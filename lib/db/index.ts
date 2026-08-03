/**
 * Koneksi Neon Postgres via Drizzle.
 * Runtime Node.js (CLAUDE.md §5) — jangan pakai `runtime = 'edge'`.
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL tidak diset. Isi di .env (Neon Postgres).');
  }
  return url;
}

export const db = drizzle(neon(connectionString()), { schema });
export { schema };
