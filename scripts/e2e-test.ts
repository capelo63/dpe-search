// Test manuel end-to-end du pipeline ADEME -> jointure BDNB -> filtrage contexte,
// sur un cas réel, avant tout scaffold Next.js. Voir docs/api-notes.md pour le
// détail des pièges API (WAF, champs de filtre retenus, etc.)
//
// Run: npx tsx scripts/e2e-test.ts

import { cpToInsee, MARSEILLE_CODES_POSTAUX } from '../lib/marseille.ts';

const USER_AGENT = 'dpe-search/0.1 (+contact: cyril@hugon.link)';
const ADEME_BASE = 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines';
const BDNB_BASE = 'https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet';

// --- Fingerprint annonce (saisi manuellement par l'utilisateur) ---
const fingerprint = {
  codePostal: '13005',
  etiquetteDpe: 'D',
  etiquetteGes: 'B',
  consoEp: 206,
  emissionGes: 8,
};

// --- Contraintes contexte annonce ---
const contraintes = {
  nbNiveauMax: 3,
  nbLogMin: 10,
  nbLogMax: 15,
  anneeConstructionMax: 1930,
  surfaceApprox: 86,
  surfaceTolerance: 0.15, // +/- 15%
};

type AdemeRecord = {
  numero_dpe: string;
  identifiant_ban: string | null;
  adresse_ban: string;
  code_insee_ban: string;
  etiquette_dpe: string;
  etiquette_ges: string;
  conso_5_usages_par_m2_ep: number;
  emission_ges_5_usages_par_m2: number;
  surface_habitable_logement?: number;
  surface_habitable_immeuble?: number;
  type_batiment?: string;
};

type BdnbRecord = {
  batiment_groupe_id: string;
  libelle_adr_principale_ban: string | null;
  hauteur_mean: number | null;
  annee_construction: number | null;
  nb_log: number | null;
  // Registre National des Copropriétés : décompte légal des lots, plus fiable que
  // nb_log (estimation géométrique BDNB qui sous-compte régulièrement les
  // immeubles anciens subdivisés, voir debug ci-dessous / README pipeline).
  nb_log_rnc: number | null;
  nb_niveau: number | null;
  classe_bilan_dpe: string | null;
};

async function fetchAdemeCandidates(codesInsee: string[]): Promise<AdemeRecord[]> {
  const inseeClause = codesInsee.map((c) => `code_insee_ban:${c}`).join(' OR ');
  const qs = [
    `(${inseeClause})`,
    `etiquette_dpe:${fingerprint.etiquetteDpe}`,
    `etiquette_ges:${fingerprint.etiquetteGes}`,
    `conso_5_usages_par_m2_ep:${fingerprint.consoEp}`,
    `emission_ges_5_usages_par_m2:${fingerprint.emissionGes}`,
  ].join(' AND ');

  const select = [
    'numero_dpe',
    'identifiant_ban',
    'adresse_ban',
    'code_insee_ban',
    'etiquette_dpe',
    'etiquette_ges',
    'conso_5_usages_par_m2_ep',
    'emission_ges_5_usages_par_m2',
    'surface_habitable_logement',
    'surface_habitable_immeuble',
    'type_batiment',
  ].join(',');

  const url = new URL(ADEME_BASE);
  url.searchParams.set('qs', qs);
  url.searchParams.set('size', '200'); // une signature exacte reste rare, mais Marseille entier peut dépasser 50 lignes
  url.searchParams.set('select', select);

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`ADEME ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  return body.results as AdemeRecord[];
}

async function fetchBdnbForCandidate(insee: string, identifiantBan: string): Promise<BdnbRecord | null> {
  const url = new URL(BDNB_BASE);
  url.searchParams.set('code_commune_insee', `eq.${insee}`);
  url.searchParams.set('cle_interop_adr_principale_ban', `eq.${identifiantBan}`);
  url.searchParams.set(
    'select',
    'batiment_groupe_id,libelle_adr_principale_ban,hauteur_mean,annee_construction,nb_log,nb_log_rnc,nb_niveau,classe_bilan_dpe'
  );

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`BDNB ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as BdnbRecord[];
  return body[0] ?? null;
}

function nbLots(bdnb: BdnbRecord): number | null {
  // nb_log_rnc (registre des copropriétés) prime sur nb_log (estimation
  // géométrique BDNB) quand disponible : plus proche du nombre réel de lots.
  return bdnb.nb_log_rnc ?? bdnb.nb_log;
}

