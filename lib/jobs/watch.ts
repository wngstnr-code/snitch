/**
 * B9 — Watcher: cek ulang bukti satelit, cabut attestation yang sudah dibantah.
 *
 * Inilah yang membedakan produk ini dari PDF. Sertifikat kertas membusuk diam-
 * diam; attestation ini memeriksa dirinya sendiri terhadap data satelit terbaru
 * dan mencabut dirinya onchain saat bukti baru bertentangan dengannya.
 *
 * ─── Kenapa `evidenceAsOf`, bukan waktu penerbitan ───────────────────────────
 * Yang dibandingkan adalah alert yang terjadi SETELAH batas bukti attestation.
 * Attestation menyatakan "sepanjang yang diketahui per tanggal X"; alert
 * bertanggal setelah X adalah fakta yang belum diketahui saat itu — persis
 * definisi bukti yang membantah. Ini juga yang membuat demo revocation bisa
 * dijalankan tanpa memalsukan apa pun: terbitkan dengan batas bukti lampau
 * pada petak yang memang punya alert setelahnya (R4).
 *
 * ─── Kenapa berurutan, bukan paralel ─────────────────────────────────────────
 * Semua revoke dikirim dari satu wallet. Mengirimnya paralel berarti tabrakan
 * nonce dan transaksi yang tergantikan. Lambat itu benar di sini.
 */

import { collectAlerts, type Geometry } from '../evidence/gfw';
import { revokeAttestation } from '../chain/attest';
import { readAttestation } from '../chain/read';
import {
  finishWatchRun,
  listActiveAttestations,
  markRevoked,
  setStatus,
  startWatchRun,
  touchChecked,
} from '../db/repo';
import { messageOf } from '../api/respond';
import type { WatchRunResult } from '../types';

export interface WatchOptions {
  trigger: 'cron' | 'manual';
  /** Batasi ke satu UID — dipakai tombol "Re-verify now" (R6). */
  onlyUid?: string;
}

/** Alert yang terjadi setelah batas bukti attestation. */
function alertsAfter(
  alerts: readonly { date: string }[],
  evidenceAsOf: Date,
): number {
  const limit = evidenceAsOf.getTime();
  return alerts.filter((a) => Date.parse(a.date) > limit).length;
}

export async function runWatch(opts: WatchOptions): Promise<WatchRunResult> {
  const run = await startWatchRun(opts.trigger);
  const result: WatchRunResult = {
    checkedAt: run.startedAt.toISOString(),
    checked: 0,
    revoked: [],
    errors: [],
  };

  let targets = await listActiveAttestations();
  if (opts.onlyUid) {
    targets = targets.filter((t) => t.attestation.uid === opts.onlyUid);
    if (targets.length === 0) {
      await finishWatchRun({
        id: run.id,
        startedAt: run.startedAt,
        checked: 0,
        revokedCount: 0,
        errorCount: 0,
      });
      throw new Error(
        `Attestation ${opts.onlyUid} tidak ada di daftar aktif — mungkin sudah ter-revoke atau belum tercatat.`,
      );
    }
  }

  for (const t of targets) {
    const uid = t.attestation.uid as `0x${string}`;
    try {
      // Chain adalah sumber kebenaran, bukan DB kita. Attestation bisa saja
      // sudah dicabut lewat jalur lain; mengirim revoke kedua hanya membakar
      // gas dan menghasilkan error yang membingungkan.
      const onchain = await readAttestation(uid);
      if (!onchain) {
        throw new Error(`Attestation ${uid} tercatat di DB tapi tidak ada di chain.`);
      }
      if (onchain.revoked) {
        await markRevoked({
          uid,
          revokeTxHash: t.attestation.revokeTxHash ?? '0x',
          revokedAt: onchain.revocationTime ?? new Date().toISOString(),
          reason: 'Ditemukan sudah ter-revoke di chain saat pemeriksaan ulang.',
        });
        await setStatus(t.verification.id, 'revoked');
        result.checked += 1;
        continue;
      }

      const geom = t.plot.geojson as Geometry;
      const fresh = await collectAlerts(geom);
      const newAlerts = alertsAfter(fresh.alerts, t.attestation.evidenceAsOf);
      result.checked += 1;

      if (newAlerts === 0) {
        await touchChecked(uid);
        continue;
      }

      const reason =
        `${newAlerts} alert deforestasi GFW bertanggal setelah evidenceAsOf ` +
        `${t.attestation.evidenceAsOf.toISOString().slice(0, 10)} ` +
        `(tile ${fresh.version}, z${fresh.zoom}, ${fresh.tilesScanned} tile). ` +
        `Bukti ini tidak diketahui saat attestation diterbitkan dan membantahnya.`;

      const revoked = await revokeAttestation(uid);
      await markRevoked({
        uid,
        revokeTxHash: revoked.txHash,
        revokedAt: revoked.revokedAt,
        reason,
      });
      // Status verifikasi ikut pindah, bukan hanya baris attestation-nya:
      // daftar di UI membaca status, dan attestation yang sudah dicabut tapi
      // masih tertulis "attested" adalah persis kebohongan diam-diam yang
      // dilawan produk ini.
      await setStatus(t.verification.id, 'revoked');

      result.revoked.push({
        uid,
        revokeTxHash: revoked.txHash,
        reason,
        newAlertsAfterEvidenceAsOf: newAlerts,
      });
    } catch (e) {
      // Kegagalan satu attestation tidak boleh menghentikan pemeriksaan yang
      // lain, tapi juga tidak boleh hilang: ia keluar di `errors` dan ikut
      // tampil di UI. Attestation yang gagal diperiksa TIDAK ditandai bersih.
      result.errors.push({ uid, error: messageOf(e) });
    }
  }

  await finishWatchRun({
    id: run.id,
    startedAt: run.startedAt,
    checked: result.checked,
    revokedCount: result.revoked.length,
    errorCount: result.errors.length,
  });

  return result;
}
