# Conventions de test manuel (Claude Code online)

Ce projet n'a pas de suite de tests automatisés end-to-end (V0, solo, scope serré). Pour tout changement UI/interactif que `tsc --noEmit` et `next build` ne peuvent pas valider (rendu réel, interactions souris/clavier, réseau), la méthode retenue en session Claude Code online :

## 1. Page de preview temporaire

Créer une route jetable (ex. `/app/dev-preview/page.tsx`) qui rend le composant à tester avec des **données mock**, sans dépendre de Supabase : aucun credential `NEXT_PUBLIC_SUPABASE_*` n'est disponible dans cet environnement (voir `docs/api-notes.md`), donc toute page qui lit/écrit en base ne peut pas être exercée avec de vraies données ici.

- Nommer la route de façon prévisible (`dev-preview`, `historique-preview`, etc.) pour la retrouver facilement avant commit.
- **Toujours la supprimer avant de commiter** — vérifier avec `git status` qu'aucune trace ne reste (page, script de capture).

## 2. Playwright + proxy sortant

Ce sandbox route tout le trafic HTTPS sortant via un agent proxy (`HTTPS_PROXY`/`https_proxy`, cf. variables d'environnement). Le Chromium lancé par Playwright **ne l'utilise pas nativement** :

- Les requêtes vers `localhost` (le serveur `next dev`) ne doivent **pas** passer par le proxy — le proxy de ce sandbox n'accepte que des tunnels CONNECT HTTPS et rejette le HTTP local en clair.
- Les requêtes vers un **domaine externe réel** (ex. tuiles IGN `data.geopf.fr`) échouent en direct (`ERR_CONNECTION_RESET`) car le sandbox exige le proxy pour sortir.

Solution qui marche de façon fiable : ne pas configurer de proxy au niveau du navigateur (`chromium.launch({ proxy: ... })` a déjà causé un rejet du trafic localhost dans le passé). À la place, intercepter la requête problématique côté Playwright (`page.route(pattern, handler)`) et la relayer via le `fetch` **Node** du script de test, qui lui fonctionne déjà nativement dans ce sandbox (mêmes appels que `lib/ademe.ts`/`lib/bdnb.ts` en usage normal) :

```js
await page.route('https://data.geopf.fr/**', async (route) => {
  const res = await fetch(route.request().url());
  const buf = Buffer.from(await res.arrayBuffer());
  await route.fulfill({ status: res.status, contentType: res.headers.get('content-type') ?? 'image/png', body: buf });
});
```

Le module `playwright` n'est pas dans les dépendances du projet (pas de raison de l'ajouter en prod) mais existe globalement dans l'environnement (`/opt/node22/lib/node_modules/playwright`, binaire Chromium sous `/opt/pw-browsers/chromium`). Le rendre résolvable depuis le projet le temps du test :

```bash
ln -s /opt/node22/lib/node_modules/playwright node_modules/playwright
# ... tests ...
rm node_modules/playwright   # à ne jamais committer
```

## 3. Simuler les appels réseau/API qui dépendent de Supabase

Pour une page qui appelle une route API interne branchée sur Supabase (ex. `POST /api/queries/batch`), intercepter cette route avec `page.route('**/api/...', route => route.fulfill({ json: {...} }))` et fournir une réponse synthétique plausible. Ça valide la logique de rendu du composant (états loading/vide/rempli, formattage, nettoyage du localStorage) mais **pas** la requête Supabase elle-même côté serveur — relire le code de la route attentivement à la place, et le signaler explicitement comme non vérifié en conditions réelles (cohérent avec le reste du projet : le round-trip Supabase réel reste à valider par l'utilisateur, qui a les credentials).

## 4. Déroulé type

1. `npm run dev` en arrière-plan sur un port dédié (éviter les conflits avec une éventuelle instance déjà lancée).
2. Script Playwright ad hoc (`scratch-*.mjs`, jamais committé) : navigue, mocke ce qui doit l'être (réseau externe, API internes), interagit (hover/clic/formulaire), capture des screenshots et/ou logge des assertions en console.
3. Lire les screenshots produits, vérifier visuellement.
4. Nettoyer : tuer le serveur dev, supprimer la page de preview, le script de capture, le symlink `node_modules/playwright`, les artefacts `.next`.
5. `git status` doit revenir propre avant tout commit.
