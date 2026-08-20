// Voir docs/api-notes.md pour le détail des pièges (colonnes non filtrables,
// timeout sur clé d'adresse seule, nb_log vs nb_log_rnc) découverts pendant
// la vérification API.
const BDNB_BASE = 'https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet';
const USER_AGENT = 'dpe-search/0.1 (+contact: cyril@hugon.link)';

export type BdnbEnrichment = {
  batimentGroupeId: string;
  libelleAdresse: string | null;
  hauteurMoyenne: number | null;
  anneeConstruction: number | null;
  nbLog: number | null;
  nbLogRnc: number | null;
  /** nbLogRnc (registre copropriétés) si dispo, sinon repli sur nbLog
   *  (estimation géométrique BDNB, sous-compte les immeubles anciens
   *  subdivisés — validé sur cas réel, voir scripts/e2e-test.ts). */
  nbLots: number | null;
  nbNiveau: number | null;
  surfaceEmpriseSol: number | null;
  dpeBatiment: string | null;
};

export type RawBdnbLine = {
  batiment_groupe_id: string;
  libelle_adr_principale_ban: string | null;
  hauteur_mean: number | null;
  annee_construction: number | null;
  nb_log: number | null;
  nb_log_rnc: number | null;
  nb_niveau: number | null;
  surface_emprise_sol: number | null;
  classe_bilan_dpe: string | null;
};

// Plus haut que la plus haute tour d'habitation de Marseille : au-delà, on
// considère qu'il s'agit d'une extraction géométrique BDNB corrompue plutôt
// qu'un vrai bâtiment (observé en prod : nb_niveau=64.4 sur un candidat).
const MAX_PLAUSIBLE_NB_NIVEAU = 20;

function roundOrNull(value: number | null): number | null {
  return value == null ? null : Math.round(value);
}

/**
 * BDNB renvoie parfois nb_log / nb_log_rnc / nb_niveau en décimal (ex.
 * nb_log_rnc=19.05, nb_niveau=3.0) — arrondi systématique avant tout usage
 * (colonnes Supabase entières, scoring). nb_niveau subit en plus un
 * sanity-check : au-delà de MAX_PLAUSIBLE_NB_NIVEAU c'est très probablement
 * une valeur corrompue (ex. 64.4 observé en prod), pas un vrai gratte-ciel
 * marseillais — on la neutralise en `null` plutôt que de polluer le scoring.
 */
export function normalizeBdnbLine(line: RawBdnbLine): BdnbEnrichment {
  const nbLog = roundOrNull(line.nb_log);
  const nbLogRnc = roundOrNull(line.nb_log_rnc);
  let nbNiveau = roundOrNull(line.nb_niveau);

  if (nbNiveau != null && nbNiveau > MAX_PLAUSIBLE_NB_NIVEAU) {
    console.warn(
      `[lib/bdnb] nb_niveau=${nbNiveau} rejeté pour ${line.batiment_groupe_id} ` +
        `(> ${MAX_PLAUSIBLE_NB_NIVEAU}, probable extraction géométrique BDNB corrompue) — remplacé par null.`
    );
    nbNiveau = null;
  }

  return {
    batimentGroupeId: line.batiment_groupe_id,
    libelleAdresse: line.libelle_adr_principale_ban,
    hauteurMoyenne: line.hauteur_mean,
    anneeConstruction: line.annee_construction,
    nbLog,
    nbLogRnc,
    nbLots: nbLogRnc ?? nbLog,
    nbNiveau,
    surfaceEmpriseSol: line.surface_emprise_sol,
    dpeBatiment: line.classe_bilan_dpe,
  };
}

/**
 * Enrichit un candidat ADEME via la jointure identifiant_ban (ADEME) <->
 * cle_interop_adr_principale_ban (BDNB). codeInsee doit toujours être fourni
 * en plus de la clé d'adresse : filtrer sur cle_interop_adr_principale_ban
 * seul cause un timeout 500 (colonne non indexée seule sur cette vue large).
 */
export async function enrichBuilding(
  codeInsee: string,
  identifiantBan: string
): Promise<BdnbEnrichment | null> {
  const url = new URL(BDNB_BASE);
  url.searchParams.set('code_commune_insee', `eq.${codeInsee}`);
  url.searchParams.set('cle_interop_adr_principale_ban', `eq.${identifiantBan}`);
  url.searchParams.set(
    'select',
    'batiment_groupe_id,libelle_adr_principale_ban,hauteur_mean,annee_construction,nb_log,nb_log_rnc,nb_niveau,surface_emprise_sol,classe_bilan_dpe'
  );

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`BDNB ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as RawBdnbLine[];
  return body[0] ? normalizeBdnbLine(body[0]) : null;
}

export type EnrichmentTarget = { codeInsee: string; identifiantBan: string | null };

// Depuis que lib/ademe.ts ne filtre plus sur les étiquettes (V1.1, tolérance
// ±0.5 sur les seules valeurs numériques), une recherche peut remonter des
// centaines de candidats (jusqu'à ~1150 observés sur "tout Marseille" sans
// émission — voir docs/api-notes.md). Un burst au-delà de ce plafond
// dépasserait la limite 120 req/min de l'offre BDNB Open en un seul appel.
const BDNB_ENRICHMENT_LIMIT = 100;

/**
 * Enrichit jusqu'à BDNB_ENRICHMENT_LIMIT candidats en parallèle (Promise.all,
 * un seul burst — largement sous la limite 120 req/min de l'offre Open sur
 * un appel isolé). Au-delà, les candidats surnuméraires restent dans la
 * shortlist (persistés côté app/api/queries/route.ts) mais sans
 * enrichissement BDNB : `bdnbNbNiveau`/`bdnbNbLots`/etc. à `null`, ce qui
 * les traite en "pas assez d'info pour exclure" côté lib/scoring.ts plutôt
 * que de les faire échouer ou de les perdre silencieusement.
 * Retourne un enrichissement par candidat, même ordre, `null` si pas
 * d'identifiant_ban, pas de bâtiment apparié dans BDNB, ou au-delà du plafond.
 */
export async function enrichBuildings(
  targets: EnrichmentTarget[]
): Promise<(BdnbEnrichment | null)[]> {
  const results: (BdnbEnrichment | null)[] = new Array(targets.length).fill(null);

  const toEnrich = targets
    .map((t, index) => ({ t, index }))
    .filter(({ t }) => t.identifiantBan != null)
    .slice(0, BDNB_ENRICHMENT_LIMIT);

  // Chaque appel est isolé (pas de Promise.all nu) : observé en vérification,
  // un timeout BDNB isolé ("statement timeout", 500) sur UN candidat ne doit
  // pas faire perdre l'enrichissement de tous les autres. Le candidat en
  // échec retombe simplement à `null` (même traitement qu'un bâtiment non
  // apparié), tracé via console.warn pour ne pas le masquer silencieusement.
  const enriched = await Promise.all(
    toEnrich.map(({ t }) =>
      enrichBuilding(t.codeInsee, t.identifiantBan as string).catch((err: Error) => {
        console.warn(`[lib/bdnb] enrichissement échoué pour identifiant_ban=${t.identifiantBan} : ${err.message}`);
        return null;
      })
    )
  );
  toEnrich.forEach(({ index }, i) => {
    results[index] = enriched[i];
  });

  return results;
}
