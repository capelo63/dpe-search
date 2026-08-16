'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { newSearchQuerySchema } from '@/types/dpe';
import { MARSEILLE_CODES_POSTAUX } from '@/lib/marseille';
import { addRecentQuery } from '@/lib/recent-queries';

const ETIQUETTES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

function arrondissementLabel(cp: string): string {
  const n = Number(cp) - 13000;
  return `${cp} (${n}${n === 1 ? 'er' : 'e'} arrondissement)`;
}

type FormState = {
  etiquetteDpe: string;
  etiquetteGes: string;
  consoEp: string;
  emissionGes: string;
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
  etiquetteDpe: '',
  etiquetteGes: '',
  consoEp: '',
  emissionGes: '',
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
 * Pré-remplissage depuis le CTA "Élargir la recherche" de la shortlist
 * (components/ShortlistView.tsx), qui encode la query précédente en query
 * params. Absent de l'URL = valeur par défaut (formulaire vierge).
 */
function stateFromParams(params: URLSearchParams): FormState {
  const get = (key: string) => params.get(key) ?? '';
  return {
    etiquetteDpe: get('etiquetteDpe'),
    etiquetteGes: get('etiquetteGes'),
    consoEp: get('consoEp'),
    emissionGes: get('emissionGes'),
    codePostal: get('codePostal'),
    chercherToutMarseille: params.get('chercherToutMarseille') === 'true',
    surfaceApprox: get('surfaceApprox'),
    surfaceTolerancePct: get('surfaceTolerancePct') || '15',
    nbNiveauMax: get('nbNiveauMax'),
    nbLotsMin: get('nbLotsMin'),
    nbLotsMax: get('nbLotsMax'),
    anneeConstructionMax: get('anneeConstructionMax'),
    listingUrl: get('listingUrl'),
    listingAgence: get('listingAgence'),
    listingPrix: get('listingPrix'),
    notes: get('notes'),
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
  const [form, setForm] = useState<FormState>(() =>
    searchParams.size > 0 ? stateFromParams(searchParams) : initialState
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setFieldErrors({});

    // Validation client via le même schéma Zod que le serveur (types/dpe.ts) :
    // les valeurs bruitées collées depuis une annonce ("206 kWh/m²/an EP")
    // sont nettoyées par le preprocess du schéma avant tout contrôle.
    const parsed = newSearchQuerySchema.safeParse(form);
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

      <form onSubmit={handleSubmit} className="mt-8 space-y-8">
        {/* (a) Signature DPE — obligatoire */}
        <fieldset className="space-y-4 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">Signature DPE (obligatoire)</legend>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Étiquette DPE" error={fieldErrors.etiquetteDpe}>
              <select
                className="input"
                value={form.etiquetteDpe}
                onChange={(e) => set('etiquetteDpe', e.target.value)}
              >
                <option value="">—</option>
                {ETIQUETTES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Étiquette GES" error={fieldErrors.etiquetteGes}>
              <select
                className="input"
                value={form.etiquetteGes}
                onChange={(e) => set('etiquetteGes', e.target.value)}
              >
                <option value="">—</option>
                {ETIQUETTES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Conso EP (kWh/m²/an)" error={fieldErrors.consoEp}>
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
                placeholder='ex. "8 kgCO2/m²/an"'
                value={form.emissionGes}
                onChange={(e) => set('emissionGes', e.target.value)}
              />
            </Field>
          </div>
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
