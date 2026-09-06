import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

/**
 * Retour du magic link (flow PKCE, cf. lib/supabase-browser.ts /
 * lib/supabase-server.ts — createBrowserClient/createServerClient de
 * @supabase/ssr utilisent PKCE par défaut) : échange le `code` contre une
 * session, écrit les cookies, puis redirige vers `next` (page initialement
 * demandée avant la redirection middleware vers /login, cf.
 * lib/supabase-middleware.ts).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';
  // next vient d'un paramètre d'URL contrôlable par l'utilisateur : on ne
  // suit qu'un chemin relatif interne, jamais une URL absolue externe.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (code) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=callback`);
}
