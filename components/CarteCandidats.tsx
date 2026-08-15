'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { scoreTier, SCORE_TIER_COLORS, type ScoredCandidate } from '@/lib/scoring';

// Tuiles IGN Plan v2, Géoplateforme, licence ouverte — aucune clé requise.
// ⚠️ Piège vérifié empiriquement (curl direct, tuiles réelles récupérées) :
// malgré le chemin /tms/1.0.0/, cet endpoint sert en réalité un schéma XYZ
// standard (pas de flip d'axe Y). Passer scheme: 'tms' sur la source raster
// pointe vers des Y qui n'existent pas dès qu'on dépasse le zoom ~8-9 (404
// systématique) — testé et confirmé : la carte reste vide avec 'tms'.
const IGN_TILES_URL = 'https://data.geopf.fr/tms/1.0.0/GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2/{z}/{x}/{y}.png';
const IGN_ATTRIBUTION = '© <a href="https://www.ign.fr/" target="_blank" rel="noreferrer">IGN</a>';

function popupHtml(c: ScoredCandidate): string {
  const streetView =
    c.latitude != null && c.longitude != null
      ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c.latitude},${c.longitude}`
      : null;
  // URL de recherche Pappers Immobilier construite à partir de l'adresse —
  // pattern non vérifié par curl (contrairement à BAN/ADEME/BDNB), à confirmer.
  const pappers = `https://immobilier.pappers.fr/recherche?q=${encodeURIComponent(c.adresse)}`;

  return `
    <div style="font-size:13px;line-height:1.5;min-width:190px">
      <div style="font-weight:600;margin-bottom:4px">${escapeHtml(c.adresse)}</div>
      <div>DPE ${escapeHtml(c.consoEp?.toString() ?? '–')} kWh/m²/an · ${escapeHtml(c.emissionGes?.toString() ?? '–')} kgCO2/m²/an</div>
      <div>Nb niveaux : ${c.bdnbNbNiveau ?? '–'} · Nb lots : ${c.bdnbNbLots ?? '–'} · Année : ${c.bdnbAnneeConstruction ?? '–'}</div>
      <div style="margin-top:6px;display:flex;gap:10px">
        ${streetView ? `<a href="${streetView}" target="_blank" rel="noreferrer">Street View</a>` : ''}
        <a href="${pappers}" target="_blank" rel="noreferrer">Pappers</a>
      </div>
    </div>
  `;
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

export function CarteCandidats({
  candidates,
  hoveredId,
  onMarkerClick,
  onMarkerHover,
}: {
  candidates: ScoredCandidate[];
  hoveredId: string | null;
  onMarkerClick: (id: string) => void;
  onMarkerHover: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const fittedRef = useRef(false);
  // Callbacks stables lus depuis l'effet des markers sans le ré-exécuter à
  // chaque render parent (évite de recréer tous les markers inutilement).
  const onMarkerClickRef = useRef(onMarkerClick);
  const onMarkerHoverRef = useRef(onMarkerHover);
  onMarkerClickRef.current = onMarkerClick;
  onMarkerHoverRef.current = onMarkerHover;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          ign: {
            type: 'raster',
            tiles: [IGN_TILES_URL],
            tileSize: 256,
            attribution: IGN_ATTRIBUTION,
          },
        },
        layers: [{ id: 'ign', type: 'raster', source: 'ign' }],
      },
      center: [5.37, 43.3], // Marseille — écrasé par le fitBounds au 1er rendu des candidats
      zoom: 12,
    });
    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    const map = mapRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function render() {
      if (!map) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();

      const withCoords = candidates.filter(
        (c): c is ScoredCandidate & { latitude: number; longitude: number } =>
          c.latitude != null && c.longitude != null
      );

      for (const c of withCoords) {
        const tier = scoreTier(c.score, c.total);
        const marker = new maplibregl.Marker({ color: SCORE_TIER_COLORS[tier].marker })
          .setLngLat([c.longitude, c.latitude])
          .setPopup(new maplibregl.Popup({ offset: 24 }).setHTML(popupHtml(c)))
          .addTo(map);

        const el = marker.getElement();
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => onMarkerClickRef.current(c.id));
        el.addEventListener('mouseenter', () => onMarkerHoverRef.current(c.id));
        el.addEventListener('mouseleave', () => onMarkerHoverRef.current(null));

        markersRef.current.set(c.id, marker);
      }

      if (!fittedRef.current && withCoords.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        withCoords.forEach((c) => bounds.extend([c.longitude, c.latitude]));
        map.fitBounds(bounds, { padding: 48, maxZoom: 17, duration: 0 });
        fittedRef.current = true;
      }
    }

    if (map.isStyleLoaded()) {
      render();
    } else {
      map.once('load', render);
    }
  }, [candidates]);

  // Surbrillance au survol d'une ligne du tableau (bordure + léger zoom visuel
  // du marker, sans déplacer la caméra — voir .dpe-marker-highlighted).
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      marker.getElement().classList.toggle('dpe-marker-highlighted', id === hoveredId);
    });
  }, [hoveredId]);

  return <div ref={containerRef} className="h-[500px] w-full rounded-lg border border-border" />;
}
