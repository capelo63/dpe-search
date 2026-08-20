'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { newSearchQuerySchema, cleanNoisyNumber, type SearchQuery } from '@/types/dpe';
import { MARSEILLE_CODES_POSTAUX } from '@/lib/marseille';
import { addRecentQuery } from '@/lib/recent-queries';
import { computeDpeLabels } from '@/lib/dpe-labels';

const ETIQUETTES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

function arrondissementLabel(cp: string): string {
  const n = Number(cp) - 13000;
  return `${cp} (${n}${n === 1 ? 'er' : 'e'} arrondissement)`;
}

type FormState = {
  consoEp: string;
  emissionGes: string;
  etage: string;
  etiquetteDpeOverride: string;
  etiquetteGesOverride: string;
  codePostal: string;
  chercherToutMarseille: boolean;
  surfaceApprox: string;
  surfaceTolerancePct: string;
  nbNiveauMax: string;
  nbLotsMin: string;
  nbLotsMax: string;
  anneeConstructionMax: string;
  listingUrl: string;
  listingAgence: string;
  listingPrix: string;
  notes: string;
};

const initialState: FormState = {
  consoEp: '',
  emissionGes: '',
  etage: '',
  etiquetteDpeOverride: '',
  etiquetteGesOverride: '',
  codePostal: '',
  chercherToutMarseille: false,
  surfaceApprox: '',
  surfaceTolerancePct: '15',
  nbNiveauMax: '',
  nbLotsMin: '',
  nbLotsMax: '',
  anneeConstructionMax: '',
  listingUrl: '',
  listingAgence: '',
  listingPrix: '',
  notes: '',
};

/**
 * Pré-remplissage depuis "Modifier la recherche" (?queryId=xxx, cf.
 * components/ShortlistView.tsx et app/shortlist/[queryId]/page.tsx) : fetch
 * de la query existante puis reconstruction de l'état formulaire. Soumettre
 * crée une nouvelle query (pas d'UPDATE), l'historique garde donc trace de
 * chaque tentative. surfaceApprox/tolérance sont reconstruits depuis
 * surface_min/surface_max (arrondi, approximation de la saisie initiale).
 * Les étiquettes ne réactivent pas automatiquement le mode surcharge : elles
 * sont recalculées depuis conso/émission comme pour une saisie neuve, sauf
 * si l'utilisateur rouvre "Modifier" lui-même.
 */
function stateFromQuery(query: SearchQuery): FormState {
  let surfaceApprox = '';
  let surfaceTolerancePct = '15';
  if (query.surfaceMin != null && query.surfaceMax != null) {
    const approx = (query.surfaceMin + query.surfaceMax) / 2;
    const tolerance = approx > 0 ? Math.round(((query.surfaceMax - approx) / approx) * 100) : 15;
    surfaceApprox = String(Math.round(approx));
    surfaceTolerancePct = String(tolerance);
  }
  return {
    consoEp: query.consoEpMin != null ? String(query.consoEpMin) : '',
    emissionGes: query.emissionGesMin != null ? String(query.emissionGesMin) : '',
    etage: query.etageMin != null ? String(query.etageMin) : '',
    etiquetteDpeOverride: query.etiquetteDpe ?? '',
    etiquetteGesOverride: query.etiquetteGes ?? '',
    codePostal: query.codePostal,
    chercherToutMarseille: query.chercherToutMarseille,
    surfaceApprox,
    surfaceTolerancePct,
    nbNiveauMax: query.nbNiveauMax != null ? String(query.nbNiveauMax) : '',
    nbLotsMin: query.nbLotsMin != null ? String(query.nbLotsMin) : '',
    nbLotsMax: query.nbLotsMax != null ? String(query.nbLotsMax) : '',
    anneeConstructionMax: query.anneeConstructionMax != null ? String(query.anneeConstructionMax) : '',
    listingUrl: query.listingUrl ?? '',
    listingAgence: query.listingAgence ?? '',
    listingPrix: query.listingPrix != null ? String(query.listingPrix) : '',
    notes: query.notes ?? '',
  };
}

export default function Home() {
  return (
    <Suspense>
      <SearchForm />
    </Suspense>
  );
}

function SearchForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryIdParam = searchParams.get('queryId');

  const [form, setForm] = useState<FormState>(initialState);
  const [prefilling, setPrefilling] = useState(!!queryIdParam);
  const [overrideActive, setOverrideActive] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!queryIdParam) return;
    let cancelled = false;
    fetch(`/api/queries/${queryIdParam}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
        return body as SearchQuery;
      })
      .then((query) => {
        if (!cancelled) setForm(stateFromQuery(query));
      })
      .catch((err: Error) => {
        if (!cancelled) setSubmitError(`Recherche introuvable : ${err.message}`);
      })
      .finally(() => {
        if (!cancelled) setPrefilling(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queryIdParam]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Calcul live des étiquettes (Évolution 1) — même nettoyage que le
  // schéma Zod (cleanNoisyNumber), pour accepter "206 kWh/m²/an EP" pendant
  // la frappe sans attendre le submit.
  const consoEpValue = cleanNoisyNumber(form.consoEp);
  const emissionGesValue = form.emissionGes ? cleanNoisyNumber(form.emissionGes) : undefined;
  const computedLabels =
    typeof consoEpValue === 'number'
      ? computeDpeLabels(consoEpValue, typeof emissionGesValue === 'number' ? emissionGesValue : undefined)
      : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setFieldErrors({});

    // Résout les étiquettes avant validation : surcharge manuelle si
    // activée, sinon calcul automatique (lib/dpe-labels.ts). etiquetteDpe
    // est toujours résolvable dès que conso EP est un nombre valide.
    const resolvedEtiquetteDpe = form.etiquetteDpeOverride || computedLabels?.etiquetteDpe || undefined;
    const resolvedEtiquetteGes = form.etiquetteGesOverride || computedLabels?.etiquetteGes || undefined;

    const payload = {
      ...form,
      etiquetteDpe: resolvedEtiquetteDpe,
      etiquetteGes: resolvedEtiquetteGes,
    };

    // Validation client via le même schéma Zod que le serveur (types/dpe.ts) :
    // les valeurs bruitées collées depuis une annonce ("206 kWh/m²/an EP")
    // sont nettoyées par le preprocess du schéma avant tout contrôle.
    const parsed = newSearchQuerySchema.safeParse(payload);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !(key in errors)) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      addRecentQuery(body.queryId);
      router.push(`/shortlist/${body.queryId}`);
    } catch (err) {
      setSubmitError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-muted-foreground">
        Signature DPE d&apos;une annonce Marseille → shortlist d&apos;adresses candidates.
      </p>
      {prefilling && <p className="mt-4 text-sm text-muted-foreground">Chargement de la recherche…</p>}

      <form onSubmit={handleSubmit} className="mt-8 space-y-8">
        {/* (a) Signature DPE — conso EP obligatoire, émission facultative, étiquettes calculées */}
        <fieldset className="space-y-4 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">Signature DPE</legend>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Conso EP (kWh/m²/an), obligatoire" error={fieldErrors.consoEp}>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                placeholder='ex. "206 kWh/m²/an EP"'
                value={form.consoEp}
                onChange={(e) => set('consoEp', e.target.value)}
              />
            </Field>

            <Field label="Émission GES (kgCO2/m²/an)" error={fieldErrors.emissionGes}>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                placeholder='ex. "8 kgCO2/m²/an" (facultatif)'
                value={form.emissionGes}
                onChange={(e) => set('emissionGes', e.target.value)}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Facultatif. Sans cette valeur, ta recherche sera plus large — pense à renseigner les
                contraintes contexte pour compenser.
              </span>
            </Field>
          </div>

          <Field
            label={
              form.emissionGes
                ? 'Étage (numéro, ex. RDC = 0)'
                : 'Étage (numéro, ex. RDC = 0) — obligatoire sans émission GES'
            }
            error={fieldErrors.etage}
          >
            <input
              className="input"
              type="text"
              inputMode="numeric"
              placeholder="ex. 3"
              value={form.etage}
              onChange={(e) => set('etage', e.target.value)}
            />
            {!form.emissionGes && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Sans émission GES, l&apos;étage est nécessaire pour garder la recherche exploitable
                (sinon trop de candidats à vérifier).
              </span>
            )}
          </Field>

          <div className="flex items-center justify-between gap-2 rounded-md bg-secondary px-3 py-2 text-sm">
            {computedLabels ? (
              <p>
                DPE calculé : <strong>{computedLabels.etiquetteDpe}</strong>
                {computedLabels.etiquetteGes &&
                  ` (conso ${computedLabels.etiquetteConso} / GES ${computedLabels.etiquetteGes})`}
              </p>
            ) : (
              <p className="text-muted-foreground">Saisis la conso EP pour voir l&apos;étiquette calculée.</p>
            )}
            <button
              type="button"
              onClick={() => setOverrideActive((v) => !v)}
              className="shrink-0 text-xs text-muted-foreground hover:underline"
            >
              {overrideActive ? 'Utiliser le calcul automatique' : 'Modifier'}
            </button>
          </div>

          {overrideActive && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Étiquette DPE (surcharge manuelle)" error={fieldErrors.etiquetteDpe}>
                <select
                  className="input"
                  value={form.etiquetteDpeOverride}
                  onChange={(e) => set('etiquetteDpeOverride', e.target.value)}
                >
                  <option value="">— calcul automatique —</option>
                  {ETIQUETTES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Étiquette GES (surcharge manuelle)" error={fieldErrors.etiquetteGes}>
                <select
                  className="input"
                  value={form.etiquetteGesOverride}
                  onChange={(e) => set('etiquetteGesOverride', e.target.value)}
                >
                  <option value="">— calcul automatique —</option>
                  {ETIQUETTES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </fieldset>

        {/* (b) Périmètre géographique — obligatoire */}
        <fieldset className="space-y-4 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">Périmètre géographique (obligatoire)</legend>

          <Field label="Code postal" error={fieldErrors.codePostal}>
            <select
              className="input"
              value={form.codePostal}
              onChange={(e) => set('codePostal', e.target.value)}
            >
              <option value="">—</option>
              {MARSEILLE_CODES_POSTAUX.map((cp) => (
                <option key={cp} value={cp}>
                  {arrondissementLabel(cp)}
                </option>
              ))}
            </select>
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.chercherToutMarseille}
              onChange={(e) => set('chercherToutMarseille', e.target.checked)}
            />
            Chercher dans tout Marseille (16 arrondissements)
          </label>
        </fieldset>

        {/* (c) Contraintes contexte — optionnelles, repliable */}
        <details className="rounded-lg border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Contraintes contexte annonce (optionnel)
          </summary>

          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Surface habitable (m²)" error={fieldErrors.surfaceApprox}>
                <input
                  className="input"
                  type="text"
                  inputMode="decimal"
                  placeholder="ex. 86"
                  value={form.surfaceApprox}
                  onChange={(e) => set('surfaceApprox', e.target.value)}
                />
              </Field>

              <Field label="Tolérance (%)" error={fieldErrors.surfaceTolerancePct}>
                <input
                  className="input"
                  type="text"
                  inputMode="decimal"
                  value={form.surfaceTolerancePct}
                  onChange={(e) => set('surfaceTolerancePct', e.target.value)}
                />
              </Field>
            </div>

            <Field label="Nb niveaux max" error={fieldErrors.nbNiveauMax}>
              <input
                className="input"
                type="text"
                inputMode="numeric"
                placeholder="ex. 3"
                value={form.nbNiveauMax}
                onChange={(e) => set('nbNiveauMax', e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Nb de lots min" error={fieldErrors.nbLotsMin}>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  placeholder="ex. 10"
                  value={form.nbLotsMin}
                  onChange={(e) => set('nbLotsMin', e.target.value)}
                />
              </Field>

              <Field label="Nb de lots max" error={fieldErrors.nbLotsMax}>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  placeholder="ex. 15"
                  value={form.nbLotsMax}
                  onChange={(e) => set('nbLotsMax', e.target.value)}
                />
              </Field>
            </div>

            <Field label="Construit avant (année)" error={fieldErrors.anneeConstructionMax}>
              <input
                className="input"
                type="text"
                inputMode="numeric"
                placeholder="ex. 1930"
                value={form.anneeConstructionMax}
                onChange={(e) => set('anneeConstructionMax', e.target.value)}
              />
            </Field>
          </div>
        </details>

        {/* (d) Référence annonce — optionnelle */}
        <fieldset className="space-y-4 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">Référence annonce (optionnel)</legend>

          <Field label="URL de l'annonce" error={fieldErrors.listingUrl}>
            <input
              className="input"
              type="text"
              placeholder="https://..."
              value={form.listingUrl}
              onChange={(e) => set('listingUrl', e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Agence" error={fieldErrors.listingAgence}>
              <input
                className="input"
                type="text"
                value={form.listingAgence}
                onChange={(e) => set('listingAgence', e.target.value)}
              />
            </Field>

            <Field label="Prix FAI (€)" error={fieldErrors.listingPrix}>
              <input
                className="input"
                type="text"
                inputMode="numeric"
                value={form.listingPrix}
                onChange={(e) => set('listingPrix', e.target.value)}
              />
            </Field>
          </div>

          <Field label="Notes" error={fieldErrors.notes}>
            <textarea
              className="input"
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
        </fieldset>

        {/* (e) Submit */}
        <div>
          {submitError && <p className="mb-3 text-sm text-destructive">{submitError}</p>}
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {loading ? 'Recherche en cours…' : 'Rechercher'}
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-destructive">{error}</span>}
    </label>
  );
}
