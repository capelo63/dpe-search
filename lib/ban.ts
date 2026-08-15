const BAN_BASE = 'https://api-adresse.data.gouv.fr/search/';
const USER_AGENT = 'dpe-search/0.1 (+contact: cyril@hugon.link)';

export type BanResult = {
  label: string;
  latitude: number;
  longitude: number;
  postcode: string;
  citycode: string;
  score: number;
};

type RawBanFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    label: string;
    postcode: string;
    citycode: string;
    score: number;
  };
};

/**
 * Normalise en Title Case une adresse brute ADEME avant géocodage BAN
 * (ex. "Rue melchion" -> "Rue Melchion") — les adresses ADEME sont parfois
 * mal capitalisées par le diagnostiqueur.
 */
export function normalizeAddress(raw: string): string {
  return raw.toLowerCase().replace(/\p{L}+/gu, (word) => word[0].toUpperCase() + word.slice(1));
}

/**
 * Géocode une adresse via la BAN. Utile en secours pour un candidat sans
 * coordonnées ADEME (`_geopoint` absent) — la plupart des candidats ADEME
 * ont déjà leurs coordonnées, ce wrapper n'est donc pas appelé en routine.
 */
export async function geocodeAddress(address: string, codePostal?: string): Promise<BanResult | null> {
  const url = new URL(BAN_BASE);
  url.searchParams.set('q', normalizeAddress(address));
  url.searchParams.set('limit', '1');
  if (codePostal) url.searchParams.set('postcode', codePostal);

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`BAN ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { features: RawBanFeature[] };
  const feature = body.features[0];
  if (!feature) return null;

  return {
    label: feature.properties.label,
    longitude: feature.geometry.coordinates[0],
    latitude: feature.geometry.coordinates[1],
    postcode: feature.properties.postcode,
    citycode: feature.properties.citycode,
    score: feature.properties.score,
  };
}
