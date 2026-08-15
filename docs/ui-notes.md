# Notes UI — à appliquer lors du build du formulaire et de la shortlist

Consignes validées par l'utilisateur après le test end-to-end du pipeline (cas réel : 25 Boulevard Boisson, 13004 Marseille, trouvé comme candidat unique). Pas encore implémentées — cette page sert de mémoire entre sessions Claude Code online (`/app/page.tsx`, `/app/shortlist/[queryId]/page.tsx`, `TableCandidats.tsx`, `FiltresDynamiques.tsx` restent à construire).

## Formulaire (`/app/page.tsx`)

- Case à cocher **"chercher dans tout Marseille"** à côté du champ code postal : bascule `chercherToutMarseille` dans `lib/ademe.ts::searchDpe` (élargit de l'arrondissement déduit du CP aux 16 codes INSEE 13201-13216 en une requête). Décoché par défaut (recherche sur l'arrondissement exact déduit du CP).

## Shortlist (`/app/shortlist/[queryId]/page.tsx`, `TableCandidats.tsx`)

Rendre visible la **force du match**, pas juste le résultat binaire "dans la liste ou pas" :

- **Badge par candidat** : `N/M critères satisfaits` (M = nombre de contraintes contexte réellement renseignées sur cette query — étage/surface/nb_lots/hauteur/année ne sont pas tous obligatoires, donc M varie selon la query, pas fixe à 5).
- **Détail dépliable par candidat** : liste des contraintes évaluées avec le résultat individuel de chacune (✓/✗ + valeur BDNB vs valeur attendue), pas juste le total agrégé.
- **Bouton "élargir la recherche"** : relâche les contraintes une à une (pas un reset global) quand la shortlist est vide ou trop réduite — probablement en désactivant la contrainte la moins discriminante en premier, ou en laissant l'utilisateur choisir laquelle lâcher. À trancher au moment de l'implémentation.

## Rappel pipeline (déjà validé, ne pas re-discuter)

- Matching signature DPE (étiquette DPE/GES + conso EP + émission GES) : **exact, sans tolérance**. Un résultat unique est le comportement voulu quand toute la signature + le contexte sont exacts.
- `nb_log_rnc` (registre copropriétés) prime sur `nb_log` (estimation géométrique BDNB) pour tout ce qui touche au nombre de lots — déjà encodé dans `lib/bdnb.ts::BdnbEnrichment.nbLots`.
