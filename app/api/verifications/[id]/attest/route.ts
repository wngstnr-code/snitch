/**
 * POST /api/verifications/[id]/attest -> Verification (dengan attestation)
 *
 * Menerbitkan attestation EAS di chain yang ditunjuk `CHAIN_ID`.
 *
 * ─── Manusia dulu, chain kemudian ────────────────────────────────────────────
 * Endpoint ini menolak bekerja tanpa `review`. Attestation membawa nama
 * peninjau ke onchain dan sifatnya permanen; menerbitkannya dari verdict agen
 * saja akan membuat langkah persetujuan manusia jadi teater UI, dan itu
 * kebalikan dari klaim produk ini.
 *
 * Verdict yang di-anchor adalah verdict SETELAH override, bukan verdict agen.
 * Kalau manusia menimpa penilaian mesin, yang mengikat adalah keputusan manusia
 * — dan alasannya sudah tersimpan di `review_log`.
 */

import type { NextRequest } from 'next/server';
import {
  getVerification,
  saveAttestation,
  setStatus,
} from '../../../../../lib/db/repo';
import { issueAttestation } from '../../../../../lib/chain/attest';
import { fail, handle, ok } from '../../../../../lib/api/respond';
import type { Verdict } from '../../../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
  ctx: RouteContext<'/api/verifications/[id]/attest'>,
): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;

    const v = await getVerification(id);
    if (!v) return fail(404, `Verifikasi ${id} tidak ditemukan.`);
    if (!v.bundle) {
      return fail(409, `Verifikasi ${id} belum punya bundle bukti (status: ${v.status}).`);
    }
    if (!v.assessment) {
      return fail(409, `Verifikasi ${id} belum dinilai agen (status: ${v.status}).`);
    }
    if (!v.review) {
      return fail(
        409,
        `Verifikasi ${id} belum direview manusia. Attestation tidak diterbitkan dari verdict agen saja.`,
      );
    }
    if (v.review.decision === 'reject') {
      return fail(
        409,
        `Peninjau menolak penilaian ini (alasan: "${v.review.reason}"). Tidak ada yang diterbitkan. ` +
          'Jalankan ulang verifikasi atau kirim review override kalau verdict-nya yang ingin diubah.',
      );
    }
    if (v.attestation) {
      // Termasuk yang SUDAH ter-revoke. Menerbitkan ulang dari bundle yang sama
      // berarti menerbitkan kembali bukti yang barusan terbukti dibantah —
      // watcher akan langsung mencabutnya lagi, dan yang tersisa hanyalah
      // riwayat onchain yang berisik. Verifikasi baru dulu, bukti baru dulu.
      const suffix = v.attestation.revoked
        ? ' (sudah ter-revoke). Jalankan verifikasi baru dengan bukti terkini sebelum menerbitkan lagi.'
        : ' (masih aktif).';
      return fail(409, `Verifikasi ${id} sudah punya attestation ${v.attestation.uid}${suffix}`);
    }

    const verdict: Verdict =
      v.review.decision === 'override' && v.review.overrideVerdict
        ? v.review.overrideVerdict
        : v.assessment.verdict;

    // LEI hanya ada kalau operator EU benar-benar terverifikasi ke GLEIF.
    // String kosong berarti "tidak diverifikasi" dan itu memang informasi yang
    // jujur untuk dibawa onchain — bukan sesuatu yang boleh diisi asal.
    const legalEntity = v.bundle.items.find((e) => e.kind === 'legal_entity');
    const lei =
      legalEntity && legalEntity.kind === 'legal_entity' ? (legalEntity.lei ?? '') : '';

    const result = await issueAttestation({
      plotId: v.plot.id,
      plotGeohash: v.plot.geohash,
      evidenceHash: `0x${v.bundle.bundleHash}`,
      evidenceUri: v.bundle.blobUrl,
      verdict,
      confidence: v.assessment.confidence,
      evidenceAsOf: v.bundle.evidenceAsOf,
      reviewedBy: v.review.reviewedBy,
      legalEntityLEI: lei,
    });

    await saveAttestation({
      verificationId: id,
      uid: result.uid,
      txHash: result.txHash,
      attester: result.attester,
      schemaUid: result.schemaUid,
      verdict,
      confidence: v.assessment.confidence,
      evidenceHash: v.bundle.bundleHash,
      evidenceUri: v.bundle.blobUrl,
      evidenceAsOf: v.bundle.evidenceAsOf,
      attestedAt: result.attestedAt,
    });
    await setStatus(id, 'attested');

    const updated = await getVerification(id);
    if (!updated) return fail(500, `Verifikasi ${id} hilang setelah attestation tersimpan.`);
    return ok(updated, { status: 201 });
  });
}
