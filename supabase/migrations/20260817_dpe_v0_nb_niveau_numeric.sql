-- Corrige un bug de prod : BDNB renvoie parfois nb_niveau en décimal, y
-- compris des valeurs aberrantes (ex. 64.4 observé sur un bâtiment à
-- l'extraction géométrique douteuse), ce qui faisait échouer l'insert sur
-- les colonnes entières ("invalid input syntax for type integer").
--
-- Corrigé côté application dans lib/bdnb.ts::normalizeBdnbLine() (arrondi
-- systématique + neutralisation en null des nb_niveau > 20, sanity-check
-- documenté dans le code). On élargit aussi le type en base par prudence :
-- Math.round() renvoie toujours un entier donc `numeric` n'a aucune
-- conséquence fonctionnelle, juste une marge de sécurité si un futur
-- appelant oublie d'arrondir avant insert.
--
-- Déjà appliquée manuellement en prod le 2026-08-17 (fix urgent) ; ce
-- fichier documente le changement pour que l'historique de migrations
-- reste fidèle à l'état réel de la base.

alter table dpe_search_query
  alter column nb_niveau_max type numeric;

alter table dpe_candidate
  alter column bdnb_nb_niveau type numeric;
