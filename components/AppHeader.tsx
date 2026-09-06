import Link from 'next/link';
import { getCurrentUser } from '@/lib/supabase-server';

/**
 * Nav minimale partagée (toutes les pages, cf. app/layout.tsx). Sans elle,
 * /app/historique n'est atteignable qu'en tapant l'URL à la main une fois
 * arrivé sur une shortlist.
 *
 * Async (Server Component) depuis le checkpoint auth : affiche l'email de
 * l'utilisateur connecté + déconnexion. Rendue aussi sur /login (pas de
 * session à ce moment-là) : getCurrentUser() renvoie alors `null` et le nav
 * applicatif (Historique/email/déconnexion) ne s'affiche simplement pas.
 */
export async function AppHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold">
          dpe-search
        </Link>
        {user && (
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/historique" className="text-muted-foreground hover:text-foreground hover:underline">
              Historique
            </Link>
            <span className="text-muted-foreground">{user.email}</span>
            <form action="/logout" method="POST">
              <button type="submit" className="text-muted-foreground hover:text-foreground hover:underline">
                Se déconnecter
              </button>
            </form>
          </nav>
        )}
      </div>
    </header>
  );
}
