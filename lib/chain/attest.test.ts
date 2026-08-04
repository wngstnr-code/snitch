/**
 * Test B7. Bagian round-trip/validasi murni lokal; bagian attest/revoke
 * mengirim transaksi SUNGGUHAN ke Base Sepolia (CLAUDE.md §0 — tanpa mock).
 *
 * Butuh `ATTESTER_PRIVATE_KEY`, `CHAIN_ID`, `EAS_SCHEMA_UID` di env — kalau
 * tidak ada, test melempar dengan pesan jelas (bukan skip diam-diam).
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hex } from 'viem';
import {
  decodeSnitchData,
  encodeSnitchData,
  issueAttestation,
  revokeAttestation,
  type SnitchAttestationData,
} from './attest';
import { readAttestation } from './read';

// `node --test` menjalankan tiap FILE test di proses terpisah dan bisa
// berjalan konkuren. Wallet attester kita tunggal (satu nonce), dan
// `attest.test.ts` + `read.test.ts` sama-sama mengirim transaksi sungguhan —
// tanpa dikunci, dua tx bisa berebut nonce yang sama ("replacement
// transaction underpriced") atau bertabrakan dengan penghitung UID internal
// EAS. Lock berbasis mkdir (atomik lintas proses di POSIX) menyerialkan
// SEMUA transaksi on-chain attester ini, lintas kedua file test.
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

/** Serialkan satu transaksi on-chain attester ini lintas proses test. */
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

const SAMPLE_HASH: Hex =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

function sample(overrides: Partial<SnitchAttestationData> = {}): SnitchAttestationData {
  return {
    plotId: 'plot-test-001',
    plotGeohash: 'w2gwc',
    evidenceHash: SAMPLE_HASH,
    evidenceUri: 'https://example.blob.vercel-storage.com/bundle-test.json',
    verdict: 'PASS',
    confidence: 87,
    evidenceAsOf: '2026-06-01T00:00:00.000Z',
    reviewedBy: 'test-suite',
    legalEntityLEI: '',
    ...overrides,
  };
}

// ---------- round-trip encode/decode ----------

test('encodeSnitchData -> decodeSnitchData round-trip untuk semua verdict', () => {
  for (const verdict of ['PASS', 'FAIL', 'INCONCLUSIVE'] as const) {
    const d = sample({ verdict });
    const encoded = encodeSnitchData(d);
    const decoded = decodeSnitchData(encoded);
    assert.deepEqual(decoded, d);
  }
});

test('round-trip pada nilai batas: legalEntityLEI kosong, confidence 0 dan 100', () => {
  for (const confidence of [0, 100]) {
    const d = sample({ confidence, legalEntityLEI: '' });
    const decoded = decodeSnitchData(encodeSnitchData(d));
    assert.deepEqual(decoded, d);
  }
});

test('round-trip mempertahankan legalEntityLEI terisi', () => {
  const d = sample({ legalEntityLEI: '529900T8BM49AURSDO55' });
  const decoded = decodeSnitchData(encodeSnitchData(d));
  assert.equal(decoded.legalEntityLEI, d.legalEntityLEI);
});

// ---------- validasi input ----------

test('encodeSnitchData menolak evidenceHash salah panjang', () => {
  assert.throws(
    () => encodeSnitchData(sample({ evidenceHash: '0x1234' as Hex })),
    /evidenceHash/i,
  );
});

test('encodeSnitchData menolak confidence > 100', () => {
  assert.throws(() => encodeSnitchData(sample({ confidence: 101 })), /confidence/i);
});

test('encodeSnitchData menolak confidence negatif', () => {
  assert.throws(() => encodeSnitchData(sample({ confidence: -1 })), /confidence/i);
});

test('encodeSnitchData menolak evidenceAsOf yang bukan ISO date sah', () => {
  assert.throws(
    () => encodeSnitchData(sample({ evidenceAsOf: 'bukan-tanggal' })),
    /evidenceAsOf/i,
  );
});

// ---------- attest & revoke sungguhan di Base Sepolia ----------

test(
  'issueAttestation menerbitkan attestation sungguhan di Base Sepolia',
  { timeout: 120_000 },
  async (t) => {
    requireEnv();

    const d = sample({ plotId: `plot-b7-test-${Date.now()}` });
    const result = await withChainLock(() => issueAttestation(d));

    assert.notEqual(result.uid, `0x${'0'.repeat(64)}`, 'uid tidak boleh nol');
    assert.match(result.txHash, /^0x[0-9a-f]{64}$/i);

    const attestedAtMs = Date.parse(result.attestedAt);
    const nowMs = Date.now();
    assert.ok(
      Math.abs(nowMs - attestedAtMs) < 5 * 60 * 1000,
      `attestedAt (${result.attestedAt}) meleset > 5 menit dari sekarang`,
    );

    t.diagnostic(`UID           : ${result.uid}`);
    t.diagnostic(`Tx attest     : ${result.txHash}`);
    t.diagnostic(`explorerUrl   : ${result.explorerUrl}`);
    t.diagnostic(`easscanUrl    : ${result.easscanUrl}`);
    console.log('--- ATTEST (B7) ---');
    console.log('uid         :', result.uid);
    console.log('txHash      :', result.txHash);
    console.log('explorerUrl :', result.explorerUrl);
    console.log('easscanUrl  :', result.easscanUrl);

    // Verifikasi lewat pembacaan on-chain langsung (B8), bukan asumsi.
    const onchain = await readAttestation(result.uid);
    assert.ok(onchain, 'attestation yang baru dibuat harus terbaca on-chain');
    assert.equal(onchain?.revoked, false);
    assert.deepEqual(onchain?.decoded, d);

    // ---- revoke sungguhan atas attestation yang sama ----
    const revoked = await withChainLock(() => revokeAttestation(result.uid));
    assert.match(revoked.txHash, /^0x[0-9a-f]{64}$/i);
    const revokedAtMs = Date.parse(revoked.revokedAt);
    assert.ok(
      Math.abs(Date.now() - revokedAtMs) < 5 * 60 * 1000,
      `revokedAt (${revoked.revokedAt}) meleset > 5 menit dari sekarang`,
    );

    console.log('--- REVOKE (B7) ---');
    console.log('txHash      :', revoked.txHash);
    console.log('explorerUrl :', revoked.explorerUrl);

    const afterRevoke = await readAttestation(result.uid);
    assert.ok(afterRevoke);
    assert.equal(afterRevoke?.revoked, true);
    assert.ok(afterRevoke?.revocationTime);

    // Revoke ulang UID yang sama harus melempar.
    await assert.rejects(() => revokeAttestation(result.uid), /sudah ter-revoke/i);
  },
);
