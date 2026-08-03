/**
 * Test regresi B2. Menyentuh GLEIF sungguhan.
 *
 * Test terpenting di berkas ini adalah dua yang menolak false positive lintas
 * yurisdiksi (R17) — itulah kegagalan yang paling mahal pada produk verifikasi:
 * jawaban salah yang terlihat meyakinkan.
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupLegalEntity, nameSimilarity, normalizeName } from './gleif';

test('normalizeName membuang bentuk hukum, bukan identitas nama', () => {
  assert.equal(normalizeName('Unilever N.V.'), 'UNILEVER');
  assert.equal(normalizeName('UNILEVER PLC'), 'UNILEVER');
  assert.equal(normalizeName('Sime Darby Plantation Berhad'), 'SIME DARBY PLANTATION');
  // "HOLDINGS" bukan bentuk hukum — membuangnya akan menyamakan dua entitas berbeda
  assert.equal(normalizeName('Unilever International Holdings N.V.'), 'UNILEVER INTERNATIONAL HOLDINGS');
});

test('nameSimilarity: identik = 1, berbeda entitas < ambang', () => {
  assert.equal(nameSimilarity('Unilever N.V.', 'UNILEVER PLC'), 1);
  const s = nameSimilarity('Unilever', 'UNILEVER INSURANCES N.V.');
  assert.ok(s > 0 && s < 0.75, `skor ${s} seharusnya di bawah ambang fuzzy`);
  assert.equal(nameSimilarity('Felda', 'Metso Minerals'), 0);
});

test('jurisdiction wajib dan harus ISO alpha-2', async () => {
  await assert.rejects(
    () => lookupLegalEntity({ legalName: 'Unilever', jurisdiction: '' }),
    /ISO 3166-1 alpha-2/,
  );
  await assert.rejects(
    () => lookupLegalEntity({ legalName: 'Unilever', jurisdiction: 'Netherlands' }),
    /ISO 3166-1 alpha-2/,
  );
});

test('operator EU nyata: Unilever N.V. di NL', async () => {
  const ev = await lookupLegalEntity({ legalName: 'Unilever N.V.', jurisdiction: 'NL' });

  assert.equal(ev.kind, 'legal_entity');
  assert.equal(ev.matchQuality, 'exact');
  assert.equal(ev.lei, '549300TK7G7NZTVM1Z30');
  assert.equal(ev.jurisdiction, 'NL');
  assert.match(ev.rawHash, /^[0-9a-f]{64}$/);
  assert.ok(ev.sourceUrl.includes('filter%5Bentity.jurisdiction%5D=NL'));

  // Dua status yang berbeda dan tidak boleh disatukan: entitas masih ACTIVE,
  // tapi registrasi LEI-nya LAPSED. Justru inilah yang harus ditemukan agen.
  assert.equal(ev.entityStatus, 'ACTIVE');
  assert.equal(ev.registrationStatus, 'LAPSED');
});

test('R17: "Sime Darby" dibatasi ke MY → tidak ada, bukan entitas HK/AU/NZ', async () => {
  const ev = await lookupLegalEntity({ legalName: 'Sime Darby', jurisdiction: 'MY' });
  assert.equal(ev.matchQuality, 'none');
  assert.equal(ev.lei, null);
  assert.equal(ev.legalName, null);
  // Tetap bukti sah: "sudah dicek, tidak ada" berbeda dari "belum dicek".
  assert.match(ev.rawHash, /^[0-9a-f]{64}$/);
  assert.ok(ev.fetchedAt.length > 0);
});

test('R17: "FELDA" tidak boleh cocok ke Felda AG (Swiss) saat mencari di MY', async () => {
  const ev = await lookupLegalEntity({ legalName: 'FELDA', jurisdiction: 'MY' });
  assert.equal(ev.matchQuality, 'none');
  assert.equal(ev.lei, null);
  assert.notEqual(ev.jurisdiction, 'CH');
});

test('cakupan GLEIF untuk perkebunan MY memang nihil (dasar keputusan R17)', async () => {
  for (const name of ['Sime Darby Plantation', 'IOI Corporation', 'IJM Plantations']) {
    const ev = await lookupLegalEntity({ legalName: name, jurisdiction: 'MY' });
    assert.equal(ev.matchQuality, 'none', `${name} tak seharusnya ketemu di GLEIF MY`);
  }
});
