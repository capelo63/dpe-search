import type { Candidate, SearchQuery } from '@/types/dpe';

export type Criterion = {
  label: string;
  /** true si le candidat satisfait le critère, ou si le critère n'était pas renseigné sur la query (vacuously true). */
  passed: boolean;
  /** false si la query n'avait pas renseigné ce critère : compte quand même dans le score, mais n'a rien "prouvé". */
  applicable: boolean;
};

export type CandidateScore = {
  score: number;
  total: number;
  criteria: Criterion[];
};

export type ScoredCandidate = Candidate & CandidateScore;

export type ScoreTier = 'high' | 'medium' | 'low';

/** 5/5 -> vert, 4/5 -> orange, ≤3/5 -> gris. */
export function scoreTier(score: number, total: number): ScoreTier {
  if (score >= total) return 'high';
  if (score === total - 1) return 'medium';
  return 'low';
}

export const SCORE_TIER_COLORS: Record<ScoreTier, { marker: string; badgeBg: string; badgeText: string }> = {
  high: { marker: '#22c55e', badgeBg: 'bg-green-100', badgeText: 'text-green-800' },
  medium: { marker: '#f97316', badgeBg: 'bg-orange-100', badgeText: 'text-orange-800' },
  low: { marker: '#9ca3af', badgeBg: 'bg-gray-100', badgeText: 'text-gray-600' },
};

/**
 * Score "N/5" d'un candidat :
 * 1. Signature DPE exacte — toujours vrai, le filtre ADEME le garantit
 *    structurellement pour tout candidat retourné.
 * 2. Surface habitable — toujours vrai pour un candidat persisté : déjà
 *    appliqué en pré-filtre côté ADEME (lib/ademe.ts::searchDpe), pas
 *    ré-évalué ici.
 * 3-5. Nb niveaux / nb de lots / année de construction — évalués ici contre
 *    l'enrichissement BDNB du candidat, car ces valeurs n'existent qu'après
 *    la jointure ADEME->BDNB (pas filtrables au moment de la requête ADEME).
 *
 * Un critère non renseigné sur la query (`applicable: false`) compte comme
 * satisfait plutôt que d'exclure le candidat.
 */
export function scoreCandidate(query: SearchQuery, candidate: Candidate): CandidateScore {
  const criteria: Criterion[] = [
    {
      label: `Signature DPE exacte (${query.etiquetteDpe}/${query.etiquetteGes}, ${query.consoEpMin} kWh/m²/an, ${query.emissionGesMin} kgCO2/m²/an)`,
      passed: true,
      applicable: true,
    },
    surfaceCriterion(query),
    nbNiveauCriterion(query, candidate),
    nbLotsCriterion(query, candidate),
    anneeConstructionCriterion(query, candidate),
  ];

  return {
    score: criteria.filter((c) => c.passed).length,
    total: criteria.length,
    criteria,
  };
}

function surfaceCriterion(query: SearchQuery): Criterion {
  const applicable = query.surfaceMin != null || query.surfaceMax != null;
  return {
    label: applicable
      ? `Surface habitable ∈ [${query.surfaceMin ?? '–'}, ${query.surfaceMax ?? '–'}] m²`
      : 'Surface habitable',
    passed: true, // pré-filtré à la recherche ADEME, donc toujours vrai pour un candidat persisté
    applicable,
  };
}

function nbNiveauCriterion(query: SearchQuery, candidate: Candidate): Criterion {
  if (query.nbNiveauMax == null) {
    return { label: 'Nb niveaux max', passed: true, applicable: false };
  }
  const label = `Nb niveaux ≤ ${query.nbNiveauMax}`;
  if (candidate.bdnbNbNiveau == null) {
    return { label, passed: true, applicable: true };
  }
  return { label, passed: candidate.bdnbNbNiveau <= query.nbNiveauMax, applicable: true };
}

function nbLotsCriterion(query: SearchQuery, candidate: Candidate): Criterion {
  if (query.nbLotsMin == null && query.nbLotsMax == null) {
    return { label: 'Nb de lots', passed: true, applicable: false };
  }
  const label = `Nb de lots ∈ [${query.nbLotsMin ?? '–'}, ${query.nbLotsMax ?? '–'}]`;
  if (candidate.bdnbNbLots == null) {
    return { label, passed: true, applicable: true };
  }
  const passed =
    (query.nbLotsMin == null || candidate.bdnbNbLots >= query.nbLotsMin) &&
    (query.nbLotsMax == null || candidate.bdnbNbLots <= query.nbLotsMax);
  return { label, passed, applicable: true };
}

function anneeConstructionCriterion(query: SearchQuery, candidate: Candidate): Criterion {
  if (query.anneeConstructionMax == null) {
    return { label: 'Année de construction max', passed: true, applicable: false };
  }
  const label = `Année de construction < ${query.anneeConstructionMax}`;
  if (candidate.bdnbAnneeConstruction == null) {
    return { label, passed: true, applicable: true };
  }
  return { label, passed: candidate.bdnbAnneeConstruction < query.anneeConstructionMax, applicable: true };
}
