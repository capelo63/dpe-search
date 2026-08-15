import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Client Supabase partagé, greffé sur le projet Teriis existant (tables
 * dpe_*). Clé anon uniquement (RLS-aware) — jamais SUPABASE_SERVICE_ROLE_KEY
 * en V0, voir supabase/migrations/20260815_dpe_v0.sql. Lazy : ne jette pas au
 * chargement du module si les env vars sont absentes (utile en build), mais
 * au premier usage réel.
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
