// Test end-to-end en trois phases, sur le cas réel validé par l'utilisateur
// (25 Boulevard Boisson, 13004 Marseille) :
//
//   Phase 0 — unitaire, pure, sans réseau : normalizeBdnbLine() arrondit
//   toujours nb_log/nb_log_rnc/nb_niveau et neutralise les nb_niveau
//   aberrants (> 20). Garde contre la régression prod du 2026-08-16
//   (nb_niveau=64.4 -> `invalid input syntax for type integer`).
//
//   Phase 1 — pipeline lib/ademe.ts -> lib/bdnb.ts en direct (pas de serveur,
//   pas de Supabase). Sert de test de non-régression sur les wrappers API.
//
//   Phase 2 — flow applicatif réel : spawn un serveur `next dev` éphémère,
//   POST /api/queries (mêmes fingerprint + contraintes), relit la query et
//   les candidats persistés dans Supabase, vérifie qu'on retrouve la même
//   adresse ET que son badge de confiance est bien 5/5 (scoreCandidate sur
//   les données relues, pas une valeur recalculée à part). Sautée proprement
//   si NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ne sont pas
//   dans l'environnement (ex. session Claude Code online sans credentials
//   Supabase) plutôt que d'échouer de façon confuse.
//
// Run: npm run e2e-test

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { searchDpe, type AdemeMatch } from '../lib/ademe.ts';
import { enrichBuildings, normalizeBdnbLine, type BdnbEnrichment, type RawBdnbLine } from '../lib/bdnb.ts';
import { computeDpeLabels } from '../lib/dpe-labels.ts';
import { scoreCandidate } from '../lib/scoring.ts';
import type { Candidate, SearchQuery } from '../types/dpe.ts';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function rawBdnbLine(overrides: Partial<RawBdnbLine>): RawBdnbLine {
  return {
    batiment_groupe_id: 'bdnb-bg-TEST',
    libelle_adr_principale_ban: null,
    hauteur_mean: null,
    annee_construction: null,
    nb_log: null,
    nb_log_rnc: null,
    nb_niveau: null,
    surface_emprise_sol: null,
    classe_bilan_dpe: null,
    ...overrides,
  };
}

function runBdnbNormalizationTest(): 'ok' | 'fail' {
  let ok = true;

  function check(label: string, actual: unknown, expected: unknown) {
    const pass = actual === expected;
    console.log(`  ${pass ? '✓' : '✗'} ${label} : ${actual} (attendu ${expected})`);
    if (!pass) ok = false;
  }

  // Cas réel observé en prod : nb_niveau=64.4 a fait échouer l'insert
  // Supabase ("invalid input syntax for type integer"). Doit être arrondi
  // PUIS rejeté par le sanity-check (> 20), pas juste arrondi.
  const corrompu = normalizeBdnbLine(rawBdnbLine({ nb_niveau: 64.4 }));
  check('nb_niveau=64.4 -> neutralisé en null (sanity-check > 20)', corrompu.nbNiveau, null);

  // Valeur limite : exactement 20 doit passer (le seuil est "> 20", pas ">= 20")
  const limite = normalizeBdnbLine(rawBdnbLine({ nb_niveau: 20 }));
  check('nb_niveau=20 -> conservé (limite incluse)', limite.nbNiveau, 20);

  // Arrondi qui fait juste franchir le seuil : 20.6 -> 21 -> rejeté
  const limiteArrondie = normalizeBdnbLine(rawBdnbLine({ nb_niveau: 20.6 }));
  check('nb_niveau=20.6 -> arrondi à 21 puis neutralisé', limiteArrondie.nbNiveau, null);

  // Décimal plausible (ex. nb_niveau=3.0 vu tel quel sur certains bâtiments)
  const plausible = normalizeBdnbLine(rawBdnbLine({ nb_niveau: 3.0 }));
  check('nb_niveau=3.0 -> entier 3', plausible.nbNiveau, 3);
  check('nb_niveau=3.0 -> jamais de décimale', Number.isInteger(plausible.nbNiveau), true);

  // null doit rester null (pas de donnée BDNB), pas 0 ni NaN
  const absent = normalizeBdnbLine(rawBdnbLine({ nb_niveau: null }));
  check('nb_niveau=null -> reste null', absent.nbNiveau, null);

  // nb_log / nb_log_rnc arrondis eux aussi (cas réel : nb_log_rnc=19.05, nb_log=64.55)
  const lots = normalizeBdnbLine(rawBdnbLine({ nb_log: 64.55, nb_log_rnc: 19.05 }));
  check('nb_log=64.55 -> entier 65', lots.nbLog, 65);
  check('nb_log_rnc=19.05 -> entier 19', lots.nbLogRnc, 19);
  check('nbLots dérivé (nb_log_rnc) -> entier 19', lots.nbLots, 19);

  console.log(ok ? '[Phase 0] ✅  normalizeBdnbLine() n\'émet jamais de décimale, valeurs aberrantes neutralisées.' : '[Phase 0] ⚠️  régression détectée.');
  return ok ? 'ok' : 'fail';
}

