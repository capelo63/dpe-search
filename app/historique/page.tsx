'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getRecentQueryIds, removeRecentQueries, clearRecentQueries } from '@/lib/recent-queries';
import type { CandidateStatus, SearchQuery } from '@/types/dpe';

type HistoryEntry = {
  query: SearchQuery;
  candidateCount: number;
  statusCounts: Partial<Record<CandidateStatus, number>>;
};

type LoadState = 'loading' | 'empty' | 'loaded' | 'error';

const STATUS_ORDER: CandidateStatus[] = ['a_verifier', 'visite', 'confirme', 'ecarte'];

function statusLabel(status: CandidateStatus, count: number): string {
  switch (status) {
    case 'a_verifier':
      return 'à vérifier';
    case 'visite':
      return 'à visiter';
    case 'confirme':
      return count > 1 ? 'confirmés' : 'confirmé';
    case 'ecarte':
      return count > 1 ? 'écartés' : 'écarté';
  }
}

function formatRelativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH}h`;
  const diffDays = Math.floor(diffH / 24);
  if (diffDays === 1) return 'hier';
  if (diffDays < 30) return `il y a ${diffDays} jours`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `il y a ${diffMonths} mois`;
  const diffYears = Math.floor(diffDays / 365);
  return `il y a ${diffYears} an${diffYears > 1 ? 's' : ''}`;
}

export default function HistoriquePage() {
  const [state, setState] = useState<LoadState>('loading');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const ids = getRecentQueryIds();
    if (ids.length === 0) {
      setState('empty');
      return;
    }

    fetch('/api/queries/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
        return body as { entries: HistoryEntry[]; missing: string[] };
      })
      .then((body) => {
        if (body.missing.length > 0) removeRecentQueries(body.missing);
        setEntries(body.entries);
        setState(body.entries.length === 0 ? 'empty' : 'loaded');
      })
      .catch((err: Error) => {
        setErrorMessage(err.message);
        setState('error');
      });
  }, []);

  function handleClearHistory() {
    const confirmed = window.confirm(
      "Vider l'historique local ? Les recherches restent en base, mais tu ne les verras plus ici depuis ce navigateur."
    );
    if (!confirmed) return;
    clearRecentQueries();
    setEntries([]);
    setState('empty');
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dpe-search-historique-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Historique</h1>
        <Link
          href="/"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Nouvelle recherche
        </Link>
      </div>

      <div className="mt-8">
        {state === 'loading' && (
          <p className="text-sm text-muted-foreground">Chargement de l&apos;historique…</p>
        )}

        {state === 'error' && (
          <p className="text-sm text-destructive">{errorMessage ?? 'Erreur inconnue.'}</p>
        )}

        {state === 'empty' && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Aucune recherche récente. Lance ta première recherche.
            </p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Nouvelle recherche
            </Link>
          </div>
        )}

        {state === 'loaded' && (
          <ul className="divide-y divide-border">
            {entries.map((entry) => (
              <HistoryRow key={entry.query.id} entry={entry} />
            ))}
          </ul>
        )}
      </div>

      {state === 'loaded' && (
        <div className="mt-10 flex gap-4 text-sm text-muted-foreground">
          <button type="button" onClick={handleClearHistory} className="hover:underline">
            Vider l&apos;historique local
          </button>
          <button type="button" onClick={handleExport} className="hover:underline">
            Exporter en JSON
          </button>
        </div>
      )}
    </main>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const { query, candidateCount, statusCounts } = entry;
  const cpLabel = query.chercherToutMarseille ? 'Tout Marseille' : query.codePostal;
  const etiquettes = query.etiquetteGes ? `${query.etiquetteDpe}/${query.etiquetteGes}` : query.etiquetteDpe;
  const signature =
    query.emissionGesMin != null
      ? `${etiquettes} · ${query.consoEpMin ?? '–'} · ${query.emissionGesMin}`
      : `${etiquettes} · ${query.consoEpMin ?? '–'}`;
  const statusParts = STATUS_ORDER.filter((s) => (statusCounts[s] ?? 0) > 0).map(
    (s) => `${statusCounts[s]} ${statusLabel(s, statusCounts[s] ?? 0)}`
  );
  const listingRef = query.listingAgence || query.listingUrl;
  const absoluteDate = new Date(query.createdAt).toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <li>
      <Link
        href={`/shortlist/${query.id}`}
        className="flex flex-col gap-1 py-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium">{cpLabel}</span>
          <span className="shrink-0 text-xs text-muted-foreground" title={absoluteDate}>
            {formatRelativeDate(query.createdAt)}
          </span>
        </div>
        <div className="text-sm text-muted-foreground">{signature}</div>
        <div className="text-sm">
          {candidateCount} candidat{candidateCount !== 1 ? 's' : ''}
          {statusParts.length > 0 && (
            <span className="text-muted-foreground"> · {statusParts.join(' · ')}</span>
          )}
        </div>
        {listingRef && <div className="truncate text-xs text-muted-foreground">{listingRef}</div>}
      </Link>
    </li>
  );
}
