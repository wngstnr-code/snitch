/**
 * Test regresi B5 — agen kontradiksi.
 *
 * Memakai bundle bukti NYATA (bukan mock, CLAUDE.md §0): dirakit lewat
 * `collectEvidence` dari B4 (GFW tile nyata + GLEIF nyata + kedua daftar sanksi
 * nyata dari Postgres), lalu benar-benar dipanggilkan ke model lewat AI Gateway
 * (`generateObject`, `anthropic/claude-sonnet-5`, temperature 0). Tidak ada
 * respons model yang dipalsukan di sini — kalau AI Gateway tidak terkonfigurasi,
 * test ini GAGAL dengan pesan error dari `generateObject`, bukan diam-diam
 * di-skip.
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBundle, guardCitations, validateCitations } from './assess';
import { collectEvidence, prepareBundle } from '../evidence/bundle';
import { areaHa, type Geometry } from '../evidence/gfw';
import type { AgentAssessment, Evidence, EvidenceBundle, Plot } from '../types';

// Petak yang sama dengan fixture B4 (lib/evidence/bundle.test.ts) — sengaja dipilih
// karena Sarawak z12/3333/2019 punya alert nyata sampai 2026-07-23 (CLAUDE.md §3.1,
// juga terverifikasi ulang lewat lib/evidence/gfw.test.ts fixture pixels:4889).
const sarawakGeom: Geometry = {
  type: 'Polygon',
  coordinates: [[[113.0, 2.5], [113.05, 2.5], [113.05, 2.55], [113.0, 2.55], [113.0, 2.5]]],
};

const sarawakPlot: Plot = {
  id: 'test-agent-sarawak',
  name: 'Petak uji agen Sarawak',
  geojson: sarawakGeom,
  geohash: 'w0m',
  areaHa: areaHa(sarawakGeom),
  operatorName: 'Sime Darby Plantation',
  source: 'upload',
};

/** Bungkus PreparedBundle jadi EvidenceBundle lengkap tanpa mengunggah ke Blob. */
function toEvidenceBundle(items: readonly Evidence[], evidenceAsOf: string): EvidenceBundle {
  const prepared = prepareBundle(items, evidenceAsOf);
  return {
    bundleId: prepared.bundleId,
    evidenceAsOf: prepared.evidenceAsOf,
    items: prepared.items,
    bundleHash: prepared.bundleHash,
    // Bundle ini tidak diunggah (B4 sudah menguji unggah/unduh sendiri) — hash
    // yang dipakai untuk sitasi tetap dihitung dari isi bukti nyata di atas.
    blobUrl: `local-test-fixture:${prepared.bundleId}`,
  };
}

function assertAssessmentShape(assessment: AgentAssessment, validIds: readonly string[]): void {
  assert.ok(['PASS', 'FAIL', 'INCONCLUSIVE'].includes(assessment.verdict), `verdict aneh: ${assessment.verdict}`);
  assert.ok(Number.isInteger(assessment.confidence), `confidence bukan integer: ${assessment.confidence}`);
  assert.ok(assessment.confidence >= 0 && assessment.confidence <= 100, `confidence di luar 0-100: ${assessment.confidence}`);
  assert.ok(assessment.summary.trim().length > 0, 'summary kosong');
  assert.ok(Array.isArray(assessment.findings));

  const validSet = new Set(validIds);
  for (const f of assessment.findings) {
    assert.ok(['critical', 'major', 'minor', 'info'].includes(f.severity), `severity aneh: ${f.severity}`);
    assert.ok(f.claim.trim().length > 0, 'claim kosong');
    assert.ok(f.contradiction.trim().length > 0, 'contradiction kosong');
    for (const id of f.evidenceIds) {
      assert.ok(validSet.has(id), `finding menyitir evidenceId yang tidak ada di bundle: ${id}`);
    }
  }
}

