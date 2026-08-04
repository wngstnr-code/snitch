/**
 * Unduh kedua daftar sanksi resmi dan simpan ke Postgres.
 *
 *   npm run sanctions:sync
 *
 * Dijalankan manual saat pengembangan. Di produksi jalurnya adalah
 * `GET /api/cron/sanctions` (Vercel Cron, lihat vercel.json) — kode yang sama,
 * dipanggil terjadwal.
 * Idempoten: isi tiap daftar diganti utuh, jadi menjalankannya dua kali aman.
 */

import {
  fetchEuConsolidated,
  fetchOfacSdn,
  storeSnapshot,
  type SanctionsSnapshot,
} from '../lib/evidence/sanctions';

async function sync(label: string, load: () => Promise<SanctionsSnapshot>) {
  const t0 = Date.now();
  const snapshot = await load();
  const stored = await storeSnapshot(snapshot);
  console.log(
    `✔ ${label}: ${stored.toLocaleString('id-ID')} entri · daftar terbit ${snapshot.listDate} · ` +
      `sha256 ${snapshot.rawHash.slice(0, 12)}… · ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
}

async function main() {
  await sync('OFAC SDN', fetchOfacSdn);
  await sync('EU Consolidated', fetchEuConsolidated);
}

main().catch((err: unknown) => {
  console.error('GAGAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
