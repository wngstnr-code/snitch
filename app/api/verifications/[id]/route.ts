/**
 * GET /api/verifications/[id] -> Verification
 *
 * Termasuk bundle bukti lengkap. Ini yang menyuplai panel bukti di UI, jadi
 * setiap item membawa `sourceUrl` dan `fetchedAt`-nya sendiri — juri harus
 * bisa melacak tiap angka ke data mentahnya.
 */

import type { NextRequest } from 'next/server';
import { getVerification } from '../../../../lib/db/repo';
import { fail, handle, ok } from '../../../../lib/api/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/verifications/[id]'>,
): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const v = await getVerification(id);
    if (!v) return fail(404, `Verifikasi ${id} tidak ditemukan.`);
    return ok(v);
  });
}
