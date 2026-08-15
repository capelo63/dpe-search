// Périmètre V0 : Marseille intra-muros uniquement, CP 13001 à 13016.
// Le code commune global de Marseille (13055) n'est pas utilisable ici : ADEME
// (champ code_insee_ban) et BDNB (champ code_commune_insee) raisonnent tous
// les deux au niveau arrondissement (secteurs électoraux, codes 13201-13216),
// voir docs/api-notes.md.
const CP_TO_INSEE: Record<string, string> = {
  '13001': '13201',
  '13002': '13202',
  '13003': '13203',
  '13004': '13204',
  '13005': '13205',
  '13006': '13206',
  '13007': '13207',
  '13008': '13208',
  '13009': '13209',
  '13010': '13210',
  '13011': '13211',
  '13012': '13212',
  '13013': '13213',
  '13014': '13214',
  '13015': '13215',
  '13016': '13216',
};

export const MARSEILLE_CODES_POSTAUX = Object.keys(CP_TO_INSEE);

export function isMarseillePostalCode(cp: string): boolean {
  return cp in CP_TO_INSEE;
}

export function cpToInsee(cp: string): string {
  const insee = CP_TO_INSEE[cp];
  if (!insee) {
    throw new Error(`Code postal hors périmètre Marseille (13001-13016) : ${cp}`);
  }
  return insee;
}
