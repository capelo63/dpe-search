# Notes API externes — vérifié le 2026-08-15

Vérification effectuée via `curl` en session Claude Code online, avant tout code. Objectif : confirmer les 3 endpoints du plan (BAN, ADEME DPE-Existant, BDNB), leurs paramètres de filtrage, et les champs exacts à mapper vers `dpe_search_query` / `dpe_candidate`.

**User-Agent applicatif** : tous les appels (ADEME comme BDNB) doivent utiliser `dpe-search/0.1 (+contact: cyril@hugon.link)` — identifiable et contactable en cas de souci côté fournisseur, plutôt qu'un UA générique. Mis à jour dans tous les exemples ci-dessous.

---

## 1. BAN — Base Adresse Nationale

Conforme au plan, aucune surprise.

```bash
curl -sS "https://api-adresse.data.gouv.fr/search/?q=rue+de+la+republique&limit=1&postcode=13001"
```

Réponse (200, GeoJSON) :

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": { "type": "Point", "coordinates": [5.373061, 43.297837] },
    "properties": {
      "label": "Rue de la republique 13001 Marseille",
      "score": 0.9658,
      "id": "13201_7849",
      "banId": "42a9f651-f944-4b0d-9b9c-084058e34aca",
      "name": "Rue de la republique",
      "postcode": "13001",
      "citycode": "13201",
      "city": "Marseille",
      "district": "Marseille 1er Arrondissement",
      "type": "street"
    }
  }],
  "query": "rue de la republique"
}
```

- Coordonnées : `features[0].geometry.coordinates` → `[lon, lat]`.
- Adresse normalisée : `properties.label`.
- `citycode` (code INSEE, ex. `13201` pour Marseille 1er) est utile pour croiser avec BDNB (`code_commune_insee`).
- Pas de clé requise, pas de rate-limit documenté observé sur un usage ponctuel.

---

## 2. ADEME DPE-Existant — data.ademe.fr (OpenDataSoft / data-fair)

### Dataset

- Nom : **DPE Logements existants (depuis juillet 2021)**
- Slug/id à utiliser dans l'URL : **`dpe03existant`** (id interne `meg-83tjwtg8dyz4vv7h1dqe`, mais le slug fonctionne directement et est plus lisible)
- 15 301 407 lignes, public, aucune clé requise.
- Endpoint confirmé :
  ```
  GET https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines
  ```

### ⚠️ Piège : `User-Agent` requis

Sans en-tête `User-Agent`, l'API renvoie **403 Forbidden** (WAF nginx devant data-fair). Toujours envoyer un UA explicite et identifiable : `dpe-search/0.1 (+contact: cyril@hugon.link)`.

### ⚠️ Piège découvert : le champ `code_postal_ban` est bloqué par le WAF dans `qs`

Le paramètre `qs` (syntaxe Lucene, ex. `champ:valeur AND champ2:valeur2`) est bien celui à utiliser pour filtrer (le filtre "par colonnes" simple `?champ=valeur` n'existe pas côté data-fair — testé, ignoré silencieusement avec un `hint`).

Mais **toute requête `qs` contenant `code_postal_ban:<valeur>` renvoie systématiquement 403**, quelle que soit la valeur (`13001`, `13002`, `75001` testés → tous 403), alors que `etiquette_dpe:D`, `numero_dpe:123`, `code_insee_ban:13201` fonctionnent (200). Cause probable : règle WAF spécifique sur ce nom de champ (pas un problème de syntaxe ni de rate-limit — confirmé par répétition après délai).

### Champ de filtre retenu : `code_insee_ban` (pas `code_postal_brut`)

Deux candidats de repli testés : `code_postal_brut` (CP tel que saisi par le diagnostiqueur) et `code_insee_ban` (code INSEE issu du géocodage BAN — même pipeline que `code_postal_ban`, juste pas bloqué par le WAF).

**Check de contenance sur le CP 13005 (arrondissement Marseille 5e, code INSEE `13205`)** :

| Filtre | Total |
|---|---|
| `code_postal_brut:13005` | 16 181 |
| `code_insee_ban:13205` | 15 844 |

Écart de ~2%, dans les deux sens. En creusant (`code_insee_ban:13205 AND NOT code_postal_brut:13005`, 199 lignes) :

```bash
curl -A "dpe-search/0.1 (+contact: cyril@hugon.link)" -G "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines" \
  --data-urlencode "qs=code_insee_ban:13205 AND NOT code_postal_brut:13005" \
  --data-urlencode "size=5" \
  --data-urlencode "select=numero_dpe,code_postal_brut,code_postal_ban,adresse_ban,identifiant_ban"
