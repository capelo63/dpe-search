import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase-server';

const bodySchema = z.object({
  queryIds: z.array(z.string().uuid()).min(1).max(50),
});

/**
 * Migration douce (checkpoint auth V1) : rattache à l'utilisateur courant
 * les queries anonymes (créées avant l'auth, cf.
 * supabase/migrations/20260906_dpe_auth_v1.sql) qu'il indique depuis son
 * historique local (components/AdoptionBanner.tsx + lib/recent-queries.ts).
 *
 * N'adopte jamais une query déjà rattachée à quelqu'un d'autre : le filtre
 * `.is('user_id', null)` fait ce travail au niveau applicatif (les policies
 * RLS restent grand ouvertes à ce stade, cf. non-objectifs du checkpoint) —
 * ce n'est donc PAS une garantie de sécurité, seulement la règle produit de
 * cette migration douce. L'isolation stricte viendra avec les RLS
 * user-aware au checkpoint suivant.
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
    return NextResponse.json({ error: 'Requête invalide (queryIds attendus)' }, { status: 400 });
  }
  const { queryIds } = parsed.data;

  const { data: updated, error } = await supabase
    .from('dpe_search_query')
    .update({ user_id: user.id })
    .in('id', queryIds)
    .is('user_id', null)
    .select('id');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const adopted = (updated ?? []).length;
  const skipped = queryIds.length - adopted;

  return NextResponse.json({ adopted, skipped });
}
