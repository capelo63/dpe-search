// ADEME renvoie adresse_ban en minuscules ("rue henri fiocca") — mise en
// forme title-case pour l'affichage (shortlist), en laissant en minuscule
// les particules françaises usuelles sauf en tête d'adresse (convention
// habituelle : "Rue de la Palud", mais "De la Major" si l'adresse commence
// par une particule).
const PARTICLES = new Set(['de', 'la', 'le', 'les', 'du', 'des', "d'", "l'", 'à', 'au', 'aux', 'et']);

function capitalize(segment: string): string {
  if (segment.length === 0) return segment;
  return segment[0].toUpperCase() + segment.slice(1).toLowerCase();
}

/**
 * Capitalise un "sous-mot" (une partie d'un mot séparée par un tiret, ex.
 * "jean" et "baptiste" dans "jean-baptiste"). Gère à part le cas d'une
 * particule collée par une apostrophe ("d'estienne" -> "d'Estienne") : la
 * particule elle-même reste en minuscule (sauf en tête d'adresse), le mot
 * qui suit l'apostrophe est toujours capitalisé.
 */
function capitalizeSubword(subword: string, isFirstOfAddress: boolean): string {
  const apostropheMatch = subword.match(/^([a-zàâäéèêëïîôöùûüç]+)(['’])(.+)$/i);
  if (apostropheMatch) {
    const [, particle, apostrophe, rest] = apostropheMatch;
    const particleLower = particle.toLowerCase();
    const isParticle = PARTICLES.has(`${particleLower}'`);
    const particleOut = isParticle && !isFirstOfAddress ? particleLower : capitalize(particle);
    return `${particleOut}${apostrophe}${capitalize(rest)}`;
  }

  const lower = subword.toLowerCase();
  if (!isFirstOfAddress && PARTICLES.has(lower)) return lower;
  return capitalize(subword);
}

/**
 * Title-case une adresse ("3 rue henri fiocca" -> "3 Rue Henri Fiocca"),
 * particules françaises laissées en minuscule sauf en tête d'adresse, mots
 * composés par un tiret capitalisés de part et d'autre ("jean-jaurès" ->
 * "Jean-Jaurès").
 */
export function toTitleCase(address: string): string {
  const words = address.trim().split(/\s+/).filter(Boolean);
  return words
    .map((word, wordIndex) =>
      word
        .split('-')
        .map((sub, subIndex) => capitalizeSubword(sub, wordIndex === 0 && subIndex === 0))
        .join('-')
    )
    .join(' ');
}
