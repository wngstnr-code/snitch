/**
 * Test regresi B3. Parser diuji murni; screening diuji terhadap isi database
 * yang benar-benar berisi kedua daftar resmi (jalankan `npm run sanctions:sync`
 * lebih dulu).
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { MATCH_THRESHOLD, parseDelimited, screenEntity } from './sanctions';

test('parseDelimited: tanda kutip, koma di dalam field, dan CRLF', () => {
  const rows = parseDelimited('36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA"\r\n173,"ANGLO-CARIBBEAN CO., LTD.",-0- ,"CUBA"\r\n', ',');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['36', 'AEROCARIBBEAN AIRLINES', '-0- ', 'CUBA']);
  // Koma di dalam tanda kutip tidak boleh memecah field.
  assert.equal(rows[1][1], 'ANGLO-CARIBBEAN CO., LTD.');
});

test('parseDelimited: kutip ganda sebagai escape', () => {
  const rows = parseDelimited('a,"dia bilang ""halo""",b', ',');
  assert.deepEqual(rows[0], ['a', 'dia bilang "halo"', 'b']);
});

test('parseDelimited: BOM dibuang dan pemisah titik koma', () => {
  const rows = parseDelimited('﻿fileGenerationDate;Entity_LogicalId\n31/07/2026;13\n', ';');
  assert.equal(rows[0][0], 'fileGenerationDate');
  assert.deepEqual(rows[1], ['31/07/2026', '13']);
});

test('screening mengembalikan satu bukti per daftar, masing-masing dengan sumbernya', async () => {
  const evidence = await screenEntity('Sime Darby Plantation');
  assert.equal(evidence.length, 2);

  const lists = evidence.flatMap((e) => e.lists.map((l) => l.list)).sort();
  assert.deepEqual(lists, ['EU_CONSOLIDATED', 'OFAC_SDN']);

  for (const e of evidence) {
    assert.equal(e.kind, 'sanctions');
    assert.match(e.rawHash, /^[0-9a-f]{64}$/, 'hash berkas daftar, bukan hash hasil cari');
    assert.match(e.lists[0].listDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.sourceUrl.startsWith('https://'));
    // Setiap bukti hanya boleh memuat match dari daftarnya sendiri.
    assert.ok(e.matches.every((m) => m.list === e.lists[0].list));
  }
});

test('entitas OFAC nyata ditemukan dengan skor penuh', async () => {
  const evidence = await screenEntity('BANCO NACIONAL DE CUBA');
  const ofac = evidence.find((e) => e.lists[0].list === 'OFAC_SDN');
  assert.ok(ofac, 'bukti OFAC harus ada');

  const hit = ofac.matches.find((m) => m.name.toUpperCase().includes('BANCO NACIONAL DE CUBA'));
  assert.ok(hit, `tidak ketemu; match teratas: ${JSON.stringify(ofac.matches.slice(0, 3))}`);
  assert.equal(hit.score, 1);
  assert.ok(hit.entryId.length > 0);
});

test('entitas daftar EU nyata ditemukan', async () => {
  const evidence = await screenEntity('Abu Nidal Organisation');
  const eu = evidence.find((e) => e.lists[0].list === 'EU_CONSOLIDATED');
  assert.ok(eu);
  assert.ok(
    eu.matches.some((m) => m.name.toUpperCase().includes('ABU NIDAL')),
    `match: ${JSON.stringify(eu.matches.slice(0, 3))}`,
  );
});

test('nama yang tidak tersanksi menghasilkan nol match, bukan error', async () => {
  const evidence = await screenEntity('Qxzv Verifikasi Nusantara');
  assert.equal(evidence.length, 2);
  for (const e of evidence) {
    assert.equal(e.matches.length, 0);
    // Tetap bukti sah: "sudah dicek terhadap daftar tertanggal X, bersih".
    assert.match(e.lists[0].listDate, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('semua match berada di atas ambang dan terurut menurun', async () => {
  const evidence = await screenEntity('Bank Melli Iran');
  for (const e of evidence) {
    for (const m of e.matches) assert.ok(m.score >= MATCH_THRESHOLD, `skor ${m.score}`);
    const scores = e.matches.map((m) => m.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  }
});

test('nama yang tidak bisa dinormalkan MELEMPAR, bukan mengembalikan bersih (R10)', async () => {
  await assert.rejects(() => screenEntity('!!! ,.-'), /tidak bisa dinormalkan/);
});
