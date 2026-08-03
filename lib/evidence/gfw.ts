/**
 * B1 — Alert deforestasi GFW dari tile publik, tanpa API key.
 *
 * Port bertipe ketat dari `prototype/gfw.mjs` (terbukti 2026-08-03: petak
 * Sarawak 3.095 ha → 16 tile → 3.577 alert dalam 1,9 s). Yang ditambahkan di
 * sini dan tidak ada di prototipe: timeout + retry backoff (CLAUDE.md §9),
 * agregasi deterministik (R16), dan perakitan `DeforestationEvidence`.
 *
 * Sumber & encoding: CLAUDE.md §3.1.
 *   hari  = R * 255 + G, sejak 2014-12-31
 *   conf  = channel ALPHA {4: low, 8: high, 24: highest} — di luar itu null,
 *           JANGAN ditebak (R3)
 *   piksel dengan alpha 0 atau R==0 && G==0 = tidak ada alert
 *
 * Lisensi data: CC BY 4.0 — atribusi wajib tampil di UI dan README.
 */

import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { AlertConfidence, DeforestationAlert, DeforestationEvidence } from '../types';

export const GFW_TILE_BASE =
  'https://tiles.globalforestwatch.org/gfw_integrated_alerts';

export const GFW_ATTRIBUTION =
  'Global Forest Watch — Integrated Deforestation Alerts (CC BY 4.0)';

/** Basis encoding tanggal GFW. */
const ALERT_EPOCH_MS = Date.UTC(2014, 11, 31);

/** Cutoff EUDR: lahan yang dibuka setelah tanggal ini tidak comply. */
export const EUDR_CUTOFF = '2020-12-31';
const EUDR_CUTOFF_MS = Date.UTC(2020, 11, 31);

/** Terverifikasi empiris 2026-08-03: hanya tiga nilai ini yang muncul (R3). */
const ALPHA_CONFIDENCE: Readonly<Record<number, AlertConfidence>> = {
  4: 'low',
  8: 'high',
  24: 'highest',
};

/** Di atas ambang ini alert tidak disimpan penuh, hanya ringkasan (R16). */
export const MAX_FULL_ALERTS = 5_000;

const DAY_MS = 86_400_000;
const TILE_TIMEOUT_MS = 20_000;
const TILE_RETRIES = 3;
const DEFAULT_CONCURRENCY = 40;

export type Geometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
export interface TileRef {
  z: number;
  x: number;
  y: number;
}

// ---------- proyeksi Web Mercator ----------

export const lon2x = (lon: number, z: number): number => ((lon + 180) / 360) * 2 ** z;
export const lat2y = (lat: number, z: number): number =>
  ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
export const x2lon = (x: number, z: number): number => (x / 2 ** z) * 360 - 180;
export const y2lat = (y: number, z: number): number => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

// ---------- geometri ----------

function ringsOf(geom: Geometry): GeoJSON.Position[][][] {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  throw new Error(
    `Geometri tidak didukung: ${(geom as { type: string }).type}. Hanya Polygon dan MultiPolygon.`,
  );
}

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export function bbox(geom: Geometry): BBox {
  let minLon = 180;
  let minLat = 90;
  let maxLon = -180;
  let maxLat = -90;
  for (const poly of ringsOf(geom)) {
    for (const ring of poly) {
      for (const pos of ring) {
        const [lon, lat] = pos;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  if (minLon > maxLon || minLat > maxLat) {
    throw new Error('Geometri kosong — tidak ada koordinat.');
  }
  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Luas geodesik dalam hektar (formula spherical excess).
 * Akurasi ~0,7% vs elipsoid — cukup untuk memilih zoom dan melaporkan luas.
 * Ring pertama = batas luar, ring berikutnya = lubang (dikurangkan).
 *
 * Selalu hitung sendiri; jangan percaya field `area_ha` dataset konsesi yang
 * sebagian bernilai 0 (R19).
 */
export function areaHa(geom: Geometry): number {
  const R = 6_378_137;
  let total = 0;
  for (const poly of ringsOf(geom)) {
    poly.forEach((ring, idx) => {
      let s = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[i + 1];
        s +=
          (((lon2 - lon1) * Math.PI) / 180) *
          (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
      }
      const a = Math.abs((s * R * R) / 2);
      total += idx === 0 ? a : -a;
    });
  }
  return total / 10_000;
}

/** Ray casting. Menangani MultiPolygon dan lubang. */
export function pointInPolygon(lon: number, lat: number, geom: Geometry): boolean {
  for (const poly of ringsOf(geom)) {
    let inThis = false;
    for (const ring of poly) {
      let crossed = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
          crossed = !crossed;
        }
      }
      // ring luar memasukkan, lubang membatalkan
      if (crossed) inThis = !inThis;
    }
    if (inThis) return true;
  }
  return false;
}

/**
 * Zoom adaptif menurut luas AOI (R11). z14 untuk radius sourcing 50 km berarti
 * 1.681 tile ≈ 6 menit — tidak layak. Resolusi native Sentinel 10 m, jadi z15+
 * hanya upsampling.
 */
export function pickZoom(ha: number): number {
  if (ha <= 5_000) return 14; // petak: 4–9 tile, < 1 s
  if (ha <= 100_000) return 13;
  return 12; // AOI luas (radius pabrik 50 km): 121 tile, ~4 s
}

export function tilesFor(geom: Geometry, zoom: number): TileRef[] {
  const b = bbox(geom);
  const x0 = Math.floor(lon2x(b.minLon, zoom));
  const x1 = Math.floor(lon2x(b.maxLon, zoom));
  const y0 = Math.floor(lat2y(b.maxLat, zoom));
  const y1 = Math.floor(lat2y(b.minLat, zoom));
  const out: TileRef[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) out.push({ z: zoom, x, y });
  }
  return out;
}

// ---------- dekode PNG (node:zlib, nol dependensi) ----------

interface DecodedPng {
  width: number;
  height: number;
  channels: number;
  pixels: Buffer;
}

const CHANNELS_BY_COLOR_TYPE: Readonly<Record<number, number>> = {
  0: 1,
  2: 3,
  3: 1,
  4: 2,
  6: 4,
};

export function decodePng(buf: Buffer): DecodedPng {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('Bukan berkas PNG.');
  }
  let pos = 8;
  const idat: Buffer[] = [];
  let width = 0;
  let height = 0;
  let colorType = 6;

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || interlace !== 0) {
        throw new Error(
          `PNG tak didukung: bitDepth=${bitDepth} interlace=${interlace} (harus 8 dan 0).`,
        );
      }
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  const channels = CHANNELS_BY_COLOR_TYPE[colorType];
  if (!channels) throw new Error(`colorType PNG tak didukung: ${colorType}`);
  if (idat.length === 0) throw new Error('PNG tanpa chunk IDAT.');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let prev = Buffer.alloc(stride);
  let p = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 255;
      else if (filter === 2) line[i] = (line[i] + b) & 255;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      } else if (filter !== 0) {
        throw new Error(`Filter PNG tak dikenal: ${filter} pada baris ${y}.`);
      }
    }
    line.copy(out, y * stride);
    prev = line;
  }

  return { width, height, channels, pixels: out };
}