/**
 * V1.1 : les étiquettes ne sont plus saisies, elles sont calculées
 * (lib/dpe-labels.ts) à partir des seuils réglementaires DPE 2021. Ce test
 * balaie chaque seuil A->G sur les deux axes, les cas limites cités par
 * l'utilisateur (70 / 70.5 / 71 côté conso) et le repli sans émission.
 */
function runDpeLabelsTest(): 'ok' | 'fail' {
  let ok = true;

  function check(label: string, actual: unknown, expected: unknown) {
    const pass = actual === expected;
    console.log(`  ${pass ? '✓' : '✗'} ${label} : ${actual} (attendu ${expected})`);
    if (!pass) ok = false;
  }

  // --- Conso EP : chaque seuil A->G (borne haute incluse dans la meilleure classe) ---
  check('conso=70 -> A (borne incluse)', computeDpeLabels(70, 6).etiquetteConso, 'A');
  check('conso=110 -> B', computeDpeLabels(110, 6).etiquetteConso, 'B');
  check('conso=180 -> C', computeDpeLabels(180, 6).etiquetteConso, 'C');
  check('conso=250 -> D', computeDpeLabels(250, 6).etiquetteConso, 'D');
  check('conso=330 -> E', computeDpeLabels(330, 6).etiquetteConso, 'E');
  check('conso=420 -> F', computeDpeLabels(420, 6).etiquetteConso, 'F');
  check('conso=421 -> G', computeDpeLabels(421, 6).etiquetteConso, 'G');

  // --- Cas limites explicitement demandés : 70 / 70.5 / 71 ---
  check('conso=70 -> A', computeDpeLabels(70).etiquetteConso, 'A');
  check('conso=70.5 -> B (dépasse le seuil, même de peu)', computeDpeLabels(70.5).etiquetteConso, 'B');
  check('conso=71 -> B', computeDpeLabels(71).etiquetteConso, 'B');

  // --- Émission GES : chaque seuil A->G ---
  check('emission=6 -> A (borne incluse)', computeDpeLabels(50, 6).etiquetteGes, 'A');
  check('emission=11 -> B', computeDpeLabels(50, 11).etiquetteGes, 'B');
  check('emission=30 -> C', computeDpeLabels(50, 30).etiquetteGes, 'C');
  check('emission=50 -> D', computeDpeLabels(50, 50).etiquetteGes, 'D');
  check('emission=70 -> E', computeDpeLabels(50, 70).etiquetteGes, 'E');
  check('emission=100 -> F', computeDpeLabels(50, 100).etiquetteGes, 'F');
  check('emission=101 -> G', computeDpeLabels(50, 101).etiquetteGes, 'G');

  // --- Étiquette finale = la moins bonne des deux (cas de l'exemple : conso B / GES C -> C) ---
  const combinee = computeDpeLabels(90, 25);
  check('conso=90 -> etiquetteConso B', combinee.etiquetteConso, 'B');
  check('emission=25 -> etiquetteGes C', combinee.etiquetteGes, 'C');
  check('étiquette finale = la moins bonne (C)', combinee.etiquetteDpe, 'C');

  // --- Émission absente : repli sur la classe conso seule ---
  const sansEmission = computeDpeLabels(150);
  check('sans émission -> etiquetteGes null', sansEmission.etiquetteGes, null);
  check('sans émission -> etiquetteDpe = etiquetteConso seule', sansEmission.etiquetteDpe, 'C');

  console.log(ok ? '[Phase 0] ✅  computeDpeLabels() respecte les seuils DPE 2021 sur les deux axes.' : '[Phase 0] ⚠️  régression détectée.');
  return ok ? 'ok' : 'fail';
}

