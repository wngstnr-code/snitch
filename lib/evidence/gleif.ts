/**
 * B2 — Verifikasi badan hukum lewat GLEIF (LEI). Tanpa API key.
 *
 * PERAN MODUL INI SEMPIT DAN DISENGAJA (CLAUDE.md §3.2, R17):
 * GLEIF dipakai untuk memverifikasi **operator/importir EU** — pihak yang
 * secara hukum wajib mengajukan DDS di bawah EUDR. BUKAN untuk memverifikasi
 * eksportir Malaysia; cakupannya di sana praktis nihil (2.256 entitas MY, nol
 * yang mengandung "PLANTATION"). Sisi eksportir diverifikasi lewat cross-check
 * RSPO dua dataset (§3.4c), bukan di sini.
 *
 * Terukur ulang 2026-08-03 dan itulah alasan `jurisdiction` WAJIB:
 *   "Sime Darby" tanpa yurisdiksi → entitas HK, AU, NZ. Dibatasi ke MY → 0.
 *   "FELDA"      tanpa yurisdiksi → Felda AG (Swiss).
 * Pada produk verifikasi, match lintas yurisdiksi bukan sekadar noise —
 * ia adalah jawaban yang salah dan terlihat meyakinkan.
 *
 * `filter[fulltext]` TIDAK dipakai: peringkatnya buruk (KLK → "Metso Minerals").
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { LegalEntityEvidence } from '../types';

export const GLEIF_API = 'https://api.gleif.org/api/v1/lei-records';

const REQUEST_TIMEOUT_MS = 15_000;
const RETRIES = 3;
const PAGE_SIZE = 25;

/**
 * Ambang kemiripan nama untuk dianggap `fuzzy`. Sengaja konservatif: lebih baik
 * melaporkan `none` ("tidak ketemu") daripada menempelkan entitas yang keliru.
 * "UNILEVER" vs "UNILEVER INSURANCES" = 0,67 → di bawah ambang → none.
 */
const FUZZY_THRESHOLD = 0.75;

/** Bentuk hukum yang dibuang saat normalisasi — bukan bagian identitas nama. */
const LEGAL_FORM_TOKENS = new Set([
  'PLC', 'LTD', 'LIMITED', 'LLC', 'LP', 'LLP', 'INC', 'CORP', 'CORPORATION',
  'NV', 'BV', 'CV', 'SE', 'SA', 'SAS', 'SARL', 'SPA', 'SRL', 'AG', 'GMBH', 'KG',
  'AB', 'AS', 'ASA', 'OY', 'OYJ', 'APS', 'PTE', 'PTY', 'BHD', 'BERHAD', 'SDN',
  'TBK', 'PT', 'CO', 'COMPANY',
]);

// ---------- validasi batas sistem (CLAUDE.md §9) ----------

const LeiRecord = z.object({
  id: z.string(),
  attributes: z.object({
    entity: z.object({
      legalName: z.object({ name: z.string() }),
      jurisdiction: z.string().nullable(),
      status: z.string().nullable(),
    }),
    registration: z.object({ status: z.string().nullable() }),
  }),
});

const LeiResponse = z.object({
  data: z.array(LeiRecord),
  meta: z
    .object({ pagination: z.object({ total: z.number() }).partial() })
    .partial()
    .optional(),
});

// ---------- pencocokan nama ----------

export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    // Titik dihapus, BUKAN diubah jadi spasi: "N.V." harus menjadi satu token
    // "NV" agar dikenali sebagai bentuk hukum, bukan dua token "N" dan "V".
    .replace(/\./g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 0 && !LEGAL_FORM_TOKENS.has(t))
    .join(' ');
}

/** Dice coefficient atas token. 1 = identik, 0 = tidak beririsan sama sekali. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

// ---------- pengambilan ----------

export interface GleifLookup {
  legalName: string;
  /** ISO 3166-1 alpha-2. WAJIB — lihat R17. */
  jurisdiction: string;
}