/** Semua alert di dalam satu tile, tanpa filter polygon. */
export function decodeTileAlerts(buf: Buffer, tile: TileRef): DeforestationAlert[] {
  const { width, height, channels, pixels } = decodePng(buf);
  const alerts: DeforestationAlert[] = [];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const o = (j * width + i) * channels;
      const r = pixels[o];
      const g = pixels[o + 1];
      const alpha = channels === 4 ? pixels[o + 3] : 255;
      if (alpha === 0 || (r === 0 && g === 0)) continue;
      alerts.push({
        date: new Date(ALERT_EPOCH_MS + (r * 255 + g) * DAY_MS).toISOString().slice(0, 10),
        lat: y2lat(tile.y + (j + 0.5) / height, tile.z),
        lon: x2lon(tile.x + (i + 0.5) / width, tile.z),
        confidence: ALPHA_CONFIDENCE[alpha] ?? null,
        tile,
      });
    }
  }
  return alerts;
}

// ---------- pengambilan tile ----------

export function tileUrl(version: string, tile: TileRef): string {
  return `${GFW_TILE_BASE}/${version}/default/${tile.z}/${tile.x}/${tile.y}.png`;
}

/**
 * Resolve `latest` → versi bertanggal (mis. `v20260803`) dan sematkan ke bukti,
 * supaya verifikasi bisa direproduksi belakangan (R14).
 */
export async function resolveVersion(): Promise<string> {
  const res = await fetch(`${GFW_TILE_BASE}/latest/default/0/0/0.png`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
  });
  const m = /gfw_integrated_alerts\/(v\d{8})\//.exec(res.url);
  if (!m) throw new Error(`Gagal me-resolve versi tile GFW dari ${res.url}`);
  return m[1];
}

/**
 * Satu tile, dengan timeout + retry backoff.
 *
 * Melempar bila akhirnya gagal — TIDAK PERNAH mengembalikan tile kosong (R10).
 * "Gagal memeriksa" bukan "tidak ada alert"; kalau keduanya tertukar, produk
 * ini menerbitkan attestation palsu.
 */
export async function fetchTile(version: string, tile: TileRef): Promise<Buffer> {
  const url = tileUrl(version, tile);
  let lastError = '';
  for (let attempt = 1; attempt <= TILE_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'snitch/0.1 (+https://github.com/wngstnr-code/snitch)' },
        signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      lastError = `HTTP ${res.status}`;
      // 4xx selain 429 tidak akan membaik dengan diulang.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < TILE_RETRIES) {
      await new Promise((r) => setTimeout(r, attempt * 750));
    }
  }
  throw new Error(
    `Tile ${tile.z}/${tile.x}/${tile.y} gagal diambil (${lastError}) setelah ${TILE_RETRIES} percobaan. ` +
      `GFW hanya melayani sabuk tropis — AOI di luar cakupan mengembalikan HTTP 500. ` +
      `URL: ${url}`,
  );
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const idx = next++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

