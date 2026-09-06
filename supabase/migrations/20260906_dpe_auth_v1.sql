-- Checkpoint auth V1 : identification des utilisateurs (Supabase Auth,
-- magic link email uniquement), sans isolation stricte pour l'instant.
--
-- user_id nullable transitoirement : les queries existantes (créées en
-- anonyme, avant ce checkpoint) doivent continuer à fonctionner le temps de
-- la migration douce (bandeau "Rattacher mes recherches" sur / au premier
-- login, cf. app/api/queries/adopt). La contrainte NOT NULL sera ajoutée au
-- checkpoint 2, une fois la migration douce en place depuis assez longtemps
-- pour que les queries orphelines restantes puissent être arbitrées
-- manuellement plutôt que bloquer un déploiement.
--
-- Pas de nouvelle table users : auth.users (native Supabase) suffit pour ce
-- checkpoint, aucun profil public n'est nécessaire tant qu'on ne stocke que
-- l'email (déjà sur auth.users) et rien de plus.
--
-- Les policies RLS restent grand ouvertes ("dpe_v0_open_*", cf.
-- 20260815_dpe_v0.sql) : l'isolation stricte ("auth.uid() = user_id") vient
-- au checkpoint 2, une fois que toutes les queries actives ont un user_id.
--
-- À jouer manuellement dans le SQL Editor Supabase, après les migrations
-- précédentes. Prérequis dashboard (Auth, redirect URLs, etc.) : voir
-- docs/auth-setup.md.

alter table dpe_search_query
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists dpe_search_query_user_id_idx on dpe_search_query(user_id);
