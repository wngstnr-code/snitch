/**
 * Intake petak lahan — validasi GeoJSON yang diunggah pengguna menjadi `Plot`.
 *
 * Ini batas sistem: apa pun yang masuk lewat sini berasal dari luar dan tidak
 * boleh dipercaya (CLAUDE.md §9). Semua penolakan harus membawa pesan yang
 * bisa dibaca manusia, karena pengguna nyata memang akan mengunggah file yang
 * salah dan mereka berhak tahu salahnya di mana.
 */

import { z } from 'zod';
import { areaHa, bbox, type Geometry } from '../evidence/gfw';
import { geohashOfBBox } from '../geohash';
import type { Plot } from '../types';

/**
 * Batas luas. z12 pada 500.000 ha sudah ratusan tile; di atas itu verifikasi
 * berubah jadi analisis regional dan berhenti bermakna sebagai "petak".
 * Menolak terang-terangan lebih jujur daripada diam-diam menurunkan resolusi.
 */
export const MAX_PLOT_HA = 500_000;

const position = z.tuple([z.number(), z.number()]).rest(z.number());
const ring = z.array(position).min(4);

const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(ring).min(1),
});

const multiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(ring).min(1)).min(1),
});

const geometrySchema = z.union([polygonSchema, multiPolygonSchema]);

const featureSchema = z.object({
  type: z.literal('Feature'),
  geometry: geometrySchema,
  properties: z.record(z.string(), z.unknown()).nullable().optional(),
});

const featureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.unknown()).min(1),
});

export class IntakeError extends Error {}

/**
 * Menerima Polygon, MultiPolygon, Feature, atau FeatureCollection.
 *
 * FeatureCollection berisi banyak polygon digabung jadi satu MultiPolygon —
 * bukan diambil fitur pertamanya. Mengambil yang pertama diam-diam akan
 * memverifikasi sebagian petak lalu melaporkannya sebagai keseluruhan, dan itu
 * persis jenis kebohongan yang dilawan produk ini.
 */
export function normalizeGeometry(input: unknown): Geometry {
  if (input === null || typeof input !== 'object') {
    throw new IntakeError('Bukan objek GeoJSON.');
  }

  const type = (input as { type?: unknown }).type;

  if (type === 'FeatureCollection') {
    const fc = featureCollectionSchema.safeParse(input);
    if (!fc.success) {
      throw new IntakeError('FeatureCollection tidak sah atau tanpa fitur.');
    }
    const polys: number[][][][] = [];
    for (const [i, f] of fc.data.features.entries()) {
      const parsed = featureSchema.safeParse(f);
      if (!parsed.success) {
        throw new IntakeError(
          `Fitur ke-${i + 1} bukan Feature bergeometri Polygon/MultiPolygon.`,
        );
      }
      const g = parsed.data.geometry;
      if (g.type === 'Polygon') polys.push(g.coordinates);
      else polys.push(...g.coordinates);
    }
    return polys.length === 1
      ? { type: 'Polygon', coordinates: polys[0]! }
      : { type: 'MultiPolygon', coordinates: polys };
  }

  if (type === 'Feature') {
    const parsed = featureSchema.safeParse(input);
    if (!parsed.success) {
      throw new IntakeError('Feature tidak membawa geometri Polygon/MultiPolygon.');
    }
    return parsed.data.geometry as Geometry;
  }

  const geom = geometrySchema.safeParse(input);
  if (!geom.success) {
    throw new IntakeError(
      'Geometri harus Polygon atau MultiPolygon. Titik dan garis tidak bisa diverifikasi sebagai petak.',
    );
  }
  return geom.data as Geometry;
}

/** Koordinat di luar rentang bumi biasanya berarti file-nya berproyeksi lain. */
function assertCoordinates(geom: Geometry): void {
  const rings =
    geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;

  for (const poly of rings) {
    for (const r of poly) {
      for (const [lon, lat] of r) {
        if (
          typeof lon !== 'number' ||
          typeof lat !== 'number' ||
          !Number.isFinite(lon) ||
          !Number.isFinite(lat)
        ) {
          throw new IntakeError('Ada koordinat yang bukan angka.');
        }
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
          throw new IntakeError(
            `Koordinat di luar rentang lon/lat: [${lon}, ${lat}]. ` +
              'GeoJSON wajib WGS84 (EPSG:4326) — kemungkinan file ini masih dalam proyeksi lain.',
          );
        }
      }
    }
  }
}

/** Cincin GeoJSON harus tertutup: titik terakhir = titik pertama. */
function assertClosedRings(geom: Geometry): void {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    for (const r of poly) {
      const first = r[0]!;
      const last = r[r.length - 1]!;
      if (first[0] !== last[0] || first[1] !== last[1]) {
        throw new IntakeError(
          'Ada cincin polygon yang tidak tertutup (titik terakhir harus sama dengan titik pertama).',
        );
      }
    }
  }
}

export interface PlotIntakeInput {
  name: string;
  operatorName: string;
  geojson: unknown;
  /** Kalau kosong, dibuat deterministik dari geohash + nama. */
  id?: string;
}

export interface PlotIntakeResult {
  plot: Plot;
  /** Dilaporkan ke UI supaya pengguna tahu zoom apa yang akan dipakai. */
  areaHa: number;
}

export function buildPlotFromUpload(input: PlotIntakeInput): PlotIntakeResult {
  const name = input.name.trim();
  if (!name) throw new IntakeError('Nama petak wajib diisi.');
  const operatorName = input.operatorName.trim();
  if (!operatorName) {
    throw new IntakeError(
      'Nama operator wajib diisi — tanpa itu tidak ada entitas yang bisa discreening ke daftar sanksi.',
    );
  }

  const geom = normalizeGeometry(input.geojson);
  assertCoordinates(geom);
  assertClosedRings(geom);

  const ha = areaHa(geom);
  if (ha <= 0) {
    throw new IntakeError('Luas petak terhitung nol — geometrinya kemungkinan rusak.');
  }
  if (ha > MAX_PLOT_HA) {
    throw new IntakeError(
      `Luas ${Math.round(ha).toLocaleString('id-ID')} ha melampaui batas ${MAX_PLOT_HA.toLocaleString('id-ID')} ha. ` +
        'Pecah menjadi beberapa petak — di atas batas ini hasilnya bukan lagi verifikasi tingkat petak.',
    );
  }

  const geohash = geohashOfBBox(bbox(geom));

  return {
    plot: {
      id: input.id?.trim() || `plot_${geohash}`,
      name,
      geojson: geom as Plot['geojson'],
      geohash,
      areaHa: ha,
      operatorName,
      source: 'upload',
    },
    areaHa: ha,
  };
}
