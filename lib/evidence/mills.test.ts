/**
 * Test regresi B10. Panggilan jaringan sungguhan terhadap kedua layer ArcGIS
 * (CLAUDE.md §0 — dilarang mock). `sourcingCircle` diuji murni lewat `areaHa()`
 * dari lib/evidence/gfw.ts.
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { areaHa } from './gfw';
import {
  MAX_MATCH_DISTANCE_KM,
  SOURCING_RADIUS_M,
  fetchUniversalMillList,
  fetchUnileverMills,
  joinMills,
  sourcingCircle,
} from './mills';

test('fetchUniversalMillList: > 1.900 pabrik, ada umlId berformat PO...', async () => {
  const { mills } = await fetchUniversalMillList();
  assert.ok(mills.length > 1_900, `dapat ${mills.length}`);
  assert.ok(mills.some((m) => /^PO\d+$/.test(m.umlId)));
});

test('fetchUnileverMills: > 1.400 pabrik', async () => {
  const { mills } = await fetchUnileverMills();
  assert.ok(mills.length > 1_400, `dapat ${mills.length}`);
});

test('sourcingCircle: luas radius 50 km dalam 1% dari 785.398 ha, ring tertutup', () => {
  const circle = sourcingCircle(3.139, 101.6869, SOURCING_RADIUS_M);
  const ring = circle.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1], 'ring harus tertutup');

  const ha = areaHa(circle);
  const expected = Math.PI * 50 ** 2 * 100; // πr² km² -> ha
  const diffPct = Math.abs(ha - expected) / expected;
  assert.ok(diffPct < 0.01, `luas ${ha} ha menyimpang ${(diffPct * 100).toFixed(2)}% dari ${expected}`);
});

test('sourcingCircle: luas tetap dalam toleransi di lintang tinggi (koreksi cos(lat))', () => {
  const circle = sourcingCircle(45, 10, SOURCING_RADIUS_M);
  const ha = areaHa(circle);
  const expected = Math.PI * 50 ** 2 * 100;
  const diffPct = Math.abs(ha - expected) / expected;
  assert.ok(diffPct < 0.01, `luas ${ha} ha menyimpang ${(diffPct * 100).toFixed(2)}% dari ${expected}`);
});

test('joinMills pada data nyata: ada yang ter-join, tidak ada yang melebihi ambang jarak', async () => {
  const [uml, unilever] = await Promise.all([fetchUniversalMillList(), fetchUnileverMills()]);
  const joins = joinMills(uml.mills, unilever.mills);

  const matched = joins.filter((j) => j.matchedBy === 'name+proximity');
  assert.ok(matched.length > 0, 'harus ada setidaknya satu join berhasil');

  for (const j of matched) {
    assert.ok(j.distanceKm !== null && j.distanceKm <= MAX_MATCH_DISTANCE_KM);
    assert.ok(j.nameSimilarity !== null && j.nameSimilarity >= 0.8);
  }
});

test('rspoDisagreement tidak pernah true bila salah satu sisi null', async () => {
  const [uml, unilever] = await Promise.all([fetchUniversalMillList(), fetchUnileverMills()]);
  const joins = joinMills(uml.mills, unilever.mills);

  for (const j of joins) {
    if (j.unilever === null) {
      assert.equal(j.rspoDisagreement, false);
      continue;
    }
    if (j.uml.rspoCertified === null || j.unilever.rspoCertified === null) {
      assert.equal(j.rspoDisagreement, false);
    }
  }
});

test('pabrik Malaysia di UML berjumlah masuk akal (ratusan)', async () => {
  const { mills } = await fetchUniversalMillList();
  const my = mills.filter((m) => m.country === 'Malaysia');
  assert.ok(my.length > 200 && my.length < 900, `dapat ${my.length}`);
});