```

→ des adresses réellement au 13005 (`code_postal_ban: "13005"`, adresse BAN cohérente, ex. `"34 Rue madon 13005 Marseille"`) où le diagnostiqueur a saisi un `code_postal_brut` **voisin plausible mais faux** (`13004`, `13006`, `13001`) — confusion de bord d'arrondissement, pas une faute de frappe grossière type `13OO5`. Filtrer sur `code_postal_brut` aurait fait perdre ces ~200 candidats légitimes rien que sur cet arrondissement.

**`code_insee_ban` est donc le filtre retenu** : il vient du même géocodage BAN fiable que `code_postal_ban`, n'est pas bloqué par le WAF, et correspond exactement au `code_commune_insee` qu'on doit de toute façon calculer pour interroger BDNB (`cpToInsee()` dans `/lib/marseille.ts`, voir plus bas) — un seul mapping CP→INSEE sert aux deux APIs.

```bash
curl -A "dpe-search/0.1 (+contact: cyril@hugon.link)" -G "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines" \
  --data-urlencode "qs=code_insee_ban:13201 AND etiquette_dpe:D AND etiquette_ges:D" \
  --data-urlencode "size=20" \
  --data-urlencode "select=numero_dpe,etiquette_dpe,etiquette_ges,adresse_ban,identifiant_ban,conso_5_usages_par_m2_ep,emission_ges_5_usages_par_m2,date_etablissement_dpe,surface_habitable_logement,type_batiment,numero_etage_appartement,nombre_appartement,nombre_niveau_immeuble,_geopoint"
