import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'dpe-search',
  description: "Désanonymisation d'annonces immobilières à Marseille via signature DPE",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
