/**
 * B3 — Screening sanksi terhadap dua daftar resmi.
 *
 *   OFAC SDN (US Treasury)  — CSV tanpa header, wajib follow redirect ke S3
 *   EU Consolidated (EC)    — CSV 118 kolom, dipisah titik koma
 *
 * Keduanya publik, tanpa pendaftaran. Diunduh berkala oleh
 * `scripts/sync-sanctions.ts`, disimpan ke Postgres, lalu dicocokkan lokal.
 *
 * Dua aturan yang tidak boleh dilanggar di modul ini:
 *
 * 1. **Daftar yang belum tersinkron atau basi = MELEMPAR**, bukan "nol match".
 *    Ini bahaya paling halus di seluruh produk: layar yang menulis "tidak ada
 *    sanksi" padahal yang terjadi adalah "belum pernah dicek" (R10).
 * 2. **Ambang sanksi lebih longgar daripada GLEIF** (0,6 vs 0,75). Arah
 *    kesalahannya sengaja dibalik: melewatkan pihak tersanksi adalah kegagalan
 *    kepatuhan, sedangkan kelebihan kandidat hanya menambah kerja reviewer
 *    manusia — dan review manusia memang bagian dari alurnya (F6).
 */

import { createHash } from 'node:crypto';
import { and, eq, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import { sanctionsEntries } from '../db/schema';
import type { SanctionsEvidence } from '../types';
import { nameSimilarity, nameTokens, normalizeName } from './names';

export const OFAC_SDN_URL =
  'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV';
export const EU_CONSOLIDATED_URL =
  'https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw';

export type SanctionsListId = 'OFAC_SDN' | 'EU_CONSOLIDATED';

/** Di bawah ambang ini kandidat dibuang. Lihat catatan (2) di atas. */
export const MATCH_THRESHOLD = 0.6;

/** Daftar yang lebih tua dari ini dianggap tidak layak dipakai memutuskan. */
export const MAX_LIST_AGE_DAYS = 30;

const DOWNLOAD_TIMEOUT_MS = 120_000;

// ---------- parser CSV (nol dependensi) ----------

/**
 * Parser CSV yang menangani tanda kutip, kutip ganda sebagai escape, dan CRLF.
 * Ditulis sendiri karena kedua berkas memakai pemisah berbeda (`,` dan `;`)
 * dan menambah dependensi berarti menambah permukaan risiko tanpa imbalan.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Buang BOM — berkas EU mengawali dengan U+FEFF.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------- unduhan ----------

export interface SanctionsEntryInput {
  entryId: string;
  name: string;
  nameNormalized: string;
  entityType: string | null;
  programs: string | null;
  country: string | null;
}

export interface SanctionsSnapshot {
  list: SanctionsListId;
  /** Tanggal publikasi daftar menurut sumbernya sendiri — bukan tanggal unduh. */
  listDate: string;
  sourceUrl: string;
  fetchedAt: string;
  rawHash: string;
  entries: SanctionsEntryInput[];
}

