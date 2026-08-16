// Pas d'auth en V0 : le seul lien entre un navigateur et ses recherches
// passées est ce localStorage. /app/historique/page.tsx en fait
// l'intersection avec dpe_search_query en base (POST /api/queries/batch).

const STORAGE_KEY = 'dpe-search:recent-queries';
const MAX_ENTRIES = 50;

function readIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeIds(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // localStorage indisponible (navigation privée stricte, quota dépassé...) : no-op
  }
}

export function getRecentQueryIds(): string[] {
  return readIds();
}

/**
 * Ajoute (ou fait remonter en tête si déjà présent) un queryId. Le
 * dédoublonnage par id est nécessaire ici : /app/shortlist/[queryId] appelle
 * cette fonction à chaque affichage (y compris en revisitant une même
 * shortlist plusieurs fois), sans quoi le plafond de 50 entrées se ferait
 * rapidement écraser par des doublons du même id plutôt que par de
 * nouvelles recherches — sans rapport avec le "pas de dédoublonnage" de
 * l'affichage historique, qui lui porte sur des queries différentes.
 */
export function addRecentQuery(id: string): void {
  if (typeof window === 'undefined') return;
  const existing = readIds().filter((existingId) => existingId !== id);
  writeIds([id, ...existing].slice(0, MAX_ENTRIES));
}

/** Retire silencieusement des ids devenus introuvables en base (cf. champ `missing` de POST /api/queries/batch). */
export function removeRecentQueries(ids: string[]): void {
  if (typeof window === 'undefined' || ids.length === 0) return;
  const toRemove = new Set(ids);
  writeIds(readIds().filter((id) => !toRemove.has(id)));
}

export function clearRecentQueries(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
