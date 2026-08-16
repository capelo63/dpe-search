import type { Metadata } from 'next';
import './globals.css';
import { AppHeader } from '@/components/AppHeader';

export const metadata: Metadata = {
  title: 'dpe-search',
  description: "Désanonymisation d'annonces immobilières à Marseille via signature DPE",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
