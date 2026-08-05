/**
 * Klien HTTP untuk seluruh UI.
 *
 * Satu aturan yang tidak boleh dilanggar (CLAUDE.md §0 dan §9): **kegagalan
 * tidak pernah berubah jadi data kosong.** Kalau server menjawab error, fungsi
 * di sini MELEMPAR dengan pesan asli dari server, dan pemanggilnya wajib
 * merendernya ke layar. Mengembalikan `[]` saat gagal akan membuat "tidak
 * berhasil memeriksa" terlihat persis seperti "bersih" — dan pada produk
 * kepatuhan itu bukan bug tampilan, itu attestation palsu.
 *
 * Semua endpoint di sini milik Dev B; bentuknya dikunci `lib/types.ts`.
 */

import type {
  CreateVerificationRequest,
  HumanReview,
  Plot,
  PublicVerifyResponse,
  Verification,
} from '@/lib/types';

/** Error yang membawa status HTTP, supaya UI bisa membedakan 404 dari 500. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Bentuk badan error dari `lib/api/respond.ts`. */
function errorMessageOf(payload: unknown, status: number): string {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    typeof (payload as { error: unknown }).error === 'string'
  ) {
    return (payload as { error: string }).error;
  }
  return `The server answered HTTP ${status} with no readable message.`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (e) {
    // Jaringan putus / server mati. Ini juga kegagalan yang harus terlihat.
    throw new ApiError(
      0,
      `Could not reach the server at ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError(
        res.status,
        `The response from ${path} is not valid JSON (HTTP ${res.status}): ${text.slice(0, 200)}`,
      );
    }
  }

  if (!res.ok) throw new ApiError(res.status, errorMessageOf(payload, res.status));
  return payload as T;
}

// ---------- Intake ----------

/** Pabrik sawit nyata dari dataset ArcGIS, sudah diseed ke DB oleh Dev B. */
export function fetchMills(params?: {
  bbox?: [number, number, number, number];
  limit?: number;
}): Promise<Plot[]> {
  const q = new URLSearchParams();
  if (params?.bbox) q.set('bbox', params.bbox.join(','));
  if (params?.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return request<Plot[]>(`/api/mills${qs ? `?${qs}` : ''}`);
}

// ---------- Verifikasi ----------

export function fetchVerifications(limit = 100): Promise<Verification[]> {
  return request<Verification[]>(`/api/verifications?limit=${limit}`);
}

export function fetchVerification(id: string): Promise<Verification> {
  return request<Verification>(`/api/verifications/${encodeURIComponent(id)}`);
}

/**
 * Menjalankan verifikasi sampai selesai. Terukur puluhan detik: tile GFW,
 * GLEIF, dua daftar sanksi, cross-check RSPO, lalu satu panggilan model.
 * Status antara tetap ditulis ke DB, jadi UI boleh polling detailnya sambil
 * permintaan ini masih berjalan.
 */
export function createVerification(
  body: CreateVerificationRequest,
): Promise<Verification> {
  return request<Verification>('/api/verifications', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function submitReview(id: string, review: HumanReview): Promise<Verification> {
  return request<Verification>(
    `/api/verifications/${encodeURIComponent(id)}/review`,
    { method: 'POST', body: JSON.stringify(review) },
  );
}

export function issueAttestation(id: string): Promise<Verification> {
  return request<Verification>(
    `/api/verifications/${encodeURIComponent(id)}/attest`,
    { method: 'POST' },
  );
}

/** "Periksa ulang sekarang" — runner watcher yang sama dengan cron. */
export function recheck(id: string): Promise<Verification> {
  return request<Verification>(
    `/api/verifications/${encodeURIComponent(id)}/recheck`,
    { method: 'POST' },
  );
}

// ---------- Verifikasi publik ----------

/**
 * `GET /api/v1/verify/[uid]` berbeda dari endpoint lain: UID yang tidak
 * ditemukan dijawab 404 dengan badan `PublicVerifyResponse` yang sudah berisi
 * penjelasannya (`found: false`, `error`). Itu jawaban yang sah, bukan
 * kegagalan — jadi jangan dilempar. Yang tetap dilempar hanya 5xx.
 */
export async function fetchPublicVerification(
  uid: string,
): Promise<PublicVerifyResponse> {
  try {
    return await request<PublicVerifyResponse>(
      `/api/v1/verify/${encodeURIComponent(uid)}`,
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) {
      return {
        uid: uid as `0x${string}`,
        found: false,
        onchain: null,
        decoded: null,
        bundle: null,
        error: e.message,
      };
    }
    throw e;
  }
}
