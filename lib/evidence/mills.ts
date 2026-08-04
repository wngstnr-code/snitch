/**
 * B10 — Seed data pabrik sawit + cross-check RSPO dua dataset independen.
 *
 * Dua sumber publik, tanpa API key (CLAUDE.md §3.4 / §3.4c):
 *
 *   A. Unilever Palm Oil Mills — 1.431 fitur, geometri POINT.
 *      Field: Mill_Name, Parent_Company, RSPO_Certified ('Yes'/'No'), Country,
 *      Province, District. TIDAK membawa identifier stabil lintas dataset —
 *      diverifikasi lewat curl 2026-08-04, tidak ada kolom UML_ID di sini.
 *
 *   B. Universal Mill List — 1.994 fitur, 500 Malaysia.
 *      Field: UML_ID (join key stabil), RSPO_Statu, RSPO_Type, Mill_Name,
 *      Parent_Com, Group_Name, Country, Confidence, Latitude/Longitude.
 *
 * Karena dataset A tidak membawa UML_ID, join HARUS memakai nama ternormalisasi
 * (lib/evidence/names.ts) + kedekatan koordinat — bukan pilihan, melainkan
 * konsekuensi dari apa yang benar-benar ada di respons ArcGIS (R aturan #3).
 *
 * Nilai produk dari modul ini bukan "seed data" — melainkan menemukan
 * ketidaksepakatan RSPO antara dua sumber independen tanpa mempercayai
 * salah satunya (CLAUDE.md §3.4c).
 */

import { z } from 'zod';
import { nameSimilarity, normalizeName } from './names';

export const UNILEVER_MILLS_URL =
  'https://services1.arcgis.com/RTK5Unh1Z71JKIiR/arcgis/rest/services/Mills/FeatureServer/0/query';
export const UML_URL =
  'https://services1.arcgis.com/Hkc3bAqSR3WGz2YJ/arcgis/rest/services/Universal_Mill_List/FeatureServer/0/query';

/** Metodologi radius sourcing pabrik sawit standar industri (WRI/GFW, CLAUDE.md §3.4). */
export const SOURCING_RADIUS_M = 50_000;

const PAGE_SIZE = 1_000;
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_RETRIES = 3;

// ---------- tipe hasil ----------

export interface UnileverMill {
  name: string;
  parentCompany: string | null;
  /** null bila field-nya tidak terbaca — JANGAN tebak (aturan #2). */
  rspoCertified: boolean | null;
  country: string | null;
  province: string | null;
  district: string | null;
  lat: number;
  lon: number;
}

export interface UmlMill {
  umlId: string;
  name: string;
  parentCompany: string | null;
  groupName: string | null;
  /** teks apa adanya dari dataset */
  rspoStatus: string | null;
  /** turunan: 'RSPO Certified' -> true, 'Not RSPO Certified' -> false, lainnya -> null */
  rspoCertified: boolean | null;
  rspoType: string | null;
  country: string | null;
  locationConfidence: string | null;
  lat: number;
  lon: number;
}

export interface MillJoin {
  uml: UmlMill;
  unilever: UnileverMill | null;
  /** cara join berhasil */
  matchedBy: 'name+proximity' | 'none';
  /** jarak km antara dua titik, null bila tidak ada pasangan */
  distanceKm: number | null;
  nameSimilarity: number | null;
  /**
   * true HANYA bila kedua dataset punya klaim tegas dan klaimnya berbeda.
   * null di salah satu sisi = tidak diketahui, BUKAN ketidaksepakatan.
   */
  rspoDisagreement: boolean;
}

