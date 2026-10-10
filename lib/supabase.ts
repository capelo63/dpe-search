import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Client Supabase anon partagé, sans notion de session utilisateur — greffé
 * sur le projet Teriis existant (tables dpe_*). Clé anon uniquement
 * (RLS-aware) — jamais SUPABASE_SERVICE_ROLE_KEY en V0, voir
 * supabase/migrations/20260815_dpe_v0.sql. Lazy : ne jette pas au chargement
 * du module si les env vars sont absentes (utile en build), mais au premier
 * usage réel.
 *
 * Depuis le checkpoint auth V1, les routes/pages applicatives utilisent
 * plutôt lib/supabase-server.ts::getSupabaseServerClient() (session
 * utilisateur liée aux cookies, cf. docs/auth-setup.md), nécessaire pour
 * rester compatible avec les RLS user-aware du checkpoint suivant. Ce client
 * anon reste utilisé uniquement là où il n'y a pas de requête HTTP/cookies
 * (scripts/e2e-test.ts, hors contexte Next.js).
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requis (voir .env.example).'
    );
  }

  client = createClient(url, anonKey);
  return client;
}
