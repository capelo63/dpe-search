import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { searchQueryFromRow, type SearchQueryRow } from '@/lib/db';

/**
 * Utilisé par app/page.tsx pour pré-remplir le formulaire depuis
 * ?queryId=xxx ("Modifier la recherche", cf. components/ShortlistView.tsx
 * et app/shortlist/[queryId]/page.tsx). Soumettre crée une nouvelle query
 * (pas d'UPDATE) : l'historique garde trace des tentatives successives.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const { data, error } = await supabase.from('dpe_search_query').select('*').eq('id', id).single();
  if (error || !data) {
    return NextResponse.json({ error: 'Recherche introuvable' }, { status: 404 });
  }

  return NextResponse.json(searchQueryFromRow(data as SearchQueryRow));
}