interface Candidate {
  lei: string;
  legalName: string;
  jurisdiction: string | null;
  entityStatus: string | null;
  registrationStatus: string | null;
  score: number;
}

function buildUrl({ legalName, jurisdiction }: GleifLookup): string {
  const params = new URLSearchParams({
    'filter[entity.legalName]': legalName,
    'filter[entity.jurisdiction]': jurisdiction,
    'page[size]': String(PAGE_SIZE),
  });
  return `${GLEIF_API}?${params.toString()}`;
}

/** Melempar setelah retry habis — jangan pernah menelan jadi "tidak ketemu" (R10). */
async function fetchRaw(url: string): Promise<string> {
  let lastError = '';
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/vnd.api+json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return await res.text();
      lastError = `HTTP ${res.status}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < RETRIES) await new Promise((r) => setTimeout(r, attempt * 750));
  }
  throw new Error(`GLEIF gagal dihubungi (${lastError}) setelah ${RETRIES} percobaan: ${url}`);
}

/**
 * Cari badan hukum di satu yurisdiksi.
 *
 * Selalu mengembalikan bukti — termasuk saat tidak ketemu (`matchQuality: 'none'`).
 * "Sudah dicek, tidak ada" adalah temuan, dan bedanya dengan "belum dicek" harus
 * terlihat di bundle.
 */
export async function lookupLegalEntity(q: GleifLookup): Promise<LegalEntityEvidence> {
  if (!/^[A-Z]{2}$/.test(q.jurisdiction)) {
    throw new Error(
      `jurisdiction wajib berupa kode ISO 3166-1 alpha-2 (mis. 'NL', 'DE'), diterima: ${JSON.stringify(q.jurisdiction)}. ` +
        `Pencarian tanpa yurisdiksi menghasilkan false positive lintas negara — "FELDA" cocok ke Felda AG (Swiss).`,
    );
  }
  if (q.legalName.trim().length === 0) {
    throw new Error('legalName kosong.');
  }

  const url = buildUrl(q);
  const fetchedAt = new Date().toISOString();
  const body = await fetchRaw(url);
  const rawHash = createHash('sha256').update(body).digest('hex');
  const parsed = LeiResponse.parse(JSON.parse(body));

  const candidates: Candidate[] = parsed.data
    .map((r) => ({
      lei: r.id,
      legalName: r.attributes.entity.legalName.name,
      jurisdiction: r.attributes.entity.jurisdiction,
      entityStatus: r.attributes.entity.status,
      registrationStatus: r.attributes.registration.status,
      score: nameSimilarity(q.legalName, r.attributes.entity.legalName.name),
    }))
    // Pertahanan berlapis: server sudah difilter, tapi jangan pernah percaya
    // satu lapis saja untuk hal yang kalau salah menghasilkan verdict keliru.
    .filter((c) => c.jurisdiction === q.jurisdiction)
    .sort((a, b) => b.score - a.score || a.lei.localeCompare(b.lei));

  const best = candidates[0];
  const matchQuality: LegalEntityEvidence['matchQuality'] =
    !best || best.score < FUZZY_THRESHOLD ? 'none' : best.score === 1 ? 'exact' : 'fuzzy';

  const matched = matchQuality === 'none' ? null : best;

  return {
    id: `legal_entity:${q.jurisdiction}:${normalizeName(q.legalName).replace(/ /g, '_')}:${rawHash.slice(0, 12)}`,
    kind: 'legal_entity',
    sourceUrl: url,
    fetchedAt,
    rawHash,
    lei: matched?.lei ?? null,
    legalName: matched?.legalName ?? null,
    // entityStatus dan registrationStatus adalah DUA hal berbeda dan tidak boleh
    // disatukan: UNILEVER N.V. ber-entity ACTIVE tapi registration LAPSED.
    entityStatus: matched?.entityStatus ?? null,
    registrationStatus: matched?.registrationStatus ?? null,
    jurisdiction: matched?.jurisdiction ?? null,
    matchQuality,
  };
}