// ---------- ambang join (aturan #3) ----------
//
// Kemiripan nama minimal 0,8 (Dice coefficient atas token, lib/evidence/names.ts):
// nama pabrik sawit sering ditulis nyaris identik di kedua dataset ("SEDENAK" vs
// "SEDENAK PALM OIL MILL") setelah bentuk hukum dibuang, jadi 0,8 cukup ketat
// untuk menolak pabrik berbeda yang kebetulan berbagi satu-dua kata umum
// ("MILL", "ESTATE") tapi cukup longgar untuk menoleransi penulisan yang beda.
//
// Jarak maksimal 3 km: GPS pabrik sawit yang didigitasi dua tim independen
// (titik intake vs titik pabrik fisik di kompleks yang sama) lazim meleset
// ratusan meter sampai sekitar 1-2 km. 3 km masih jauh lebih kecil dari jarak
// antar-pabrik tetangga di perkebunan padat sawit MY/ID (biasanya >5-10 km
// antar pabrik pengolahan karena tiap pabrik melayani radius sourcing besar),
// jadi risiko menjodohkan ke pabrik SALAH di kebun yang sama tetap rendah.
export const NAME_SIMILARITY_THRESHOLD = 0.8;
export const MAX_MATCH_DISTANCE_KM = 3;

// ---------- skema ArcGIS (batas sistem — validasi zod, aturan #10) ----------

const arcgisPointGeom = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]),
});

const unileverProps = z.object({
  Mill_Name: z.string().nullish(),
  Parent_Company: z.string().nullish(),
  RSPO_Certified: z.string().nullish(),
  Country: z.string().nullish(),
  Province: z.string().nullish(),
  District: z.string().nullish(),
});

const unileverFeature = z.object({
  geometry: arcgisPointGeom.nullish(),
  properties: unileverProps,
});

const unileverResponse = z.object({
  type: z.literal('FeatureCollection'),
  properties: z
    .object({ exceededTransferLimit: z.boolean().optional() })
    .optional(),
  features: z.array(unileverFeature),
});

const umlProps = z.object({
  UML_ID: z.string().nullish(),
  Mill_Name: z.string().nullish(),
  Parent_Com: z.string().nullish(),
  Group_Name: z.string().nullish(),
  RSPO_Statu: z.string().nullish(),
  RSPO_Type: z.string().nullish(),
  Country: z.string().nullish(),
  Confidence: z.string().nullish(),
  Latitude: z.number().nullish(),
  Longitude: z.number().nullish(),
});

const umlFeature = z.object({
  geometry: arcgisPointGeom.nullish(),
  properties: umlProps,
});

const umlResponse = z.object({
  type: z.literal('FeatureCollection'),
  properties: z
    .object({ exceededTransferLimit: z.boolean().optional() })
    .optional(),
  features: z.array(umlFeature),
});

// ---------- unduhan berpaginasi, timeout + retry (aturan #9) ----------

