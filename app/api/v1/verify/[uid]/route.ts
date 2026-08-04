/**
 * GET /api/v1/verify/[uid] -> PublicVerifyResponse
 *
 * Verifikasi publik, tanpa akun. Ini permukaan yang paling penting dijaga
 * kejujurannya, karena inilah yang dipakai pihak ketiga untuk memutuskan
 * apakah sebuah attestation masih berlaku.
 *
 * ─── Tidak membaca DB kita sama sekali ───────────────────────────────────────
 * Status diambil langsung dari kontrak EAS, dan bundle bukti diunduh dari URL
 * yang tercatat DI DALAM attestation itu sendiri, lalu hash-nya dihitung ulang
 * dan diadu dengan `evidenceHash` yang di-anchor onchain. Artinya jawaban
 * endpoint ini tetap benar meskipun database kita salah, tertinggal, atau
 * dirusak — dan siapa pun bisa mengulangi langkah yang sama tanpa kita.
 */

import type { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { readAttestation } from '../../../../../lib/chain/read';
import { handle, messageOf, ok } from '../../../../../lib/api/respond';
import { getChainConfig } from '../../../../../lib/chain/config';
import type { Evidence, EvidenceBundle, PublicVerifyResponse } from '../../../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UID_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Mengunduh bundle dan MEMBUKTIKAN ia adalah berkas yang di-anchor.
 * Hash tidak cocok → bundle tidak dikembalikan sama sekali. Menampilkan bukti
 * yang tidak terbukti milik attestation ini lebih buruk daripada tidak
 * menampilkan apa-apa.
 */
async function fetchAndProveBundle(
  uri: string,
  expectedHash: string,
): Promise<{ bundle: EvidenceBundle | null; error: string | null }> {
  let res: Response;
  try {
    res = await fetch(uri, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    return { bundle: null, error: `Bundle bukti tidak bisa diunduh: ${messageOf(e)}` };
  }
  if (!res.ok) {
    return { bundle: null, error: `Bundle bukti tidak bisa diunduh: HTTP ${res.status} dari ${uri}` };
  }

  const text = await res.text();
  const actual = createHash('sha256').update(text).digest('hex');
  const expected = expectedHash.replace(/^0x/, '').toLowerCase();
  if (actual !== expected) {
    return {
      bundle: null,
      error:
        `Bundle di ${uri} TIDAK cocok dengan hash yang di-anchor onchain ` +
        `(onchain ${expected}, berkas ${actual}). Bukti tidak dapat dipercaya.`,
    };
  }

  let parsed: { evidenceAsOf: string; items: Evidence[] };
  try {
    parsed = JSON.parse(text) as { evidenceAsOf: string; items: Evidence[] };
  } catch (e) {
    return { bundle: null, error: `Bundle bukan JSON yang sah: ${messageOf(e)}` };
  }

  return {
    bundle: {
      bundleId: `bundle_${actual.slice(0, 16)}`,
      evidenceAsOf: parsed.evidenceAsOf,
      items: parsed.items,
      bundleHash: actual,
      blobUrl: uri,
    },
    error: null,
  };
}

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/v1/verify/[uid]'>,
): Promise<Response> {
  return handle(async () => {
    const { uid } = await ctx.params;

    if (!UID_RE.test(uid)) {
      const body: PublicVerifyResponse = {
        uid: uid as `0x${string}`,
        found: false,
        onchain: null,
        decoded: null,
        bundle: null,
        error: 'UID tidak berformat bytes32 (0x + 64 hex).',
      };
      return ok(body, { status: 400 });
    }

    const a = await readAttestation(uid as `0x${string}`);
    if (!a) {
      const body: PublicVerifyResponse = {
        uid: uid as `0x${string}`,
        found: false,
        onchain: null,
        decoded: null,
        bundle: null,
        error: `Tidak ada attestation ber-UID ini di chain ${getChainConfig().chainId}.`,
      };
      return ok(body, { status: 404 });
    }

    const { bundle, error } = a.decoded
      ? await fetchAndProveBundle(a.decoded.evidenceUri, a.decoded.evidenceHash)
      : { bundle: null, error: 'Data attestation tidak sesuai schema SNITCH — tidak bisa didekode.' };

    const body: PublicVerifyResponse = {
      uid: a.uid,
      found: true,
      onchain: {
        revoked: a.revoked,
        revocationTime: a.revocationTime,
        time: a.time,
        attester: a.attester,
        schemaUid: a.schemaUid,
        chainId: a.chainId,
        explorerUrl: a.explorerUrl,
        easscanUrl: a.easscanUrl,
      },
      decoded: a.decoded
        ? {
            plotId: a.decoded.plotId,
            plotGeohash: a.decoded.plotGeohash,
            evidenceHash: a.decoded.evidenceHash,
            evidenceUri: a.decoded.evidenceUri,
            verdict: a.decoded.verdict,
            confidence: a.decoded.confidence,
            evidenceAsOf: a.decoded.evidenceAsOf,
            reviewedBy: a.decoded.reviewedBy,
            legalEntityLEI: a.decoded.legalEntityLEI,
          }
        : null,
      bundle,
      error,
    };
    return ok(body);
  });
}
