import { NextResponse } from 'next/server';
import { getSupabaseServerClient, warnIfNotOwner } from '@/lib/supabase-server';
import { searchQueryFromRow, type SearchQueryRow } from '@/lib/db';

/**
 * Utilisé par app/page.tsx pour pré-remplir le formulaire depuis
 * ?queryId=xxx ("Modifier la recherche", cf. components/ShortlistView.tsx
 * et app/shortlist/[queryId]/page.tsx). Soumettre crée une nouvelle query
 * (pas d'UPDATE) : l'historique garde trace des tentatives successives.
 *
 * Checkpoint auth V1 : session requise (401 sinon). Pas encore de filtrage
 * par user_id (RLS stricte au checkpoint suivant) — un utilisateur peut
 * encore lire la query d'un autre, seulement tracé via warnIfNotOwner.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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

  const { data, error } = await supabase.from('dpe_search_query').select('*').eq('id', id).single();
  if (error || !data) {
    return NextResponse.json({ error: 'Recherche introuvable' }, { status: 404 });
  }

  warnIfNotOwner(user.id, (data as SearchQueryRow).user_id, `GET /api/queries/${id}`);

  return NextResponse.json(searchQueryFromRow(data as SearchQueryRow));
}
