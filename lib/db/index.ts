/**
 * Koneksi Neon Postgres via Drizzle.
 * Runtime Node.js (CLAUDE.md §5) — jangan pakai `runtime = 'edge'`.
 *
 * ─── Kenapa malas, bukan dibuat saat modul dimuat ────────────────────────────
 * Versi sebelumnya memanggil `drizzle(neon(connectionString()))` di lingkup
 * modul, jadi cukup meng-IMPOR modul ini sudah menuntut `DATABASE_URL` ada.
 * Akibatnya `next build` gagal tanpa kredensial database — terbukti:
 * "Failed to collect page data for /api/cron/sanctions". Build seharusnya
 * hanya butuh kode, bukan rahasia runtime; ketergantungan itu membuat CI
 * mustahil dijalankan jujur dan menjadikan setiap deploy dengan env yang
 * belum lengkap sebagai kegagalan build yang membingungkan.
 *
 * Proxy dipakai supaya seluruh pemanggil tetap menulis `db.select(...)` seperti
 * biasa; koneksi baru dibuat pada akses pertama, yaitu saat permintaan
 * sungguhan datang dan `DATABASE_URL` memang wajib ada.
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL tidak diset. Isi di .env (Neon Postgres).');
  }
  return url;
}

let cached: Db | null = null;

/** Klien sungguhan. Melempar bila env belum ada — jangan pernah diam-diam no-op. */
export function getDb(): Db {
  if (!cached) {
    cached = drizzle(neon(connectionString()), { schema });
  }
  return cached;
}

export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

export { schema };