async function fetchJsonWithRetry(url: string): Promise<unknown> {
  let lastError = '';
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'snitch/0.1 (+https://github.com/wngstnr-code/snitch)' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) return await res.json();
      lastError = `HTTP ${res.status}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < FETCH_RETRIES) {
      await new Promise((r) => setTimeout(r, attempt * 750));
    }
  }
  throw new Error(`Gagal mengambil ${url} setelah ${FETCH_RETRIES} percobaan (${lastError}).`);
}

/**
 * Paginasi ArcGIS sampai habis (aturan #1). Respons menandai
 * `exceededTransferLimit: true` selama masih ada halaman berikutnya; berhenti
 * saat sebuah halaman kembali kosong ATAU bendera itu hilang.
 */
async function fetchAllPages<F>(
  baseUrl: string,
  parse: (json: unknown) => { features: F[]; exceededTransferLimit: boolean },
): Promise<F[]> {
  const out: F[] = [];
  let offset = 0;
  for (;;) {
    const url = `${baseUrl}?where=1=1&outFields=*&f=geojson&resultOffset=${offset}&resultRecordCount=${PAGE_SIZE}`;
    const json = await fetchJsonWithRetry(url);
    const { features, exceededTransferLimit } = parse(json);
    out.push(...features);
    if (features.length === 0 || !exceededTransferLimit) break;
    offset += features.length;
  }
  return out;
}

function toRspoBoolean(v: string | null | undefined): boolean | null {
  const t = (v ?? '').trim().toLowerCase();
  if (t === 'yes') return true;
  if (t === 'no') return false;
  return null;
}

function umlRspoBoolean(v: string | null | undefined): boolean | null {
  const t = (v ?? '').trim();
  if (t === 'RSPO Certified') return true;
  if (t === 'Not RSPO Certified') return false;
  return null;
}

function nz(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

// ---------- pemetaan fitur -> model (satu sumber kebenaran) ----------
//
// Dipakai baik oleh unduhan penuh (seed) maupun lookup tertarget satu pabrik
// (bukti sertifikasi). Kalau dua jalur itu memetakan field-nya sendiri-sendiri,
// cepat atau lambat keduanya akan menyimpang.

function mapUnilever(f: z.infer<typeof unileverFeature>): UnileverMill | null {
  const geom = f.geometry;
  const name = nz(f.properties.Mill_Name);
  if (!geom || !name) return null;
  const [lon, lat] = geom.coordinates;
  return {
    name,
    parentCompany: nz(f.properties.Parent_Company),
    rspoCertified: toRspoBoolean(f.properties.RSPO_Certified),
    country: nz(f.properties.Country),
    province: nz(f.properties.Province),
    district: nz(f.properties.District),
    lat,
    lon,
  };
}

function mapUml(f: z.infer<typeof umlFeature>): UmlMill | null {
  const geom = f.geometry;
  const umlId = nz(f.properties.UML_ID);
  const name = nz(f.properties.Mill_Name);
  if (!geom || !umlId || !name) return null;
  // Field Latitude/Longitude kadang beda dari geometry pada dataset ArcGIS
  // hasil re-upload; percayai geometry karena itulah yang dipakai peta.
  const [lon, lat] = geom.coordinates;
  return {
    umlId,
    name,
    parentCompany: nz(f.properties.Parent_Com),
    groupName: nz(f.properties.Group_Name),
    rspoStatus: nz(f.properties.RSPO_Statu),
    rspoCertified: umlRspoBoolean(f.properties.RSPO_Statu),
    rspoType: nz(f.properties.RSPO_Type),
    country: nz(f.properties.Country),
    locationConfidence: nz(f.properties.Confidence),
    lat,
    lon,
  };
}

// ---------- konektor A: Unilever ----------

export async function fetchUnileverMills(): Promise<{
  mills: UnileverMill[];
  sourceUrl: string;
  fetchedAt: string;
}> {
  const fetchedAt = new Date().toISOString();
  const rawFeatures = await fetchAllPages(UNILEVER_MILLS_URL, (json) => {
    const parsed = unileverResponse.parse(json);
    return {
      features: parsed.features,
      exceededTransferLimit: parsed.properties?.exceededTransferLimit === true,
    };
  });

  const mills: UnileverMill[] = [];
  for (const f of rawFeatures) {
    const m = mapUnilever(f);
    if (m) mills.push(m);
  }
  if (mills.length === 0) {
    throw new Error('Unilever Palm Oil Mills terunduh tapi nol fitur terparse.');
  }
  return { mills, sourceUrl: UNILEVER_MILLS_URL, fetchedAt };
}

// ---------- konektor B: Universal Mill List ----------

export async function fetchUniversalMillList(): Promise<{
  mills: UmlMill[];
  sourceUrl: string;
  fetchedAt: string;
}> {
  const fetchedAt = new Date().toISOString();
  const rawFeatures = await fetchAllPages(UML_URL, (json) => {
    const parsed = umlResponse.parse(json);
    return {
      features: parsed.features,
      exceededTransferLimit: parsed.properties?.exceededTransferLimit === true,
    };
  });

  const mills: UmlMill[] = [];
  for (const f of rawFeatures) {
    const m = mapUml(f);
    if (m) mills.push(m);
  }
  if (mills.length === 0) {
    throw new Error('Universal Mill List terunduh tapi nol fitur terparse.');
  }
  return { mills, sourceUrl: UML_URL, fetchedAt };
}

// ---------- lookup tertarget satu pabrik (untuk bukti sertifikasi) ----------
//
// Seed mengunduh seluruh dataset; bukti TIDAK boleh. Sebuah butir bukti wajib
// membawa `rawHash` atas respons yang benar-benar dipakai memutuskan, dan
// hash 2 MB dataset penuh tidak membuktikan apa pun tentang satu pabrik.
// Maka: query per pabrik, hash respons per pabrik.

/** Respons mentah dipertahankan — itulah yang di-hash, bukan hasil parse. */
export interface TargetedLookup<T> {
  mill: T | null;
  url: string;
  raw: string;
  fetchedAt: string;
}

async function fetchTextWithRetry(url: string): Promise<string> {
  let lastError = '';
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'snitch/0.1 (+https://github.com/wngstnr-code/snitch)' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) return await res.text();
      lastError = `HTTP ${res.status}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < FETCH_RETRIES) {
      await new Promise((r) => setTimeout(r, attempt * 750));
    }
  }
  throw new Error(`Gagal mengambil ${url} setelah ${FETCH_RETRIES} percobaan (${lastError}).`);
}