test('assessBundle: bundle nyata (deforestasi + GLEIF + sanksi) menghasilkan penilaian valid dengan sitasi nyata', async (t) => {
  const evidenceAsOf = '2026-06-01T00:00:00.000Z';
  const items = await collectEvidence({
    plot: sarawakPlot,
    euOperator: { legalName: 'Unilever N.V.', jurisdiction: 'NL' },
    screenNames: ['Sime Darby Plantation'],
    evidenceAsOf,
  });
  const bundle = toEvidenceBundle(items, evidenceAsOf);
  const validIds = bundle.items.map((i) => i.id);

  const result = await assessBundle(bundle, {
    plot: sarawakPlot,
    euOperator: { legalName: 'Unilever N.V.', jurisdiction: 'NL' },
  });

  // Assert TERPENTING: setiap evidenceId di setiap finding benar-benar ada di bundle.
  const check = validateCitations(result.assessment, validIds);
  assert.ok(check.valid, `sitasi tak sah ditemukan: ${JSON.stringify(check.invalidIds)}`);

  assertAssessmentShape(result.assessment, validIds);
  assert.equal(result.model, 'anthropic/claude-sonnet-5');
  assert.ok(!Number.isNaN(Date.parse(result.assessedAt)));

  t.diagnostic(
    `verdict=${result.assessment.verdict} confidence=${result.assessment.confidence} ` +
      `findings=${result.assessment.findings.length} retried=${result.retried}`,
  );
});

test('assessBundle: deforestasi berat setelah cutoff EUDR → verdict TIDAK boleh PASS', async (t) => {
  // evidenceAsOf mendekati hari ini: petak Sarawak ini punya ribuan alert nyata
  // setelah cutoff 2020-12-31 (lihat lib/evidence/gfw.test.ts, fixture tile
  // 3333/2019 → 4.889 piksel, rentang 2020-01-12..2026-07-23). Tidak ada operator
  // EU / sanksi diinput di sini supaya sinyal deforestasi tidak "tertutup" bukti lain.
  const evidenceAsOf = '2026-08-01T00:00:00.000Z';
  const items = await collectEvidence({
    plot: sarawakPlot,
    screenNames: ['Sime Darby Plantation'],
    evidenceAsOf,
  });
  const bundle = toEvidenceBundle(items, evidenceAsOf);

  const defo = items.find((i) => i.kind === 'deforestation');
  assert.ok(defo && defo.kind === 'deforestation');
  assert.ok(defo.alertsAfterCutoff > 1_000, `alertsAfterCutoff terlalu kecil untuk fixture ini: ${defo.alertsAfterCutoff}`);

  const result = await assessBundle(bundle, { plot: sarawakPlot });

  assert.notEqual(result.assessment.verdict, 'PASS', `verdict semestinya bukan PASS: ${JSON.stringify(result.assessment)}`);
  t.diagnostic(`alertsAfterCutoff=${defo.alertsAfterCutoff} → verdict=${result.assessment.verdict}`);
});

test('validateCitations mendeteksi evidenceId palsu tanpa memanggil model', () => {
  const fake: AgentAssessment = {
    verdict: 'FAIL',
    confidence: 80,
    findings: [
      {
        severity: 'critical',
        claim: 'klaim uji',
        contradiction: 'kontradiksi uji',
        evidenceIds: ['deforestation:nyata-1', 'deforestation:karangan-tidak-ada'],
      },
    ],
    summary: 'ringkasan uji',
  };

  const result = validateCitations(fake, ['deforestation:nyata-1', 'legal_entity:nyata-2']);
  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidIds, ['deforestation:karangan-tidak-ada']);

  const clean = validateCitations(
    { ...fake, findings: [{ ...fake.findings[0], evidenceIds: ['deforestation:nyata-1'] }] },
    ['deforestation:nyata-1', 'legal_entity:nyata-2'],
  );
  assert.equal(clean.valid, true);
  assert.deepEqual(clean.invalidIds, []);
});

test('assessBundle menolak bundle kosong tanpa memanggil model', async () => {
  const emptyBundle: EvidenceBundle = {
    bundleId: 'bundle_empty',
    evidenceAsOf: '2026-06-01T00:00:00.000Z',
    items: [],
    bundleHash: 'a'.repeat(64),
    blobUrl: 'local-test-fixture:empty',
  };

  await assert.rejects(() => assessBundle(emptyBundle, { plot: sarawakPlot }), /bundle kosong/);
});

