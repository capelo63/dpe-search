import { z } from 'zod';
import { cpToInsee, MARSEILLE_CODES_POSTAUX } from './marseille';

// Voir docs/api-notes.md pour le détail des pièges (WAF, champ de filtre
// retenu, taille de page) découverts pendant la vérification API.
const ADEME_BASE = 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines';
const USER_AGENT = 'dpe-search/0.1 (+contact: cyril@hugon.link)';

export const etiquetteSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
export type Etiquette = z.infer<typeof etiquetteSchema>;

export const ademeSignatureSchema = z.object({
  etiquetteDpe: etiquetteSchema,
  etiquetteGes: etiquetteSchema,
  consoEp: z.number(),
  emissionGes: z.number(),
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

/**
 * Recherche par signature DPE exacte (étiquettes + conso/émission), sur un
 * ensemble de codes INSEE arrondissement donné. Pas de tolérance numérique :
 * la précision de la signature EST le mécanisme de désanonymisation (validé
 * sur cas réel — 25 Boulevard Boisson, 13004 — voir scripts/e2e-test.ts).
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
  const qs = [
    `(${inseeClause})`,
    `etiquette_dpe:${parsed.etiquetteDpe}`,
    `etiquette_ges:${parsed.etiquetteGes}`,
    `conso_5_usages_par_m2_ep:${parsed.consoEp}`,
    `emission_ges_5_usages_par_m2:${parsed.emissionGes}`,
  ].join(' AND ');

  const url = new URL(ADEME_BASE);
  url.searchParams.set('qs', qs);
  url.searchParams.set('size', '200'); // signature exacte + tout Marseille peut dépasser 50 lignes
  url.searchParams.set('select', SELECT_FIELDS);

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`ADEME ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { results: RawAdemeLine[] };
  return body.results.map(normalize);
}

export type SearchDpeParams = {
  codePostal: string;
  etiquetteDpe: Etiquette;
  etiquetteGes: Etiquette;
  consoEp: number;
  emissionGes: number;
  /** Case à cocher formulaire "chercher dans tout Marseille" (13001-13016). */
  chercherToutMarseille?: boolean;
  /** Contraintes annonce, appliquées en post-filtrage (champs absents/peu
   *  fiables selon le type de DPE côté ADEME pour un filtrage qs direct). */
  surfaceMin?: number | null;
  surfaceMax?: number | null;
  etageMin?: number | null;
  etageMax?: number | null;
};

/**
 * Point d'entrée applicatif : dérive le scope géographique du CP (ou des 16
 * arrondissements Marseille si chercherToutMarseille), interroge ADEME sur la
 * signature exacte, puis applique les contraintes surface/étage de la query.
 */
export async function searchDpe(params: SearchDpeParams): Promise<AdemeMatch[]> {
  const codesInsee = params.chercherToutMarseille
    ? MARSEILLE_CODES_POSTAUX.map(cpToInsee)
    : [cpToInsee(params.codePostal)];

  const matches = await searchDpeBySignature(
    {
      etiquetteDpe: params.etiquetteDpe,
      etiquetteGes: params.etiquetteGes,
      consoEp: params.consoEp,
      emissionGes: params.emissionGes,
    },
    codesInsee
  );

  return matches.filter((m) => {
    if (m.surfaceHabitable != null) {
      if (params.surfaceMin != null && m.surfaceHabitable < params.surfaceMin) return false;
      if (params.surfaceMax != null && m.surfaceHabitable > params.surfaceMax) return false;
    }
    if (m.numeroEtageAppartement != null) {
      if (params.etageMin != null && m.numeroEtageAppartement < params.etageMin) return false;
      if (params.etageMax != null && m.numeroEtageAppartement > params.etageMax) return false;
    }
    return true;
  });
}