/** `mill: null` berarti UML_ID itu memang tidak ada — bukan kegagalan jaringan. */
export async function lookupUmlById(umlId: string): Promise<TargetedLookup<UmlMill>> {
  if (!/^[A-Za-z0-9_-]+$/.test(umlId)) {
    throw new Error(`UML_ID tidak wajar: ${JSON.stringify(umlId)}`);
  }
  const url =
    `${UML_URL}?where=${encodeURIComponent(`UML_ID='${umlId}'`)}` +
    `&outFields=*&f=geojson`;
  const fetchedAt = new Date().toISOString();
  const raw = await fetchTextWithRetry(url);
  const parsed = umlResponse.parse(JSON.parse(raw));
  const first = parsed.features[0];
  return { mill: first ? mapUml(first) : null, url, raw, fetchedAt };
}

/**
 * Kotak pencarian ±0,05° ≈ ±5,5 km — sengaja lebih lebar dari ambang
 * pencocokan 3 km, supaya kandidat yang sah tidak hilang karena kotaknya
 * kesempitan. Penyaringan sesungguhnya tetap dilakukan nama + jarak.
 */
const ENVELOPE_DEG = 0.05;

export interface UnileverNearResult extends TargetedLookup<UnileverMill> {
  distanceKm: number | null;
  nameSimilarity: number | null;
  /** berapa pabrik ada di dalam kotak sebelum disaring nama + jarak */
  candidates: number;
}

/**
 * Cari padanan di dataset Unilever memakai aturan pencocokan yang PERSIS SAMA
 * dengan `joinMills` (nama ternormalisasi ≥ 0,8 dan jarak ≤ 3 km). Kalau bukti
 * dan seed memakai aturan berbeda, keduanya bisa menyimpulkan hal berlawanan
 * tentang pabrik yang sama.
 */
export async function lookupUnileverNear(
  lat: number,
  lon: number,
  name: string,
): Promise<UnileverNearResult> {
  const envelope = [
    lon - ENVELOPE_DEG,
    lat - ENVELOPE_DEG,
    lon + ENVELOPE_DEG,
    lat + ENVELOPE_DEG,
  ].join(',');
  const url =
    `${UNILEVER_MILLS_URL}?where=1%3D1&geometry=${encodeURIComponent(envelope)}` +
    `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=*&f=geojson`;

  const fetchedAt = new Date().toISOString();
  const raw = await fetchTextWithRetry(url);
  const parsed = unileverResponse.parse(JSON.parse(raw));

  const target = normalizeName(name);
  let best: { mill: UnileverMill; sim: number; dist: number } | null = null;
  for (const f of parsed.features) {
    const m = mapUnilever(f);
    if (!m) continue;
    const sim = nameSimilarity(target, normalizeName(m.name));
    if (sim < NAME_SIMILARITY_THRESHOLD) continue;
    const dist = distanceKm(lat, lon, m.lat, m.lon);
    if (dist > MAX_MATCH_DISTANCE_KM) continue;
    if (!best || sim > best.sim || (sim === best.sim && dist < best.dist)) {
      best = { mill: m, sim, dist };
    }
  }

  return {
    mill: best?.mill ?? null,
    url,
    raw,
    fetchedAt,
    distanceKm: best ? Number(best.dist.toFixed(3)) : null,
    nameSimilarity: best ? Number(best.sim.toFixed(3)) : null,
    candidates: parsed.features.length,
  };
}

