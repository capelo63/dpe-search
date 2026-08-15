'use client';

export type Filters = {
  nbNiveauMax: number;
  anneeConstructionMax: number;
  nbLotsMin: number;
  nbLotsMax: number;
  surfaceTolerancePct: number;
};

export type FilterBounds = {
  nbNiveau: { min: number; max: number };
  annee: { min: number; max: number };
  nbLots: { min: number; max: number };
};

/**
 * Filtres purement côté client (pas de re-fetch) : bornes suggérées par le
 * brief (nb_niveaux 1-6, année 1850-2020, nb_lots 1-50) mais étendues
 * dynamiquement si un candidat dépasse ces valeurs, pour ne jamais masquer
 * un candidat réel par un plafond de slider trop bas.
 */
export function FiltresDynamiques({
  bounds,
  filters,
  onChange,
  surfaceReferenceDisponible,
}: {
  bounds: FilterBounds;
  filters: Filters;
  onChange: (next: Filters) => void;
  surfaceReferenceDisponible: boolean;
}) {
  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2 xl:grid-cols-4">
      <SliderField
        label={`Nb niveaux ≤ ${filters.nbNiveauMax}`}
        min={bounds.nbNiveau.min}
        max={bounds.nbNiveau.max}
        value={filters.nbNiveauMax}
        onChange={(v) => set('nbNiveauMax', v)}
      />

      <SliderField
        label={`Construit avant ${filters.anneeConstructionMax}`}
        min={bounds.annee.min}
        max={bounds.annee.max}
        value={filters.anneeConstructionMax}
        onChange={(v) => set('anneeConstructionMax', v)}
      />

      <div className="text-sm">
        <span className="mb-1 block text-muted-foreground">
          Nb de lots : {filters.nbLotsMin}–{filters.nbLotsMax}
        </span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={bounds.nbLots.min}
            max={bounds.nbLots.max}
            value={filters.nbLotsMin}
            onChange={(e) => set('nbLotsMin', Math.min(Number(e.target.value), filters.nbLotsMax))}
            className="w-full"
            aria-label="Nb de lots minimum"
          />
          <input
            type="range"
            min={bounds.nbLots.min}
            max={bounds.nbLots.max}
            value={filters.nbLotsMax}
            onChange={(e) => set('nbLotsMax', Math.max(Number(e.target.value), filters.nbLotsMin))}
            className="w-full"
            aria-label="Nb de lots maximum"
          />
        </div>
      </div>

      <SliderField
        label={
          surfaceReferenceDisponible
            ? `Tolérance surface ± ${filters.surfaceTolerancePct}%`
            : 'Tolérance surface (aucune surface de référence sur cette recherche)'
        }
        min={0}
        max={30}
        value={filters.surfaceTolerancePct}
        onChange={(v) => set('surfaceTolerancePct', v)}
        disabled={!surfaceReferenceDisponible}
      />
    </div>
  );
}

function SliderField({
  label,
  min,
  max,
  value,
  onChange,
  disabled,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full disabled:opacity-40"
      />
    </label>
  );
}
