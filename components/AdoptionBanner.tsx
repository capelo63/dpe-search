'use client';

import { useEffect, useState } from 'react';
import { getRecentQueryIds } from '@/lib/recent-queries';

const DISMISSED_KEY = 'dpe-search:adoption-dismissed';

type State =
  | { phase: 'hidden' }
  | { phase: 'prompt'; ids: string[] }
  | { phase: 'adopting' }
  | { phase: 'done'; adopted: number; skipped: number }
  | { phase: 'error'; message: string };

function markDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, 'true');
  } catch {
    // localStorage indisponible (navigation privée stricte...) : la bannière
    // pourra réapparaître à la prochaine visite, sans conséquence grave.
  }
}

/**
 * Migration douce (checkpoint auth V1) : au premier login, propose de
 * rattacher au compte les queries créées en anonyme, retrouvées via le
 * localStorage existant (lib/recent-queries.ts, déjà utilisé par
 * /app/historique). Pas de re-proposition après un "Ignorer" ou un
 * rattachement réussi (flag localStorage dédié, distinct de la liste des
 * ids elle-même qui reste utile à /app/historique).
 */
export function AdoptionBanner() {
  const [state, setState] = useState<State>({ phase: 'hidden' });

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISSED_KEY) === 'true') return;
    } catch {
      return;
    }
    const ids = getRecentQueryIds();
    if (ids.length > 0) setState({ phase: 'prompt', ids });
  }, []);

  function dismiss() {
    markDismissed();
    setState({ phase: 'hidden' });
  }

  async function adopt(ids: string[]) {
    setState({ phase: 'adopting' });
    try {
      const res = await fetch('/api/queries/adopt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryIds: ids }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      markDismissed();
      setState({ phase: 'done', adopted: body.adopted, skipped: body.skipped });
    } catch (err) {
      setState({ phase: 'error', message: (err as Error).message });
    }
  }

  if (state.phase === 'hidden') return null;

  return (
    <div className="mb-6 rounded-lg border border-border bg-accent/50 p-4 text-sm">
      {state.phase === 'prompt' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            Nous avons trouvé {state.ids.length} recherche{state.ids.length !== 1 ? 's' : ''} précédente
            {state.ids.length !== 1 ? 's' : ''} dans votre historique local. Voulez-vous les rattacher à
            votre compte ?
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => adopt(state.ids)}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              Rattacher
            </button>
            <button type="button" onClick={dismiss} className="text-muted-foreground hover:underline">
              Ignorer
            </button>
          </div>
        </div>
      )}

      {state.phase === 'adopting' && <p>Rattachement en cours…</p>}

      {state.phase === 'done' && (
        <p>
          {state.adopted} recherche{state.adopted !== 1 ? 's' : ''} adoptée{state.adopted !== 1 ? 's' : ''}
          {state.skipped > 0 &&
            ` · ${state.skipped} ignorée${state.skipped !== 1 ? 's' : ''} (déjà rattachée(s) à un compte ou introuvable(s))`}
          .
        </p>
      )}

      {state.phase === 'error' && <p className="text-destructive">Erreur lors du rattachement : {state.message}</p>}
    </div>
  );
}