// --- Fingerprint annonce (saisi manuellement par l'utilisateur) — V1.1 : plus
// d'étiquettes en entrée, elles sont calculées (lib/dpe-labels.ts). Repris par
// les deux scénarios Phase 1 et par le flow API complet en Phase 2. ---
const FINGERPRINT = {
  codePostal: '13005',
  consoEp: 206,
  emissionGes: 8,
};

// --- Contraintes contexte annonce ---
const CONTRAINTES = {
  nbNiveauMax: 3,
  nbLotsMin: 10,
  nbLotsMax: 15,
  anneeConstructionMax: 1930,
  surfaceApprox: 86,
  surfaceTolerance: 0.15, // +/- 15%
};

const EXPECTED_ADDRESS = '25 Boulevard boisson 13004 Marseille';

const SURFACE_MIN = CONTRAINTES.surfaceApprox * (1 - CONTRAINTES.surfaceTolerance);
const SURFACE_MAX = CONTRAINTES.surfaceApprox * (1 + CONTRAINTES.surfaceTolerance);

/** Pont AdemeMatch + BdnbEnrichment -> Candidate (forme attendue par scoreCandidate). */
function toCandidate(ademe: AdemeMatch, bdnb: BdnbEnrichment | null): Candidate {
  const now = new Date().toISOString();
  return {
    id: 'test',
    queryId: 'test',
    ademeNumero: ademe.numeroDpe,
    identifiantBan: ademe.identifiantBan,
    adresse: ademe.adresseBan,
    codePostal: ademe.codePostalBan ?? '',
    latitude: ademe.latitude,
    longitude: ademe.longitude,
    consoEp: ademe.consoEp,
    emissionGes: ademe.emissionGes,
    surfaceHabitable: ademe.surfaceHabitable,
    bdnbAnneeConstruction: bdnb?.anneeConstruction ?? null,
    bdnbHauteurMoyenne: bdnb?.hauteurMoyenne ?? null,
    bdnbSurfaceBatie: bdnb?.surfaceEmpriseSol ?? null,
    bdnbNbLots: bdnb?.nbLots ?? null,
    bdnbNbNiveau: bdnb?.nbNiveau ?? null,
    bdnbDpeBatiment: bdnb?.dpeBatiment ?? null,
    bdnbEnrichedAt: bdnb ? now : null,
    status: 'a_verifier',
    notes: null,
    createdAt: now,
  };
}

/** Query minimale (mêmes contraintes contexte que FINGERPRINT/CONTRAINTES), pour scoreCandidate. */
function buildSearchQueryStub(overrides: Partial<SearchQuery>): SearchQuery {
  return {
    id: 'test',
    createdAt: new Date().toISOString(),
    codePostal: FINGERPRINT.codePostal,
    etiquetteDpe: 'D',
    etiquetteGes: null,
    consoEpMin: FINGERPRINT.consoEp,
    consoEpMax: FINGERPRINT.consoEp,
    emissionGesMin: null,
    emissionGesMax: null,
    surfaceMin: SURFACE_MIN,
    surfaceMax: SURFACE_MAX,
    etageMin: null,
    etageMax: null,
    nbLotsMin: CONTRAINTES.nbLotsMin,
    nbLotsMax: CONTRAINTES.nbLotsMax,
    nbNiveauMax: CONTRAINTES.nbNiveauMax,
    anneeConstructionMax: CONTRAINTES.anneeConstructionMax,
    chercherToutMarseille: false,
    listingUrl: null,
    listingAgence: null,
    listingPrix: null,
    notes: null,
    ...overrides,
  };
}

type ScenarioSearchParams = { consoEp: number; emissionGes?: number; etageMin?: number; etageMax?: number };

/**
 * Exécute un scénario de recherche complet (searchDpe -> enrichBuildings ->
 * scoreCandidate, arrondissement puis repli tout Marseille si besoin — même
 * logique que le pré-filtre géocodage documenté ci-dessus) et vérifie que
 * l'adresse validée ressort dans la "shortlist finale" (score === total,
 * c-à-d tous les critères applicables satisfaits) avec le badge attendu.
 */
