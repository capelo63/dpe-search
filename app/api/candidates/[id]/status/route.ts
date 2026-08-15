import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';

const bodySchema = z.object({
  status: z.enum(['a_verifier', 'ecarte', 'confirme', 'visite']),
});

/**
 * Matérialise le workflow multi-passes (à vérifier / écarté / à visiter /
 * confirmé) : mise à jour optimiste côté client (ShortlistView), ce PATCH
 * persiste le choix. Statut par défaut à l'insertion : 'a_verifier'.
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
    supabase = getSupabase();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
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
