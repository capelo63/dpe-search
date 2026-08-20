'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Candidate, CandidateStatus, SearchQuery } from '@/types/dpe';
import { scoreCandidate, type ScoredCandidate } from '@/lib/scoring';
import { FiltresDynamiques, type Filters, type FilterBounds } from './FiltresDynamiques';
import { TableCandidats } from './TableCandidats';
import { CarteCandidats } from './CarteCandidats';

export function ShortlistView({
  query,
  candidates: initialCandidates,
}: {
  query: SearchQuery;
  candidates: Candidate[];
}) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const scored = useMemo<ScoredCandidate[]>(
    () => candidates.map((c) => ({ ...c, ...scoreCandidate(query, c) })),
    [candidates, query]
  );

  const bounds = useMemo<FilterBounds>(() => {
    const niveaux = scored.map((c) => c.bdnbNbNiveau).filter((v): v is number => v != null);
    const annees = scored.map((c) => c.bdnbAnneeConstruction).filter((v): v is number => v != null);
    const lots = scored.map((c) => c.bdnbNbLots).filter((v): v is number => v != null);
    // Bornes suggérées par le brief (1-6 / 1850-2020 / 1-50), étendues si un
    // candidat réel les dépasse — sinon un candidat pourrait être masqué dès
    // l'état initial du filtre par un plafond de slider trop bas.
    return {
      nbNiveau: { min: 1, max: Math.max(6, ...niveaux) },
      annee: { min: 1850, max: Math.max(2020, ...annees) },
      nbLots: { min: 1, max: Math.max(50, ...lots) },
    };
  }, [scored]);

  const surfaceReference =
    query.surfaceMin != null && query.surfaceMax != null ? (query.surfaceMin + query.surfaceMax) / 2 : null;

  const [filters, setFilters] = useState<Filters>(() => ({
    nbNiveauMax: bounds.nbNiveau.max,
    anneeConstructionMax: bounds.annee.max,
    nbLotsMin: bounds.nbLots.min,
    nbLotsMax: bounds.nbLots.max,
    surfaceTolerancePct: 30,
  }));

  const filtered = useMemo(
    () =>
      scored.filter((c) => {
        if (c.bdnbNbNiveau != null && c.bdnbNbNiveau > filters.nbNiveauMax) return false;
        if (c.bdnbAnneeConstruction != null && c.bdnbAnneeConstruction >= filters.anneeConstructionMax) return false;
        if (
          c.bdnbNbLots != null &&
          (c.bdnbNbLots < filters.nbLotsMin || c.bdnbNbLots > filters.nbLotsMax)
        )
          return false;
        if (surfaceReference != null && c.surfaceHabitable != null) {
          const lo = surfaceReference * (1 - filters.surfaceTolerancePct / 100);
          const hi = surfaceReference * (1 + filters.surfaceTolerancePct / 100);
          if (c.surfaceHabitable < lo || c.surfaceHabitable > hi) return false;
        }
        return true;
      }),
    [scored, filters, surfaceReference]
  );

  const handleMarkerClick = useCallback((id: string) => setSelectedId(id), []);

  async function handleStatusChange(id: string, status: CandidateStatus) {
    const previous = candidates;
    setCandidates((cs) => cs.map((c) => (c.id === id ? { ...c, status } : c)));
    try {
      const res = await fetch(`/api/candidates/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      setCandidates(previous); // rollback si le PATCH échoue
    }
  }

  if (candidates.length === 0) {
    return (
      <p className="mt-8 text-sm text-muted-foreground">
        Aucun candidat trouvé sur cette signature. Essayez d&apos;élargir à tout Marseille depuis le
        formulaire.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <FiltresDynamiques
        bounds={bounds}
        filters={filters}
        onChange={setFilters}
        surfaceReferenceDisponible={surfaceReference != null}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          <p>Aucun candidat ne passe ces filtres.</p>
          <Link
            href={`/?queryId=${query.id}`}
            className="mt-3 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Modifier la recherche
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <TableCandidats
            candidates={filtered}
            hoveredId={hoveredId}
            selectedId={selectedId}
            onRowHover={setHoveredId}
            onStatusChange={handleStatusChange}
          />
          <CarteCandidats
            candidates={filtered}
            hoveredId={hoveredId}
            onMarkerClick={handleMarkerClick}
            onMarkerHover={setHoveredId}
          />
        </div>
      )}
    </div>
  );
}
