/**
 * Test B8. Menyentuh jaringan sungguhan: kontrak EAS di Base Sepolia dan
 * indexer GraphQL easscan (CLAUDE.md §0 — tanpa mock).
 *
 * Test ini membuat SATU attestation baru (lewat B7) untuk diverifikasi lewat
 * `readAttestation`, supaya tidak bergantung pada state attestation lama yang
 * mungkin sudah di-revoke test lain / dihapus. Wallet berdana faucet terbatas
 * — hanya satu attestation dibuat di sini.
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hex } from 'viem';
import { issueAttestation, type SnitchAttestationData } from './attest';
import { listOurAttestations, readAttestation } from './read';

// Lock lintas-proses yang sama dengan `attest.test.ts` — lihat komentar di
// sana. Wallet attester tunggal, dua file test bisa berjalan konkuren.
const LOCK_PATH = join(tmpdir(), 'snitch-eas-attester.lock');

async function acquireChainLock(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(LOCK_PATH);
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`Gagal mengambil lock chain (${LOCK_PATH}) setelah ${timeoutMs}ms.`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

function releaseChainLock(): void {
  if (existsSync(LOCK_PATH)) {
    try {
      rmdirSync(LOCK_PATH);
    } catch {
      // sudah dilepas proses lain — abaikan.
    }
  }
}

async function withChainLock<T>(fn: () => Promise<T>): Promise<T> {
  await acquireChainLock();
  try {
    return await fn();
  } finally {
    releaseChainLock();
  }
}

function requireEnv(): void {
  const missing = ['ATTESTER_PRIVATE_KEY', 'CHAIN_ID', 'EAS_SCHEMA_UID'].filter(
    (k) => !process.env[k],
  );
  if (missing.length > 0) {
    throw new Error(
      `Env wajib untuk test on-chain tidak diset: ${missing.join(', ')}. Isi di .env.`,
    );
  }
}

test('readAttestation pada UID nol -> null', async () => {
  requireEnv();
  const zero: Hex = `0x${'0'.repeat(64)}`;
  const result = await readAttestation(zero);
  assert.equal(result, null);
});

test('readAttestation pada UID acak yang tidak pernah dipakai -> null', async () => {
  requireEnv();
  // UID acak deterministik untuk run ini — praktis mustahil pernah
  // dipakai attestation sungguhan.
  const random: Hex = `0x${'a1b2c3'.repeat(10)}ffff` as Hex;
  const result = await readAttestation(random);
  assert.equal(result, null);
});

/**
 * Poll indexer EAS sampai UID muncul, dengan backoff linear.
 *
 * Mengembalikan `undefined` bila menyerah — pemanggil yang memutuskan apakah
 * itu kegagalan. Sengaja tidak pernah "melunak jadi lulus": indexer yang lambat
 * dan fitur yang rusak harus bisa dibedakan, dan keduanya bukan sukses.
 */
const POLL_MAX_ATTEMPTS = 6;

async function pollIndexerForUid(
  uid: Hex,
  t: { diagnostic: (msg: string) => void },
  maxAttempts: number = POLL_MAX_ATTEMPTS,
): Promise<Awaited<ReturnType<typeof listOurAttestations>>[number] | undefined> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const list = await listOurAttestations(20);
    const found = list.find((a) => a.uid.toLowerCase() === uid.toLowerCase());
    if (found) return found;
    if (attempt < maxAttempts) {
      t.diagnostic(`indexer belum mengindeks UID (percobaan ${attempt}/${maxAttempts}), tunggu...`);
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  return undefined;
}

test(
  'readAttestation & listOurAttestations pada attestation nyata',
  { timeout: 120_000 },
  async (t) => {
    requireEnv();

    const d: SnitchAttestationData = {
      plotId: `plot-b8-test-${Date.now()}`,
      plotGeohash: 'w2gwc',
      evidenceHash:
        '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      evidenceUri: 'https://example.blob.vercel-storage.com/bundle-b8-test.json',
      verdict: 'FAIL',
      confidence: 42,
      evidenceAsOf: '2026-06-01T00:00:00.000Z',
      reviewedBy: 'test-suite-b8',
      legalEntityLEI: '',
    };

    const issued = await withChainLock(() => issueAttestation(d));
    t.diagnostic(`UID untuk test B8: ${issued.uid}`);
    console.log('--- ATTEST (B8 fixture) ---');
    console.log('uid         :', issued.uid);
    console.log('txHash      :', issued.txHash);
    console.log('explorerUrl :', issued.explorerUrl);

    const onchain = await readAttestation(issued.uid);
    assert.ok(onchain, 'attestation harus terbaca on-chain');
    assert.equal(onchain?.schemaUid.toLowerCase(), issued.schemaUid.toLowerCase());
    assert.equal(onchain?.attester.toLowerCase(), issued.attester.toLowerCase());
    assert.equal(onchain?.revoked, false);
    assert.deepEqual(onchain?.decoded, d);

    const found = await pollIndexerForUid(issued.uid, t);
    if (!found) {
      throw new Error(
        `Indexer EAS GraphQL belum mengindeks attestation ${issued.uid} setelah ${POLL_MAX_ATTEMPTS} percobaan. ` +
          `Ini bisa berarti indexer sedang lambat, bukan berarti fitur listOurAttestations rusak — ` +
          `periksa manual di ${issued.easscanUrl}.`,
      );
    }

    assert.equal(found.uid.toLowerCase(), issued.uid.toLowerCase());
    assert.deepEqual(found.decoded, d);
  },
);

test(
  'poll indexer MENYERAH pada UID yang tidak akan pernah ada, bukan menggantung atau lulus palsu',
  { timeout: 120_000 },
  async (t) => {
    // Cabang "indexer tidak pernah mengejar" sebelumnya tidak pernah dijalankan:
    // indexer selalu cepat, jadi loop poll di atas selalu keluar di percobaan
    // pertama. Kode yang menangani kegagalan tapi belum pernah dieksekusi adalah
    // kode yang belum diketahui bekerja.
    //
    // Di sini kondisinya dipicu SUNGGUHAN — bukan dengan memalsukan respons,
    // melainkan dengan menanyakan UID acak yang memang tidak pernah diterbitkan
    // siapa pun. Indexer sungguhan yang menjawab, dan jawabannya memang
    // "tidak ada". Yang diuji: poll berhenti pada batasnya dan mengembalikan
    // undefined, sehingga pemanggil bisa melaporkan kegagalan jujur.
    const neverExists = `0x${'ab'.repeat(32)}` as Hex;

    const t0 = Date.now();
    const found = await pollIndexerForUid(neverExists, t, 3);
    const elapsedS = (Date.now() - t0) / 1000;

    assert.equal(found, undefined, 'UID yang tidak ada tidak boleh "ditemukan"');
    // Membuktikan ia benar-benar mengulang dan menunggu, bukan langsung menyerah
    // di percobaan pertama: backoff 3 s + 6 s antara tiga percobaan.
    assert.ok(elapsedS >= 9, `poll terlalu cepat menyerah: ${elapsedS.toFixed(1)} s`);
    t.diagnostic(`menyerah setelah 3 percobaan dalam ${elapsedS.toFixed(1)} s — sesuai harapan`);
  },
);
