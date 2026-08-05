'use client';

import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { DeforestationAlert, Plot } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  GFW_LEGEND,
  GFW_TILE_URL,
  registerGfwProtocol,
  subscribeTileIssues,
} from '@/lib/ui/gfw-tiles';

/**
 * Jendela instrumen.
 *
 * Satu-satunya bidang gelap di seluruh aplikasi — sengaja, karena isinya
 * memang citra satelit, bukan dokumen. Lapisannya, dari bawah ke atas:
 *
 *  1. Citra satelit Esri World Imagery (tanpa token)
 *  2. Alert deforestasi GFW, DIDEKODE ULANG di browser (lib/ui/gfw-tiles.ts)
 *  3. Batas petak / radius sourcing
 *  4. Titik pabrik atau titik alert hasil dekode server
 *
 * Lapisan alert tidak boleh dipasang sebagai raster biasa: alpha tile GFW
 * hanya bernilai 4/8/24 dari 255 karena channel itu menyimpan tingkat
 * keyakinan, bukan transparansi. Dirender apa adanya hasilnya 1,6-9% opasitas
 * alias tak terlihat. Protokol kustom membacanya dengan aturan yang sama
 * dengan server, lalu menggambar ulang dengan warna yang terbaca mata.
 *
 * Semua endpoint sudah diuji dengan panggilan nyata (HTTP 200) sebelum dipakai.
 */

const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export interface PlotMapProps {
  /** Titik pabrik yang bisa dipilih. */
  plots?: Plot[];
  selectedPlotId?: string | null;
  onSelect?: (plot: Plot) => void;
  /** Petak yang sedang dilihat — peta akan memusat ke sini. */
  focus?: Plot | null;
  /** Alert hasil dekode piksel, digambar sebagai titik. */
  alerts?: DeforestationAlert[];
  className?: string;
}

