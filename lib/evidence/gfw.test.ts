/**
 * Test regresi B1. Menyentuh jaringan dengan sengaja: yang diuji adalah
 * kemampuan membaca data GFW yang sungguhan, bukan tiruannya.
 *
 * Fixture di bawah adalah nilai TERUKUR dari tile nyata (CLAUDE.md §3.1),
 * dan versi tile-nya DIPIN ke `v20260803`. Versi bertanggal bersifat permanen,
 * jadi angka-angka ini tetap valid walau GFW menerbitkan versi baru tiap hari —
 * itulah gunanya R14.
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areaHa,
  buildDeforestationEvidence,
  collectAlerts,
  countAfterCutoff,
  decodeTileAlerts,
  fetchTile,
  pickZoom,
  pointInPolygon,
  resolveVersion,
  summarizeAlerts,
  tilesFor,
  type Geometry,
} from './gfw';

/** Versi dipin supaya fixture reproducible (R14). */
const PINNED_VERSION = 'v20260803';

const donut: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
      [0, 0],
    ],
    [
      [3, 3],
      [3, 7],
      [7, 7],
      [7, 3],
      [3, 3],
    ],
  ],
};

test('pointInPolygon menghormati lubang', () => {
  assert.equal(pointInPolygon(1, 1, donut), true, 'di dalam ring luar');
  assert.equal(pointInPolygon(5, 5, donut), false, 'di dalam lubang = di luar');
  assert.equal(pointInPolygon(20, 20, donut), false, 'jauh di luar');
});

test('areaHa: 1°x1° di ekuator ≈ 1.230.900 ha', () => {
  const square: Geometry = {
    type: 'Polygon',
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  };
  const ha = areaHa(square);
  // Toleransi 1,5%: bola vs elipsoid.
  assert.ok(
    Math.abs(ha - 1_230_900) / 1_230_900 < 0.015,
    `luas ${Math.round(ha)} ha di luar toleransi`,
  );
});

test('areaHa mengurangkan lubang', () => {
  const outerOnly: Geometry = {
    type: 'Polygon',
    coordinates: [donut.coordinates[0]],
  };
  assert.ok(areaHa(donut) < areaHa(outerOnly));
});

test('pickZoom adaptif menurut luas AOI (R11)', () => {
  assert.equal(pickZoom(500), 14, 'petak kecil');
  assert.equal(pickZoom(5_000), 14, 'batas atas petak');
  assert.equal(pickZoom(50_000), 13);
  assert.equal(pickZoom(785_000), 12, 'radius sourcing pabrik 50 km');
});

test('tilesFor menutupi bbox', () => {
  const plot: Geometry = {
    type: 'Polygon',
    coordinates: [[[113.0, 2.5], [113.05, 2.5], [113.05, 2.55], [113.0, 2.55], [113.0, 2.5]]],
  };
  const tiles = tilesFor(plot, 14);
  assert.equal(tiles.length, 16, '3.095 ha @ z14 = 16 tile');
  assert.ok(tiles.every((t) => t.z === 14));
});

test('summarizeAlerts menandai truncated dan menghitung per bulan', () => {
  const s = summarizeAlerts([
    { date: '2021-03-04', lat: 0, lon: 0, confidence: 'high', tile: { z: 12, x: 1, y: 1 } },
    { date: '2021-03-20', lat: 0, lon: 0, confidence: 'low', tile: { z: 12, x: 1, y: 1 } },
    { date: '2022-01-01', lat: 0, lon: 0, confidence: null, tile: { z: 12, x: 1, y: 1 } },
  ]);
  assert.deepEqual(s.byMonth, { '2021-03': 2, '2022-01': 1 });
  assert.deepEqual(s.byConfidence, { low: 1, high: 1, highest: 0 });
  assert.equal(s.truncated, false);
  // confidence null tidak boleh diam-diam dihitung sebagai salah satu kelas (R3)
  assert.equal(s.byConfidence.low + s.byConfidence.high + s.byConfidence.highest, 2);
});

test('countAfterCutoff memakai cutoff EUDR 2020-12-31', () => {
  const at = (date: string) => ({
    date,
    lat: 0,
    lon: 0,
    confidence: null,
    tile: { z: 12, x: 1, y: 1 },
  });
  assert.equal(countAfterCutoff([at('2020-12-30'), at('2020-12-31'), at('2021-01-01')]), 1);
});