// ---------- join ----------

/** Haversine, kilometer. */
function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Join UML (sisi utama, karena identifier-nya stabil untuk dipakai sebagai
 * `plots.id`) terhadap Unilever, memakai nama ternormalisasi + kedekatan
 * koordinat (dataset Unilever tidak membawa UML_ID — dikonfirmasi via curl,
 * lihat komentar header modul ini).
 *
 * O(n*m) sederhana: n≈500 (MY) atau ≤1.994 total, m≈1.431 — beberapa juta
 * perbandingan string+jarak, di bawah satu detik di Node. Tidak perlu
 * spatial index untuk ukuran data ini.
 */
export function joinMills(
  uml: readonly UmlMill[],
  unilever: readonly UnileverMill[],
): MillJoin[] {
  return uml.map((u): MillJoin => {
    let best: { mill: UnileverMill; sim: number; dist: number } | null = null;
    const uNorm = normalizeName(u.name);
    for (const m of unilever) {
      const sim = nameSimilarity(uNorm, normalizeName(m.name));
      if (sim < NAME_SIMILARITY_THRESHOLD) continue;
      const dist = distanceKm(u.lat, u.lon, m.lat, m.lon);
      if (dist > MAX_MATCH_DISTANCE_KM) continue;
      // Utamakan kemiripan nama tertinggi; jarak sebagai tie-breaker.
      if (!best || sim > best.sim || (sim === best.sim && dist < best.dist)) {
        best = { mill: m, sim, dist };
      }
    }

    if (!best) {
      return {
        uml: u,
        unilever: null,
        matchedBy: 'none',
        distanceKm: null,
        nameSimilarity: null,
        rspoDisagreement: false,
      };
    }

    const rspoDisagreement =
      u.rspoCertified !== null &&
      best.mill.rspoCertified !== null &&
      u.rspoCertified !== best.mill.rspoCertified;

    return {
      uml: u,
      unilever: best.mill,
      matchedBy: 'name+proximity',
      distanceKm: Number(best.dist.toFixed(3)),
      nameSimilarity: Number(best.sim.toFixed(3)),
      rspoDisagreement,
    };
  });
}

// ---------- radius sourcing (petak pengganti untuk analisis GFW) ----------

/**
 * Lingkaran radius sourcing di sekitar titik pabrik, sebagai Polygon GeoJSON.
 * Koreksi `cos(lat)` untuk konversi jarak-meter -> derajat-longitude, supaya
 * lingkaran benar secara geodesik (bukan elips) pada lintang non-nol.
 * Ring ditutup (titik pertama = titik terakhir) dan berurutan searah jarum
 * jam saat dilihat dari atas dengan sudut naik — memenuhi winding GeoJSON
 * (ring luar counter-clockwise di RFC 7946); kita bangun CCW dengan sudut
 * naik dari timur berlawanan jarum jam secara matematis standar.
 */
export function sourcingCircle(
  lat: number,
  lon: number,
  radiusM: number = SOURCING_RADIUS_M,
  steps: number = 64,
): GeoJSON.Polygon {
  const R = 6_378_137; // jari-jari bumi (m), sama dengan yang dipakai areaHa() di gfw.ts
  const latRad = (lat * Math.PI) / 180;
  const dLat = radiusM / R;
  const dLon = radiusM / (R * Math.cos(latRad));

  const ring: GeoJSON.Position[] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (2 * Math.PI * i) / steps;
    const pointLat = lat + (dLat * Math.sin(theta) * 180) / Math.PI;
    const pointLon = lon + (dLon * Math.cos(theta) * 180) / Math.PI;
    ring.push([pointLon, pointLat]);
  }
  // Titik pertama dan terakhir sudah identik (i=0 dan i=steps punya theta yang
  // sama modulo 2π), tapi dipaksa eksplisit sama supaya tidak bergantung pada
  // presisi floating point.
  ring[ring.length - 1] = ring[0];

  return { type: 'Polygon', coordinates: [ring] };
}
