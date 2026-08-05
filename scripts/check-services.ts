/**
 * Cek layanan berbayar/berkredensial yang dipakai Fase 1: AI Gateway + Vercel Blob.
 *
 *   npm run services:check
 *
 * Alasan ada: dua kredensial ini baru terpakai jauh di dalam Fase 1 (B4 bundler,
 * B5 agen). Kalau salah satunya belum ter-provision, kita ingin tahu sekarang —
 * bukan di jam ke-30. Keduanya diuji dengan panggilan nyata; tidak ada mode
 * "anggap saja jalan".
 */

import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { put, del } from '@vercel/blob';

const failures: string[] = [];

/** Harus sama dengan MODEL di lib/agent/assess.ts — kalau menyimpang, cek ini
 *  akan melaporkan sehat sementara agennya mati. */
const MODEL_ID = 'gemini-3.6-flash';

async function checkAiGateway() {
  const { text } = await generateText({
    model: google(MODEL_ID),
    prompt: 'Reply with exactly this token and nothing else: SNITCH_GATEWAY_OK',
    temperature: 0,
  });
  const ok = text.trim() === 'SNITCH_GATEWAY_OK';
  console.log(`  ${ok ? '✔' : '✘'} Google AI (${MODEL_ID}): ${JSON.stringify(text.trim())}`);
  if (!ok) failures.push('Google AI');
}

async function checkBlob() {
  const body = `snitch services check ${new Date().toISOString()}`;
  // Path unik tiap run. Versi sebelumnya memakai path tetap lalu menghapusnya di
  // akhir; run berikutnya membaca URL yang sama dan mendapat 404 yang sudah
  // tersimpan di cache CDN — cek ini melaporkan Blob mati padahal sehat.
  // Terbukti 2026-08-04: path lama → 404, path baru → 200 pada percobaan sama.
  const { url } = await put(`healthcheck/services-${Date.now()}.txt`, body, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  const res = await fetch(url, { cache: 'no-store' });
  const back = await res.text();
  const ok = res.ok && back === body;
  console.log(`  ${ok ? '✔' : '✘'} Vercel Blob write+read: HTTP ${res.status} · ${url}`);
  if (!ok) failures.push('Vercel Blob');
  await del(url);
}

async function main() {
  for (const [label, fn] of [
    ['Google AI', checkAiGateway],
    ['Vercel Blob', checkBlob],
  ] as const) {
    try {
      await fn();
    } catch (err) {
      console.log(`  ✘ ${label}: ${err instanceof Error ? err.message : String(err)}`);
      failures.push(label);
    }
  }

  if (failures.length > 0) {
    console.error(`\nGAGAL: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\n✔ Google AI & Blob hidup.');
}

main();