```

→ 200, résultats cohérents pour CP/arrondissement 13001 (`code_insee_ban:13201`) / DPE D / GES D.

### Stratégie de recherche : repli sur tout Marseille si 0 résultat sur l'arrondissement exact

Confirmé par le test end-to-end (`scripts/e2e-test.ts`, voir aussi ce script pour le détail) : le CP affiché sur une annonce (zone de distribution postale) et le `code_insee_ban` (secteur électoral issu du géocodage BAN) peuvent diverger près d'une frontière d'arrondissement — cf. le check de contenance ci-dessus. Sur le cas réel testé (CP 13005, signature exacte), 0 résultat dans `code_insee_ban:13205` mais **1 résultat exact en élargissant aux 16 arrondissements de Marseille** (le bâtiment était en réalité `code_insee_ban:13204`).

**Stratégie retenue pour `/lib/ademe.ts`** : chercher d'abord sur l'arrondissement déduit du CP saisi ; si 0 résultat après filtrage contexte, élargir automatiquement aux 16 CP Marseille (`(code_insee_ban:13201 OR ... OR code_insee_ban:13216)`) plutôt que de conclure à un échec — toujours dans le périmètre V0, pas de géocodage/bbox nécessaire, juste 16 clauses `OR` en plus.

⚠️ Le paramètre `size` doit être généreux (`200` au moins) sur cette requête élargie : sur signature exacte + tout Marseille, on a observé 62 lignes, largement au-dessus du défaut de pagination si non précisé.

### Filtres numériques (plages conso/émission)

Syntaxe range Lucene confirmée fonctionnelle :

```
qs=code_insee_ban:13201 AND etiquette_dpe:D AND conso_5_usages_par_m2_ep:[160 TO 170]
```

→ 200, résultats cohérents.

### Champs confirmés à mapper

| Usage | Champ ADEME |
|---|---|
| Étiquette DPE | `etiquette_dpe` |
| Étiquette GES | `etiquette_ges` |
| Conso EP (kWh/m²/an) | `conso_5_usages_par_m2_ep` |
| Émission GES (kgCO2/m²/an) | `emission_ges_5_usages_par_m2` |
| CP/arrondissement (filtre) | `code_insee_ban` (⚠️ pas `code_postal_ban`, bloqué par le WAF ; pas `code_postal_brut` non plus, saisie diagnostiqueur peu fiable — voir check de contenance ci-dessus) |
| CP (affichage) | `code_postal_ban` (lisible directement dans les résultats, seul le *filtre* WAF pose problème) |
| Adresse normalisée | `adresse_ban` |
| Clé de jointure BAN/BDNB | `identifiant_ban` (format `13201_9601_00017`, identique à `cle_interop_adr_principale_ban` côté BDNB — **clé de jointure directe**) |
| N° DPE | `numero_dpe` |
| Date DPE | `date_etablissement_dpe` |
| Surface | `surface_habitable_logement` |
| Type bâtiment | `type_batiment` |
| Étage | `numero_etage_appartement` |
| Nb lots (proxy) | `nombre_appartement` |
| Nb niveaux immeuble | `nombre_niveau_immeuble` |
| Géolocalisation | `_geopoint` (`"lat,lon"` string) |

`identifiant_ban` étant identique en format à `cle_interop_adr_principale_ban` de BDNB, c'est la clé de jointure à privilégier pour l'enrichissement (plus fiable qu'un géocodage BAN redondant, cf. point d'attention normalisation adresses du brief).

---

## 3. BDNB — Base de Données Nationale des Bâtiments

L'URL `bdnb.io` (ancienne doc citée dans le brief) a changé : l'API REST est maintenant sur **`api.bdnb.io`**, catalogue/portail sur `api-portail.bdnb.io`.

### Offre retenue : **API Open**

- Gratuite, **sans authentification**, en licence ouverte.
- Quota : 10 000 requêtes/mois, **120 req/min par IP** (confirmé par les en-têtes de réponse `x-rate-limit-limit: 120`, `x-rate-limit-remaining`, `x-rate-limit-reset`).
- Offres payantes (Open+/Expert) existent pour plus de volume — hors scope V0.

### Base URL confirmée

```
https://api.bdnb.io/v1/bdnb/donnees/<table>
```

Style **PostgREST** (filtres `?champ=eq.valeur`, `select=champ1,champ2`, etc. — pas de doc OpenAPI publique trouvée à un chemin standard, structure déduite du client Python officiel `bdnb-client` + tests directs).

### ⚠️ Piège : `code_commune_insee` absent de certaines tables larges

`batiment_groupe_dpe_representatif_logement`, `batiment_groupe_ffo_bat`, `batiment_groupe_bdtopo_bat` n'ont pas de colonne `code_commune_insee` filtrable directement (erreur PostgREST `42703`). C'est la vue consolidée **`batiment_groupe_complet`** qu'il faut utiliser — elle agrège tout ce dont on a besoin en un seul appel.

### Table à utiliser : `batiment_groupe_complet`

```bash
curl -A "dpe-search/0.1 (+contact: cyril@hugon.link)" \
  "https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet?code_commune_insee=eq.13201&select=batiment_groupe_id,libelle_adr_principale_ban,cle_interop_adr_principale_ban,hauteur_mean,annee_construction,nb_log,nb_niveau,classe_bilan_dpe&limit=3"
```

→ 200, exemple de résultat :

```json
{
  "batiment_groupe_id": "bdnb-bg-4QMY-PP2Z-THVX",
  "libelle_adr_principale_ban": "17 Rue vincent scotto 13001 Marseille 1er Arrondissement",
  "cle_interop_adr_principale_ban": "13201_9601_00017",
  "hauteur_mean": 23,
  "annee_construction": 1900,
  "nb_log": 6,
  "nb_niveau": 6,
  "classe_bilan_dpe": "C"
}
```

### ⚠️ Piège : timeout si on filtre sur `cle_interop_adr_principale_ban` seul

Filtrer uniquement par `cle_interop_adr_principale_ban=eq.<clé>` sur `batiment_groupe_complet` → **500 `statement timeout`** (colonne non indexée seule sur cette vue large). **Toujours combiner avec `code_commune_insee=eq.<insee>`** (indexé) en plus de la clé d'adresse — testé et rapide (< 1s) :

```bash
curl -A "dpe-search/0.1 (+contact: cyril@hugon.link)" \
  "https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet?code_commune_insee=eq.13201&cle_interop_adr_principale_ban=eq.13201_9601_00017&select=batiment_groupe_id,libelle_adr_principale_ban,hauteur_mean,annee_construction,nb_log,classe_bilan_dpe"