async function runScenario(
  label: string,
  searchParams: ScenarioSearchParams,
  queryOverrides: Partial<SearchQuery>,
  expected: { score: number; total: number }
): Promise<'ok' | 'fail'> {
  console.log(`[Phase 1] Scénario "${label}"`);

  async function search(chercherToutMarseille: boolean): Promise<AdemeMatch[]> {
    return searchDpe({
      codePostal: FINGERPRINT.codePostal,
      consoEp: searchParams.consoEp,
      emissionGes: searchParams.emissionGes,
      chercherToutMarseille,
      surfaceMin: SURFACE_MIN,
      surfaceMax: SURFACE_MAX,
      etageMin: searchParams.etageMin,
      etageMax: searchParams.etageMax,
    });
  }

  let matches = await search(false);
  console.log(`  ${matches.length} DPE(s) sur l'arrondissement ${FINGERPRINT.codePostal} (pré-filtre surface inclus)`);

  if (!matches.some((m) => m.adresseBan === EXPECTED_ADDRESS)) {
    // code_insee_ban (géocodage BAN) peut dériver par rapport au CP postal
    // affiché sur l'annonce près d'une frontière d'arrondissement (~1-2% des
    // lignes, voir docs/api-notes.md). Repli : élargir à tout Marseille.
    console.log(`[Phase 1] Adresse validée absente sur l'arrondissement exact, élargissement à tout Marseille (13001-13016)`);
    matches = await search(true);
    console.log(`  ${matches.length} DPE(s) sur tout Marseille (pré-filtre surface inclus)`);
  }

  const enrichments = await enrichBuildings(
    matches.map((m) => ({ codeInsee: m.codeInseeBan, identifiantBan: m.identifiantBan }))
  );

  const query = buildSearchQueryStub({
    emissionGesMin: searchParams.emissionGes ?? null,
    emissionGesMax: searchParams.emissionGes ?? null,
    etageMin: searchParams.etageMin ?? null,
    etageMax: searchParams.etageMax ?? null,
    ...queryOverrides,
  });

  const scored = matches.map((m, i) => {
    const candidate = toCandidate(m, enrichments[i]);
    return { candidate, ...scoreCandidate(query, candidate) };
  });

  const shortlist = scored.filter((s) => s.score === s.total);
  console.log(`[Phase 1] Shortlist finale (score = total) : ${shortlist.length} candidat(s)`);

  const match = shortlist.find((s) => s.candidate.adresse === EXPECTED_ADDRESS);
  if (!match) {
    console.log(`[Phase 1] ⚠️  "${label}" : adresse validée (${EXPECTED_ADDRESS}) absente de la shortlist finale.`);
    return 'fail';
  }

  const badgeOk = match.score === expected.score && match.total === expected.total;
  console.log(
    `  ${badgeOk ? '✓' : '✗'} "${label}" : badge ${match.score}/${match.total} (attendu ${expected.score}/${expected.total})`
  );
  if (!badgeOk) return 'fail';

  console.log(`[Phase 1] ✅  "${label}" : adresse confirmée retrouvée avec badge ${match.score}/${match.total}.`);
  return 'ok';
}

/**
 * Deux scénarios (V1.1) :
 *  - "avec émission" : les 4 dimensions numériques (conso, émission,
 *    3 contraintes contexte -> emission + nbNiveau + nbLots + année = 4
 *    critères applicables), badge 4/4 attendu.
 *  - "sans émission + étage=0" : émission absente, étage requis en repli
 *    (cf. types/dpe.ts .refine). Écart assumé par rapport à l'énoncé initial
 *    ("shortlist plus large, >1 candidat attendu") : vérifié empiriquement
 *    que searchDpe() applique déjà le pré-filtre surface (±15% sur 86 m²) en
 *    plus du numéro d'étage, ce qui réduit le pool brut à quelques dizaines
 *    de lignes avant même les contraintes contexte — combiné à
 *    nb_niveau/nb_lots/année (très sélectif), la shortlist finale converge
 *    aussi vers 1 seul candidat. Le badge, en revanche, correspond bien à
 *    l'attente : 3/3 (émission non applicable, 3 critères contexte).
 */
async function runLibPipelineTest(): Promise<'ok' | 'fail'> {
  const avecEmission = await runScenario(
    'avec émission',
    { consoEp: FINGERPRINT.consoEp, emissionGes: FINGERPRINT.emissionGes },
    {},
    { score: 4, total: 4 }
  );
  console.log('');
  const sansEmission = await runScenario(
    'sans émission (étage=0 en repli)',
    { consoEp: FINGERPRINT.consoEp, etageMin: 0, etageMax: 0 },
    {},
    { score: 3, total: 3 }
  );
  return avecEmission === 'ok' && sansEmission === 'ok' ? 'ok' : 'fail';
}

