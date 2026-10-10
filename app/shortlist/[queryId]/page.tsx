import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseServerClient, warnIfNotOwner } from '@/lib/supabase-server';
import { searchQueryFromRow, candidateFromRow, type SearchQueryRow, type CandidateRow } from '@/lib/db';
import { ShortlistView } from '@/components/ShortlistView';
import { RecordRecentQuery } from '@/components/RecordRecentQuery';

// SSR : fetch direct Supabase (pas de polling/SSE, cf. POST /api/queries qui
// a déjà tout persisté avant de renvoyer queryId). Le rendu interactif
// (filtres, carte, tableau, statut) est délégué à ShortlistView (client).
//
// Checkpoint auth V1 : route protégée par middleware.ts (redirection /login
// déjà faite si pas de session) ; client Supabase lié à la session
// utilisateur (pas l'anon global lib/supabase.ts) pour rester compatible
// avec les RLS user-aware du checkpoint suivant. Pas encore de filtrage par
// user_id ici (cf. non-objectifs) — juste un log si la query consultée
// n'appartient pas à l'utilisateur courant.
export default async function ShortlistPage({ params }: { params: Promise<{ queryId: string }> }) {
  const { queryId } = await params;
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: queryRow, error: queryError } = await supabase
    .from('dpe_search_query')
    .select('*')
    .eq('id', queryId)
    .single();

  if (queryError || !queryRow) {
    notFound();
  }

  if (user) {
    warnIfNotOwner(user.id, (queryRow as SearchQueryRow).user_id, `GET /shortlist/${queryId}`);
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
    <main className="mx-auto max-w-6xl px-6 py-12">
      <RecordRecentQuery queryId={query.id} />

      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Nouvelle recherche
        </Link>
        <Link href={`/?queryId=${query.id}`} className="text-sm text-muted-foreground hover:underline">
          Modifier la recherche
        </Link>
      </div>

      <h1 className="mt-2 text-2xl font-semibold">
        Shortlist — CP {query.codePostal}, DPE {query.etiquetteDpe}
        {query.etiquetteGes ? `/${query.etiquetteGes}` : ''}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {candidates.length} candidat{candidates.length !== 1 ? 's' : ''} · conso EP {query.consoEpMin}{' '}
        kWh/m²/an
        {query.emissionGesMin != null && <> · émission GES {query.emissionGesMin} kgCO2/m²/an</>}
      </p>

      <ShortlistView query={query} candidates={candidates} />
    </main>
  );
}
