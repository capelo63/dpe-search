'use client';

import { useEffect, useRef } from 'react';
import type { CandidateStatus } from '@/types/dpe';
import { scoreTier, SCORE_TIER_COLORS, type ScoredCandidate } from '@/lib/scoring';

const STATUS_LABELS: Record<CandidateStatus, string> = {
  a_verifier: 'À vérifier',
  ecarte: 'Écarté',
  visite: 'À visiter',
  confirme: 'Confirmé',
};

export function TableCandidats({
  candidates,
  hoveredId,
  selectedId,
  onRowHover,
  onStatusChange,
}: {
  candidates: ScoredCandidate[];
  hoveredId: string | null;
  selectedId: string | null;
  onRowHover: (id: string | null) => void;
  onStatusChange: (id: string, status: CandidateStatus) => void;
}) {
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  // Clic sur un marker (CarteCandidats) -> scroll + surbrillance de la ligne.
  useEffect(() => {
    if (!selectedId) return;
    rowRefs.current.get(selectedId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedId]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Adresse</th>
            <th className="py-2 pr-4 font-medium">Conso EP</th>
            <th className="py-2 pr-4 font-medium">Émission GES</th>
            <th className="py-2 pr-4 font-medium">Surface</th>
            <th className="py-2 pr-4 font-medium">Nb niveaux</th>
            <th className="py-2 pr-4 font-medium">Nb lots (RNC)</th>
            <th className="py-2 pr-4 font-medium">Année</th>
            <th className="py-2 pr-4 font-medium">Score</th>
            <th className="py-2 pr-4 font-medium">Statut</th>
            <th className="py-2 pr-4 font-medium">Street View</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => {
            const tier = scoreTier(c.score, c.total);
            const colors = SCORE_TIER_COLORS[tier];
            const streetViewUrl =
              c.latitude != null && c.longitude != null
                ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c.latitude},${c.longitude}`
                : null;
            const isActive = c.id === hoveredId || c.id === selectedId;

            return (
              <tr
                key={c.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(c.id, el);
                  else rowRefs.current.delete(c.id);
                }}
                onMouseEnter={() => onRowHover(c.id)}
                onMouseLeave={() => onRowHover(null)}
                className={`border-b border-border transition-colors ${isActive ? 'bg-accent' : ''}`}
              >
                <td className="py-2 pr-4">{c.adresse}</td>
                <td className="py-2 pr-4">{c.consoEp ?? '–'}</td>
                <td className="py-2 pr-4">{c.emissionGes ?? '–'}</td>
                <td className="py-2 pr-4">{c.surfaceHabitable ?? '–'}</td>
                <td className="py-2 pr-4">{c.bdnbNbNiveau ?? '–'}</td>
                <td className="py-2 pr-4">{c.bdnbNbLots ?? '–'}</td>
                <td className="py-2 pr-4">{c.bdnbAnneeConstruction ?? '–'}</td>
                <td className="py-2 pr-4">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors.badgeBg} ${colors.badgeText}`}
                  >
                    {c.score}/{c.total}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <select
                    className="input py-1"
                    value={c.status}
                    onChange={(e) => onStatusChange(c.id, e.target.value as CandidateStatus)}
                  >
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-4">
                  {streetViewUrl ? (
                    <a
                      href={streetViewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Voir
                    </a>
                  ) : (
                    '–'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
