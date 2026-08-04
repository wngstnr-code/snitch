/**
 * B4 — Perakit bundle bukti.
 *
 * Mengumpulkan ketiga jenis bukti, memotongnya pada batas `evidenceAsOf`,
 * menghitung sha256 yang di-anchor onchain, lalu mengunggahnya ke Vercel Blob
 * supaya siapa pun bisa mengunduh dan menghitung ulang hash yang sama.
 *
 * ─── `evidenceAsOf` bukan label, melainkan BATAS BUKTI (R4) ──────────────────
 * Ia parameter, tidak pernah `now()`. Alert yang lebih baru dari batas itu
 * DIBUANG dari bundle — bukan karena kita menyembunyikannya, tapi karena bukti
 * itu memang belum diketahui pada saat tersebut. Justru itulah yang membuat
 * demo revocation jujur: attestation terbit atas keadaan per 2026-06-01, lalu
 * watcher menjalankan pemeriksaan yang sama dengan data hari ini, menemukan
 * alert yang sungguh-sungguh baru, dan mencabut attestation-nya. Seluruh data
 * asli; hanya jendela waktunya yang dipilih.
 *
 * Kalau satu sumber gagal, SELURUH perakitan gagal (R10). Bundle setengah jadi
 * yang terlihat lengkap lebih berbahaya daripada tidak ada bundle sama sekali.
 */

import { createHash } from 'node:crypto';
import { put } from '@vercel/blob';
import type {
  DeforestationAlert,
  Evidence,
  EvidenceBundle,
  Plot,
} from '../types';
import {
  buildDeforestationEvidence,
  collectAlerts,
  type CollectResult,
  type Geometry,
} from './gfw';
import { buildCertificationEvidence } from './certification';
import { lookupLegalEntity } from './gleif';
import { screenEntity } from './sanctions';

/** Batas aman ukuran bundle sebelum diunggah. */
const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;

export interface EuOperator {
  legalName: string;
  /** ISO 3166-1 alpha-2 — wajib, lihat R17. */
  jurisdiction: string;
}

export interface CollectEvidenceInput {
  plot: Plot;
  /**
   * Operator/importir EU yang wajib mengajukan DDS. Opsional: kalau tidak
   * diketahui, bukti `legal_entity` TIDAK dibuat sama sekali — dan karena agen
   * hanya boleh menyitir bukti yang ada, ketiadaannya otomatis berarti
   * "belum terverifikasi", bukan "lolos".
   */
  euOperator?: EuOperator;
  /** Nama-nama yang discreening ke daftar sanksi (operator, induk perusahaan). */
  screenNames: string[];
  /**
   * Pabrik dari dataset (§3.4c) — memicu cross-check sertifikasi RSPO antara
   * dua dataset independen. Tidak diisi untuk petak hasil upload: pabrik punya
   * klaim sertifikasi, petak lahan tidak.
   */
  millRef?: {
    umlId: string;
    fallbackName?: string;
    fallbackLat?: number;
    fallbackLon?: number;
  };
  /** ISO. WAJIB — batas bukti, bukan `now()`. */
  evidenceAsOf: string;
}

function assertIsoDate(value: string, field: string): void {
  const t = Date.parse(value);
  if (Number.isNaN(t)) {
    throw new Error(`${field} bukan tanggal ISO yang sah: ${JSON.stringify(value)}`);
  }
}

/** Buang alert yang terjadi setelah batas bukti. */
export function clipAlertsTo(alerts: readonly DeforestationAlert[], asOf: string): DeforestationAlert[] {
  const limit = Date.parse(asOf);
  return alerts.filter((a) => Date.parse(a.date) <= limit);
}

