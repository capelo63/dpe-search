import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient, User } from '@supabase/supabase-js';

function requireEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requis (voir .env.example).'
    );
  }
  return { url, anonKey };
}

/**
 * Client Supabase côté serveur (Server Components, Route Handlers), lié à la
 * session utilisateur via les cookies de la requête (pattern officiel
 * @supabase/ssr, cf. docs/auth-setup.md). Toujours en créer un nouveau par
 * requête — jamais partagé/mis en cache comme lib/supabase.ts::getSupabase(),
 * qui reste utilisé là où aucune session n'a de sens (scripts/e2e-test.ts,
 * hors contexte requête HTTP).
 *
 * L'écriture de cookies (setAll) échoue silencieusement dans un Server
 * Component (pas de réponse HTTP à modifier) — attendu, cf. doc
 * @supabase/ssr : c'est middleware.ts qui a la responsabilité du refresh de
 * session. Dans un Route Handler, `cookies()` est bien mutable et
 * l'écriture fonctionne (utilisé par /app/auth/callback, /app/logout).
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, anonKey } = requireEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component : no-op attendu, voir commentaire ci-dessus.
        }
      },
    },
  });
}

/**
 * Utilisateur courant, ou `null` si pas de session (ou si Supabase n'est pas
 * configuré — ex. session Claude Code online sans credentials, voir
 * .env.example). Volontairement permissif : contrairement à
 * getSupabaseServerClient(), ne jette jamais — utilisé par AppHeader (rendu
 * sur toutes les pages, y compris /login) qui doit pouvoir s'afficher sans
 * session ni configuration.
 */
export async function getCurrentUser(): Promise<User | null> {
  let supabase: SupabaseClient;
  try {
    supabase = await getSupabaseServerClient();
  } catch {
    return null;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Log de préparation au checkpoint RLS strictes (pas de blocage ici) : trace
 * les accès à une ressource dont le user_id ne correspond pas à
 * l'utilisateur courant. Ignore les ressources encore orphelines
 * (user_id null, cf. migration douce) — attendu tant que tout le monde n'a
 * pas adopté ses queries.
 */
export function warnIfNotOwner(userId: string, resourceUserId: string | null, context: string): void {
  if (resourceUserId != null && resourceUserId !== userId) {
    console.warn(
      `[auth] user ${userId} a accédé à une ressource appartenant à ${resourceUserId} (${context}) — RLS stricte pas encore active, aucun blocage.`
    );
  }
}
