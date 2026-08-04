/**
 * GET /api/mills?bbox=minLon,minLat,maxLon,maxLat&limit=
 *
 * Mengembalikan `Plot[]` sesuai kontrak `lib/types.ts`. Geometri tiap pabrik
 * adalah lingkaran radius sourcing 50 km (CLAUDE.md §3.4), bukan titik —
 * pabrik memang titik, tapi yang bisa diverifikasi terhadap tile GFW adalah
 * areanya. Bedakan ini di UI: hasilnya *mill sourcing risk*, bukan verifikasi
 * tingkat petak.
 *
 * Datanya berasal dari tabel `plots` yang diisi `npm run mills:seed`. Kalau
 * kosong, jawabannya array kosong dengan status 200 — itu bukan error, itu
 * memang "belum di-seed".
 */

import type { NextRequest } from 'next/server';
import { listMills, rowToPlot } from '../../../lib/db/repo';
import { fail, handle, ok, parseBBox } from '../../../lib/api/respond';
import type { Plot } from '../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    let bbox: [number, number, number, number] | undefined;
    try {
      bbox = parseBBox(request.nextUrl.searchParams.get('bbox'));
    } catch (e) {
      return fail(400, e instanceof Error ? e.message : String(e));
    }

    const rawLimit = request.nextUrl.searchParams.get('limit');
    const limit = rawLimit ? Number(rawLimit) : undefined;
    if (rawLimit && (!Number.isInteger(limit) || limit! < 1 || limit! > 5000)) {
      return fail(400, 'limit harus bilangan bulat 1–5000');
    }

    const rows = await listMills({ bbox, limit });
    const plots: Plot[] = rows.map(rowToPlot);
    return ok(plots);
  });
}
