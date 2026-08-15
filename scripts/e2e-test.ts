// Test manuel end-to-end du pipeline ADEME -> jointure BDNB -> filtrage
// contexte, sur un cas réel. Sert aussi de test de non-régression pour
// /lib/ademe.ts et /lib/bdnb.ts : toute évolution de ces wrappers doit
// continuer à retrouver 25 Boulevard Boisson, 13004 Marseille (validé par
// l'utilisateur).
//
// Run: npm run e2e-test

import { cpToInsee, MARSEILLE_CODES_POSTAUX } from '../lib/marseille.ts';
import { searchDpeBySignature, type AdemeMatch } from '../lib/ademe.ts';
import { enrichBuilding, type BdnbEnrichment } from '../lib/bdnb.ts';

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

async function main() {
  const insee = cpToInsee(fingerprint.codePostal);
  console.log(`Fingerprint DPE=${fingerprint.etiquetteDpe}/${fingerprint.etiquetteGes}, ` +
    `conso_ep=${fingerprint.consoEp}, emission_ges=${fingerprint.emissionGes}, CP=${fingerprint.codePostal} (INSEE ${insee})`);

  // --- Passe 1 : arrondissement exact déduit du CP ---
  console.log(`\n[Passe 1] ADEME sur code_insee_ban=${insee} uniquement`);
  const ademePass1 = await searchDpeBySignature(fingerprint, [insee]);
  console.log(`  ${ademePass1.length} DPE(s) sur signature exacte`);
  const { shortlist: shortlist1 } = await enrichAndFilter(ademePass1);
  console.log(`  ${shortlist1.length} candidat(s) satisfont les contraintes contexte`);

  let finalShortlist = shortlist1;

  if (shortlist1.length === 0) {
    // code_insee_ban (géocodage BAN) peut dériver par rapport au CP postal
    // affiché sur l'annonce près d'une frontière d'arrondissement (~1-2% des
    // lignes, voir docs/api-notes.md). Repli : élargir à tout Marseille
    // (équivalent de la case "chercher dans tout Marseille" du formulaire).
    console.log(`\n[Passe 2] 0 résultat sur l'arrondissement exact, élargissement à tout Marseille (13001-13016)`);
    const codesInsee = MARSEILLE_CODES_POSTAUX.map(cpToInsee);
    const ademePass2 = await searchDpeBySignature(fingerprint, codesInsee);
    console.log(`  ${ademePass2.length} DPE(s) sur signature exacte, tout Marseille`);
    const { shortlist: shortlist2 } = await enrichAndFilter(ademePass2);
    finalShortlist = shortlist2;
  }

  console.log(`\nShortlist finale (nb_niveau<=${contraintes.nbNiveauMax}, ` +
    `nb_lots∈[${contraintes.nbLotsMin},${contraintes.nbLotsMax}] via nb_log_rnc, ` +
    `annee_construction<${contraintes.anneeConstructionMax}, ` +
    `surface≈${contraintes.surfaceApprox}m² ±${contraintes.surfaceTolerance * 100}%): ${finalShortlist.length} adresse(s)`);
  for (const e of finalShortlist) {
    console.log(`  * ${e.ademe.adresseBan}`);
    console.log(`    DPE ${e.ademe.numeroDpe} | ${e.ademe.etiquetteDpe}/${e.ademe.etiquetteGes} | ` +
      `conso_ep=${e.ademe.consoEp} | emission_ges=${e.ademe.emissionGes} | surface=${e.ademe.surfaceHabitable ?? '?'}`);
    console.log(`    BDNB hauteur=${e.bdnb!.hauteurMoyenne}m | annee=${e.bdnb!.anneeConstruction} | ` +
      `nb_log=${e.bdnb!.nbLog} | nb_log_rnc=${e.bdnb!.nbLogRnc} | nb_niveau=${e.bdnb!.nbNiveau}`);
  }

  const expectedAddress = '25 Boulevard boisson 13004 Marseille';
  const found = finalShortlist.some((e) => e.ademe.adresseBan === expectedAddress);

  if (finalShortlist.length === 0) {
    console.log(`\n⚠️  Aucun candidat même après élargissement Marseille entier. À investiguer.`);
    process.exitCode = 1;
  } else if (!found) {
    console.log(`\n⚠️  Shortlist non vide mais ne contient pas l'adresse validée (${expectedAddress}). Régression possible dans lib/ademe.ts ou lib/bdnb.ts.`);
    process.exitCode = 1;
  } else {
    console.log(`\n✅  Pipeline validé : shortlist retrouve l'adresse confirmée (${expectedAddress}).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
