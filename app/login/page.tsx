'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

// Magic link email uniquement (pas de mot de passe, pas d'OAuth en V1, cf.
// docs/auth-setup.md) : moins de friction, moins de surface de risque, moins
// de support à assurer.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setErrorMessage(null);
    try {
      const supabase = getSupabaseBrowserClient();
      // Le callback (/app/auth/callback) échange le code PKCE contre une
      // session puis redirige vers `next` — repasse par le middleware, donc
      // vers la page initialement demandée avant la redirection /login.
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;
      setStatus('sent');
    } catch (err) {
      setErrorMessage((err as Error).message);
      setStatus('error');
    }
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Connexion</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Recevez un lien de connexion par email, sans mot de passe.
      </p>

      {status === 'sent' ? (
        <p className="mt-8 rounded-lg border border-border bg-accent/50 p-4 text-sm">
          Un lien de connexion a été envoyé à votre email. Vérifiez votre boîte de réception (et vos
          spams).
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.fr"
            />
          </div>
          {status === 'error' && <p className="text-sm text-destructive">{errorMessage}</p>}
          <button
            type="submit"
            disabled={status === 'sending'}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {status === 'sending' ? 'Envoi…' : 'Recevoir le lien de connexion'}
          </button>
        </form>
      )}
    </main>
  );
}
