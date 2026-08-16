import Link from 'next/link';

/**
 * Nav minimale partagée (toutes les pages, cf. app/layout.tsx). Sans elle,
 * /app/historique n'est atteignable qu'en tapant l'URL à la main une fois
 * arrivé sur une shortlist.
 */
export function AppHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold">
          dpe-search
        </Link>
        <nav>
          <Link href="/historique" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            Historique
          </Link>
        </nav>
      </div>
    </header>
  );
}
