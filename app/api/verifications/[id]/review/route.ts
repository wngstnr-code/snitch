/**
 * POST /api/verifications/[id]/review  HumanReview -> Verification
 *
 * Keputusan manusia. Disimpan dua kali dengan sengaja (lihat `lib/db/repo.ts`):
 * kolom `review` adalah keadaan sekarang, `review_log` adalah jejak audit yang
 * tidak pernah ditimpa.
 *
 * `reason` wajib untuk SEMUA keputusan, bukan hanya penolakan. Attestation ini
 * membawa nama peninjau ke onchain; alasan yang kosong membuat tanda tangan itu
 * tidak bisa dipertanggungjawabkan siapa pun di kemudian hari.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getVerification, saveReview, setStatus } from '../../../../../lib/db/repo';
import { fail, handle, ok } from '../../../../../lib/api/respond';
import type { HumanReview } from '../../../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'override']),
    overrideVerdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']).optional(),
    reason: z.string().trim().min(10, 'reason minimal 10 karakter — ini masuk jejak audit'),
    reviewedBy: z.string().trim().min(1),
    reviewedAt: z.string().optional(),
  })
  .refine((b) => b.decision !== 'override' || !!b.overrideVerdict, {
    message: 'decision=override wajib disertai overrideVerdict',
    path: ['overrideVerdict'],
  });

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/verifications/[id]/review'>,
): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail(
        400,
        `Body tidak sah: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }

    const existing = await getVerification(id);
    if (!existing) return fail(404, `Verifikasi ${id} tidak ditemukan.`);
    if (!existing.assessment) {
      return fail(
        409,
        `Verifikasi ${id} belum dinilai agen (status: ${existing.status}). Tidak ada yang bisa direview.`,
      );
    }
    if (existing.attestation && !existing.attestation.revoked) {
      return fail(
        409,
        `Verifikasi ${id} sudah diterbitkan onchain (${existing.attestation.uid}). Review setelah penerbitan tidak mengubah apa pun di chain — cabut attestation-nya kalau keputusannya berubah.`,
      );
    }

    const review: HumanReview = {
      decision: parsed.data.decision,
      overrideVerdict: parsed.data.overrideVerdict,
      reason: parsed.data.reason,
      reviewedBy: parsed.data.reviewedBy,
      reviewedAt: parsed.data.reviewedAt ?? new Date().toISOString(),
    };

    await saveReview(id, review);
    // Status tetap `awaiting_review` sampai attestation benar-benar terbit.
    // Penolakan pun tidak mengubah status: yang berubah adalah keputusan
    // manusianya, dan itu sudah terekam. Status mencerminkan posisi di alur
    // onchain, bukan pendapat peninjau.
    await setStatus(id, 'awaiting_review');

    const updated = await getVerification(id);
    if (!updated) return fail(500, `Verifikasi ${id} hilang setelah review disimpan.`);
    return ok(updated);
  });
}
