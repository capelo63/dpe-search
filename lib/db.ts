import type { Candidate, CandidateStatus, Etiquette, NewCandidate, NewSearchQuery, SearchQuery } from '@/types/dpe';

// Mapping camelCase (types/dpe.ts) <-> snake_case (colonnes Supabase), voir
// supabase/migrations/20260815_dpe_v0.sql + 20260816_dpe_v0_context_constraints.sql

export type SearchQueryRow = {
  id: string;
  created_at: string;
  code_postal: string;
  etiquette_dpe: string;
  etiquette_ges: string | null;
  conso_ep_min: number | null;
  conso_ep_max: number | null;
  emission_ges_min: number | null;
  emission_ges_max: number | null;
  surface_min: number | null;
  surface_max: number | null;
  etage_min: number | null;
  etage_max: number | null;
  nb_lots_min: number | null;
  nb_lots_max: number | null;
  nb_niveau_max: number | null;
  annee_construction_max: number | null;
  chercher_tout_marseille: boolean;
  listing_url: string | null;
  listing_agence: string | null;
  listing_prix: number | null;
  notes: string | null;
};

export function searchQueryFromRow(row: SearchQueryRow): SearchQuery {
  return {
    id: row.id,
    createdAt: row.created_at,
    codePostal: row.code_postal,
    etiquetteDpe: row.etiquette_dpe as Etiquette,
    etiquetteGes: row.etiquette_ges as Etiquette | null,
    consoEpMin: row.conso_ep_min,
    consoEpMax: row.conso_ep_max,
    emissionGesMin: row.emission_ges_min,
    emissionGesMax: row.emission_ges_max,
    surfaceMin: row.surface_min,
    surfaceMax: row.surface_max,
    etageMin: row.etage_min,
    etageMax: row.etage_max,
    nbLotsMin: row.nb_lots_min,
    nbLotsMax: row.nb_lots_max,
    nbNiveauMax: row.nb_niveau_max,
    anneeConstructionMax: row.annee_construction_max,
    chercherToutMarseille: row.chercher_tout_marseille,
    listingUrl: row.listing_url,
    listingAgence: row.listing_agence,
    listingPrix: row.listing_prix,
    notes: row.notes,
  };
}

export function searchQueryToInsertRow(q: NewSearchQuery): Omit<SearchQueryRow, 'id' | 'created_at'> {
  return {
    code_postal: q.codePostal,
    etiquette_dpe: q.etiquetteDpe,
    etiquette_ges: q.etiquetteGes,
    conso_ep_min: q.consoEpMin,
    conso_ep_max: q.consoEpMax,
    emission_ges_min: q.emissionGesMin,
    emission_ges_max: q.emissionGesMax,
    surface_min: q.surfaceMin,
    surface_max: q.surfaceMax,
    etage_min: q.etageMin,
    etage_max: q.etageMax,
    nb_lots_min: q.nbLotsMin,
    nb_lots_max: q.nbLotsMax,
    nb_niveau_max: q.nbNiveauMax,
    annee_construction_max: q.anneeConstructionMax,
    chercher_tout_marseille: q.chercherToutMarseille,
    listing_url: q.listingUrl,
    listing_agence: q.listingAgence,
    listing_prix: q.listingPrix,
    notes: q.notes,
  };
}

export type CandidateRow = {
  id: string;
  query_id: string;
  ademe_numero: string | null;
  identifiant_ban: string | null;
  adresse: string;
  code_postal: string;
  latitude: number | null;
  longitude: number | null;
  conso_ep: number | null;
  emission_ges: number | null;
  surface_habitable: number | null;
  bdnb_annee_construction: number | null;
  bdnb_hauteur_moyenne: number | null;
  bdnb_surface_batie: number | null;
  bdnb_nb_lots: number | null;
  bdnb_nb_niveau: number | null;
  bdnb_dpe_batiment: string | null;
  bdnb_enriched_at: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

export function candidateFromRow(row: CandidateRow): Candidate {
  return {
    id: row.id,
    queryId: row.query_id,
    ademeNumero: row.ademe_numero,
    identifiantBan: row.identifiant_ban,
    adresse: row.adresse,
    codePostal: row.code_postal,
    latitude: row.latitude,
    longitude: row.longitude,
    consoEp: row.conso_ep,
    emissionGes: row.emission_ges,
    surfaceHabitable: row.surface_habitable,
    bdnbAnneeConstruction: row.bdnb_annee_construction,
    bdnbHauteurMoyenne: row.bdnb_hauteur_moyenne,
    bdnbSurfaceBatie: row.bdnb_surface_batie,
    bdnbNbLots: row.bdnb_nb_lots,
    bdnbNbNiveau: row.bdnb_nb_niveau,
    bdnbDpeBatiment: row.bdnb_dpe_batiment,
    bdnbEnrichedAt: row.bdnb_enriched_at,
    status: row.status as CandidateStatus,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function candidateToInsertRow(c: NewCandidate): Omit<CandidateRow, 'id' | 'created_at'> {
  return {
    query_id: c.queryId,
    ademe_numero: c.ademeNumero,
    identifiant_ban: c.identifiantBan,
    adresse: c.adresse,
    code_postal: c.codePostal,
    latitude: c.latitude,
    longitude: c.longitude,
    conso_ep: c.consoEp,
    emission_ges: c.emissionGes,
    surface_habitable: c.surfaceHabitable,
    bdnb_annee_construction: c.bdnbAnneeConstruction,
    bdnb_hauteur_moyenne: c.bdnbHauteurMoyenne,
    bdnb_surface_batie: c.bdnbSurfaceBatie,
    bdnb_nb_lots: c.bdnbNbLots,
    bdnb_nb_niveau: c.bdnbNbNiveau,
    bdnb_dpe_batiment: c.bdnbDpeBatiment,
    bdnb_enriched_at: c.bdnbEnrichedAt,
    status: c.status,
    notes: c.notes,
  };
}
