-- Ajoute le flag "recherche élargie à tout Marseille" sur dpe_search_query,
-- absent des migrations précédentes. La case "Chercher dans tout Marseille"
-- existe côté formulaire (app/page.tsx) et pilote le scope de la requête
-- ADEME (lib/ademe.ts::searchDpe), mais n'était jusqu'ici jamais persistée.
--
-- Nécessaire pour /app/historique/page.tsx : sans lui, impossible de savoir
-- après coup si une query ciblait un seul arrondissement ou les 16, pour
-- afficher "13004" vs "Tout Marseille" dans la liste des recherches passées.
--
-- À jouer manuellement dans le SQL Editor Supabase, après les migrations
-- précédentes.

alter table dpe_search_query
  add column chercher_tout_marseille boolean not null default false;