async function download(url: string): Promise<{ text: string; finalUrl: string }> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Unduhan gagal: ${url} → HTTP ${res.status}`);
  return { text: await res.text(), finalUrl: res.url };
}

/** OFAC memakai literal `-0- ` untuk nilai kosong. */
function ofacValue(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' || t === '-0-' ? null : t;
}

/**
 * OFAC SDN. Berkas CSV-nya tanpa header dan tanpa tanggal publikasi di dalamnya;
 * tanggal itu ada di path publikasi resmi tempat redirect bermuara
 * (…/Published/<uuid>/2026-07-29/…). Kalau tidak bisa dibaca → melempar.
 * Bukti tanpa tanggal daftar tidak bisa dipertanggungjawabkan.
 */
export async function fetchOfacSdn(): Promise<SanctionsSnapshot> {
  const fetchedAt = new Date().toISOString();
  const { text, finalUrl } = await download(OFAC_SDN_URL);
  const m = /\/(\d{4}-\d{2}-\d{2})\//.exec(finalUrl);
  if (!m) {
    throw new Error(
      `Tanggal publikasi OFAC tidak terbaca dari URL akhir: ${finalUrl}. ` +
        `Jangan menebak tanggal daftar sanksi.`,
    );
  }
  const entries: SanctionsEntryInput[] = [];
  for (const cols of parseDelimited(text, ',')) {
    if (cols.length < 4) continue;
    const entryId = (cols[0] ?? '').trim();
    const name = ofacValue(cols[1]);
    if (!entryId || !name) continue;
    entries.push({
      entryId,
      name,
      nameNormalized: normalizeName(name),
      entityType: ofacValue(cols[2]) ?? 'entity',
      programs: ofacValue(cols[3]),
      country: ofacValue(cols[9]),
    });
  }
  if (entries.length === 0) throw new Error('OFAC SDN terunduh tapi nol entri terparse.');

  return {
    list: 'OFAC_SDN',
    listDate: m[1],
    sourceUrl: OFAC_SDN_URL,
    fetchedAt,
    rawHash: createHash('sha256').update(text).digest('hex'),
    entries,
  };
}

/** Indeks kolom EU (1-based di dokumentasi, 0-based di sini) — 118 kolom. */
const EU_COL = {
  fileGenerationDate: 0,
  referenceNumber: 2,
  subjectType: 7,
  programme: 14,
  wholeName: 19,
  aliasLogicalId: 24,
  countryIso2: 42,
} as const;

export async function fetchEuConsolidated(): Promise<SanctionsSnapshot> {
  const fetchedAt = new Date().toISOString();
  const { text } = await download(EU_CONSOLIDATED_URL);
  const rows = parseDelimited(text, ';');
  if (rows.length < 2) throw new Error('Daftar EU terunduh tapi kosong.');

  // dd/MM/yyyy pada kolom pertama tiap baris data.
  const rawDate = (rows[1][EU_COL.fileGenerationDate] ?? '').trim();
  const dm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(rawDate);
  if (!dm) throw new Error(`fileGenerationDate EU tak terbaca: ${JSON.stringify(rawDate)}`);
  const listDate = `${dm[3]}-${dm[2]}-${dm[1]}`;

  const seen = new Set<string>();
  const entries: SanctionsEntryInput[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (cols.length < 25) continue;
    const name = (cols[EU_COL.wholeName] ?? '').trim();
    if (!name) continue;
    const ref = (cols[EU_COL.referenceNumber] ?? '').trim();
    const aliasId = (cols[EU_COL.aliasLogicalId] ?? '').trim();
    const entryId = `${ref}:${aliasId}`;
    if (seen.has(entryId)) continue;
    seen.add(entryId);
    entries.push({
      entryId,
      name,
      nameNormalized: normalizeName(name),
      // E = entity, P = person
      entityType: (cols[EU_COL.subjectType] ?? '').trim() === 'P' ? 'individual' : 'entity',
      programs: (cols[EU_COL.programme] ?? '').trim() || null,
      country: (cols[EU_COL.countryIso2] ?? '').trim() || null,
    });
  }
  if (entries.length === 0) throw new Error('Daftar EU terunduh tapi nol entri terparse.');

  return {
    list: 'EU_CONSOLIDATED',
    listDate,
    sourceUrl: EU_CONSOLIDATED_URL,
    fetchedAt,
    rawHash: createHash('sha256').update(text).digest('hex'),
    entries,
  };
}

// ---------- penyimpanan ----------

const INSERT_BATCH = 500;

/** Tulis snapshot ke DB, mengganti isi daftar yang sama secara utuh. */
export async function storeSnapshot(snapshot: SanctionsSnapshot): Promise<number> {
  await db.delete(sanctionsEntries).where(eq(sanctionsEntries.list, snapshot.list));

  const listDate = new Date(`${snapshot.listDate}T00:00:00Z`);
  const fetchedAt = new Date(snapshot.fetchedAt);

  for (let i = 0; i < snapshot.entries.length; i += INSERT_BATCH) {
    const batch = snapshot.entries.slice(i, i + INSERT_BATCH).map((e) => ({
      id: `${snapshot.list}:${e.entryId}`,
      list: snapshot.list,
      entryId: e.entryId,
      name: e.name,
      nameNormalized: e.nameNormalized,
      entityType: e.entityType,
      programs: e.programs,
      country: e.country,
      listDate,
      sourceUrl: snapshot.sourceUrl,
      fetchedAt,
      rawHash: snapshot.rawHash,
    }));
    await db.insert(sanctionsEntries).values(batch).onConflictDoNothing();
  }
  return snapshot.entries.length;
}

// ---------- screening ----------

export interface ListStatus {
  list: SanctionsListId;
  listDate: string;
  sourceUrl: string;
  fetchedAt: string;
  rawHash: string;
  entryCount: number;
}

const ALL_LISTS: readonly SanctionsListId[] = ['OFAC_SDN', 'EU_CONSOLIDATED'];

async function listStatus(list: SanctionsListId): Promise<ListStatus> {
  const rows = await db
    .select()
    .from(sanctionsEntries)
    .where(eq(sanctionsEntries.list, list))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(
      `Daftar ${list} belum ada di database. Jalankan \`npm run sanctions:sync\` dulu. ` +
        `Screening terhadap daftar kosong akan terbaca "bersih" padahal artinya "belum dicek".`,
    );
  }
  const ageDays = (Date.now() - row.fetchedAt.getTime()) / 86_400_000;
  if (ageDays > MAX_LIST_AGE_DAYS) {
    throw new Error(
      `Daftar ${list} terakhir diunduh ${Math.floor(ageDays)} hari lalu (batas ${MAX_LIST_AGE_DAYS}). ` +
        `Sinkronkan ulang sebelum memutuskan apa pun.`,
    );
  }
  return {
    list,
    listDate: row.listDate.toISOString().slice(0, 10),
    sourceUrl: row.sourceUrl,
    fetchedAt: row.fetchedAt.toISOString(),
    rawHash: row.rawHash,
    entryCount: 0,
  };
}

