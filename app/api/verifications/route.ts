/**
 * GET  /api/verifications                          -> Verification[]
 * POST /api/verifications  CreateVerificationRequest -> Verification
 *
 * Daftar sengaja TANPA bundle bukti: satu petak bisa membawa ribuan alert dan
 * halaman daftar tidak menampilkannya. Detail penuh diambil per item lewat
 * `GET /api/verifications/[id]`.
 *
 * POST menjalankan verifikasi sampai selesai lalu mengembalikan hasil akhirnya.
 * Bukan fire-and-forget: pada runtime serverless, kerja yang tidak di-await
 * mati begitu respons dikirim — dan verifikasi yang mati diam-diam adalah
 * persis kegagalan yang produk ini ada untuk mencegah. Status antara tetap
 * ditulis ke DB, jadi UI boleh polling `GET /api/verifications/[id]` selama
 * request ini berjalan.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createVerification, getVerification, listVerifications } from '../../../lib/db/repo';
import { runVerification } from '../../../lib/jobs/run-verification';
import { buildPlotFromUpload, IntakeError } from '../../../lib/plots/intake';
import { fail, handle, messageOf, ok } from '../../../lib/api/respond';
import { getPlot, rowToPlot } from '../../../lib/db/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** GFW + GLEIF + sanksi + satu panggilan model. Terukur puluhan detik. */
export const maxDuration = 300;

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    const rawLimit = request.nextUrl.searchParams.get('limit');
    const limit = rawLimit ? Number(rawLimit) : 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return fail(400, 'limit harus bilangan bulat 1–500');
    }
    return ok(await listVerifications(limit));
  });
}

const bodySchema = z.object({
  plot: z.object({
    id: z.string().optional(),
    name: z.string(),
    geojson: z.unknown(),
    operatorName: z.string(),
    source: z.enum(['upload', 'mill_dataset']),
  }),
  operatorName: z.string(),
  evidenceAsOf: z.string().optional(),
  euOperator: z
    .object({
      legalName: z.string().min(1),
      jurisdiction: z
        .string()
        .regex(/^[A-Za-z]{2}$/, 'jurisdiction harus ISO 3166-1 alpha-2, mis. NL'),
    })
    .optional(),
});

export async function POST(request: NextRequest): Promise<Response> {
  return handle(async () => {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail(400, `Body tidak sah: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    const body = parsed.data;

    const evidenceAsOf = body.evidenceAsOf ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(evidenceAsOf))) {
      return fail(400, `evidenceAsOf bukan tanggal ISO yang sah: ${evidenceAsOf}`);
    }

    // Plot dari dataset pabrik sudah ada di DB lengkap dengan geometri radius
    // sourcing dan klaim RSPO-nya — pakai baris itu apa adanya. Membangun ulang
    // dari body akan membuang justru metadata yang dipakai agen untuk
    // mengadu dua dataset (§3.4 vs §3.4c).
    let plot;
    if (body.plot.source === 'mill_dataset') {
      const id = body.plot.id?.trim();
      if (!id) {
        return fail(400, 'plot.id wajib untuk source=mill_dataset — pilih pabrik dari /api/mills.');
      }
      const row = await getPlot(id);
      if (!row) {
        return fail(404, `Pabrik ${id} tidak ada di dataset. Jalankan \`npm run mills:seed\` atau pilih dari /api/mills.`);
      }
      plot = rowToPlot(row);
    } else {
      try {
        plot = buildPlotFromUpload({
          id: body.plot.id,
          name: body.plot.name,
          operatorName: body.plot.operatorName || body.operatorName,
          geojson: body.plot.geojson,
        }).plot;
      } catch (e) {
        if (e instanceof IntakeError) return fail(400, messageOf(e));
        throw e;
      }
    }

    const id = await createVerification({
      plot,
      evidenceAsOf,
      euOperator: body.euOperator
        ? {
            legalName: body.euOperator.legalName,
            jurisdiction: body.euOperator.jurisdiction.toUpperCase(),
          }
        : undefined,
    });

    // Kegagalan di dalam runner tersimpan sebagai status `failed` + pesan, dan
    // ikut terbawa di respons — bukan dilemparkan sebagai 500 tanpa jejak.
    await runVerification(id);

    const v = await getVerification(id);
    if (!v) return fail(500, `Verifikasi ${id} hilang setelah dibuat.`);
    return ok(v, { status: 201 });
  });
}
