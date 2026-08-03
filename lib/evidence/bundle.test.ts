/**
 * Test regresi B4. Merakit bundle dari bukti sungguhan (GFW + GLEIF + kedua
 * daftar sanksi), mengunggahnya ke Vercel Blob, lalu MENGUNDUHNYA LAGI dan
 * menghitung ulang hash-nya — persis seperti yang akan dilakukan verifikator
 * pihak ketiga terhadap hash yang di-anchor onchain.
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipAlertsTo,
  collectEvidence,
  prepareBundle,
  publishBundle,
  verifyPublishedBundle,
} from './bundle';
import { areaHa, type Geometry } from './gfw';
import type { DeforestationEvidence, Evidence, Plot } from '../types';

const sarawakPlot: Plot = {
  id: 'test-sarawak',
  name: 'Petak uji Sarawak',
  geojson: {
    type: 'Polygon',
    coordinates: [[[113.0, 2.5], [113.05, 2.5], [113.05, 2.55], [113.0, 2.55], [113.0, 2.5]]],
  },
  geohash: 'w0m',
  areaHa: areaHa({
    type: 'Polygon',
    coordinates: [[[113.0, 2.5], [113.05, 2.5], [113.05, 2.55], [113.0, 2.55], [113.0, 2.5]]],
  } as Geometry),
  operatorName: 'Sime Darby Plantation',
  source: 'upload',
};

const alert = (date: string) => ({
  date,
  lat: 2.5,
  lon: 113.0,
  confidence: null,
  tile: { z: 14, x: 1, y: 1 },
});

test('clipAlertsTo memotong tepat pada batas bukti (R4)', () => {
  const alerts = [alert('2026-05-31'), alert('2026-06-01'), alert('2026-06-02')];
  const clipped = clipAlertsTo(alerts, '2026-06-01');
  assert.deepEqual(clipped.map((a) => a.date), ['2026-05-31', '2026-06-01']);
});

test('prepareBundle menolak evidenceAsOf yang bukan tanggal', () => {
  assert.throws(() => prepareBundle([], 'kemarin'), /bukan tanggal ISO/);
});

test('prepareBundle menolak bundle kosong dan evidenceId ganda', () => {
  assert.throws(() => prepareBundle([], '2026-06-01'), /tanpa bukti/);

  const dupe = {
    id: 'sanctions:OFAC_SDN:2026-07-29:X',
    kind: 'sanctions',
    sourceUrl: 'https://example.org',
    fetchedAt: '2026-08-03T00:00:00.000Z',
    rawHash: 'a'.repeat(64),
    lists: [{ list: 'OFAC_SDN' as const, listDate: '2026-07-29' }],
    matches: [],
  } satisfies Evidence;
  assert.throws(() => prepareBundle([dupe, dupe], '2026-06-01'), /ganda/);
});

test('bundleHash tidak bergantung pada urutan item, tapi bergantung pada evidenceAsOf', () => {
  const mk = (id: string): Evidence => ({
    id,
    kind: 'sanctions',
    sourceUrl: 'https://example.org',
    fetchedAt: '2026-08-03T00:00:00.000Z',
    rawHash: 'b'.repeat(64),
    lists: [{ list: 'OFAC_SDN', listDate: '2026-07-29' }],
    matches: [],
  });
  const a = mk('sanctions:A');
  const b = mk('sanctions:B');

  assert.equal(
    prepareBundle([a, b], '2026-06-01').bundleHash,
    prepareBundle([b, a], '2026-06-01').bundleHash,
    'urutan tidak boleh mengubah hash',
  );
  assert.notEqual(
    prepareBundle([a, b], '2026-06-01').bundleHash,
    prepareBundle([a, b], '2026-06-02').bundleHash,
    'batas bukti berbeda = bukti berbeda',
  );
});

test('ujung-ke-ujung: kumpulkan bukti nyata, rakit, unggah, unduh, hitung ulang hash', async (t) => {
  const evidenceAsOf = '2026-06-01T00:00:00.000Z';

  const items = await collectEvidence({
    plot: sarawakPlot,
    euOperator: { legalName: 'Unilever N.V.', jurisdiction: 'NL' },
    screenNames: ['Sime Darby Plantation'],
    evidenceAsOf,
  });

  // Satu deforestasi + satu badan hukum + dua daftar sanksi.
  const kinds = items.map((i) => i.kind).sort();
  assert.deepEqual(kinds, ['deforestation', 'legal_entity', 'sanctions', 'sanctions']);

  const defo = items.find((i): i is DeforestationEvidence => i.kind === 'deforestation');
  assert.ok(defo);
  // Batas bukti benar-benar dihormati: tidak ada alert setelah evidenceAsOf.
  assert.ok(
    defo.alerts.every((a) => Date.parse(a.date) <= Date.parse(evidenceAsOf)),
    'ada alert yang lolos melewati batas bukti',
  );
  assert.ok(defo.alertsAfterCutoff > 0, 'petak ini memang punya alert setelah cutoff EUDR');

  // Setiap bukti wajib membawa jejak sumbernya (CLAUDE.md §9).
  for (const it of items) {
    assert.ok(it.sourceUrl.startsWith('https://'), `sourceUrl buruk: ${it.id}`);
    assert.match(it.rawHash, /^[0-9a-f]{64}$/);
    assert.ok(!Number.isNaN(Date.parse(it.fetchedAt)));
  }

  const prepared = prepareBundle(items, evidenceAsOf);
  assert.match(prepared.bundleHash, /^[0-9a-f]{64}$/);
  assert.ok(prepared.bundleId.startsWith('bundle_'));

  const bundle = await publishBundle(prepared);
  assert.ok(bundle.blobUrl.startsWith('https://'));
  assert.equal(bundle.evidenceAsOf, evidenceAsOf);

  // Inilah klaim yang sesungguhnya: hash yang akan di-anchor onchain benar-benar
  // cocok dengan berkas yang bisa diunduh siapa pun.
  assert.equal(await verifyPublishedBundle(bundle), true);

  t.diagnostic(
    `${items.length} bukti · ${defo.alerts.length} alert sampai ${evidenceAsOf.slice(0, 10)} · ` +
      `${(Buffer.byteLength(prepared.payload) / 1024).toFixed(0)} KB · ${bundle.blobUrl}`,
  );
});