function matchesContraintes(bdnb: BdnbRecord): boolean {
  if (bdnb.nb_niveau == null || bdnb.nb_niveau > contraintes.nbNiveauMax) return false;
  const lots = nbLots(bdnb);
  if (lots == null || lots < contraintes.nbLogMin || lots > contraintes.nbLogMax) return false;
  if (bdnb.annee_construction == null || bdnb.annee_construction >= contraintes.anneeConstructionMax)
    return false;
  return true;
}

function matchesSurface(ademe: AdemeRecord): boolean {
  const surface = ademe.surface_habitable_logement ?? ademe.surface_habitable_immeuble;
  if (surface == null) return true; // pas assez d'info pour exclure, laisse passer
  const lo = contraintes.surfaceApprox * (1 - contraintes.surfaceTolerance);
  const hi = contraintes.surfaceApprox * (1 + contraintes.surfaceTolerance);
  return surface >= lo && surface <= hi;
}

async function enrichAndFilter(ademeCandidates: AdemeRecord[]) {
  const enriched: { ademe: AdemeRecord; bdnb: BdnbRecord | null }[] = [];
  for (const c of ademeCandidates) {
    if (!c.identifiant_ban) {
      enriched.push({ ademe: c, bdnb: null });
      continue;
    }
    const bdnb = await fetchBdnbForCandidate(c.code_insee_ban, c.identifiant_ban);
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
  const ademePass1 = await fetchAdemeCandidates([insee]);
  console.log(`  ${ademePass1.length} DPE(s) sur signature exacte`);
  const { shortlist: shortlist1 } = await enrichAndFilter(ademePass1);
  console.log(`  ${shortlist1.length} candidat(s) satisfont les contraintes contexte`);

  let finalShortlist = shortlist1;
  let ademeCandidates = ademePass1;

  if (shortlist1.length === 0) {
    // Le CP affiché sur l'annonce (postal) et le code_insee_ban (géocodage BAN)
    // peuvent diverger près des frontières d'arrondissement (~1-2% des lignes,
    // voir docs/api-notes.md). On élargit à tout Marseille (toujours dans le
    // périmètre V0) plutôt que de conclure à un échec.
    console.log(`\n[Passe 2] 0 résultat sur l'arrondissement exact, élargissement à tout Marseille (13001-13016)`);
    const codesInsee = MARSEILLE_CODES_POSTAUX.map(cpToInsee);
    ademeCandidates = await fetchAdemeCandidates(codesInsee);
    console.log(`  ${ademeCandidates.length} DPE(s) sur signature exacte, tout Marseille`);
    const { shortlist: shortlist2 } = await enrichAndFilter(ademeCandidates);
    finalShortlist = shortlist2;
  }

  console.log(`\nShortlist finale (nb_niveau<=${contraintes.nbNiveauMax}, ` +
    `nb_lots∈[${contraintes.nbLogMin},${contraintes.nbLogMax}] via nb_log_rnc, ` +
    `annee_construction<${contraintes.anneeConstructionMax}, ` +
    `surface≈${contraintes.surfaceApprox}m² ±${contraintes.surfaceTolerance * 100}%): ${finalShortlist.length} adresse(s)`);
  for (const e of finalShortlist) {
    console.log(`  * ${e.ademe.adresse_ban}`);
    console.log(`    DPE ${e.ademe.numero_dpe} | ${e.ademe.etiquette_dpe}/${e.ademe.etiquette_ges} | ` +
      `conso_ep=${e.ademe.conso_5_usages_par_m2_ep} | emission_ges=${e.ademe.emission_ges_5_usages_par_m2} | ` +
      `surface=${e.ademe.surface_habitable_logement ?? e.ademe.surface_habitable_immeuble ?? '?'}`);
    console.log(`    BDNB hauteur=${e.bdnb!.hauteur_mean}m | annee=${e.bdnb!.annee_construction} | ` +
      `nb_log=${e.bdnb!.nb_log} | nb_log_rnc=${e.bdnb!.nb_log_rnc} | nb_niveau=${e.bdnb!.nb_niveau}`);
  }

  if (finalShortlist.length === 0) {
    console.log(`\n⚠️  Aucun candidat même après élargissement Marseille entier. À investiguer.`);
    process.exitCode = 1;
  } else {
    console.log(`\n✅  Pipeline validé : ${finalShortlist.length} candidat(s) trouvé(s) via ADEME -> jointure BDNB (identifiant_ban) -> filtrage contexte.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
