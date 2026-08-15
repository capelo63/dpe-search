import { NextResponse } from 'next/server';
import { newSearchQuerySchema, type NewCandidate, type NewSearchQuery } from '@/types/dpe';
import { searchDpe } from '@/lib/ademe';
import { enrichBuildings } from '@/lib/bdnb';
import { getSupabase } from '@/lib/supabase';
import { searchQueryToInsertRow, candidateToInsertRow } from '@/lib/db';

/**
 * Flow synchrone V0 (budget round-trip cible : ≤4s) : valide la saisie,
 * interroge ADEME sur la signature exacte, enrichit les candidats via BDNB
 * (en parallèle, cf. lib/bdnb.ts::enrichBuildings), persiste la query et ses
 * candidats dans Supabase, retourne queryId. Pas de polling/SSE : le client
 * attend la réponse puis redirige vers /shortlist/[queryId] qui SSR-fetche
 * depuis Supabase.
 */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: 'Corps de requête JSON invalide' }, { status: 400 });
  }

  const parsed = newSearchQuerySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Requête invalide', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const surfaceMin =
    input.surfaceApprox != null ? input.surfaceApprox * (1 - input.surfaceTolerancePct / 100) : null;
  const surfaceMax =
    input.surfaceApprox != null ? input.surfaceApprox * (1 + input.surfaceTolerancePct / 100) : null;

  let ademeMatches;
  try {
    ademeMatches = await searchDpe({
      codePostal: input.codePostal,
      etiquetteDpe: input.etiquetteDpe,
      etiquetteGes: input.etiquetteGes,
      consoEp: input.consoEp,
      emissionGes: input.emissionGes,
      chercherToutMarseille: input.chercherToutMarseille,
      surfaceMin,
      surfaceMax,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Recherche ADEME impossible : ${(err as Error).message}` },
      { status: 502 }
    );
  }

  let enrichments;
  try {
    enrichments = await enrichBuildings(
      ademeMatches.map((m) => ({ codeInsee: m.codeInseeBan, identifiantBan: m.identifiantBan }))
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Enrichissement BDNB impossible : ${(err as Error).message}` },
      { status: 502 }
    );
  }

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const newQuery: NewSearchQuery = {
    codePostal: input.codePostal,
    etiquetteDpe: input.etiquetteDpe,
    etiquetteGes: input.etiquetteGes,
    consoEpMin: input.consoEp,
    consoEpMax: input.consoEp,
    emissionGesMin: input.emissionGes,
    emissionGesMax: input.emissionGes,
    surfaceMin,
    surfaceMax,
    etageMin: null,
    etageMax: null,
    nbLotsMin: input.nbLotsMin ?? null,
    nbLotsMax: input.nbLotsMax ?? null,
    nbNiveauMax: input.nbNiveauMax ?? null,
    anneeConstructionMax: input.anneeConstructionMax ?? null,
    listingUrl: input.listingUrl ?? null,
    listingAgence: input.listingAgence ?? null,
    listingPrix: input.listingPrix ?? null,
    notes: input.notes ?? null,
  };

  const { data: queryRow, error: queryError } = await supabase
    .from('dpe_search_query')
    .insert(searchQueryToInsertRow(newQuery))
    .select('id')
    .single();

  if (queryError || !queryRow) {
    return NextResponse.json(
      { error: `Enregistrement de la recherche impossible : ${queryError?.message ?? 'inconnu'}` },
      { status: 500 }
    );
  }

  const queryId = queryRow.id as string;

  if (ademeMatches.length > 0) {
    const now = new Date().toISOString();
    const candidateRows = ademeMatches.map((m, i) => {
      const enrichment = enrichments[i];
      const candidate: NewCandidate = {
        queryId,
        ademeNumero: m.numeroDpe,
        identifiantBan: m.identifiantBan,
        adresse: m.adresseBan,
        codePostal: m.codePostalBan ?? input.codePostal,
        latitude: m.latitude,
        longitude: m.longitude,
        consoEp: m.consoEp,
        emissionGes: m.emissionGes,
        surfaceHabitable: m.surfaceHabitable,
        bdnbAnneeConstruction: enrichment?.anneeConstruction ?? null,
        bdnbHauteurMoyenne: enrichment?.hauteurMoyenne ?? null,
        bdnbSurfaceBatie: enrichment?.surfaceEmpriseSol ?? null,
        bdnbNbLots: enrichment?.nbLots ?? null,
        bdnbNbNiveau: enrichment?.nbNiveau ?? null,
        bdnbDpeBatiment: enrichment?.dpeBatiment ?? null,
        bdnbEnrichedAt: enrichment ? now : null,
        status: 'a_verifier',
        notes: null,
      };
      return candidateToInsertRow(candidate);
    });

    const { error: candidatesError } = await supabase.from('dpe_candidate').insert(candidateRows);
    if (candidatesError) {
      return NextResponse.json(
        { error: `Enregistrement des candidats impossible : ${candidatesError.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ queryId, candidateCount: ademeMatches.length }, { status: 201 });
}
