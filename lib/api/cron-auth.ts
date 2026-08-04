/**
 * Otorisasi endpoint cron.
 *
 * Endpoint di balik ini mengirim transaksi onchain dan mengunduh puluhan MB
 * dari sumber pemerintah. Kalau terbuka, siapa pun bisa menguras wallet
 * attester dan mencabut attestation orang lain.
 *
 * ─── Gagal TERTUTUP di deployment ────────────────────────────────────────────
 * Sebelumnya secret bersifat opsional: kalau `CRON_SECRET` tidak diset,
 * endpoint terbuka lebar. Itu aman di localhost dan berbahaya di Vercel —
 * dan yang paling gampang terjadi adalah lupa mengisi env di dashboard, yaitu
 * persis kondisi yang membuat lubangnya terbuka. Maka di lingkungan ter-deploy
 * ketiadaan secret adalah error, bukan izin.
 */

import { fail } from './respond';

/** Vercel selalu menyetel `VERCEL=1` di runtime-nya. */
function isDeployed(): boolean {
  return process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
}

/** `null` berarti lolos; selain itu, respons penolakan yang siap dikembalikan. */
export function checkCronAuth(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    if (isDeployed()) {
      return fail(
        500,
        'CRON_SECRET belum diset di deployment ini. Endpoint cron mengirim transaksi onchain, ' +
          'jadi ia menolak berjalan tanpa otorisasi alih-alih terbuka untuk siapa saja.',
      );
    }
    // Localhost tanpa secret: diizinkan supaya demo tidak terhambat.
    return null;
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return fail(401, 'Tidak berwenang menjalankan job ini.');
  }
  return null;
}
