'use client';

import { useEffect } from 'react';
import { addRecentQuery } from '@/lib/recent-queries';

/**
 * /app/shortlist/[queryId]/page.tsx est un Server Component (SSR direct
 * Supabase) : ce petit composant client, sans rendu visuel, capte l'accès
 * via URL directe (partagée, favori, revisite) pour l'historique local —
 * pas seulement les recherches lancées depuis le formulaire (déjà couvert
 * par app/page.tsx).
 */
export function RecordRecentQuery({ queryId }: { queryId: string }) {
  useEffect(() => {
    addRecentQuery(queryId);
  }, [queryId]);

  return null;
}
