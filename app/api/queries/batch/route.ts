import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient, warnIfNotOwner } from '@/lib/supabase-server';
import { searchQueryFromRow, type SearchQueryRow } from '@/lib/db';
import type { CandidateStatus, SearchQuery } from '@/types/dpe';

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
});

export type QueryHistoryEntry = {
  query: SearchQuery;
  candidateCount: number;
  statusCounts: Partial<Record<CandidateStatus, number>>;
};

/**
 * /app/historique lit ses queryId dans localStorage (client), donc ne peut
 * pas les résoudre en SSR. Ce batch évite un fetch par query : un seul
 * round-trip pour jusqu'à 50 ids (le plafond localStorage, cf.
 * lib/recent-queries.ts). Pas de vue/RPC Postgres pour l'agrégation par
 * statut — un simple group-by en JS sur `select query_id, status` reste
 * largement suffisant aux volumes V0 et évite une migration de plus à faire
 * jouer manuellement.
 *
 * Checkpoint auth V1 : session requise (401 sinon). Pas encore de filtrage
 * par user_id (RLS stricte au checkpoint suivant) : chaque query dont le
 * user_id ne correspond pas à l'utilisateur courant est tracée via
 * warnIfNotOwner plutôt que masquée.
 */
export async function POST(request: Request) {
  let supabase;
  try {
    supabase = await getSupabaseServerClient();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide (ids attendus)' }, { status: 400 });
  }
  const { ids } = parsed.data;

  const { data: queryRows, error: queryError } = await supabase
    .from('dpe_search_query')
    .select('*')
    .in('id', ids)
    .order('created_at', { ascending: false });

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  const foundIds = (queryRows ?? []).map((r) => r.id as string);
  const missing = ids.filter((id) => !foundIds.includes(id));

  const statusByQuery = new Map<string, Partial<Record<CandidateStatus, number>>>();
  if (foundIds.length > 0) {
    const { data: candidateRows, error: candidatesError } = await supabase
      .from('dpe_candidate')
      .select('query_id, status')
      .in('query_id', foundIds);

    if (candidatesError) {
      return NextResponse.json({ error: candidatesError.message }, { status: 500 });
    }

    for (const row of candidateRows ?? []) {
      const counts = statusByQuery.get(row.query_id) ?? {};
      const status = row.status as CandidateStatus;
      counts[status] = (counts[status] ?? 0) + 1;
      statusByQuery.set(row.query_id, counts);
    }
  }

  const entries: QueryHistoryEntry[] = (queryRows ?? []).map((row) => {
    const query = searchQueryFromRow(row as SearchQueryRow);
    warnIfNotOwner(user.id, query.userId, `POST /api/queries/batch`);
    const statusCounts = statusByQuery.get(query.id) ?? {};
    const candidateCount = Object.values(statusCounts).reduce((a, b) => a + (b ?? 0), 0);
    return { query, candidateCount, statusCounts };
  });

  return NextResponse.json({ entries, missing });
}
