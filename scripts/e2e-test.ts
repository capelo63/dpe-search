// Test end-to-end en deux phases, sur le cas réel validé par l'utilisateur
// (25 Boulevard Boisson, 13004 Marseille) :
//
//   Phase 1 — pipeline lib/ademe.ts -> lib/bdnb.ts en direct (pas de serveur,
//   pas de Supabase). Sert de test de non-régression sur les wrappers API.
//
//   Phase 2 — flow applicatif réel : spawn un serveur `next dev` éphémère,
//   POST /api/queries (mêmes fingerprint + contraintes), relit les candidats
//   persistés dans Supabase, vérifie qu'on retrouve la même adresse. Sautée
//   proprement si NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ne
//   sont pas dans l'environnement (ex. session Claude Code online sans
//   credentials Supabase) plutôt que d'échouer de façon confuse.
//
// Run: npm run e2e-test

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpToInsee, MARSEILLE_CODES_POSTAUX } from '../lib/marseille.ts';
import { searchDpeBySignature, type AdemeMatch } from '../lib/ademe.ts';
import { enrichBuilding, type BdnbEnrichment } from '../lib/bdnb.ts';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

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
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('dpe_candidate')
      .select('adresse')
      .eq('query_id', body.queryId);

    if (error) {
      console.log(`[Phase 2] ⚠️  Lecture Supabase impossible : ${error.message}`);
      return 'fail';
    }

    const found = (data ?? []).some((r: { adresse: string }) => r.adresse === EXPECTED_ADDRESS);
    if (!found) {
      console.log(`[Phase 2] ⚠️  Candidat validé non retrouvé parmi ${data?.length ?? 0} ligne(s) persistée(s).`);
      return 'fail';
    }
    console.log(`[Phase 2] ✅  Flow POST -> Supabase -> lecture retrouve l'adresse confirmée (${EXPECTED_ADDRESS}).`);
    return 'ok';
  } finally {
    server?.kill();
  }
}

async function main() {
  const phase1 = await runLibPipelineTest();
  console.log('');
  const phase2 = await runApiFlowTest();

  console.log(`\nRésumé : Phase 1 (lib) = ${phase1} · Phase 2 (API+Supabase) = ${phase2}`);
  process.exitCode = phase1 === 'fail' || phase2 === 'fail' ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
