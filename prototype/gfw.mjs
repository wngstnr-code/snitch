// JEJAK — dekode alert deforestasi GFW dari tile publik (tanpa API key)
// Calon isi lib/evidence/gfw.ts
import zlib from 'node:zlib';

export const EUDR_CUTOFF = Date.UTC(2020, 11, 31); // 2020-12-31
const EPOCH = Date.UTC(2014, 11, 31);              // basis encoding GFW
const TILE_BASE = 'https://tiles.globalforestwatch.org/gfw_integrated_alerts';

// alpha → confidence (diverifikasi empiris 2026-08-03: hanya {4,8,24} yang muncul)
const CONFIDENCE = { 4: 'low', 8: 'high', 24: 'highest' };

// ---------- geo helpers ----------
export const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export const lat2y = (lat, z) =>
  ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
export const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
export const y2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

function ringsOf(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  throw new Error(`geometri tidak didukung: ${geom.type}`);
}

export function bbox(geom) {
  let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
  for (const poly of ringsOf(geom))
    for (const ring of poly)
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
  return { minLon, minLat, maxLon, maxLat };
}

// Luas geodesik (m²) — formula spherical excess
export function areaHa(geom) {
  const R = 6378137;
  let total = 0;
  for (const poly of ringsOf(geom)) {
    poly.forEach((ring, idx) => {
      let s = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[i + 1];
        s += ((lon2 - lon1) * Math.PI) / 180 *
             (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
      }
      const a = Math.abs((s * R * R) / 2);
      total += idx === 0 ? a : -a; // ring dalam = lubang
    });
  }
  return total / 10000;
}

// Ray casting; menangani MultiPolygon + lubang
export function pointInPolygon(lon, lat, geom) {
  let inside = false;
  for (const poly of ringsOf(geom)) {
    let inThis = false;
    for (const ring of poly) {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
      }
      if (c) inThis = !inThis; // ring luar masuk, lubang membatalkan
    }
    if (inThis) inside = true;
  }
  return inside;
}

// ---------- pemilihan zoom adaptif (terukur 2026-08-03) ----------
export function pickZoom(ha) {
  if (ha <= 5000) return 14;  // petak: 4–9 tile, <1 s
  if (ha <= 100000) return 13;
  return 12;                  // AOI luas (radius pabrik 50 km): 121 tile, ~4 s
}

export function tilesFor(geom, zoom) {
  const b = bbox(geom);
  const x0 = Math.floor(lon2x(b.minLon, zoom));
  const x1 = Math.floor(lon2x(b.maxLon, zoom));
  const y0 = Math.floor(lat2y(b.maxLat, zoom));
  const y1 = Math.floor(lat2y(b.minLat, zoom));
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z: zoom, x, y });
  return out;
}

// ---------- dekode PNG (stdlib zlib, tanpa dependensi) ----------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('bukan PNG');
  let pos = 8, idat = [], w = 0, h = 0, ct = 6, bd = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bd = data[8]; ct = data[9];
      if (bd !== 8 || data[12] !== 0) throw new Error(`PNG tak didukung bd=${bd} interlace=${data[12]}`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let prev = Buffer.alloc(stride), p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      if (f === 1) line[i] = (line[i] + a) & 255;
      else if (f === 2) line[i] = (line[i] + b) & 255;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(out, y * stride); prev = line;
  }
  return { w, h, ch, px: out };
}

// ---------- pengambilan + dekode ----------
async function fetchTile(t, version) {
  const url = `${TILE_BASE}/${version}/default/${t.z}/${t.x}/${t.y}.png`;
  const res = await fetch(url, { headers: { 'User-Agent': 'jejak/1.0' } });
  if (!res.ok) throw new Error(`tile ${t.z}/${t.x}/${t.y} → HTTP ${res.status}`);
  return { buf: Buffer.from(await res.arrayBuffer()), url };
}

// Sematkan versi bertanggal agar bukti reproducible (R14)
export async function resolveVersion() {
  const res = await fetch(`${TILE_BASE}/latest/default/0/0/0.png`, { redirect: 'follow' });
  const m = res.url.match(/gfw_integrated_alerts\/(v\d{8})\//);
  if (!m) throw new Error(`gagal me-resolve versi dari ${res.url}`);
  return m[1];
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

/**
 * Kumpulkan alert deforestasi di dalam polygon.
 * Melempar bila tile gagal — "gagal memeriksa" TIDAK BOLEH terbaca "bersih" (R10).
 */
export async function collectAlerts(geom, opts = {}) {
  const ha = areaHa(geom);
  const zoom = opts.zoom ?? pickZoom(ha);
  const version = opts.version ?? (await resolveVersion());
  const tiles = tilesFor(geom, zoom);
  const concurrency = opts.concurrency ?? 40;

  const results = await mapLimit(tiles, concurrency, async (t) => {
    const { buf, url } = await fetchTile(t, version);
    const { w, h, ch, px } = decodePng(buf);
    const alerts = [];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const o = (j * w + i) * ch;
        const r = px[o], g = px[o + 1], a = ch === 4 ? px[o + 3] : 255;
        if (a === 0 || (r === 0 && g === 0)) continue;
        const lon = x2lon(t.x + (i + 0.5) / w, t.z);
        const lat = y2lat(t.y + (j + 0.5) / h, t.z);
        if (!pointInPolygon(lon, lat, geom)) continue;
        alerts.push({
          date: new Date(EPOCH + (r * 255 + g) * 86400000).toISOString().slice(0, 10),
          lat, lon,
          confidence: CONFIDENCE[a] ?? null, // null bila nilai tak dikenal — jangan dikarang
          tile: t,
        });
      }
    }
    return { alerts, url };
  });

  const alerts = results.flatMap((r) => r.alerts).sort((a, b) => a.date.localeCompare(b.date));
  return {
    alerts,
    alertsAfterCutoff: alerts.filter((a) => Date.parse(a.date) > EUDR_CUTOFF).length,
    tilesScanned: tiles.length,
    zoom,
    version,
    areaHa: ha,
    sourceUrls: results.map((r) => r.url),
    fetchedAt: new Date().toISOString(),
  };
}
