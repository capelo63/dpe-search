import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient, warnIfNotOwner } from '@/lib/supabase-server';

const bodySchema = z.object({
  status: z.enum(['a_verifier', 'ecarte', 'confirme', 'visite']),
});

/**
 * Matérialise le workflow multi-passes (à vérifier / écarté / à visiter /
 * confirmé) : mise à jour optimiste côté client (ShortlistView), ce PATCH
 * persiste le choix. Statut par défaut à l'insertion : 'a_verifier'.
 *
 * Checkpoint auth V1 : session requise (401 sinon). Pas encore de filtrage
 * par user_id (RLS stricte au checkpoint suivant) — un select préalable sur
 * la query parente permet de tracer (warnIfNotOwner) sans bloquer.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Statut invalide' }, { status: 400 });
  }

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

  const { data: candidateRow } = await supabase
    .from('dpe_candidate')
    .select('query_id')
    .eq('id', id)
    .single();
  if (candidateRow) {
    const { data: queryRow } = await supabase
      .from('dpe_search_query')
      .select('user_id')
      .eq('id', candidateRow.query_id)
      .single();
    if (queryRow) {
      warnIfNotOwner(user.id, queryRow.user_id as string | null, `PATCH /api/candidates/${id}/status`);
    }
  }

  const { error } = await supabase
    .from('dpe_candidate')
    .update({ status: parsed.data.status })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