// ---------- agregasi (R16) ----------

export interface AlertSummary {
  byMonth: Record<string, number>;
  byConfidence: Record<AlertConfidence, number>;
  truncated: boolean;
}

/**
 * Ringkasan deterministik — selalu dihitung dari SELURUH alert, termasuk saat
 * daftar penuhnya nanti dipangkas. Bundle bukti bisa membengkak sampai puluhan
 * MB pada AOI radius 50 km (R16); ringkasannya tetap kecil dan tetap jujur.
 */
export function summarizeAlerts(alerts: readonly DeforestationAlert[]): AlertSummary {
  const byMonth: Record<string, number> = {};
  const byConfidence: Record<AlertConfidence, number> = { low: 0, high: 0, highest: 0 };
  for (const a of alerts) {
    const month = a.date.slice(0, 7);
    byMonth[month] = (byMonth[month] ?? 0) + 1;
    if (a.confidence !== null) byConfidence[a.confidence] += 1;
  }
  return { byMonth, byConfidence, truncated: alerts.length > MAX_FULL_ALERTS };
}

export function countAfterCutoff(alerts: readonly DeforestationAlert[]): number {
  return alerts.filter((a) => Date.parse(a.date) > EUDR_CUTOFF_MS).length;
}

// ---------- orkestrasi ----------

export interface CollectOptions {
  zoom?: number;
  version?: string;
  concurrency?: number;
}

export interface CollectResult {
  alerts: DeforestationAlert[];
  tilesScanned: number;
  zoom: number;
  version: string;
  areaHa: number;
  fetchedAt: string;
  /** sha256 per tile, urut menurut z/x/y — dasar rawHash yang reproducible */
  tileHashes: Array<{ tile: TileRef; sha256: string }>;
}

/** Kumpulkan alert yang benar-benar jatuh di dalam polygon. */
export async function collectAlerts(
  geom: Geometry,
  opts: CollectOptions = {},
): Promise<CollectResult> {
  const ha = areaHa(geom);
  const zoom = opts.zoom ?? pickZoom(ha);
  const version = opts.version ?? (await resolveVersion());
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const tiles = tilesFor(geom, zoom).sort(
    (a, b) => a.z - b.z || a.x - b.x || a.y - b.y,
  );

  const perTile = await mapLimit(tiles, concurrency, async (tile) => {
    const buf = await fetchTile(version, tile);
    const alerts = decodeTileAlerts(buf, tile).filter((a) =>
      pointInPolygon(a.lon, a.lat, geom),
    );
    return { tile, alerts, sha256: createHash('sha256').update(buf).digest('hex') };
  });

  const alerts = perTile
    .flatMap((r) => r.alerts)
    .sort((a, b) => a.date.localeCompare(b.date) || a.lat - b.lat || a.lon - b.lon);

  return {
    alerts,
    tilesScanned: tiles.length,
    zoom,
    version,
    areaHa: ha,
    fetchedAt: new Date().toISOString(),
    tileHashes: perTile.map((r) => ({ tile: r.tile, sha256: r.sha256 })),
  };
}

function canonicalGeometry(geom: Geometry): string {
  return JSON.stringify({ type: geom.type, coordinates: geom.coordinates });
}

/**
 * Rakit bukti sesuai kontrak `DeforestationEvidence`.
 *
 * `rawHash` mencakup piksel tile MENTAH **plus** parameter query (versi, zoom,
 * geometri). Tanpa parameter itu, dua verifikasi dengan zoom berbeda bisa
 * menghasilkan hash sama padahal bukan bukti yang sama (R16).
 */
export function buildDeforestationEvidence(
  geom: Geometry,
  result: CollectResult,
): DeforestationEvidence {
  const manifest = JSON.stringify({
    source: GFW_TILE_BASE,
    version: result.version,
    zoom: result.zoom,
    geometry: canonicalGeometry(geom),
    tiles: result.tileHashes.map((t) => `${t.tile.z}/${t.tile.x}/${t.tile.y}:${t.sha256}`),
  });
  const rawHash = createHash('sha256').update(manifest).digest('hex');
  const truncated = result.alerts.length > MAX_FULL_ALERTS;

  return {
    id: `deforestation:${result.version}:z${result.zoom}:${rawHash.slice(0, 12)}`,
    kind: 'deforestation',
    sourceUrl: `${GFW_TILE_BASE}/${result.version}/default/{z}/{x}/{y}.png`,
    fetchedAt: result.fetchedAt,
    rawHash,
    // Daftar penuh hanya bila muat; ringkasan di bawah selalu dihitung dari
    // seluruh alert, jadi angka agregatnya tetap benar walau daftarnya dipangkas.
    alerts: truncated ? result.alerts.slice(-MAX_FULL_ALERTS) : result.alerts,
    summary: summarizeAlerts(result.alerts),
    alertsAfterCutoff: countAfterCutoff(result.alerts),
    tilesScanned: result.tilesScanned,
    zoom: result.zoom,
    tileVersion: result.version,
    areaHa: result.areaHa,
  };
}
