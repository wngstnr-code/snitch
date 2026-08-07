import type { Metadata } from 'next';
import type { Hex } from 'viem';
import { PublicVerify } from '@/components/public-verify';
import { readAttestation } from '@/lib/chain/read';
import { formatDateTime } from '@/lib/ui/format';

/** Bentuk UID EAS: 0x + 32 byte hex. Dipakai untuk menolak lookup chain sia-sia. */
const UID_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Metadata dihasilkan di server (bukan `'use client'`) supaya tautan yang
 * dibagikan ke importir EU menampilkan status attestation di preview
 * Telegram/X/WhatsApp tanpa menjalankan JS — dan supaya mesin pencari
 * benar-benar mengindeks isinya, bukan shell kosong.
 */
export async function generateMetadata(
  props: PageProps<'/v/[uid]'>,
): Promise<Metadata> {
  const { uid } = await props.params;

  if (!UID_RE.test(uid)) {
    return {
      title: 'Invalid attestation UID · SNITCH',
      description: 'This is not a valid EAS attestation UID.',
      robots: { index: false },
    };
  }

  try {
    const record = await readAttestation(uid as Hex);

    if (!record) {
      return {
        title: 'Attestation not found · SNITCH',
        description: `No attestation with UID ${uid} exists on this chain.`,
        robots: { index: false },
      };
    }

    const verdict = record.decoded?.verdict ?? 'UNKNOWN';

    if (record.revoked) {
      const title = 'REVOKED · SNITCH attestation';
      const description = `Verdict ${verdict}, revoked ${formatDateTime(record.revocationTime)}. This attestation self-revoked because newer satellite evidence contradicted it.`;
      return {
        title,
        description,
        openGraph: { title, description },
        twitter: { card: 'summary_large_image', title, description },
      };
    }

    const title = `ACTIVE · ${verdict} · SNITCH attestation`;
    const description = record.decoded
      ? `Issued ${formatDateTime(record.time)}, evidence valid as of ${formatDateTime(record.decoded.evidenceAsOf)}.`
      : `Issued ${formatDateTime(record.time)}. Not decodable as SNITCH schema data.`;
    return {
      title,
      description,
      openGraph: { title, description },
      twitter: { card: 'summary_large_image', title, description },
    };
  } catch {
    // Pembacaan chain gagal — ini KEGAGALAN, bukan "belum ada" dan bukan
    // "aktif". Menampilkannya seolah salah satu dari dua itu melanggar §0.
    const title = 'SNITCH attestation';
    const description =
      'Its status could not be read from the chain right now. This is a read failure, not a verdict — reload to try again.';
    return {
      title,
      description,
      openGraph: { title, description },
      twitter: { card: 'summary_large_image', title, description },
    };
  }
}

export default async function PublicVerifyPage(props: PageProps<'/v/[uid]'>) {
  const { uid } = await props.params;
  return <PublicVerify uid={uid} />;
}
