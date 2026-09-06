import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

/**
 * POST plutôt que GET : une déconnexion est une mutation d'état, pas une
 * navigation (évite aussi qu'un lien/prefetch la déclenche par accident).
 * Route publique (cf. lib/supabase-middleware.ts) : signOut() sans session
 * est un no-op, pas la peine d'exiger d'être authentifié pour se
 * déconnecter.
 */
export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url));
}
