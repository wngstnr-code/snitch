/**
 * B6 — Job runner verifikasi.
 *
 * Merangkai empat modul yang sudah teruji sendiri-sendiri menjadi satu alur:
 * kumpulkan bukti (B1–B3) → rakit & anchor bundle (B4) → nilai dengan agen (B5)
 * → berhenti di `awaiting_review`.
 *
 * ─── Kenapa runner berhenti sebelum attestation ──────────────────────────────
 * Karena manusia yang memutuskan. Penerbitan onchain adalah langkah terpisah
 * (`POST /api/verifications/[id]/attest`) yang hanya bisa dipicu setelah ada
 * review. Kalau runner boleh menerbitkan sendiri, "human review" cuma hiasan UI.
 *
 * ─── Kegagalan tidak pernah ditelan ──────────────────────────────────────────
 * Setiap lemparan dari modul mana pun berakhir sebagai status `failed` plus
 * pesan aslinya di kolom `error`, yang ikut tampil di UI. Runner ini TIDAK
 * PERNAH melanjutkan dengan bukti separuh: "gagal memeriksa" ≠ "bersih", dan
 * pada produk kepatuhan tertukarnya dua hal itu berarti menerbitkan attestation
 * palsu (CLAUDE.md §9, R10).
 */

import {
  collectEvidence,
  prepareBundle,
  publishBundle,
  verifyPublishedBundle,
} from '../evidence/bundle';
import { assessBundle, type AssessContext } from '../agent/assess';
import {
  getVerificationRow,
  markFailed,
  rowToPlot,
  saveAssessment,
  saveBundle,
  saveEvidence,
  setStatus,
} from '../db/repo';
import { messageOf } from '../api/respond';
import type { PlotRow, VerificationRow } from '../db/schema';

export interface RunResult {
  verificationId: string;
  status: 'awaiting_review' | 'failed';
  error: string | null;
  evidenceCount: number;
  bundleHash: string | null;
  verdict: string | null;
  findings: number;
  /** true bila agen harus mengulang karena sitasi tak sah (R5) */
  agentRetried: boolean;
  durationS: number;
}

/**
 * Nama-nama yang discreening ke daftar sanksi.
 *
 * Induk perusahaan ikut discreening, bukan hanya operator langsung: struktur
 * kepemilikan sawit berlapis, dan pihak tersanksi lazimnya berada di atas
 * entitas operasional, bukan di entitas yang namanya tercetak di dokumen.
 */
function screenNamesFor(v: VerificationRow, p: PlotRow): string[] {
  const names = [p.operatorName, p.millParentCompany, v.euOperatorName];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const t = n?.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function euOperatorOf(
  v: VerificationRow,
): { legalName: string; jurisdiction: string } | undefined {
  if (!v.euOperatorName || !v.euOperatorJurisdiction) return undefined;
  return {
    legalName: v.euOperatorName,
    jurisdiction: v.euOperatorJurisdiction,
  };
}

/**
 * Pemicu cross-check sertifikasi. Koordinat seed dibawa sebagai cadangan supaya
 * sisi Unilever tetap bisa dicari kalau UML_ID-nya sudah hilang dari dataset
 * sejak seed terakhir — dataset publik memang berubah tanpa pemberitahuan.
 */
function millRefOf(p: PlotRow) {
  if (p.source !== 'mill_dataset' || !p.millUmlId) return undefined;
  return {
    umlId: p.millUmlId,
    fallbackName: p.name,
    fallbackLat: p.lat ?? undefined,
    fallbackLon: p.lon ?? undefined,
  };
}

/** Klaim sertifikasi dua dataset — hanya ada untuk plot dari dataset pabrik. */
function millClaimsOf(p: PlotRow): AssessContext['millClaims'] {
  if (p.source !== 'mill_dataset') return undefined;
  return {
    umlId: p.millUmlId,
    rspoStatusUml: p.millRspoStatusUml,
    rspoCertifiedUnilever: p.millRspoCertifiedUnilever,
    rspoType: p.millRspoType,
    parentCompany: p.millParentCompany,
  };
}

export async function runVerification(id: string): Promise<RunResult> {
  const started = Date.now();
  const base = {
    verificationId: id,
    evidenceCount: 0,
    bundleHash: null,
    verdict: null,
    findings: 0,
    agentRetried: false,
  };

  const row = await getVerificationRow(id);
  if (!row) throw new Error(`Verifikasi ${id} tidak ditemukan.`);

  const { verification: v, plot: p } = row;
  const evidenceAsOf = v.evidenceAsOf.toISOString();

  try {
    // 1. Kumpulkan bukti. Alert dipotong pada `evidenceAsOf` di dalam
    //    collectEvidence — batas bukti, bukan label (R4).
    await setStatus(id, 'collecting');
    const items = await collectEvidence({
      plot: rowToPlot(p),
      euOperator: euOperatorOf(v),
      screenNames: screenNamesFor(v, p),
      millRef: millRefOf(p),
      evidenceAsOf,
    });
    await saveEvidence(id, items);

    // 2. Rakit, unggah, dan simpan hash yang nanti di-anchor onchain.
    const bundle = await publishBundle(prepareBundle(items, evidenceAsOf));

    // Buktikan berkasnya benar-benar bisa diunduh dan hash-nya cocok SEBELUM
    // hash itu ditulis ke chain. Anchor bersifat permanen; kalau unggahan
    // rusak atau URL-nya tidak terjangkau publik, kita akan mengabadikan
    // janji yang tidak bisa ditepati siapa pun — dan verifikator pihak ketiga
    // yang menemukannya, bukan kita.
    if (!(await verifyPublishedBundle(bundle))) {
      throw new Error(
        `Bundle ${bundle.bundleId} diunggah tapi hash hasil unduh ulang tidak cocok ` +
          `(${bundle.blobUrl}). Menolak melanjutkan — hash ini akan di-anchor onchain.`,
      );
    }

    await saveBundle(id, bundle);

    // 3. Nilai. Agen hanya melihat bundle — tanpa akses jaringan (B5).
    await setStatus(id, 'assessing');
    const result = await assessBundle(bundle, {
      plot: rowToPlot(p),
      euOperator: euOperatorOf(v),
      millClaims: millClaimsOf(p),
    });
    await saveAssessment(id, result.assessment);

    // 4. Serahkan ke manusia. Runner berhenti di sini, selalu.
    await setStatus(id, 'awaiting_review');

    return {
      ...base,
      status: 'awaiting_review',
      error: null,
      evidenceCount: items.length,
      bundleHash: bundle.bundleHash,
      verdict: result.assessment.verdict,
      findings: result.assessment.findings.length,
      agentRetried: result.retried,
      durationS: (Date.now() - started) / 1000,
    };
  } catch (e) {
    const message = messageOf(e);
    await markFailed(id, message);
    return {
      ...base,
      status: 'failed',
      error: message,
      durationS: (Date.now() - started) / 1000,
    };
  }
}
