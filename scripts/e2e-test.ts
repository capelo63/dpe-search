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
import { cpToInsee, MARSEILLE_CODES_POSTAUX } from '../lib/marseille.ts';
import { searchDpeBySignature, type AdemeMatch } from '../lib/ademe.ts';
import { enrichBuilding, normalizeBdnbLine, type BdnbEnrichment, type RawBdnbLine } from '../lib/bdnb.ts';

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

// --- Fingerprint annonce (saisi manuellement par l'utilisateur) ---
const fingerprint = {
  codePostal: '13005',
  etiquetteDpe: 'D' as const,
  etiquetteGes: 'B' as const,
  consoEp: 206,
  emissionGes: 8,
};

// --- Contraintes contexte annonce ---
const contraintes = {
  nbNiveauMax: 3,
  nbLotsMin: 10,
  nbLotsMax: 15,
  anneeConstructionMax: 1930,
  surfaceApprox: 86,
  surfaceTolerance: 0.15, // +/- 15%
};

const EXPECTED_ADDRESS = '25 Boulevard boisson 13004 Marseille';

function matchesContraintes(bdnb: BdnbEnrichment): boolean {
  if (bdnb.nbNiveau == null || bdnb.nbNiveau > contraintes.nbNiveauMax) return false;
  if (bdnb.nbLots == null || bdnb.nbLots < contraintes.nbLotsMin || bdnb.nbLots > contraintes.nbLotsMax)
    return false;
  if (bdnb.anneeConstruction == null || bdnb.anneeConstruction >= contraintes.anneeConstructionMax)
    return false;
  return true;
}

function matchesSurface(ademe: AdemeMatch): boolean {
  if (ademe.surfaceHabitable == null) return true; // pas assez d'info pour exclure, laisse passer
  const lo = contraintes.surfaceApprox * (1 - contraintes.surfaceTolerance);
  const hi = contraintes.surfaceApprox * (1 + contraintes.surfaceTolerance);
  return ademe.surfaceHabitable >= lo && ademe.surfaceHabitable <= hi;
}

async function enrichAndFilter(ademeCandidates: AdemeMatch[]) {
  const enriched: { ademe: AdemeMatch; bdnb: BdnbEnrichment | null }[] = [];
  for (const c of ademeCandidates) {
    const bdnb = c.identifiantBan ? await enrichBuilding(c.codeInseeBan, c.identifiantBan) : null;
    enriched.push({ ademe: c, bdnb });
  }
  const shortlist = enriched.filter((e) => e.bdnb && matchesContraintes(e.bdnb) && matchesSurface(e.ademe));
  return { enriched, shortlist };
}

async function runLibPipelineTest(): Promise<'ok' | 'fail'> {
  const insee = cpToInsee(fingerprint.codePostal);
  console.log(`[Phase 1] Fingerprint DPE=${fingerprint.etiquetteDpe}/${fingerprint.etiquetteGes}, ` +
    `conso_ep=${fingerprint.consoEp}, emission_ges=${fingerprint.emissionGes}, CP=${fingerprint.codePostal} (INSEE ${insee})`);

  console.log(`[Phase 1] ADEME sur code_insee_ban=${insee} uniquement`);
  const ademePass1 = await searchDpeBySignature(fingerprint, [insee]);
  console.log(`  ${ademePass1.length} DPE(s) sur signature exacte`);
  const { shortlist: shortlist1 } = await enrichAndFilter(ademePass1);
  console.log(`  ${shortlist1.length} candidat(s) satisfont les contraintes contexte`);

  let finalShortlist = shortlist1;

  if (shortlist1.length === 0) {
    // code_insee_ban (géocodage BAN) peut dériver par rapport au CP postal
    // affiché sur l'annonce près d'une frontière d'arrondissement (~1-2% des
    // lignes, voir docs/api-notes.md). Repli : élargir à tout Marseille.
    console.log(`[Phase 1] 0 résultat sur l'arrondissement exact, élargissement à tout Marseille (13001-13016)`);
    const codesInsee = MARSEILLE_CODES_POSTAUX.map(cpToInsee);
    const ademePass2 = await searchDpeBySignature(fingerprint, codesInsee);
    console.log(`  ${ademePass2.length} DPE(s) sur signature exacte, tout Marseille`);
    const { shortlist: shortlist2 } = await enrichAndFilter(ademePass2);
    finalShortlist = shortlist2;
  }

  console.log(`[Phase 1] Shortlist finale : ${finalShortlist.length} adresse(s)`);
  for (const e of finalShortlist) {
    console.log(`  * ${e.ademe.adresseBan}`);
  }

  const found = finalShortlist.some((e) => e.ademe.adresseBan === EXPECTED_ADDRESS);
  if (finalShortlist.length === 0) {
    console.log(`[Phase 1] ⚠️  Aucun candidat même après élargissement Marseille entier.`);
    return 'fail';
  }
  if (!found) {
    console.log(`[Phase 1] ⚠️  Shortlist non vide mais ne contient pas l'adresse validée (${EXPECTED_ADDRESS}).`);
    return 'fail';
  }
  console.log(`[Phase 1] ✅  lib/ademe.ts + lib/bdnb.ts retrouvent l'adresse confirmée.`);
  return 'ok';
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
        etiquetteDpe: fingerprint.etiquetteDpe,
        etiquetteGes: fingerprint.etiquetteGes,
        consoEp: fingerprint.consoEp,
        emissionGes: fingerprint.emissionGes,
        codePostal: fingerprint.codePostal,
        chercherToutMarseille: true,
        surfaceApprox: contraintes.surfaceApprox,
        surfaceTolerancePct: contraintes.surfaceTolerance * 100,
        nbNiveauMax: contraintes.nbNiveauMax,
        nbLotsMin: contraintes.nbLotsMin,
        nbLotsMax: contraintes.nbLotsMax,
        anneeConstructionMax: contraintes.anneeConstructionMax,
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
    const { scoreCandidate } = await import('../lib/scoring.ts');
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
