/**
 * POST /api/verifications/[id]/recheck -> Verification (bisa memicu revoke)
 *
 * Tombol "Re-verify now". Menjalankan runner watcher yang PERSIS SAMA dengan
 * cron (R6) — dibatasi ke attestation milik verifikasi ini. Kalau bukti satelit
 * baru membantahnya, revocation terjadi di sini, live, di depan juri.
 */

import type { NextRequest } from 'next/server';
import { getVerification } from '../../../../../lib/db/repo';
import { runWatch } from '../../../../../lib/jobs/watch';
import { fail, handle, ok } from '../../../../../lib/api/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
  ctx: RouteContext<'/api/verifications/[id]/recheck'>,
): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;

    const v = await getVerification(id);
    if (!v) return fail(404, `Verifikasi ${id} tidak ditemukan.`);
    if (!v.attestation) {
      return fail(
        409,
        `Verifikasi ${id} belum punya attestation (status: ${v.status}). Tidak ada yang bisa dicabut.`,
      );
    }
    if (v.attestation.revoked) {
      return fail(
        409,
        `Attestation ${v.attestation.uid} sudah ter-revoke pada ${v.attestation.revokedAt}.`,
      );
    }

    const run = await runWatch({ trigger: 'manual', onlyUid: v.attestation.uid });

    // Kegagalan pemeriksaan tidak boleh terlihat seperti "aman". Kalau watcher
    // gagal, endpoint ini gagal juga — dengan pesan aslinya.
    const err = run.errors[0];
    if (err) return fail(502, `Pemeriksaan ulang gagal: ${err.error}`);

    const updated = await getVerification(id);
    if (!updated) return fail(500, `Verifikasi ${id} hilang setelah pemeriksaan ulang.`);
    return ok(updated);
  });
}
