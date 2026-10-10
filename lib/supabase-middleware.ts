import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Routes accessibles sans session. Le reste de l'app est protégé par
// défaut (préparation de l'ouverture à des utilisateurs tiers) : la
// landing publique arrive au checkpoint 3, pour l'instant `/` est privé.
const PUBLIC_PATHS = ['/login', '/auth/callback', '/logout'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Pattern officiel Supabase pour Next.js middleware : rafraîchit la session
 * (cookies signés) à chaque requête, puis protège les routes applicatives en
 * redirigeant vers /login si pas de session. Voir middleware.ts (racine)
 * pour le point d'entrée Next.js, docs/auth-setup.md pour la configuration
 * Supabase dashboard associée.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Pas de credentials (ex. session Claude Code online sans Supabase, voir
    // .env.example) : impossible de vérifier une session, on laisse passer
    // plutôt que de bloquer tout accès à l'app dans cet environnement — les
    // routes API elles-mêmes échouent proprement (500) faute de config.
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() (pas getSession()) : revalide le JWT auprès de Supabase plutôt
  // que de faire confiance au cookie tel quel — recommandation officielle
  // pour du code qui décide d'un accès.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
