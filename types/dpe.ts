import { z } from 'zod';
import { MARSEILLE_CODES_POSTAUX } from '@/lib/marseille';

export const etiquetteSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
export type Etiquette = z.infer<typeof etiquetteSchema>;

export type CandidateStatus = 'a_verifier' | 'ecarte' | 'confirme' | 'visite';

// Miroir de dpe_search_query (supabase/migrations/20260815_dpe_v0.sql +
// 20260816_dpe_v0_context_constraints.sql + 20260818_dpe_v0_chercher_tout_marseille.sql).
// conso_ep_min/max et emission_ges_min/max sont des colonnes range en base,
// mais V0 fait du matching exact (pas de tolérance, voir scripts/e2e-test.ts) :
// min = max = valeur saisie à l'écriture.
export type SearchQuery = {
  id: string;
  createdAt: string;
  codePostal: string;
  etiquetteDpe: Etiquette;
  etiquetteGes: Etiquette;
  consoEpMin: number | null;
  consoEpMax: number | null;
  emissionGesMin: number | null;
  emissionGesMax: number | null;
  surfaceMin: number | null;
  surfaceMax: number | null;
  etageMin: number | null;
  etageMax: number | null;
  nbLotsMin: number | null;
  nbLotsMax: number | null;
  nbNiveauMax: number | null;
  anneeConstructionMax: number | null;
  chercherToutMarseille: boolean;
  listingUrl: string | null;
  listingAgence: string | null;
  listingPrix: number | null;
  notes: string | null;
};

export type NewSearchQuery = Omit<SearchQuery, 'id' | 'createdAt'>;

// Miroir de dpe_candidate.
export type Candidate = {
  id: string;
  queryId: string;
  ademeNumero: string | null;
  identifiantBan: string | null;
  adresse: string;
  codePostal: string;
  latitude: number | null;
  longitude: number | null;
  consoEp: number | null;
  emissionGes: number | null;
  surfaceHabitable: number | null;
  bdnbAnneeConstruction: number | null;
  bdnbHauteurMoyenne: number | null;
  bdnbSurfaceBatie: number | null;
  bdnbNbLots: number | null;
  bdnbNbNiveau: number | null;
  bdnbDpeBatiment: string | null;
  bdnbEnrichedAt: string | null;
  status: CandidateStatus;
  notes: string | null;
  createdAt: string;
};

export type NewCandidate = Omit<Candidate, 'id' | 'createdAt'>;

// --- Schéma Zod partagé client/serveur pour le formulaire de recherche ---
// Utilisé tel quel côté client (validation inline sur submit) et côté
// serveur (POST /api/queries) : une seule définition, un seul comportement.

/**
 * Nettoie un nombre "bruité" collé depuis une annonce (ex. "206 kWh/m²/an EP",
 * "8 kgCO2/m²/an") : ne garde que chiffres/point/virgule, puis parseFloat.
 * parseFloat s'arrête à la première virgule (pas de conversion virgule ->
 * point) : sans incidence ici, les signatures DPE affichées sur une annonce
 * sont toujours des entiers (voir docs/api-notes.md).
 */
function cleanNoisyNumber(val: unknown): unknown {
  if (typeof val === 'number' || val == null) return val;
  if (typeof val !== 'string') return val;
  const cleaned = val.replace(/[^\d.,]/g, '');
  if (cleaned === '') return undefined;
  const parsed = parseFloat(cleaned);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function noisy<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(cleanNoisyNumber, schema);
}

export const codePostalSchema = z.enum(MARSEILLE_CODES_POSTAUX as [string, ...string[]], {
  errorMap: () => ({ message: 'Code postal Marseille (13001-13016) uniquement' }),
});

export const newSearchQuerySchema = z
  .object({
    // (a) Signature DPE — obligatoire
    etiquetteDpe: etiquetteSchema,
    etiquetteGes: etiquetteSchema,
    consoEp: noisy(z.number().nonnegative()),
    emissionGes: noisy(z.number().nonnegative()),

    // (b) Périmètre géographique — obligatoire
    codePostal: codePostalSchema,
    chercherToutMarseille: z.boolean().default(false),

    // (c) Contraintes contexte — optionnelles, repliables dans le formulaire
    surfaceApprox: noisy(z.number().positive().optional()),
    surfaceTolerancePct: noisy(z.number().min(0).max(100).optional()).default(15),
    nbNiveauMax: noisy(z.number().int().nonnegative().optional()),
    nbLotsMin: noisy(z.number().int().nonnegative().optional()),
    nbLotsMax: noisy(z.number().int().nonnegative().optional()),
    anneeConstructionMax: noisy(z.number().int().optional()),

    // (d) Référence annonce — optionnelle
    listingUrl: z
      .union([z.string().url(), z.literal('')])
      .optional()
      .transform((v) => (v ? v : undefined)),
    listingAgence: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined)),
    listingPrix: noisy(z.number().int().nonnegative().optional()),
    notes: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((data) => data.nbLotsMin == null || data.nbLotsMax == null || data.nbLotsMin <= data.nbLotsMax, {
    message: 'Le nb de lots min doit être ≤ au nb de lots max',
    path: ['nbLotsMax'],
  });

export type NewSearchQueryInput = z.infer<typeof newSearchQuerySchema>;
