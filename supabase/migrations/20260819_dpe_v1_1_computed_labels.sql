-- V1.1 : les étiquettes DPE/GES ne sont plus saisies manuellement, elles
-- sont calculées à partir de conso EP / émission GES (lib/dpe-labels.ts).
-- L'émission GES devient elle-même facultative dans le formulaire, donc
-- l'étiquette GES qui en dérive ne peut plus toujours être garantie
-- non-nulle. etiquette_dpe reste NOT NULL : elle retombe sur la classe
-- conso seule quand l'émission est absente, donc toujours calculable tant
-- que conso EP est fourni (qui, lui, reste obligatoire).
--
-- À jouer manuellement dans le SQL Editor Supabase, après les migrations
-- précédentes.

alter table dpe_search_query
  alter column etiquette_ges drop not null;
