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
  dpeBatiment: string | null;
};

type RawBdnbLine = {
  batiment_groupe_id: string;
  libelle_adr_principale_ban: string | null;
  hauteur_mean: number | null;
  annee_construction: number | null;
  nb_log: number | null;
  nb_log_rnc: number | null;
  nb_niveau: number | null;
  classe_bilan_dpe: string | null;
};

function normalize(line: RawBdnbLine): BdnbEnrichment {
  return {
    batimentGroupeId: line.batiment_groupe_id,
    libelleAdresse: line.libelle_adr_principale_ban,
    hauteurMoyenne: line.hauteur_mean,
    anneeConstruction: line.annee_construction,
    nbLog: line.nb_log,
    nbLogRnc: line.nb_log_rnc,
    nbLots: line.nb_log_rnc ?? line.nb_log,
    nbNiveau: line.nb_niveau,
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
    'batiment_groupe_id,libelle_adr_principale_ban,hauteur_mean,annee_construction,nb_log,nb_log_rnc,nb_niveau,classe_bilan_dpe'
  );

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`BDNB ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as RawBdnbLine[];
  return body[0] ? normalize(body[0]) : null;
}

export type EnrichmentTarget = { codeInsee: string; identifiantBan: string | null };

/**
 * Enrichit plusieurs candidats en série (offre Open : 120 req/min, pas de
 * clé — un batch séquentiel reste largement sous la limite pour une
 * shortlist typique). Retourne un enrichissement par candidat, même ordre,
 * `null` si pas d'identifiant_ban ou pas de bâtiment apparié dans BDNB.
 */
export async function enrichBuildings(
  targets: EnrichmentTarget[]
): Promise<(BdnbEnrichment | null)[]> {
  const results: (BdnbEnrichment | null)[] = [];
  for (const t of targets) {
    if (!t.identifiantBan) {
      results.push(null);
      continue;
    }
    results.push(await enrichBuilding(t.codeInsee, t.identifiantBan));
  }
  return results;
}
