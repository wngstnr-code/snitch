/**
 * Test intake — murni deterministik, tanpa jaringan.
 *
 * Petak Sarawak di bawah ini adalah geometri yang sama yang dipakai
 * `lib/evidence/gfw.test.ts` untuk mengambil alert GFW sungguhan, jadi angka
 * luasnya bisa diadu langsung dengan hasil di sana.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlotFromUpload,
  IntakeError,
  MAX_PLOT_HA,
  normalizeGeometry,
} from './intake';

const SARAWAK_RING = [
  [113.0, 2.5],
  [113.05, 2.5],
  [113.05, 2.55],
  [113.0, 2.55],
  [113.0, 2.5],
];

const SARAWAK_POLYGON = { type: 'Polygon', coordinates: [SARAWAK_RING] };

test('menerima Polygon telanjang', () => {
  const g = normalizeGeometry(SARAWAK_POLYGON);
  assert.equal(g.type, 'Polygon');
});

test('menerima Feature dan mengambil geometrinya', () => {
  const g = normalizeGeometry({
    type: 'Feature',
    properties: { name: 'apa pun' },
    geometry: SARAWAK_POLYGON,
  });
  assert.equal(g.type, 'Polygon');
});

test('FeatureCollection banyak polygon digabung, BUKAN diambil yang pertama', () => {
  const second = [
    [114.0, 2.5],
    [114.05, 2.5],
    [114.05, 2.55],
    [114.0, 2.55],
    [114.0, 2.5],
  ];
  const g = normalizeGeometry({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: null, geometry: SARAWAK_POLYGON },
      {
        type: 'Feature',
        properties: null,
        geometry: { type: 'Polygon', coordinates: [second] },
      },
    ],
  });
  assert.equal(g.type, 'MultiPolygon');
  assert.equal(g.type === 'MultiPolygon' ? g.coordinates.length : 0, 2);
});

test('FeatureCollection berisi satu polygon tetap jadi Polygon', () => {
  const g = normalizeGeometry({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: null, geometry: SARAWAK_POLYGON }],
  });
  assert.equal(g.type, 'Polygon');
});

test('Point ditolak dengan pesan yang menjelaskan kenapa', () => {
  assert.throws(
    () => normalizeGeometry({ type: 'Point', coordinates: [113, 2.5] }),
    (e: unknown) => e instanceof IntakeError && /Polygon atau MultiPolygon/.test((e as Error).message),
  );
});

test('koordinat berproyeksi lain ditolak, bukan diam-diam dipakai', () => {
  // Nilai khas UTM/Web Mercator dalam meter — jelas bukan derajat.
  const utm = [
    [412_000, 276_000],
    [413_000, 276_000],
    [413_000, 277_000],
    [412_000, 277_000],
    [412_000, 276_000],
  ];
  assert.throws(
    () =>
      buildPlotFromUpload({
        name: 'x',
        operatorName: 'y',
        geojson: { type: 'Polygon', coordinates: [utm] },
      }),
    (e: unknown) => e instanceof IntakeError && /WGS84/.test((e as Error).message),
  );
});

test('cincin yang tidak tertutup ditolak', () => {
  assert.throws(
    () =>
      buildPlotFromUpload({
        name: 'x',
        operatorName: 'y',
        geojson: {
          type: 'Polygon',
          coordinates: [[[113.0, 2.5], [113.05, 2.5], [113.05, 2.55], [113.0, 2.55]]],
        },
      }),
    (e: unknown) => e instanceof IntakeError && /tidak tertutup/.test((e as Error).message),
  );
});

test('nama operator kosong ditolak — tanpa itu tidak ada yang bisa discreening', () => {
  assert.throws(
    () =>
      buildPlotFromUpload({
        name: 'Petak',
        operatorName: '   ',
        geojson: SARAWAK_POLYGON,
      }),
    (e: unknown) => e instanceof IntakeError && /operator/.test((e as Error).message),
  );
});

test('petak Sarawak menghasilkan luas dan geohash yang wajar', () => {
  const { plot, areaHa } = buildPlotFromUpload({
    name: 'Petak Sarawak',
    operatorName: 'Contoh Sdn Bhd',
    geojson: SARAWAK_POLYGON,
  });

  // 0,05° x 0,05° di lintang 2,5° ≈ 3.090 ha (bandingkan gfw.test.ts).
  assert.ok(areaHa > 3_000 && areaHa < 3_200, `luas tak terduga: ${areaHa}`);
  assert.equal(plot.source, 'upload');
  assert.equal(plot.geohash.length, 9);
  // Sarawak ada di sel geohash 'w' — kalau ini berubah, geohash-nya salah.
  assert.ok(plot.geohash.startsWith('w'), plot.geohash);
  assert.equal(plot.id, `plot_${plot.geohash}`);
});

test('petak yang terlalu luas ditolak dengan batas yang disebutkan', () => {
  // ~10° x 10° di ekuator, jauh di atas MAX_PLOT_HA.
  const huge = {
    type: 'Polygon',
    coordinates: [[[100, 0], [110, 0], [110, 10], [100, 10], [100, 0]]],
  };
  assert.throws(
    () => buildPlotFromUpload({ name: 'x', operatorName: 'y', geojson: huge }),
    (e: unknown) =>
      e instanceof IntakeError &&
      (e as Error).message.includes(MAX_PLOT_HA.toLocaleString('id-ID')),
  );
});
