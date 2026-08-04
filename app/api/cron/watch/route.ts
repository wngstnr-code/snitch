/**
 * GET /api/cron/watch -> WatchRunResult
 *
 * Dipanggil Vercel Cron. Hobby plan hanya melayani interval harian, jadi
 * jalur yang sama diekspos sebagai `POST /api/verifications/[id]/recheck`
 * untuk pemeriksaan on-demand (R6) — dua pintu, satu runner, supaya yang
 * didemokan persis kode yang jalan di produksi.
 *
 * Diamankan `CRON_SECRET` bila variabelnya diset: endpoint ini mengirim
 * transaksi onchain, jadi ia tidak boleh bisa dipicu siapa saja.
 */

import type { NextRequest } from 'next/server';
import { runWatch } from '../../../../lib/jobs/watch';
import { fail, handle, ok } from '../../../../lib/api/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = request.headers.get('authorization');
      if (auth !== `Bearer ${secret}`) {
        return fail(401, 'Tidak berwenang menjalankan watcher.');
      }
    }
    return ok(await runWatch({ trigger: 'cron' }));
  });
}
