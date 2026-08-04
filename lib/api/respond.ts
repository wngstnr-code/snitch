/**
 * Helper respons API.
 *
 * Aturannya satu: **error tidak pernah ditelan** (CLAUDE.md §9). Setiap
 * kegagalan keluar sebagai status HTTP yang benar plus pesan yang bisa dibaca
 * manusia, karena UI wajib menampilkannya apa adanya. Mengembalikan 200 dengan
 * array kosong akan membuat "gagal memeriksa" terlihat persis seperti "bersih",
 * dan pada produk kepatuhan itu bukan bug tampilan — itu attestation palsu.
 */

export interface ApiError {
  error: string;
}

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function fail(status: number, message: string): Response {
  return Response.json({ error: message } satisfies ApiError, { status });
}

/** Pesan yang layak ditampilkan, dari nilai apa pun yang dilempar. */
export function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : JSON.stringify(e);
}

/**
 * Membungkus handler supaya lemparan tak terduga tetap keluar sebagai 500
 * berpesan, bukan sebagai halaman error Next yang tidak berguna bagi Dev A.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    console.error('[api]', e);
    return fail(500, messageOf(e));
  }
}

/** `?bbox=minLon,minLat,maxLon,maxLat` — melempar bila bentuknya salah. */
export function parseBBox(
  raw: string | null,
): [number, number, number, number] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error('bbox harus empat angka: minLon,minLat,maxLon,maxLat');
  }
  const [minLon, minLat, maxLon, maxLat] = parts as [
    number,
    number,
    number,
    number,
  ];
  if (minLon > maxLon || minLat > maxLat) {
    throw new Error('bbox terbalik: min harus lebih kecil dari max');
  }
  return [minLon, minLat, maxLon, maxLat];
}
