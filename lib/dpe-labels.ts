import type { Etiquette } from '@/types/dpe';

// Seuils réglementaires du DPE 2021 (arrêté du 31/03/2021, méthode 3CL).
// Bornes hautes inclusives : une valeur exactement au seuil reste dans la
// meilleure classe (ex. 70 -> A, 70.001 -> B).
const CONSO_THRESHOLDS: [Etiquette, number][] = [
  ['A', 70],
  ['B', 110],
  ['C', 180],
  ['D', 250],
  ['E', 330],
  ['F', 420],
];

const GES_THRESHOLDS: [Etiquette, number][] = [
  ['A', 6],
  ['B', 11],
  ['C', 30],
  ['D', 50],
  ['E', 70],
  ['F', 100],
];

function classify(value: number, thresholds: [Etiquette, number][]): Etiquette {
  for (const [label, max] of thresholds) {
    if (value <= max) return label;
  }
  return 'G';
}

export type DpeLabels = {
  /** Classe déduite de la seule conso EP. */
  etiquetteConso: Etiquette;
  /** Classe déduite de la seule émission GES, ou null si non renseignée. */
  etiquetteGes: Etiquette | null;
  /**
   * Étiquette DPE finale affichée sur le diagnostic : depuis la réforme 2021,
   * c'est la moins bonne (la plus défavorable) des deux classes qui
   * l'emporte. Repli sur etiquetteConso seule si l'émission n'est pas fournie.
   */
  etiquetteDpe: Etiquette;
};

/**
 * Calcule les étiquettes DPE/GES à partir des seules valeurs numériques —
 * ce sont ces seuils qui remplacent la saisie manuelle des étiquettes dans
 * le formulaire (app/page.tsx affiche "DPE calculé : ..." en live).
 * emissionGes est optionnelle (V1.1 : le champ devient facultatif dans le
 * formulaire) ; sans elle, etiquetteGes vaut null et etiquetteDpe retombe
 * sur etiquetteConso seule.
 */
export function computeDpeLabels(consoEp: number, emissionGes?: number): DpeLabels {
  const etiquetteConso = classify(consoEp, CONSO_THRESHOLDS);
  const etiquetteGes = emissionGes != null ? classify(emissionGes, GES_THRESHOLDS) : null;
  const etiquetteDpe = etiquetteGes != null && etiquetteGes > etiquetteConso ? etiquetteGes : etiquetteConso;
  return { etiquetteConso, etiquetteGes, etiquetteDpe };
}
