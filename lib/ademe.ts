import { z } from 'zod';
import { cpToInsee, MARSEILLE_CODES_POSTAUX } from './marseille';

// Voir docs/api-notes.md pour le détail des pièges (WAF, champ de filtre
// retenu, taille de page) découverts pendant la vérification API.
const ADEME_BASE = 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines';
const USER_AGENT = 'dpe-search/0.1 (+contact: cyril@hugon.link)';

// Tolérance d'arrondi (V1.1) : les étiquettes ne sont plus saisies (calculées,
// cf. lib/dpe-labels.ts), donc plus filtrées côté ADEME — seules les valeurs
// numériques comptent désormais. ±0.5 absorbe l'écart entre la valeur
// affichée (arrondie) sur une annonce et la valeur réellement stockée côté
// ADEME (parfois décimale, cf. docs/api-notes.md).
//
// ⚠️ Vérifié empiriquement (cas réel 25 Boulevard Boisson, conso=206,
// émission=8) : une plage ±0.5 sur CHAQUE requête, sans filtre étiquette,
// remonte des centaines de candidats bruts dès qu'on élargit à tout
// Marseille (478 avec émission, 1300+ sans), et le bâtiment recherché peut
// se retrouver n'importe où dans un ordre de retour ADEME qui n'a aucun
// rapport avec la pertinence (position 466/478 observée) — largement au-delà
// de ce que BDNB peut enrichir en une seule requête synchrone (120 req/min,
// voir lib/bdnb.ts). D'où la stratégie "exact d'abord" ci-dessous : la
// plupart des annonces affichent des valeurs déjà stockées telles quelles
// côté ADEME (validé sur ce cas réel : conso_5_usages_par_m2_ep vaut
// exactement 206, pas 205.6 arrondi) donc un match exact suffit et reste
// précis ; la tolérance ±0.5 ne sert plus qu'en repli, pour les cas plus
// rares où la valeur stockée est réellement décimale.
const ROUNDING_TOLERANCE = 0.5;

export const ademeSignatureSchema = z.object({
  consoEp: z.number(),
  emissionGes: z.number().optional(),
  /** Étage exact (numero_etage_appartement) — filtre ADEME direct, pas une plage. */
  etage: z.number().optional(),
});
export type AdemeSignature = z.infer<typeof ademeSignatureSchema>;

export type AdemeMatch = {
  numeroDpe: string;
  identifiantBan: string | null;
  adresseBan: string;
  codePostalBan: string | null;
  codeInseeBan: string;
  etiquetteDpe: string;
  etiquetteGes: string;
  consoEp: number;
  emissionGes: number;
  surfaceHabitable: number | null;
  typeBatiment: string | null;
  dateEtablissementDpe: string | null;
  numeroEtageAppartement: number | null;
  latitude: number | null;
  longitude: number | null;
};

const SELECT_FIELDS = [
  'numero_dpe',
  'identifiant_ban',
  'adresse_ban',
  'code_postal_ban',
  'code_insee_ban',
  'etiquette_dpe',
  'etiquette_ges',
  'conso_5_usages_par_m2_ep',
  'emission_ges_5_usages_par_m2',
  'surface_habitable_logement',
  'surface_habitable_immeuble',
  'type_batiment',
  'date_etablissement_dpe',
  'numero_etage_appartement',
  '_geopoint',
].join(',');

type RawAdemeLine = {
  numero_dpe: string;
  identifiant_ban?: string | null;
  adresse_ban?: string;
  code_postal_ban?: string | null;
  code_insee_ban: string;
  etiquette_dpe: string;
  etiquette_ges: string;
  conso_5_usages_par_m2_ep: number;
  emission_ges_5_usages_par_m2: number;
  surface_habitable_logement?: number;
  surface_habitable_immeuble?: number;
  type_batiment?: string;
  date_etablissement_dpe?: string;
  numero_etage_appartement?: number;
  _geopoint?: string; // "lat,lon"
};

function normalize(line: RawAdemeLine): AdemeMatch {
  const [latStr, lonStr] = (line._geopoint ?? '').split(',');
  const lat = latStr ? Number(latStr) : NaN;
  const lon = lonStr ? Number(lonStr) : NaN;
  return {
    numeroDpe: line.numero_dpe,
    identifiantBan: line.identifiant_ban ?? null,
    adresseBan: line.adresse_ban ?? '',
    codePostalBan: line.code_postal_ban ?? null,
    codeInseeBan: line.code_insee_ban,
    etiquetteDpe: line.etiquette_dpe,
    etiquetteGes: line.etiquette_ges,
    consoEp: line.conso_5_usages_par_m2_ep,
    emissionGes: line.emission_ges_5_usages_par_m2,
    surfaceHabitable: line.surface_habitable_logement ?? line.surface_habitable_immeuble ?? null,
    typeBatiment: line.type_batiment ?? null,
    dateEtablissementDpe: line.date_etablissement_dpe ?? null,
    numeroEtageAppartement: line.numero_etage_appartement ?? null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
  };
}

