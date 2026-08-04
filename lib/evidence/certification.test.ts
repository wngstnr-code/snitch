/**
 * Test bukti sertifikasi — panggilan nyata ke kedua FeatureServer (§0).
 *
 * Pabrik yang dipakai bukan diambil sembarangan: WA HA (PO1000000234) adalah
 * salah satu dari 22 pabrik Malaysia yang kedua datasetnya benar-benar tidak
 * sepakat, terhitung saat seed. RIMMER (PO1000000262) bertentangan ke arah
 * sebaliknya. SEDENAK (PO1000000019) disepakati keduanya.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCertificationEvidence, UML_DATASET_NAME, UNILEVER_DATASET_NAME } from './certification';
import { lookupUmlById, lookupUnileverNear, MAX_MATCH_DISTANCE_KM } from './mills';

const WA_HA = 'PO1000000234'; // UML: certified · Unilever: tidak
const RIMMER = 'PO1000000262'; // UML: tidak · Unilever: certified
const SEDENAK = 'PO1000000019'; // keduanya certified

test('lookupUmlById mengembalikan satu pabrik dengan UML_ID persis', async () => {
  const r = await lookupUmlById(WA_HA);
  assert.ok(r.mill, 'pabrik harus ditemukan');
  assert.equal(r.mill.umlId, WA_HA);
  assert.equal(r.mill.name, 'WA HA');
  assert.ok(r.raw.length > 0, 'respons mentah harus disimpan untuk rawHash');
  assert.ok(r.url.includes(WA_HA));
});

test('UML_ID yang tidak ada -> mill null, BUKAN melempar', async () => {
  const r = await lookupUmlById('PO0000000000');
  assert.equal(r.mill, null);
});

test('UML_ID berformat aneh ditolak sebelum menyentuh jaringan', async () => {
  await assert.rejects(() => lookupUmlById("PO1' OR '1'='1"), /tidak wajar/);
});

test('lookupUnileverNear mencocokkan WA HA POM ke WA HA dalam ambang', async () => {
  const uml = await lookupUmlById(WA_HA);
  assert.ok(uml.mill);
  const r = await lookupUnileverNear(uml.mill.lat, uml.mill.lon, uml.mill.name);
  assert.ok(r.mill, 'padanan Unilever harus ketemu');
  assert.ok(
    r.distanceKm !== null && r.distanceKm <= MAX_MATCH_DISTANCE_KM,
    `jarak ${r.distanceKm} km melewati ambang`,
  );
  assert.ok(r.nameSimilarity !== null && r.nameSimilarity >= 0.8);
});

test('lokasi tanpa pabrik apa pun -> mill null, bukan padanan paksaan', async () => {
  // Tengah Samudra Hindia.
  const r = await lookupUnileverNear(-10, 80, 'WA HA');
  assert.equal(r.mill, null);
  assert.equal(r.distanceKm, null);
  assert.equal(r.candidates, 0);
});

test('WA HA: ketidaksepakatan nyata terdeteksi dan bisa disitir', async () => {
  const e = await buildCertificationEvidence({ umlId: WA_HA });

  assert.equal(e.kind, 'certification');
  assert.equal(e.scheme, 'RSPO');
  assert.equal(e.millUmlId, WA_HA);
  assert.equal(e.disagreement, true, 'WA HA harus terdeteksi bertentangan');

  const uml = e.claims.find((c) => c.dataset === UML_DATASET_NAME);
  const uni = e.claims.find((c) => c.dataset === UNILEVER_DATASET_NAME);
  assert.equal(uml?.certified, true);
  assert.equal(uni?.certified, false);

  // Syarat agar bisa disitir agen dan dilacak pembaca.
  assert.ok(e.id.startsWith(`certification:RSPO:${WA_HA}:`));
  assert.equal(e.rawHash.length, 64);
  assert.ok(e.sourceUrl.startsWith('https://'));
  assert.ok(!Number.isNaN(Date.parse(e.fetchedAt)));
  for (const c of e.claims) assert.ok(c.sourceUrl.startsWith('https://'));
});

test('RIMMER: bertentangan ke arah sebaliknya', async () => {
  const e = await buildCertificationEvidence({ umlId: RIMMER });
  assert.equal(e.disagreement, true);
  const uml = e.claims.find((c) => c.dataset === UML_DATASET_NAME);
  const uni = e.claims.find((c) => c.dataset === UNILEVER_DATASET_NAME);
  assert.equal(uml?.certified, false);
  assert.equal(uni?.certified, true);
});

test('SEDENAK: dua dataset sepakat -> disagreement false', async () => {
  const e = await buildCertificationEvidence({ umlId: SEDENAK });
  assert.equal(e.disagreement, false);
});

test('rawHash berbeda antar pabrik — hash dataset penuh tidak akan begitu', async () => {
  const a = await buildCertificationEvidence({ umlId: WA_HA });
  const b = await buildCertificationEvidence({ umlId: SEDENAK });
  assert.notEqual(a.rawHash, b.rawHash);
});

test('pabrik tanpa padanan Unilever: certified null, dan itu BUKAN ketidaksepakatan', async () => {
  // Cari satu pabrik MY yang tidak ter-join (296 dari 500 saat seed).
  const { fetchUniversalMillList } = await import('./mills');
  const { mills } = await fetchUniversalMillList();
  const my = mills.filter((m) => m.country === 'Malaysia');

  let checked = 0;
  for (const m of my) {
    const near = await lookupUnileverNear(m.lat, m.lon, m.name);
    if (near.mill !== null) continue;

    const e = await buildCertificationEvidence({ umlId: m.umlId });
    const uni = e.claims.find((c) => c.dataset === UNILEVER_DATASET_NAME);
    assert.equal(uni?.certified, null, `${m.name}: tanpa padanan harus null`);
    assert.equal(uni?.raw, null);
    assert.equal(
      e.disagreement,
      false,
      'satu sisi tidak diketahui tidak boleh dihitung sebagai pertentangan',
    );
    checked = 1;
    break;
  }
  assert.equal(checked, 1, 'tidak menemukan satu pun pabrik tanpa padanan untuk diuji');
});
