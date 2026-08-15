-- Complète dpe_search_query / dpe_candidate avec les champs "nb niveaux",
-- "année construction" et "surface habitable" nécessaires aux contraintes
-- contexte et au tableau du formulaire/shortlist (checkpoint /app/page.tsx +
-- /app/shortlist/[queryId]/page.tsx). Absents de la migration V0 initiale
-- (20260815_dpe_v0.sql) mais requis par le pipeline validé sur cas réel
-- (25 Boulevard Boisson, 13004) : nb_niveau et annee_construction sont deux
-- des contraintes contexte qui ont permis de désanonymiser l'adresse (voir
-- scripts/e2e-test.ts) ; surface_habitable est la surface ADEME du candidat
-- (déjà utilisée en pré-filtre côté recherche, mais jamais persistée jusqu'ici).
--
-- À jouer manuellement dans le SQL Editor Supabase, après 20260815_dpe_v0.sql.

alter table dpe_search_query
  add column nb_niveau_max int,
  add column annee_construction_max int;

alter table dpe_candidate
  add column bdnb_nb_niveau int,
  add column surface_habitable numeric;
