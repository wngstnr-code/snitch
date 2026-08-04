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
import {
  lookupAttestationTxHash,
  readAttestation,
} from '../../../../../lib/chain/read';
import { handle, messageOf, ok } from '../../../../../lib/api/respond';
import { getChainConfig, txExplorerUrl } from '../../../../../lib/chain/config';
import type { Evidence, EvidenceBundle, PublicVerifyResponse } from '../../../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UID_RE = /^0x[0-9a-fA-F]{64}$/;

/** Bundle terbesar yang pernah dirakit jauh di bawah ini (lihat MAX_BUNDLE_BYTES). */
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

/**
 * `evidenceUri` berasal dari data attestation, dan SIAPA PUN bisa menerbitkan
 * attestation pada schema publik kita. Artinya string ini adalah masukan tak
 * tepercaya yang menyuruh server kita melakukan permintaan HTTP — persis
 * bentuk SSRF. Tolak apa pun yang bukan https ke host publik.
 */
function assertFetchableUri(uri: string): void {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    throw new Error(`evidenceUri bukan URL yang sah: ${uri}`);
  }
  if (u.protocol !== 'https:') {
    throw new Error(`evidenceUri harus https, dapat: ${u.protocol}`);
  }
  if (isNonPublicHost(u.hostname)) {
    throw new Error(`evidenceUri menunjuk host non-publik: ${u.hostname}`);
  }
}

/**
 * Diekspor untuk diuji. Ini penyaring berbasis nama, bukan resolusi DNS —
 * ia tidak menangkap nama publik yang sengaja diarahkan ke alamat internal.
 * Perlindungan sesungguhnya adalah isolasi jaringan runtime; ini lapisan
 * murah yang menutup vektor yang paling gampang dipakai.
 */
export function isNonPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  // Literal IPv6 selalu ditulis dalam kurung siku di URL.
  if (host.startsWith('[')) return true;

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    return true;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;

  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // privat
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, termasuk metadata cloud
    (a === 172 && b >= 16 && b <= 31) || // privat
    (a === 192 && b === 168) // privat
  );
}

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
  try {
    assertFetchableUri(uri);
  } catch (e) {
    return { bundle: null, error: messageOf(e) };
  }

  let res: Response;
  try {
    res = await fetch(uri, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { bundle: null, error: `Bundle bukti tidak bisa diunduh: ${messageOf(e)}` };
  }
  if (!res.ok) {
    return { bundle: null, error: `Bundle bukti tidak bisa diunduh: HTTP ${res.status} dari ${uri}` };
  }

  // Batas ukuran ditegakkan dua kali: dari header kalau ada, dan dari byte yang
  // benar-benar terbaca kalau server berbohong atau tidak mengirim header.
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
    return {
      bundle: null,
      error: `Bundle terlalu besar (${declared} byte, batas ${MAX_DOWNLOAD_BYTES}).`,
    };
  }

  const text = await res.text();
  if (Buffer.byteLength(text) > MAX_DOWNLOAD_BYTES) {
    return {
      bundle: null,
      error: `Bundle melampaui batas ${MAX_DOWNLOAD_BYTES} byte setelah diunduh.`,
    };
  }
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

    const [proof, txHash] = await Promise.all([
      a.decoded
        ? fetchAndProveBundle(a.decoded.evidenceUri, a.decoded.evidenceHash)
        : Promise.resolve({
            bundle: null,
            error: 'Data attestation tidak sesuai schema SNITCH — tidak bisa didekode.',
          }),
      // Best-effort: kontrak tidak menyimpan tx hash. Kalau indexer tidak
      // menjawab, tautan jatuh ke halaman easscan attestation ini — halaman
      // nyata untuk UID ini, bukan tautan karangan.
      lookupAttestationTxHash(a.uid),
    ]);
    const { bundle, error } = proof;

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
        explorerUrl: txHash ? txExplorerUrl(txHash) : a.easscanUrl,
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
