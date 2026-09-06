# Configuration Supabase Auth (checkpoint auth V1 — magic link)

Ce checkpoint ajoute l'authentification (Supabase Auth, magic link email
uniquement — pas de mot de passe, pas d'OAuth en V1). La partie code est
gérée par cette PR ; les réglages ci-dessous sont à faire **côté humain**,
dans le dashboard Supabase du projet (Auth → Providers / URL Configuration /
Email Templates).

## 1. Provider Email (magic link)

- Authentication → Providers → **Email** : activé.
- Authentication → Providers → **Email** → désactiver l'option mot de passe
  (« Email Password » / « Enable password sign-ups » selon la version du
  dashboard) : on ne veut que le lien magique (`signInWithOtp`), jamais de
  mot de passe stocké.

## 2. Redirect URLs

Authentication → URL Configuration → **Redirect URLs**. Liste à tenir à jour
au fil des checkpoints (ajouter, ne jamais retirer une URL encore utilisée
en prod) :

| URL                                       | Depuis quand         | Pourquoi |
|--------------------------------------------|----------------------|----------|
| `http://localhost:3000/**`                 | checkpoint auth V1   | dev local |
| `https://dpe-search.vercel.app/**`         | checkpoint auth V1   | prod actuelle (Vercel) |
| `https://ouestcebien.fr/**`                | checkpoint 3 (rebrand)| domaine marchand, à ajouter quand il sera configuré — **ne pas retirer l'URL Vercel à ce moment-là** si elle reste accessible |

## 3. Site URL

Authentication → URL Configuration → **Site URL** :

- Dev : `http://localhost:3000`
- Prod actuelle : `https://dpe-search.vercel.app`
- À reconfigurer en `https://ouestcebien.fr` au checkpoint 3.

## 4. Templates d'email

Authentication → Email Templates → **Magic Link**. Pas urgent pour ce
checkpoint (le template par défaut Supabase, en anglais, fonctionne tel
quel) — personnalisation en français à faire quand le temps le permet.

## 5. Vérifications avant de tester en réel

- [ ] Provider Email activé, mot de passe désactivé
- [ ] Redirect URLs : `localhost:3000/**` + URL Vercel prod
- [ ] Site URL correcte pour l'environnement testé
- [ ] Migration `supabase/migrations/20260906_dpe_auth_v1.sql` jouée (ajout
      de `user_id` sur `dpe_search_query`)

## Pourquoi ces choix (contexte pour la suite)

- **Magic link uniquement** : moins de friction à l'inscription, pas de mot
  de passe à sécuriser/faire oublier/faire réinitialiser, moins de surface
  d'attaque (pas de credential stuffing possible). Le compromis (email requis
  à chaque connexion) est acceptable pour un outil à usage peu fréquent.
- **Pas de table `dpe_users` custom** : `auth.users` (natif Supabase) suffit
  tant qu'on ne stocke que l'email — déjà présent nativement. Une table de
  profil public n'a de sens qu'à partir du moment où on stocke autre chose
  (nom, préférences...), prévu à un checkpoint ultérieur.
- **RLS toujours grand ouvertes à ce stade** (`dpe_v0_open_*`, cf.
  `supabase/migrations/20260815_dpe_v0.sql`) : `user_id` est ajouté et
  renseigné sur les nouvelles queries, mais rien n'empêche encore un
  utilisateur authentifié de lire/modifier les données d'un autre — c'est
  volontaire pour ce checkpoint (identification avant isolation), corrigé au
  checkpoint suivant. Les endroits où un accès "pas le sien" est possible
  sont tracés via `console.warn` (`lib/supabase-server.ts::warnIfNotOwner`)
  pour donner de la visibilité avant d'activer le blocage.