```

→ 200, résultat unique retourné en < 1s.

Le code INSEE Marseille se déduit du CP : arrondissement `13001` → `13201`, `13002` → `13202`, … `13016` → `13216` (16 mappings 1:1, à encoder en dur dans `/lib/marseille.ts`, fonction `cpToInsee(cp: string): string`). ⚠️ Le code commune global de Marseille (`13055`) ne fonctionne pas ici — BDNB (comme le champ `code_insee_ban` d'ADEME) raisonne au niveau **arrondissement** (secteurs électoraux, codes `13201`–`13216`), pas au niveau commune.

### Champs confirmés à mapper

| Usage | Champ BDNB (`batiment_groupe_complet`) |
|---|---|
| Hauteur moyenne bâtiment | `hauteur_mean` |
| Année de construction | `annee_construction` |
| Nb de logements (estimation géométrique) | `nb_log` |
| Nb de lots (registre copropriétés, plus fiable) | `nb_log_rnc` ⚠️ à préférer à `nb_log` pour le filtre "nb lots" — voir `scripts/e2e-test.ts` |
| Nb de niveaux | `nb_niveau` |
| DPE bâtiment (représentatif) | `classe_bilan_dpe` (peut être `null` si pas de DPE bâtiment agrégé) |
| Adresse | `libelle_adr_principale_ban` |
| Clé de jointure ADEME | `cle_interop_adr_principale_ban` ↔ `identifiant_ban` (ADEME) |
| Identifiant bâtiment | `batiment_groupe_id` |

### Stratégie d'enrichissement recommandée

1. Pour chaque candidat ADEME, on a déjà `identifiant_ban` (ex. `13201_9601_00017`) et le code postal.
2. Dériver le code INSEE Marseille depuis le CP (`13001` → `13201`, etc. — table statique, pas d'appel API).
3. Appeler `batiment_groupe_complet?code_commune_insee=eq.<insee>&cle_interop_adr_principale_ban=eq.<identifiant_ban>`.
4. Si aucun résultat (bâtiment non apparié dans BDNB, ~5-10% des cas selon la doc BDNB), laisser les champs `bdnb_*` à `null` et `bdnb_enriched_at` renseigné quand même (pour ne pas re-tenter en boucle).

Cette approche évite un géocodage BAN redondant (déjà fait par l'ADEME et la BDNB séparément) et est plus fiable que le matching adresse textuelle mentionné dans le brief.

---

## Résumé des écarts avec le plan initial

| Point du plan | Réalité vérifiée |
|---|---|
| Dataset ADEME "à confirmer" | Confirmé : slug `dpe03existant` |
| Filtre direct `code_postal_ban` dans `qs` | **Bloqué par le WAF (403)** → utiliser `code_insee_ban` (fiable, non filtré par WAF, réutilise le mapping CP→INSEE de `/lib/marseille.ts`) |
| BDNB sur `bdnb.io`, "clé API possiblement requise" | API réelle sur `api.bdnb.io`, offre **Open gratuite sans clé**, 120 req/min |
| Endpoint BDNB par adresse | Table `batiment_groupe_complet`, filtrer par `code_commune_insee` + `cle_interop_adr_principale_ban` (pas par adresse texte) |
| Matching adresse ADEME ↔ BDNB par normalisation texte | Un identifiant commun existe (`identifiant_ban` / `cle_interop_adr_principale_ban`), pas besoin de matching flou pour la majorité des cas |

## Collision de préfixe `dpe_*` dans Supabase Teriis

Vérifié manuellement par l'utilisateur dans le SQL Editor Supabase (aucune credential Supabase n'étant disponible dans cet environnement Claude Code online) :

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'dpe_%';
```

→ `Success. No rows returned`. RAS, la migration peut être jouée telle quelle.
