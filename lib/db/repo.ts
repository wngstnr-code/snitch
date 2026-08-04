/**
 * Repository — satu-satunya tempat baris DB diterjemahkan menjadi bentuk API
 * (`lib/types.ts`) dan sebaliknya.
 *
 * Kenapa dipusatkan: `Verification` adalah gabungan lima tabel. Kalau perakitan
 * itu tersebar di tiap route handler, dua endpoint akan pelan-pelan menjawab
 * bentuk yang berbeda untuk entitas yang sama — dan Dev A yang menanggungnya.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './index';
import {
  attestations,
  evidenceItems,
  plots,
  reviewLog,
  verifications,
  watchRuns,
  type AttestationRow,
  type PlotRow,
  type VerificationRow,
} from './schema';
import { attestationUrl, getChainConfig, txExplorerUrl } from '../chain/config';
import type {
  AgentAssessment,
  AttestationRef,
  Evidence,
  EvidenceBundle,
  HumanReview,
  Plot,
  Verdict,
  Verification,
  VerificationStatus,
} from '../types';

// ---------- helper ----------

const iso = (d: Date): string => d.toISOString();

/**
 * ID yang enak dibaca di layar dan tetap tak bertabrakan. `randomUUID` sudah
 * cukup, tapi prefiks membuat log dan URL demo bisa dibaca sekilas.
 */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

// ---------- plots ----------

export function rowToPlot(r: PlotRow): Plot {
  return {
    id: r.id,
    name: r.name,
    geojson: r.geojson,
    geohash: r.geohash,
    areaHa: r.areaHa,
    operatorName: r.operatorName,
    source: r.source,
  };
}