test('resolveVersion mengembalikan versi bertanggal, bukan "latest" (R14)', async () => {
  const v = await resolveVersion();
  assert.match(v, /^v\d{8}$/);
});

// ---------- fixture tile nyata (CLAUDE.md §3.1) ----------

const TILE_FIXTURES = [
  { name: 'Riau', tile: { z: 12, x: 3202, y: 2042 }, pixels: 293, first: '2021-02-15', last: '2026-07-15' },
  { name: 'Sarawak', tile: { z: 12, x: 3333, y: 2019 }, pixels: 4889, first: '2020-01-12', last: '2026-07-23' },
  { name: 'Kalimantan', tile: { z: 12, x: 3333, y: 2065 }, pixels: 2956, first: '2020-01-31', last: '2026-07-23' },
] as const;

for (const f of TILE_FIXTURES) {
  test(`dekode tile ${f.name} ${f.tile.z}/${f.tile.x}/${f.tile.y} → ${f.pixels} piksel`, async () => {
    const buf = await fetchTile(PINNED_VERSION, f.tile);
    const alerts = decodeTileAlerts(buf, f.tile);
    const dates = alerts.map((a) => a.date).sort();

    assert.equal(alerts.length, f.pixels);
    assert.equal(dates[0], f.first);
    assert.equal(dates[dates.length - 1], f.last);

    // Confidence hanya boleh salah satu dari tiga nilai alpha, atau null (R3).
    for (const a of alerts) {
      assert.ok(
        a.confidence === null || ['low', 'high', 'highest'].includes(a.confidence),
        `confidence tak terduga: ${String(a.confidence)}`,
      );
    }
  });
}

test('tile di luar cakupan tropis GFW MELEMPAR, bukan mengembalikan kosong (R10)', async () => {
  // 12/2000/1000 ≈ 66°N di Atlantik Utara — GFW menjawab HTTP 500 secara konsisten.
  // "Gagal memeriksa" tidak boleh terbaca sebagai "bersih".
  await assert.rejects(
    () => fetchTile(PINNED_VERSION, { z: 12, x: 2000, y: 1000 }),
    /gagal diambil/i,
  );
});

// ---------- integrasi ujung-ke-ujung ----------

test('collectAlerts pada petak Sarawak nyata', async (t) => {
  const plot: Geometry = {
    type: 'Polygon',
    coordinates: [[[113.0, 2.5], [113.05, 2.5], [113.05, 2.55], [113.0, 2.55], [113.0, 2.5]]],
  };

  const result = await collectAlerts(plot, { version: PINNED_VERSION });

  assert.equal(result.zoom, 14);
  assert.equal(result.tilesScanned, 16);
  assert.equal(result.version, PINNED_VERSION);
  assert.ok(Math.abs(result.areaHa - 3_095) < 20, `luas ${result.areaHa}`);
  assert.ok(result.alerts.length > 3_000, `hanya ${result.alerts.length} alert`);

  // Klaim yang paling penting: tidak ada alert di luar polygon (R2).
  assert.ok(result.alerts.every((a) => pointInPolygon(a.lon, a.lat, plot)));

  // Terurut menaik menurut tanggal.
  const dates = result.alerts.map((a) => a.date);
  assert.deepEqual(dates, [...dates].sort());

  const evidence = buildDeforestationEvidence(plot, result);
  assert.equal(evidence.kind, 'deforestation');
  assert.equal(evidence.tileVersion, PINNED_VERSION);
  assert.match(evidence.rawHash, /^[0-9a-f]{64}$/);
  assert.equal(evidence.alertsAfterCutoff, countAfterCutoff(result.alerts));
  assert.ok(evidence.alertsAfterCutoff > 3_000);
  // sourceUrl wajib menyimpan versi bertanggal, bukan 'latest'
  assert.ok(evidence.sourceUrl.includes(PINNED_VERSION));
  assert.ok(!evidence.sourceUrl.includes('latest'));

  // rawHash deterministik untuk input yang sama.
  assert.equal(buildDeforestationEvidence(plot, result).rawHash, evidence.rawHash);
  // ...dan berubah bila parameter query berubah (zoom), walau tile-nya sama.
  assert.notEqual(
    buildDeforestationEvidence(plot, { ...result, zoom: 12 }).rawHash,
    evidence.rawHash,
  );

  t.diagnostic(
    `${result.alerts.length} alert · ${evidence.alertsAfterCutoff} setelah cutoff · ` +
      `${Object.keys(evidence.summary.byMonth).length} bulan berbeda`,
  );
});
