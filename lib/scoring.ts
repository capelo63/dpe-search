import type { Candidate, SearchQuery } from '@/types/dpe';

export type Criterion = {
  label: string;
  /** true si le candidat satisfait le critère. */
  passed: boolean;
  /** false si la query n'avait pas renseigné ce critère : n'entre ni dans le score ni dans le total. */
  applicable: boolean;
};

export type CandidateScore = {
  score: number;
  total: number;
  criteria: Criterion[];
};

export type ScoredCandidate = Candidate & CandidateScore;

export type ScoreTier = 'high' | 'medium' | 'low';

/** Score parfait -> vert, un cran en dessous -> orange, le reste -> gris. Générique : ne suppose pas un total fixe. */
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
 * Score "N/M" dynamique (V1.1) : M dépend des critères réellement renseignés
 * sur la query, pas d'un total fixe. Signature (conso EP) et surface ne sont
 * plus comptées ici — ce sont des pré-filtres côté recherche ADEME
 * (lib/ademe.ts::searchDpe), donc structurellement toujours vraies pour tout
 * candidat persisté, elles ne discriminaient rien. Émission GES, en
 * revanche, redevient un critère à part entière : depuis que la recherche
 * tolère ±0.5 (lib/ademe.ts), un candidat peut passer le pré-filtre sans
 * matcher exactement — le critère ici distingue un match exact d'un match
 * "juste dans la fenêtre de tolérance". Un critère non applicable (non
 * renseigné sur la query) est exclu du décompte, pas compté comme satisfait.
 */
export function scoreCandidate(query: SearchQuery, candidate: Candidate): CandidateScore {
  const criteria: Criterion[] = [
    emissionPrecisionCriterion(query, candidate),
    nbNiveauCriterion(query, candidate),
    nbLotsCriterion(query, candidate),
    anneeConstructionCriterion(query, candidate),
  ];

  const applicable = criteria.filter((c) => c.applicable);
  return {
    score: applicable.filter((c) => c.passed).length,
    total: applicable.length,
    criteria,
  };
}

function emissionPrecisionCriterion(query: SearchQuery, candidate: Candidate): Criterion {
  if (query.emissionGesMin == null) {
    return { label: 'Émission GES', passed: true, applicable: false };
  }
  const label = `Émission GES = ${query.emissionGesMin} kgCO2/m²/an (exact)`;
  if (candidate.emissionGes == null) {
    return { label, passed: true, applicable: true };
  }
  return { label, passed: candidate.emissionGes === query.emissionGesMin, applicable: true };
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