export async function getPlot(id: string): Promise<PlotRow | null> {
  const rows = await db.select().from(plots).where(eq(plots.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Upsert supaya plot hasil upload bisa dikirim ulang tanpa menggandakan baris. */
export async function upsertPlot(p: Plot): Promise<PlotRow> {
  const values = {
    id: p.id,
    name: p.name,
    geojson: p.geojson,
    geohash: p.geohash,
    areaHa: p.areaHa,
    operatorName: p.operatorName,
    source: p.source,
  };
  const rows = await db
    .insert(plots)
    .values(values)
    .onConflictDoUpdate({
      target: plots.id,
      set: {
        name: values.name,
        geojson: values.geojson,
        geohash: values.geohash,
        areaHa: values.areaHa,
        operatorName: values.operatorName,
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error(`Gagal menyimpan plot ${p.id}.`);
  return row;
}

export interface MillFilter {
  /** [minLon, minLat, maxLon, maxLat] */
  bbox?: [number, number, number, number];
  limit?: number;
}

/**
 * Pabrik untuk peta. Difilter di DB pada kolom `lat`/`lon` (titik pabrik),
 * bukan pada polygon radius sourcing — memfilter lingkaran 50 km berarti
 * pabrik di luar layar ikut terbawa hanya karena radiusnya menyenggol bbox.
 */
export async function listMills(f: MillFilter = {}): Promise<PlotRow[]> {
  const limit = f.limit ?? 2000;
  const where = f.bbox
    ? and(
        eq(plots.source, 'mill_dataset'),
        sql`${plots.lon} between ${f.bbox[0]} and ${f.bbox[2]}`,
        sql`${plots.lat} between ${f.bbox[1]} and ${f.bbox[3]}`,
      )
    : eq(plots.source, 'mill_dataset');

  return db.select().from(plots).where(where).limit(limit);
}

// ---------- verifications ----------

export async function createVerification(input: {
  plot: Plot;
  evidenceAsOf: string;
  euOperator?: { legalName: string; jurisdiction: string };
}): Promise<string> {
  await upsertPlot(input.plot);
  const id = newId('ver');
  await db.insert(verifications).values({
    id,
    plotId: input.plot.id,
    status: 'pending',
    evidenceAsOf: new Date(input.evidenceAsOf),
    euOperatorName: input.euOperator?.legalName ?? null,
    euOperatorJurisdiction: input.euOperator?.jurisdiction ?? null,
  });
  return id;
}

/** Baris mentah + plot-nya — yang dibutuhkan job runner, bukan bentuk API. */
export async function getVerificationRow(
  id: string,
): Promise<{ verification: VerificationRow; plot: PlotRow } | null> {
  const rows = await db
    .select({ v: verifications, p: plots })
    .from(verifications)
    .innerJoin(plots, eq(verifications.plotId, plots.id))
    .where(eq(verifications.id, id))
    .limit(1);
  const row = rows[0];
  return row ? { verification: row.v, plot: row.p } : null;
}

export async function setStatus(
  id: string,
  status: VerificationStatus,
  error: string | null = null,
): Promise<void> {
  await db
    .update(verifications)
    .set({ status, error, updatedAt: new Date() })
    .where(eq(verifications.id, id));
}

/**
 * Kegagalan disimpan sebagai status + pesan, bukan dibuang. R10: "gagal
 * memeriksa" harus terlihat di UI, karena ia tidak sama dengan "bersih".
 */
export async function markFailed(id: string, error: string): Promise<void> {
  await setStatus(id, 'failed', error);
}

export async function saveEvidence(
  verificationId: string,
  items: readonly Evidence[],
): Promise<void> {
  if (items.length === 0) return;
  await db
    .insert(evidenceItems)
    .values(
      items.map((e) => ({
        id: e.id,
        verificationId,
        kind: e.kind,
        sourceUrl: e.sourceUrl,
        fetchedAt: new Date(e.fetchedAt),
        rawHash: e.rawHash,
        payload: e,
      })),
    )
    // Kunci majemuk: bukti yang sama boleh muncul di banyak verifikasi.
    .onConflictDoNothing({
      target: [evidenceItems.verificationId, evidenceItems.id],
    });
}

export async function saveBundle(
  verificationId: string,
  bundle: EvidenceBundle,
): Promise<void> {
  await db
    .update(verifications)
    .set({
      bundleId: bundle.bundleId,
      bundleHash: bundle.bundleHash,
      bundleBlobUrl: bundle.blobUrl,
      updatedAt: new Date(),
    })
    .where(eq(verifications.id, verificationId));
}

export async function saveAssessment(
  verificationId: string,
  assessment: AgentAssessment,
): Promise<void> {
  await db
    .update(verifications)
    .set({ assessment, updatedAt: new Date() })
    .where(eq(verifications.id, verificationId));
}

/**
 * Review disimpan dua kali dengan sengaja: kolom `review` adalah keadaan
 * sekarang, `review_log` adalah jejak audit yang tidak pernah ditimpa. Pada
 * produk kepatuhan, "siapa memutuskan apa, kapan" tidak boleh bisa hilang
 * karena seseorang mengubah keputusannya.
 */
export async function saveReview(
  verificationId: string,
  review: HumanReview,
): Promise<void> {
  await db.insert(reviewLog).values({
    id: newId('rev'),
    verificationId,
    decision: review.decision,
    overrideVerdict: review.overrideVerdict ?? null,
    reason: review.reason,
    reviewedBy: review.reviewedBy,
    reviewedAt: new Date(review.reviewedAt),
  });
  await db
    .update(verifications)
    .set({ review, updatedAt: new Date() })
    .where(eq(verifications.id, verificationId));
}

// ---------- attestations ----------

export function rowToAttestationRef(r: AttestationRow): AttestationRef {
  return {
    uid: r.uid as `0x${string}`,
    txHash: r.txHash as `0x${string}`,
    chainId: r.chainId,
    schemaUid: r.schemaUid as `0x${string}`,
    attestedAt: iso(r.attestedAt),
    revoked: r.revoked,
    revokedAt: r.revokedAt ? iso(r.revokedAt) : null,
    revokeTxHash: (r.revokeTxHash as `0x${string}` | null) ?? null,
    revokeReason: r.revokeReason,
    explorerUrl: txExplorerUrl(r.txHash),
    easscanUrl: attestationUrl(r.uid),
  };
}

export async function saveAttestation(input: {
  verificationId: string;
  uid: string;
  txHash: string;
  attester: string;
  schemaUid: string;
  verdict: Verdict;
  confidence: number;
  evidenceHash: string;
  evidenceUri: string;
  evidenceAsOf: string;
  attestedAt: string;
}): Promise<void> {
  await db.insert(attestations).values({
    uid: input.uid,
    verificationId: input.verificationId,
    chainId: getChainConfig().chainId,
    schemaUid: input.schemaUid,
    txHash: input.txHash,
    attester: input.attester,
    verdict: input.verdict,
    confidence: input.confidence,
    evidenceHash: input.evidenceHash,
    evidenceUri: input.evidenceUri,
    evidenceAsOf: new Date(input.evidenceAsOf),
    attestedAt: new Date(input.attestedAt),
  });
}

export async function markRevoked(input: {
  uid: string;
  revokeTxHash: string;
  revokedAt: string;
  reason: string;
}): Promise<void> {
  await db
    .update(attestations)
    .set({
      revoked: true,
      revokeTxHash: input.revokeTxHash,
      revokedAt: new Date(input.revokedAt),
      revokeReason: input.reason,
      lastCheckedAt: new Date(),
    })
    .where(eq(attestations.uid, input.uid));
}

export async function touchChecked(uid: string): Promise<void> {
  await db
    .update(attestations)
    .set({ lastCheckedAt: new Date() })
    .where(eq(attestations.uid, uid));
}

export interface WatchTarget {
  attestation: AttestationRow;
  verification: VerificationRow;
  plot: PlotRow;
}

/** Attestation yang masih hidup — inilah yang diperiksa ulang watcher (B9). */
export async function listActiveAttestations(): Promise<WatchTarget[]> {
  const rows = await db
    .select({ a: attestations, v: verifications, p: plots })
    .from(attestations)
    .innerJoin(verifications, eq(attestations.verificationId, verifications.id))
    .innerJoin(plots, eq(verifications.plotId, plots.id))
    .where(eq(attestations.revoked, false));

  return rows.map((r) => ({ attestation: r.a, verification: r.v, plot: r.p }));
}

export async function getAttestationByUid(
  uid: string,
): Promise<AttestationRow | null> {
  const rows = await db
    .select()
    .from(attestations)
    .where(eq(attestations.uid, uid))
    .limit(1);
  return rows[0] ?? null;
}

// ---------- perakitan Verification ----------

async function bundleFor(
  v: VerificationRow,
  items: Evidence[],
): Promise<EvidenceBundle | null> {
  if (!v.bundleId || !v.bundleHash || !v.bundleBlobUrl) return null;
  return {
    bundleId: v.bundleId,
    evidenceAsOf: iso(v.evidenceAsOf),
    items,
    bundleHash: v.bundleHash,
    blobUrl: v.bundleBlobUrl,
  };
}

function assemble(
  v: VerificationRow,
  p: PlotRow,
  items: Evidence[],
  att: AttestationRow | null,
  bundle: EvidenceBundle | null,
): Verification {
  return {
    id: v.id,
    status: v.status,
    plot: rowToPlot(p),
    bundle,
    assessment: v.assessment ?? null,
    review: v.review ?? null,
    attestation: att ? rowToAttestationRef(att) : null,
    error: v.error,
    createdAt: iso(v.createdAt),
  };
}

export async function getVerification(id: string): Promise<Verification | null> {
  const rows = await db
    .select({ v: verifications, p: plots })
    .from(verifications)
    .innerJoin(plots, eq(verifications.plotId, plots.id))
    .where(eq(verifications.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const evRows = await db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.verificationId, id));
  const items = evRows.map((e) => e.payload as Evidence);

  const attRows = await db
    .select()
    .from(attestations)
    .where(eq(attestations.verificationId, id))
    .orderBy(desc(attestations.attestedAt))
    .limit(1);

  return assemble(
    row.v,
    row.p,
    items,
    attRows[0] ?? null,
    await bundleFor(row.v, items),
  );
}

export async function getVerificationByUid(
  uid: string,
): Promise<Verification | null> {
  const att = await getAttestationByUid(uid);
  if (!att) return null;
  return getVerification(att.verificationId);
}

/**
 * Daftar untuk tabel di UI. Bukti sengaja TIDAK dimuat di sini: satu petak bisa
 * membawa ribuan alert, dan halaman daftar tidak menampilkannya. Detail
 * lengkapnya diambil per-item lewat `getVerification`.
 */
export async function listVerifications(limit = 100): Promise<Verification[]> {
  const rows = await db
    .select({ v: verifications, p: plots })
    .from(verifications)
    .innerJoin(plots, eq(verifications.plotId, plots.id))
    .orderBy(desc(verifications.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.v.id);
  const attRows = await db
    .select()
    .from(attestations)
    .where(inArray(attestations.verificationId, ids));
  const attByVer = new Map(attRows.map((a) => [a.verificationId, a]));

  return rows.map((r) =>
    assemble(r.v, r.p, [], attByVer.get(r.v.id) ?? null, null),
  );
}

// ---------- watch runs ----------

export async function startWatchRun(
  trigger: 'cron' | 'manual',
): Promise<{ id: string; startedAt: Date }> {
  const id = newId('watch');
  const startedAt = new Date();
  await db.insert(watchRuns).values({ id, startedAt, trigger });
  return { id, startedAt };
}

export async function finishWatchRun(input: {
  id: string;
  startedAt: Date;
  checked: number;
  revokedCount: number;
  errorCount: number;
}): Promise<void> {
  const finishedAt = new Date();
  await db
    .update(watchRuns)
    .set({
      finishedAt,
      checked: input.checked,
      revokedCount: input.revokedCount,
      errorCount: input.errorCount,
      durationS: (finishedAt.getTime() - input.startedAt.getTime()) / 1000,
    })
    .where(eq(watchRuns.id, input.id));
}