export function PlotMap({
  plots = [],
  selectedPlotId = null,
  onSelect,
  focus = null,
  alerts = [],
  className,
}: PlotMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  // Callback disimpan di ref supaya handler klik MapLibre selalu memanggil
  // versi terbaru tanpa perlu memasang ulang peta setiap render.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Dibaca di dalam effect titik pabrik tanpa menjadikannya dependensi.
  const focusRef = useRef(focus);
  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);
  /** Sekali saja: jangan rebut kendali kamera setiap kali daftar diperbarui. */
  const fittedPlots = useRef(false);
  /** Dipakai handler klik MapLibre untuk mencari plot dari id-nya. */
  const plotsRef = useRef(plots);
  useEffect(() => {
    plotsRef.current = plots;
  }, [plots]);

  const [ready, setReady] = useState(false);
  const [showAlerts, setShowAlerts] = useState(true);
  /** Tile alert yang ditolak GFW — dilaporkan, tidak disembunyikan (§0). */
  const [missingTiles, setMissingTiles] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);

  // ── inisialisasi peta ──
  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;

    (async () => {
      try {
        // MapLibre v6 tidak lagi punya default export — hanya named export.
        const {
          Map,
          NavigationControl,
          ScaleControl,
          addProtocol,
          getWorkerUrl,
          setWorkerUrl,
        } = await import('maplibre-gl');
        if (cancelled || !container.current) return;

        // MapLibre menebak lokasi worker-nya dari `import.meta.url` modulnya
        // sendiri, dan menyerah jadi string kosong bila itu bukan URL http.
        // Di bawah Turbopack memang bukan — akibatnya worker tidak pernah
        // dibuat, dan SETIAP lapisan GeoJSON diam-diam kosong sementara raster
        // tetap normal. Tidak ada error yang muncul di mana pun; gejalanya
        // hanya `isStyleLoaded()` yang selamanya false.
        // Berkas worker disalin ke public/maplibre (lihat SOURCE.txt di sana).
        if (!getWorkerUrl()) setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

        // Protokol yang mendekode tile alert GFW jadi piksel yang terlihat.
        registerGfwProtocol(
          addProtocol as Parameters<typeof registerGfwProtocol>[0],
        );

        const m = new Map({
          container: container.current,
          center: [110, 2],
          zoom: 3.4,
          attributionControl: {
            compact: true,
            customAttribution:
              'Imagery: Esri World Imagery · Alerts: Global Forest Watch (CC BY 4.0)',
          },
          style: {
            version: 8,
            sources: {
              imagery: {
                type: 'raster',
                tiles: [ESRI_IMAGERY],
                tileSize: 256,
                maxzoom: 18,
                attribution: 'Esri, Maxar, Earthstar Geographics',
              },
              gfw: {
                type: 'raster',
                tiles: [GFW_TILE_URL],
                tileSize: 256,
                // Tile asli tersedia sampai z12; di atas itu MapLibre
                // memperbesar tile z12 alih-alih meminta yang tidak ada.
                maxzoom: 12,
                attribution:
                  'Global Forest Watch integrated alerts (CC BY 4.0)',
              },
            },
            layers: [
              { id: 'bg', type: 'background', paint: { 'background-color': '#0b1116' } },
              { id: 'imagery', type: 'raster', source: 'imagery' },
              { id: 'gfw', type: 'raster', source: 'gfw' },
            ],
          },
        });

        m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
        m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

        // `style.load`, BUKAN `load`. `load` baru menyala setelah tile pertama
        // selesai dirender, sehingga satu sumber raster yang gagal menyandera
        // seluruh antarmuka di layar "loading map…" — persis yang terjadi saat
        // dekoder tile alert sempat melempar. Sumber dan lapisan hanya butuh
        // gayanya siap, bukan tilenya.
        m.on('style.load', () => {
          if (cancelled) return;

          // sumber kosong dulu; diisi oleh effect di bawah
          m.addSource('plots', { type: 'geojson', data: emptyFC() });
          m.addSource('focus', { type: 'geojson', data: emptyFC() });
          m.addSource('alerts', { type: 'geojson', data: emptyFC() });

          m.addLayer({
            id: 'focus-fill',
            type: 'fill',
            source: 'focus',
            paint: { 'fill-color': '#0F5F8F', 'fill-opacity': 0.14 },
          });
          m.addLayer({
            id: 'focus-line',
            type: 'line',
            source: 'focus',
            paint: { 'line-color': '#9fd4f5', 'line-width': 2.5, 'line-dasharray': [3, 2] },
          });

          m.addLayer({
            id: 'alert-dots',
            type: 'circle',
            source: 'alerts',
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.6, 14, 4],
              'circle-color': '#D81E5B',
              'circle-opacity': 0.9,
              'circle-stroke-width': 0.5,
              'circle-stroke-color': '#3a0417',
            },
          });

          m.addLayer({
            id: 'plot-dots',
            type: 'circle',
            source: 'plots',
            paint: {
              // `interpolate` atas `['zoom']` WAJIB berada di tingkat teratas;
              // menyarangkannya di dalam `case` membuat MapLibre membuang
              // seluruh aturan ini — itulah kenapa titik pabrik sempat tidak
              // muncul sama sekali. Jadi urutannya dibalik: interpolasi di
              // luar, pilihan terpilih/tidak di tiap perhentian.
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                4,
                ['case', ['boolean', ['feature-state', 'selected'], false], 7, 3.5],
                8,
                ['case', ['boolean', ['feature-state', 'selected'], false], 10, 5.5],
                12,
                ['case', ['boolean', ['feature-state', 'selected'], false], 13, 8],
              ],
              'circle-color': [
                'case',
                ['boolean', ['feature-state', 'selected'], false],
                '#ffffff',
                '#7fc4ec',
              ],
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#08243a',
            },
          });

          m.on('click', 'plot-dots', (e) => {
            const id = e.features?.[0]?.properties?.plotId;
            if (typeof id !== 'string') return;
            const hit = plotsRef.current.find((p) => p.id === id);
            if (hit) onSelectRef.current?.(hit);
          });
          m.on('mouseenter', 'plot-dots', () => {
            m.getCanvas().style.cursor = 'pointer';
          });
          m.on('mouseleave', 'plot-dots', () => {
            m.getCanvas().style.cursor = '';
          });

          setReady(true);
        });

        m.on('error', (e) => {
          // Tile gagal itu lumrah di tepi cakupan; yang tidak boleh adalah peta
          // gagal diam-diam. Catat, jangan sembunyikan.
          console.warn('[peta]', e.error?.message ?? e);
        });

        map.current = m;
      } catch (e) {
        setFailure(
          `The map could not load: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    })();

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // ── kabar tile yang tidak tersedia ──
  useEffect(() => subscribeTileIssues(setMissingTiles), []);

  // ── lapisan alert bisa dimatikan ──
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.getLayer('gfw')) return;
    m.setLayoutProperty('gfw', 'visibility', showAlerts ? 'visible' : 'none');
  }, [showAlerts, ready]);

  // ── titik pabrik ──
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = geojsonSource(m, 'plots');
    if (!src) return;

    src.setData({
      type: 'FeatureCollection',
      features: plots.map((p) => ({
        type: 'Feature' as const,
        id: p.id,
        geometry: { type: 'Point' as const, coordinates: centroidOf(p) },
        // Hanya id yang dibawa. Versi sebelumnya menyisipkan seluruh objek
        // Plot ter-JSON di properti tiap titik — 500 poligon 65 sudut, sekitar
        // 1,3 MB yang disalin ke dalam sumber peta tanpa satu pun dibaca.
        properties: { plotId: p.id, name: p.name },
      })),
    });

    // Arahkan pandangan ke tempat pabriknya benar-benar berada. Pusat awal
    // peta ([110, 2]) jatuh di Kalimantan tengah, sedangkan seluruh 500 pabrik
    // hasil seed ada di Malaysia — layarnya benar, isinya di luar bingkai, dan
    // yang terlihat pengguna adalah peta kosong.
    if (!focusRef.current && plots.length > 0 && !fittedPlots.current) {
      const b = bboxOfMany(plots);
      if (b) {
        m.fitBounds(b, { padding: 40, duration: 0, maxZoom: 8 });
        fittedPlots.current = true;
      }
    }

  }, [plots, ready]);

  // ── penanda terpilih ──
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    for (const p of plots) {
      m.setFeatureState(
        { source: 'plots', id: p.id },
        { selected: p.id === selectedPlotId },
      );
    }
  }, [selectedPlotId, plots, ready]);

  // ── petak yang sedang dilihat ──
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = geojsonSource(m, 'focus');
    if (!src) return;

    if (!focus) {
      src.setData(emptyFC());
      return;
    }
    src.setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: focus.geojson, properties: { name: focus.name } },
      ],
    });

    const b = bboxOf(focus);
    if (b) m.fitBounds(b, { padding: 48, duration: 700, maxZoom: 13 });
  }, [focus, ready]);

  // ── titik alert hasil dekode ──
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = geojsonSource(m, 'alerts');
    if (!src) return;

    src.setData({
      type: 'FeatureCollection',
      features: alerts.map((a) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [a.lon, a.lat] },
        properties: { date: a.date, confidence: a.confidence ?? 'unverified' },
      })),
    });
  }, [alerts, ready]);


  if (failure) {
    return (
      <div
        className={cn(
          'flex items-center justify-center border border-alert/40 bg-alert-soft p-6',
          className,
        )}
        role="alert"
      >
        <p className="datum text-alert">{failure}</p>
      </div>
    );
  }

  return (
    <div className={cn('relative overflow-hidden rounded-sm border border-rule', className)}>
      <div ref={container} className="h-full w-full bg-[#0b1116]" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
        <span className="pointer-events-auto rounded-sm bg-[#0b1116]/85 px-2 py-1 font-[family-name:var(--font-data)] text-[0.625rem] tracking-[0.1em] text-[#9fd4f5] uppercase">
          Satellite imagery
        </span>
        <label className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-sm bg-[#0b1116]/85 px-2 py-1 text-[0.6875rem] text-[#dbe7ee]">
          <input
            type="checkbox"
            checked={showAlerts}
            onChange={(e) => setShowAlerts(e.target.checked)}
            className="accent-[#F0347A]"
          />
          GFW alerts
        </label>
      </div>

      {showAlerts && missingTiles > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 top-10 flex justify-center px-2">
          <p className="pointer-events-auto max-w-md rounded-sm border border-[#e0b25c]/60 bg-[#2a1f08]/90 px-2 py-1 text-[0.6875rem] leading-snug text-[#f0d9a8]">
            {missingTiles} alert tile{missingTiles === 1 ? '' : 's'} could not be
            loaded from Global Forest Watch. Those areas are blank because the
            source refused, not because they are clear.
          </p>
        </div>
      ) : null}

      {showAlerts ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-3 gap-y-1 bg-gradient-to-t from-[#0b1116] to-transparent px-2 pt-6 pb-7">
          <span className="font-[family-name:var(--font-data)] text-[0.625rem] tracking-[0.1em] text-[#9fd4f5] uppercase">
            Alert confidence
          </span>
          {GFW_LEGEND.map((l) => (
            <span
              key={l.label}
              className="flex items-center gap-1 text-[0.625rem] text-[#dbe7ee]"
            >
              <span
                aria-hidden
                className="size-2 rounded-[1px]"
                style={{
                  background: `rgba(${l.rgba[0]},${l.rgba[1]},${l.rgba[2]},${l.rgba[3] / 255})`,
                }}
              />
              {l.label}
            </span>
          ))}
        </div>
      ) : null}

      {!ready && !failure ? (
        <p className="absolute inset-0 flex items-center justify-center font-[family-name:var(--font-data)] text-xs text-[#9fd4f5]">
          loading map…
        </p>
      ) : null}
    </div>
  );
}

// ---------- bantuan geometri ----------

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/** Sumber GeoJSON yang benar-benar sudah ada dan benar-benar bertipe geojson. */
function geojsonSource(m: MapLibreMap, id: string): GeoJSONSource | null {
  const s = m.getSource(id);
  return s && s.type === 'geojson' ? (s as GeoJSONSource) : null;
}

function eachPosition(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  fn: (lon: number, lat: number) => void,
): void {
  const rings =
    geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
  for (const ring of rings) {
    for (const pos of ring) {
      const [lon, lat] = pos;
      if (typeof lon === 'number' && typeof lat === 'number') fn(lon, lat);
    }
  }
}

/** Titik tengah bounding box — cukup untuk menempatkan penanda pabrik. */
function centroidOf(p: Plot): [number, number] {
  const b = bboxOf(p);
  if (!b) return [0, 0];
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

/** Kotak pembatas gabungan seluruh petak — dipakai memusatkan peta ke data. */
function bboxOfMany(plots: Plot[]): [number, number, number, number] | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const p of plots) {
    eachPosition(p.geojson, (lon, lat) => {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    });
  }
  if (!Number.isFinite(minLon)) return null;
  return [minLon, minLat, maxLon, maxLat];
}

function bboxOf(p: Plot): [number, number, number, number] | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  eachPosition(p.geojson, (lon, lat) => {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  });

  if (!Number.isFinite(minLon)) return null;
  return [minLon, minLat, maxLon, maxLat];
}