// ─── Jalur kegagalan sitasi (R5) ──────────────────────────────────────────────
//
// Cabang-cabang ini tidak pernah terpicu oleh model sungguhan: Sonnet konsisten
// menyitir id yang benar sejak percobaan pertama. Selama ini penanganan
// kegagalannya karena itu hanya "diperiksa dengan dibaca" — dan kode penanganan
// kegagalan yang belum pernah dijalankan adalah kode yang belum diketahui
// bekerja. `guardCitations` menerima produser penilaian sehingga jalur itu bisa
// dijalankan sungguhan.
//
// Ini BUKAN mock data terlarang (§0): yang disuntikkan adalah fungsi penghasil
// untuk menguji logika kendali kita sendiri, bukan bukti karangan yang
// berpura-pura hasil pengukuran. Tidak ada angka dari sini yang sampai ke layar.

const VALID_IDS = ['deforestation:v1:z12:abc', 'sanctions:OFAC_SDN:2026-07-29:X'];

function assessmentCiting(ids: string[]): AgentAssessment {
  return {
    verdict: 'FAIL',
    confidence: 70,
    findings: [
      {
        severity: 'major',
        claim: 'klaim uji',
        contradiction: 'kontradiksi uji',
        evidenceIds: ids,
      },
    ],
    summary: 'ringkasan uji',
  };
}

test('guardCitations: sitasi sah pada percobaan pertama → tanpa pengulangan', async () => {
  let calls = 0;
  const { assessment, retried } = await guardCitations(async () => {
    calls += 1;
    return assessmentCiting([VALID_IDS[0]!]);
  }, VALID_IDS);

  assert.equal(calls, 1, 'tidak boleh memanggil model dua kali kalau sudah sah');
  assert.equal(retried, false);
  assert.equal(assessment.verdict, 'FAIL');
});

test('guardCitations: id palsu lalu benar → mengulang sekali, hasil kedua dipakai', async () => {
  const corrections: (string | null)[] = [];
  const { assessment, retried } = await guardCitations(async (correction) => {
    corrections.push(correction);
    return corrections.length === 1
      ? assessmentCiting(['certification:RSPO:TIDAK_ADA:deadbeef'])
      : assessmentCiting([VALID_IDS[1]!]);
  }, VALID_IDS);

  assert.equal(retried, true);
  assert.equal(corrections.length, 2);
  assert.equal(corrections[0], null, 'percobaan pertama tanpa koreksi');
  assert.ok(corrections[1], 'percobaan kedua harus membawa sufiks koreksi');
  // Koreksi wajib menyebut id yang salah DAN daftar id yang sah.
  assert.match(corrections[1]!, /certification:RSPO:TIDAK_ADA:deadbeef/);
  assert.match(corrections[1]!, /deforestation:v1:z12:abc/);
  assert.equal(assessment.verdict, 'FAIL');
  assert.deepEqual(assessment.findings[0]!.evidenceIds, [VALID_IDS[1]]);
});

test('guardCitations: gagal dua kali → INCONCLUSIVE yang menyatakan kegagalannya', async () => {
  const { assessment, retried } = await guardCitations(
    async () => assessmentCiting(['tidak:ada:1', 'tidak:ada:2']),
    VALID_IDS,
  );

  assert.equal(retried, true);
  assert.equal(assessment.verdict, 'INCONCLUSIVE');
  assert.equal(assessment.confidence, 0);
  // Temuan dikosongkan, TIDAK disaring diam-diam lalu sisanya dipakai.
  assert.deepEqual(assessment.findings, []);
  // Summary harus menyebut id tak sah dan menegaskan ini bukan "petak bersih".
  assert.match(assessment.summary, /tidak:ada:1/);
  assert.match(assessment.summary, /TIDAK DAPAT DIPERCAYA/);
  assert.match(assessment.summary, /bukan berarti petak/);
});

test('guardCitations: sebagian id sah sebagian palsu tetap dianggap gagal', async () => {
  const { assessment } = await guardCitations(
    async () => assessmentCiting([VALID_IDS[0]!, 'tidak:ada:3']),
    VALID_IDS,
  );
  // Satu sitasi palsu membuat seluruh penalaran tidak bisa dipercaya —
  // finding yang "kebetulan benar" tidak diselamatkan.
  assert.equal(assessment.verdict, 'INCONCLUSIVE');
});
