import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Client Supabase côté navigateur (Client Components), session synchronisée
 * via cookies (lisibles aussi côté serveur, cf. lib/supabase-server.ts)
 * plutôt que localStorage — pattern @supabase/ssr. Utilisé uniquement là où
 * un appel direct à supabase-js est nécessaire côté client (/app/login pour
 * signInWithOtp) ; le reste de l'app passe par les routes API.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requis (voir .env.example).'
    );
  }

  client = createBrowserClient(url, anonKey);
  return client;
}