async function runAdemeQuery(qs: string): Promise<AdemeMatch[]> {
  const url = new URL(ADEME_BASE);
  url.searchParams.set('qs', qs);
  // Le repli tolérance (ci-dessous) peut remonter des centaines de lignes
  // sur "tout Marseille" — 2000 laisse de la marge par rapport aux ~1300
  // observés en vérification ; ADEME accepte des size bien plus grands sans
  // broncher (testé jusqu'à 5000).
  url.searchParams.set('size', '2000');
  url.searchParams.set('select', SELECT_FIELDS);

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`ADEME ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { results: RawAdemeLine[] };
  return body.results.map(normalize);
}

function buildClauses(
  inseeClause: string,
  parsed: AdemeSignature,
  useTolerance: boolean
): string {
  const clauses = [`(${inseeClause})`];

  clauses.push(
    useTolerance
      ? `conso_5_usages_par_m2_ep:[${parsed.consoEp - ROUNDING_TOLERANCE} TO ${parsed.consoEp + ROUNDING_TOLERANCE}]`
      : `conso_5_usages_par_m2_ep:${parsed.consoEp}`
  );

  if (parsed.emissionGes != null) {
    clauses.push(
      useTolerance
        ? `emission_ges_5_usages_par_m2:[${parsed.emissionGes - ROUNDING_TOLERANCE} TO ${parsed.emissionGes + ROUNDING_TOLERANCE}]`
        : `emission_ges_5_usages_par_m2:${parsed.emissionGes}`
    );
  }

  if (parsed.etage != null) {
    clauses.push(`numero_etage_appartement:${parsed.etage}`);
  }

  return clauses.join(' AND ');
}

/**
 * Recherche par signature numérique (conso EP obligatoire, émission GES et
 * étage optionnels), sur un ensemble de codes INSEE arrondissement donné.
 * Ne filtre plus sur les étiquettes DPE/GES (V1.1) : elles sont désormais
 * calculées à partir des mêmes valeurs numériques (lib/dpe-labels.ts), donc
 * un filtre par étiquette serait redondant avec le filtre numérique.
 *
 * Stratégie en deux passes (voir le commentaire sur ROUNDING_TOLERANCE pour
 * le pourquoi) : égalité stricte d'abord — rapide, précis, suffisant dans la
 * plupart des cas puisque les valeurs affichées sur une annonce correspondent
 * souvent exactement à ce qu'ADEME a stocké. Si ça ne renvoie rien, repli sur
 * une tolérance ±0.5 (arrondi d'affichage) — plus large, mais seulement
 * déclenché pour les cas qui en ont réellement besoin.
 */
export async function searchDpeBySignature(
  signature: AdemeSignature,
  codesInsee: string[]
): Promise<AdemeMatch[]> {
  const parsed = ademeSignatureSchema.parse(signature);
  if (codesInsee.length === 0) {
    throw new Error('codesInsee ne peut pas être vide');
  }

  // code_insee_ban est le champ de filtre retenu : code_postal_ban est bloqué
  // par le WAF ademe (403 systématique), code_postal_brut est une saisie
  // diagnostiqueur peu fiable qui fait perdre ~1-2% de lignes légitimes en
  // bordure d'arrondissement. Voir docs/api-notes.md.
  const inseeClause = codesInsee.map((c) => `code_insee_ban:${c}`).join(' OR ');

  const exact = await runAdemeQuery(buildClauses(inseeClause, parsed, false));
  if (exact.length > 0) {
    return exact;
  }
  return runAdemeQuery(buildClauses(inseeClause, parsed, true));
}

export type SearchDpeParams = {
  codePostal: string;
  consoEp: number;
  /** Facultative (V1.1) : absente, l'axe émission est simplement retiré de la requête ADEME. */
  emissionGes?: number;
  /** Case à cocher formulaire "chercher dans tout Marseille" (13001-13016). */
  chercherToutMarseille?: boolean;
  /** Contraintes annonce. surfaceMin/Max en post-filtrage (champ peu fiable
   *  selon le type de DPE côté ADEME pour un filtrage qs direct). etageMin/Max
   *  sert de source à un filtre ADEME exact (pas une plage) quand les deux
   *  valent la même chose — cf. searchDpeBySignature. Requis par le
   *  formulaire quand emissionGes est absent : sans lui, la signature
   *  numérique seule (conso EP) remonte un pool bien trop large pour être
   *  enrichi via BDNB en une requête synchrone (voir ROUNDING_TOLERANCE). */
  surfaceMin?: number | null;
  surfaceMax?: number | null;
  etageMin?: number | null;
  etageMax?: number | null;
};

/**
 * Point d'entrée applicatif : dérive le scope géographique du CP (ou des 16
 * arrondissements Marseille si chercherToutMarseille), interroge ADEME sur la
 * signature numérique (étage en filtre exact si etageMin === etageMax),
 * puis applique la contrainte surface de la query en post-filtrage.
 */
export async function searchDpe(params: SearchDpeParams): Promise<AdemeMatch[]> {
  const codesInsee = params.chercherToutMarseille
    ? MARSEILLE_CODES_POSTAUX.map(cpToInsee)
    : [cpToInsee(params.codePostal)];

  const etage =
    params.etageMin != null && params.etageMin === params.etageMax ? params.etageMin : undefined;

  const matches = await searchDpeBySignature(
    {
      consoEp: params.consoEp,
      emissionGes: params.emissionGes,
      etage,
    },
    codesInsee
  );

  return matches.filter((m) => {
    if (m.surfaceHabitable != null) {
      if (params.surfaceMin != null && m.surfaceHabitable < params.surfaceMin) return false;
      if (params.surfaceMax != null && m.surfaceHabitable > params.surfaceMax) return false;
    }
    return true;
  });
}
