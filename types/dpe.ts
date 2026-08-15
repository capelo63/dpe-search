export type Etiquette = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export type CandidateStatus = 'a_verifier' | 'ecarte' | 'confirme' | 'visite';

// Miroir de dpe_search_query (supabase/migrations/20260815_dpe_v0.sql).
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
  bdnbAnneeConstruction: number | null;
  bdnbHauteurMoyenne: number | null;
  bdnbSurfaceBatie: number | null;
  bdnbNbLots: number | null;
  bdnbDpeBatiment: string | null;
  bdnbEnrichedAt: string | null;
  status: CandidateStatus;
  notes: string | null;
  createdAt: string;
};

export type NewCandidate = Omit<Candidate, 'id' | 'createdAt'>;
