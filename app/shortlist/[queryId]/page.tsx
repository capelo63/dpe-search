import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import { searchQueryFromRow, candidateFromRow, type SearchQueryRow, type CandidateRow } from '@/lib/db';
import { scoreCandidate } from '@/lib/scoring';

// SSR : fetch direct Supabase (pas de polling/SSE, cf. POST /api/queries qui
// a déjà tout persisté avant de renvoyer queryId).
export default async function ShortlistPage({ params }: { params: Promise<{ queryId: string }> }) {
  const { queryId } = await params;
  const supabase = getSupabase();

  const { data: queryRow, error: queryError } = await supabase
    .from('dpe_search_query')
    .select('*')
    .eq('id', queryId)
    .single();

  if (queryError || !queryRow) {
    notFound();
  }

  const { data: candidateRows, error: candidatesError } = await supabase
    .from('dpe_candidate')
    .select('*')
    .eq('query_id', queryId)
    .order('created_at', { ascending: true });

  if (candidatesError) {
    throw new Error(`Chargement des candidats impossible : ${candidatesError.message}`);
  }

  const query = searchQueryFromRow(queryRow as SearchQueryRow);
  const candidates = (candidateRows ?? []).map((r) => candidateFromRow(r as CandidateRow));

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← Nouvelle recherche
      </Link>

      <h1 className="mt-2 text-2xl font-semibold">
        Shortlist — CP {query.codePostal}, DPE {query.etiquetteDpe}/{query.etiquetteGes}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {candidates.length} candidat{candidates.length !== 1 ? 's' : ''} · conso EP {query.consoEpMin}{' '}
        kWh/m²/an · émission GES {query.emissionGesMin} kgCO2/m²/an
      </p>

      {candidates.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Aucun candidat trouvé sur cette signature. Essayez d&apos;élargir à tout Marseille depuis le
          formulaire.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Adresse</th>
                <th className="py-2 pr-4 font-medium">Conso EP</th>
                <th className="py-2 pr-4 font-medium">Émission GES</th>
                <th className="py-2 pr-4 font-medium">Surface</th>
                <th className="py-2 pr-4 font-medium">Nb niveaux</th>
                <th className="py-2 pr-4 font-medium">Nb lots (RNC)</th>
                <th className="py-2 pr-4 font-medium">Année</th>
                <th className="py-2 pr-4 font-medium">Score</th>
                <th className="py-2 pr-4 font-medium">Street View</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const { score, total } = scoreCandidate(query, c);
                const streetViewUrl =
                  c.latitude != null && c.longitude != null
                    ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c.latitude},${c.longitude}`
                    : null;
                return (
                  <tr key={c.id} className="border-b border-border">
                    <td className="py-2 pr-4">{c.adresse}</td>
                    <td className="py-2 pr-4">{c.consoEp ?? '–'}</td>
                    <td className="py-2 pr-4">{c.emissionGes ?? '–'}</td>
                    <td className="py-2 pr-4">{c.surfaceHabitable ?? '–'}</td>
                    <td className="py-2 pr-4">{c.bdnbNbNiveau ?? '–'}</td>
                    <td className="py-2 pr-4">{c.bdnbNbLots ?? '–'}</td>
                    <td className="py-2 pr-4">{c.bdnbAnneeConstruction ?? '–'}</td>
                    <td className="py-2 pr-4">
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                        {score}/{total}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {streetViewUrl ? (
                        <a
                          href={streetViewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          Voir
                        </a>
                      ) : (
                        '–'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