/**
 * Screening satu nama terhadap kedua daftar.
 *
 * Mengembalikan SATU bukti PER DAFTAR — bukan satu bukti gabungan. Dengan begitu
 * tiap bukti membawa `sourceUrl` dan `rawHash` daftarnya sendiri, dan agen bisa
 * menyitir daftar mana yang cocok tanpa ambiguitas.
 */
export async function screenEntity(name: string): Promise<SanctionsEvidence[]> {
  const tokens = nameTokens(name);
  if (tokens.length === 0) {
    throw new Error(`Nama tidak bisa dinormalkan menjadi token: ${JSON.stringify(name)}`);
  }

  // Prefilter di SQL supaya tidak menarik puluhan ribu baris; skor sebenarnya
  // dihitung di sini dengan fungsi yang sama seperti B2.
  const probes = tokens.filter((t) => t.length >= 4).slice(0, 6);
  const searchTokens = probes.length > 0 ? probes : tokens;

  const out: SanctionsEvidence[] = [];
  for (const list of ALL_LISTS) {
    const status = await listStatus(list);
    const rows = await db
      .select()
      .from(sanctionsEntries)
      .where(
        and(
          eq(sanctionsEntries.list, list),
          or(...searchTokens.map((t) => ilike(sanctionsEntries.nameNormalized, `%${t}%`))),
        ),
      )
      .limit(2_000);

    const matches = rows
      .map((r) => ({
        name: r.name,
        list,
        score: Number(nameSimilarity(name, r.name).toFixed(3)),
        entryId: r.entryId,
      }))
      .filter((m) => m.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score || a.entryId.localeCompare(b.entryId))
      .slice(0, 25);

    out.push({
      id: `sanctions:${list}:${status.listDate}:${normalizeName(name).replace(/ /g, '_')}`,
      kind: 'sanctions',
      sourceUrl: status.sourceUrl,
      fetchedAt: status.fetchedAt,
      // Hash berkas daftar yang benar-benar dipakai memutuskan — bukan hash
      // hasil pencarian. Ini yang membuat screening bisa diaudit ulang.
      rawHash: status.rawHash,
      lists: [{ list, listDate: status.listDate }],
      matches,
    });
  }
  return out;
}
