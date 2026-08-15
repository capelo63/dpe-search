-- dpe-search V0 — greffé sur le projet Supabase Teriis, tables préfixées dpe_*
-- À jouer manuellement dans le SQL Editor de Supabase Studio (pas de Supabase CLI en session Claude Code online).
--
-- Prérequis : vérifier qu'aucune table dpe_* n'existe déjà dans ce projet, ex.
--   select table_name from information_schema.tables
--   where table_schema = 'public' and table_name like 'dpe_%';

-- Query : une recherche = une signature DPE + un CP + des contraintes annonce
create table dpe_search_query (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  code_postal text not null,
  etiquette_dpe text not null check (etiquette_dpe in ('A','B','C','D','E','F','G')),
  etiquette_ges text not null check (etiquette_ges in ('A','B','C','D','E','F','G')),
  conso_ep_min numeric,
  conso_ep_max numeric,
  emission_ges_min numeric,
  emission_ges_max numeric,
  surface_min numeric,
  surface_max numeric,
  etage_min int,
  etage_max int,
  nb_lots_min int,
  nb_lots_max int,
  listing_url text,
  listing_agence text,
  listing_prix int,
  notes text
);

-- Candidat : une adresse ADEME matchée par une query, enrichie par BDNB
create table dpe_candidate (
  id uuid primary key default gen_random_uuid(),
  query_id uuid references dpe_search_query(id) on delete cascade,
  ademe_numero text,             -- n° DPE ADEME si dispo
  identifiant_ban text,          -- clé de jointure ADEME <-> BDNB (identifiant_ban / cle_interop_adr_principale_ban)
  adresse text not null,
  code_postal text not null,
  latitude numeric,
  longitude numeric,
  -- Signature DPE de l'ADEME
  conso_ep numeric,
  emission_ges numeric,
  -- Enrichissement BDNB
  bdnb_annee_construction int,
  bdnb_hauteur_moyenne numeric,
  bdnb_surface_batie numeric,
  bdnb_nb_lots int,
  bdnb_dpe_batiment text,
  bdnb_enriched_at timestamptz,
  -- Décision utilisateur
  status text default 'a_verifier' check (status in ('a_verifier','ecarte','confirme','visite')),
  notes text,
  created_at timestamptz default now()
);

create index dpe_candidate_query_id_idx on dpe_candidate(query_id);
create index dpe_candidate_status_idx on dpe_candidate(status);

-- V0 solo : RLS activée avec policies grand ouvertes.
-- Justification : la clé anon est utilisée depuis Claude Code online + Vercel, pas la service_role
-- (évite d'exposer une clé qui bypass toutes les RLS des autres tables Teriis).
-- En V1 avec auth : remplacer ces policies par du "auth.uid() = user_id" classique.
alter table dpe_search_query enable row level security;
create policy "dpe_v0_open_query" on dpe_search_query for all using (true) with check (true);

alter table dpe_candidate enable row level security;
create policy "dpe_v0_open_candidate" on dpe_candidate for all using (true) with check (true);
