/**
 * GET /api/cron/watch -> WatchRunResult
 *
 * Dipanggil Vercel Cron. Hobby plan hanya melayani interval harian, jadi
 * jalur yang sama diekspos sebagai `POST /api/verifications/[id]/recheck`
 * untuk pemeriksaan on-demand (R6) — dua pintu, satu runner, supaya yang
 * didemokan persis kode yang jalan di produksi.
 *
 * Diamankan `CRON_SECRET`. Di deployment, ketiadaan secret adalah error dan
 * BUKAN izin — endpoint ini mengirim transaksi onchain (lihat lib/api/cron-auth.ts).
 */

import type { NextRequest } from 'next/server';
import { runWatch } from '../../../../lib/jobs/watch';
import { handle, ok } from '../../../../lib/api/respond';
import { checkCronAuth } from '../../../../lib/api/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    const denied = checkCronAuth(request);
    if (denied) return denied;
    return ok(await runWatch({ trigger: 'cron' }));
  });
}