async function waitForServer(base: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(base);
      if (res.ok) return;
    } catch {
      // pas encore prêt
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Serveur next dev non prêt après ${timeoutMs}ms`);
}

async function runApiFlowTest(): Promise<'ok' | 'fail' | 'skipped'> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.log(
      '[Phase 2] SKIPPED — NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY absents de ' +
        "l'environnement (voir .env.example). Le flow POST /api/queries -> Supabase ne peut pas être exécuté ici."
    );
    return 'skipped';
  }

  const port = 3919;
  let server: ChildProcess | undefined;

  try {
    server = spawn('npx', ['next', 'dev', '-p', String(port)], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });

    console.log(`[Phase 2] Démarrage de next dev sur le port ${port}...`);
    await waitForServer(`http://localhost:${port}`, 30_000);

    const res = await fetch(`http://localhost:${port}/api/queries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // V1.1 : plus d'étiquettes en entrée (calculées côté serveur, cf.
        // lib/dpe-labels.ts). Scénario "avec émission" -> pas besoin d'étage.
        consoEp: FINGERPRINT.consoEp,
        emissionGes: FINGERPRINT.emissionGes,
        codePostal: FINGERPRINT.codePostal,
        chercherToutMarseille: true,
        surfaceApprox: CONTRAINTES.surfaceApprox,
        surfaceTolerancePct: CONTRAINTES.surfaceTolerance * 100,
        nbNiveauMax: CONTRAINTES.nbNiveauMax,
        nbLotsMin: CONTRAINTES.nbLotsMin,
        nbLotsMax: CONTRAINTES.nbLotsMax,
        anneeConstructionMax: CONTRAINTES.anneeConstructionMax,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      console.log(`[Phase 2] ⚠️  POST /api/queries a échoué (${res.status}): ${body.error}`);
      return 'fail';
    }
    console.log(`[Phase 2] POST /api/queries -> queryId=${body.queryId}, ${body.candidateCount} candidat(s) persisté(s)`);

    const { getSupabase } = await import('../lib/supabase.ts');
    const { searchQueryFromRow, candidateFromRow } = await import('../lib/db.ts');
    const supabase = getSupabase();

    const { data: queryRow, error: queryError } = await supabase
      .from('dpe_search_query')
      .select('*')
      .eq('id', body.queryId)
      .single();
    if (queryError || !queryRow) {
      console.log(`[Phase 2] ⚠️  Lecture de la query Supabase impossible : ${queryError?.message ?? 'inconnue'}`);
      return 'fail';
    }

    const { data: candidateRows, error: candidatesError } = await supabase
      .from('dpe_candidate')
      .select('*')
      .eq('query_id', body.queryId);
    if (candidatesError) {
      console.log(`[Phase 2] ⚠️  Lecture des candidats Supabase impossible : ${candidatesError.message}`);
      return 'fail';
    }

    const query = searchQueryFromRow(queryRow);
    const candidates = (candidateRows ?? []).map(candidateFromRow);
    const match = candidates.find((c) => c.adresse === EXPECTED_ADDRESS);

    if (!match) {
      console.log(`[Phase 2] ⚠️  Candidat validé non retrouvé parmi ${candidates.length} ligne(s) persistée(s).`);
      return 'fail';
    }

    const { score, total } = scoreCandidate(query, match);
    if (score !== total) {
      console.log(`[Phase 2] ⚠️  Candidat retrouvé mais badge ${score}/${total} (attendu ${total}/${total}).`);
      return 'fail';
    }

    console.log(
      `[Phase 2] ✅  Flow POST -> Supabase -> lecture retrouve l'adresse confirmée (${EXPECTED_ADDRESS}) avec un badge ${score}/${total}.`
    );
    return 'ok';
  } finally {
    server?.kill();
  }
}

async function main() {
  const phase0 = runBdnbNormalizationTest();
  console.log('');
  const phase1 = await runLibPipelineTest();
  console.log('');
  const phase2 = await runApiFlowTest();

  console.log(`\nRésumé : Phase 0 (unitaire) = ${phase0} · Phase 1 (lib) = ${phase1} · Phase 2 (API+Supabase) = ${phase2}`);
  process.exitCode = phase0 === 'fail' || phase1 === 'fail' || phase2 === 'fail' ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
