/**
 * GET /api/cron/sanctions
 *
 * Menyegarkan kedua daftar sanksi resmi ke Postgres.
 *
 * ─── Kenapa ini wajib ada, bukan sekadar enak dipunyai ───────────────────────
 * `screenEntity` MELEMPAR bila daftar di DB berumur lebih dari 30 hari (R10) —
 * pilihan yang benar, karena screening terhadap daftar basi lebih berbahaya
 * daripada tidak screening sama sekali. Konsekuensinya: tanpa penyegaran
 * terjadwal, seluruh verifikasi berhenti bekerja 30 hari setelah deployment.
 * Sebelum endpoint ini ada, satu-satunya jalur penyegaran adalah menjalankan
 * `npm run sanctions:sync` dari laptop seseorang.
 *
 * Idempoten: isi tiap daftar diganti utuh, jadi dijalankan dua kali aman.
 */

import type { NextRequest } from 'next/server';
import {
  fetchEuConsolidated,
  fetchOfacSdn,
  storeSnapshot,
  type SanctionsListId,
  type SanctionsSnapshot,
} from '../../../../lib/evidence/sanctions';
import { handle, messageOf, ok } from '../../../../lib/api/respond';
import { checkCronAuth } from '../../../../lib/api/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Terukur: OFAC ~30 s, EU ~36 s. Beri ruang untuk hari yang lambat. */
export const maxDuration = 300;

interface ListResult {
  list: SanctionsListId;
  ok: boolean;
  entries: number | null;
  listDate: string | null;
  rawHash: string | null;
  durationS: number;
  error: string | null;
}

async function sync(
  list: SanctionsListId,
  load: () => Promise<SanctionsSnapshot>,
): Promise<ListResult> {
  const t0 = Date.now();
  try {
    const snapshot = await load();
    const entries = await storeSnapshot(snapshot);
    return {
      list,
      ok: true,
      entries,
      listDate: snapshot.listDate,
      rawHash: snapshot.rawHash,
      durationS: Number(((Date.now() - t0) / 1000).toFixed(1)),
      error: null,
    };
  } catch (e) {
    return {
      list,
      ok: false,
      entries: null,
      listDate: null,
      rawHash: null,
      durationS: Number(((Date.now() - t0) / 1000).toFixed(1)),
      error: messageOf(e),
    };
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    const denied = checkCronAuth(request);
    if (denied) return denied;

    // Satu daftar gagal tidak boleh membatalkan yang lain — dua sumber
    // pemerintah yang berbeda punya jadwal pemeliharaan sendiri-sendiri.
    // Tapi kegagalannya juga tidak boleh hilang: ia keluar di respons dan
    // status HTTP-nya ikut merah supaya cron melaporkannya sebagai gagal.
    const results = [
      await sync('OFAC_SDN', fetchOfacSdn),
      await sync('EU_CONSOLIDATED', fetchEuConsolidated),
    ];

    const allOk = results.every((r) => r.ok);
    return ok(
      { syncedAt: new Date().toISOString(), allOk, results },
      { status: allOk ? 200 : 502 },
    );
  });
}