export async function collectEvidence(input: CollectEvidenceInput): Promise<Evidence[]> {
  assertIsoDate(input.evidenceAsOf, 'evidenceAsOf');
  if (input.screenNames.length === 0) {
    throw new Error('screenNames kosong — tidak ada entitas yang discreening ke daftar sanksi.');
  }

  const geom = input.plot.geojson as Geometry;
  const items: Evidence[] = [];

  // 1. Deforestasi — dipotong pada batas bukti.
  const raw: CollectResult = await collectAlerts(geom);
  const clipped: CollectResult = {
    ...raw,
    alerts: clipAlertsTo(raw.alerts, input.evidenceAsOf),
  };
  items.push(buildDeforestationEvidence(geom, clipped, input.evidenceAsOf));

  // 2. Badan hukum operator EU (kalau diketahui).
  if (input.euOperator) {
    items.push(await lookupLegalEntity(input.euOperator));
  }

  // 3. Sanksi — satu bukti per daftar, per nama.
  for (const name of input.screenNames) {
    items.push(...(await screenEntity(name)));
  }

  // 4. Sertifikasi — dua dataset independen diadu (§3.4c). Sengaja butir bukti
  //    tersendiri supaya ketidaksepakatannya bisa DISITIR agen, bukan sekadar
  //    dilihat.
  if (input.millRef) {
    items.push(await buildCertificationEvidence(input.millRef));
  }

  return items;
}

/**
 * Bentuk kanonik yang di-hash. `blobUrl` sengaja TIDAK ikut — ia baru ada
 * setelah unggahan, dan hash harus bisa dihitung ulang dari isi bundle saja.
 */
function canonicalPayload(items: readonly Evidence[], evidenceAsOf: string): string {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ evidenceAsOf, items: sorted });
}

export interface PreparedBundle {
  bundleId: string;
  bundleHash: string;
  evidenceAsOf: string;
  items: Evidence[];
  payload: string;
}

export function prepareBundle(items: readonly Evidence[], evidenceAsOf: string): PreparedBundle {
  assertIsoDate(evidenceAsOf, 'evidenceAsOf');
  if (items.length === 0) throw new Error('Bundle tanpa bukti — menolak merakit.');

  const ids = items.map((i) => i.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) {
    throw new Error(
      `evidenceId ganda di dalam bundle: ${duplicate}. Sitasi agen jadi ambigu kalau dibiarkan (R5).`,
    );
  }

  const payload = canonicalPayload(items, evidenceAsOf);
  const bundleHash = createHash('sha256').update(payload).digest('hex');
  const bytes = Buffer.byteLength(payload);
  if (bytes > MAX_BUNDLE_BYTES) {
    throw new Error(
      `Bundle ${(bytes / 1024 / 1024).toFixed(1)} MB melewati batas ${MAX_BUNDLE_BYTES / 1024 / 1024} MB. ` +
        `Agregasi R16 seharusnya menahan ini — periksa apakah daftar alert ikut membengkak.`,
    );
  }

  return {
    bundleId: `bundle_${bundleHash.slice(0, 16)}`,
    bundleHash,
    evidenceAsOf,
    items: [...items].sort((a, b) => a.id.localeCompare(b.id)),
    payload,
  };
}

/**
 * Unggah ke Vercel Blob dan kembalikan bundle lengkap.
 *
 * Path diturunkan dari hash, jadi dua bundle beridentik isi menempati URL yang
 * sama — dan verifikator bisa membuktikan hash onchain cocok dengan berkas yang
 * benar-benar bisa mereka unduh.
 */
export async function publishBundle(prepared: PreparedBundle): Promise<EvidenceBundle> {
  const { url } = await put(`bundles/${prepared.bundleId}.json`, prepared.payload, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });

  return {
    bundleId: prepared.bundleId,
    evidenceAsOf: prepared.evidenceAsOf,
    items: prepared.items,
    bundleHash: prepared.bundleHash,
    blobUrl: url,
  };
}

/** Verifikasi ulang: unduh bundle dan hitung hash-nya sendiri. */
export async function verifyPublishedBundle(bundle: EvidenceBundle): Promise<boolean> {
  const res = await fetch(bundle.blobUrl, {
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Bundle tidak bisa diunduh: ${bundle.blobUrl} → HTTP ${res.status}`);
  const text = await res.text();
  return createHash('sha256').update(text).digest('hex') === bundle.bundleHash;
}
