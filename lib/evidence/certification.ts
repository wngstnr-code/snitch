/**
 * Bukti sertifikasi RSPO — cross-check dua dataset independen (CLAUDE.md §3.4c).
 *
 * ─── Kenapa ini bukti, bukan sekadar metadata petak ──────────────────────────
 * Sebelumnya klaim RSPO hanya dikirim ke agen sebagai konteks. Akibatnya agen
 * bisa MELIHAT ketidaksepakatan tapi tidak bisa MENYITIRNYA — validator sitasi
 * (R5) menolak finding tanpa `evidenceId`, jadi cross-check adversarial yang
 * justru salah satu nilai jual terkuat produk ini turun jadi catatan kaki di
 * summary. Dengan menjadikannya butir bukti ber-`id`, ia bisa disitir seperti
 * bukti lain, dan pembaca bisa melacaknya ke respons mentah kedua dataset.
 *
 * ─── Kenapa query per pabrik, bukan dataset penuh ────────────────────────────
 * Tiap bukti wajib membawa `rawHash` atas respons yang benar-benar dipakai
 * memutuskan (§9). Hash dari 2 MB dataset lengkap tidak membuktikan apa pun
 * tentang satu pabrik — dan akan berubah setiap kali pabrik lain yang tak ada
 * hubungannya ikut diperbarui.
 *
 * ─── Ketidaksepakatan, bukan vonis ───────────────────────────────────────────
 * `disagreement: true` hanya berarti dua sumber tidak sepakat. Ia TIDAK
 * menyatakan siapa yang benar — kita memang tidak tahu. Justru itu gunanya:
 * temuan yang muncul tanpa perlu mempercayai pihak mana pun.
 */

import { createHash } from 'node:crypto';
import {
  lookupUmlById,
  lookupUnileverNear,
  UML_URL,
  UNILEVER_MILLS_URL,
} from './mills';
import type { CertificationClaim, CertificationEvidence } from '../types';

export const UML_DATASET_NAME = 'Universal Mill List';
export const UNILEVER_DATASET_NAME = 'Unilever Palm Oil Mills';

export interface CertificationLookup {
  /** identifier pabrik universal, mis. 'PO1000000234' */
  umlId: string;
  /** dipakai mencocokkan sisi Unilever bila UML tidak ditemukan */
  fallbackName?: string;
  fallbackLat?: number;
  fallbackLon?: number;
}

/**
 * Mengambil klaim RSPO pabrik dari kedua dataset dan mengadu keduanya.
 *
 * Melempar bila UML_ID tidak ditemukan DAN tidak ada koordinat cadangan:
 * tanpa titik acuan, sisi Unilever tidak bisa dicari sama sekali, dan
 * mengembalikan "tidak ada klaim" akan terbaca seperti "tidak ada masalah".
 */
export async function buildCertificationEvidence(
  q: CertificationLookup,
): Promise<CertificationEvidence> {
  const uml = await lookupUmlById(q.umlId);

  const name = uml.mill?.name ?? q.fallbackName ?? null;
  const lat = uml.mill?.lat ?? q.fallbackLat ?? null;
  const lon = uml.mill?.lon ?? q.fallbackLon ?? null;

  if (name === null || lat === null || lon === null) {
    throw new Error(
      `Pabrik ${q.umlId} tidak ada di Universal Mill List dan tidak ada nama/koordinat cadangan — ` +
        'sisi Unilever tidak bisa dicocokkan, jadi bukti sertifikasi tidak dapat dirakit.',
    );
  }

  const unilever = await lookupUnileverNear(lat, lon, name);

  const claims: CertificationClaim[] = [
    {
      dataset: UML_DATASET_NAME,
      sourceUrl: uml.url,
      // Teks apa adanya dari dataset, bukan hasil tafsir kita.
      raw: uml.mill?.rspoStatus ?? null,
      certified: uml.mill?.rspoCertified ?? null,
    },
    {
      dataset: UNILEVER_DATASET_NAME,
      sourceUrl: unilever.url,
      raw:
        unilever.mill === null
          ? null
          : unilever.mill.rspoCertified === null
            ? null
            : unilever.mill.rspoCertified
              ? 'Yes'
              : 'No',
      certified: unilever.mill?.rspoCertified ?? null,
    },
  ];

  // Tegas di kedua sisi DAN berbeda. Satu sisi null = tidak diketahui, dan
  // "tidak diketahui" tidak pernah boleh dihitung sebagai pertentangan.
  const a = claims[0]!.certified;
  const b = claims[1]!.certified;
  const disagreement = a !== null && b !== null && a !== b;

  // Hash mencakup KEDUA respons mentah plus URL-nya: dua verifikasi yang
  // menanyakan pabrik berbeda tidak boleh berbagi hash yang sama.
  const rawHash = createHash('sha256')
    .update(
      JSON.stringify({
        umlUrl: uml.url,
        umlRaw: uml.raw,
        unileverUrl: unilever.url,
        unileverRaw: unilever.raw,
      }),
    )
    .digest('hex');

  return {
    id: `certification:RSPO:${q.umlId}:${rawHash.slice(0, 12)}`,
    kind: 'certification',
    // `sourceUrl` tunggal wajib ada di EvidenceBase; UML adalah sisi utama
    // karena identifier-nya stabil. URL kedua dataset tetap ada di `claims`.
    sourceUrl: uml.url,
    fetchedAt: uml.fetchedAt,
    rawHash,
    scheme: 'RSPO',
    millName: name,
    millUmlId: uml.mill?.umlId ?? null,
    supplyChainType: uml.mill?.rspoType ?? null,
    claims,
    disagreement,
    matchDistanceKm: unilever.distanceKm,
  };
}

/** Dataset yang diadu, untuk atribusi di UI. */
export const CERTIFICATION_SOURCES = [
  { name: UML_DATASET_NAME, url: UML_URL },
  { name: UNILEVER_DATASET_NAME, url: UNILEVER_MILLS_URL },
] as const;
