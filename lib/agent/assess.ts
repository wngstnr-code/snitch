
/**
 * B5 — Agen kontradiksi.
 *
 * Menerima satu `EvidenceBundle` yang SUDAH dikumpulkan oleh kode deterministik
 * (B2-B4: GFW, GLEIF, sanksi, cross-check RSPO) dan meminta model menemukan
 * non-conformance terstruktur, tiap temuan bersitasi ke `evidenceId` yang nyata.
 *
 * Agen ini TIDAK PERNAH memanggil API eksternal sendiri — tidak diberi tool,
 * tidak diberi akses fetch. Ia murni menalar atas ringkasan bukti yang dikirim
 * di prompt (CLAUDE.md B5). Kalau bukti belum terkumpul, itu urusan `lib/evidence`,
 * bukan urusan modul ini.
 *
 * ─── R5: halusinasi sitasi ditolak, bukan dibuang diam-diam ──────────────────
 * Kalau model menyitir `evidenceId` yang tidak ada di bundle, itu bukan finding
 * yang "sedikit meleset" — itu tanda penalaran seluruhnya tidak bisa dipercaya.
 * Maka: satu kali percobaan ulang dengan pesan koreksi eksplisit; kalau masih
 * gagal, kembalikan INCONCLUSIVE yang MENYEBUTKAN kegagalan itu apa adanya.
 * Tidak pernah diam-diam menyaring finding yang sitasinya salah lalu berpura-pura
 * sisanya valid — itu sama berbahayanya dengan menelan error jadi array kosong.
 */

import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import type { AgentAssessment, EvidenceBundle, Plot } from '../types';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt';

export interface AssessContext {
  plot: Plot;
  /** operator/importir EU, kalau diketahui */
  euOperator?: { legalName: string; jurisdiction: string };
  /**
   * Klaim sertifikasi dari dua dataset independen (CLAUDE.md §3.4 vs §3.4c).
   * Ketidaksepakatan di antara keduanya adalah non-conformance nyata.
   * Semua field opsional — plot hasil upload pengguna tidak punya ini.
   */
  millClaims?: {
    umlId?: string | null;
    /** Universal Mill List: 'RSPO Certified' | 'Not RSPO Certified' */
    rspoStatusUml?: string | null;
    /** Unilever Palm Oil Mills: RSPO_Certified Yes/No */
    rspoCertifiedUnilever?: boolean | null;
    rspoType?: string | null;
    parentCompany?: string | null;
  };
}

export interface AssessResult {
  assessment: AgentAssessment;
  /** true bila percobaan pertama menghasilkan evidenceId palsu dan harus diulang */
  retried: boolean;
  /** model yang benar-benar dipakai */
  model: string;
  /** ISO */
  assessedAt: string;
}

const MODEL = google('gemini-2.5-flash');
const MODEL_NAME_FOR_LOGS = 'google/gemini-2.5-flash';
const MODEL_TIMEOUT_MS = 120_000;

// Mencerminkan `Finding` di lib/types.ts persis (severity/claim/contradiction/evidenceIds).
const FindingSchema = z.object({
  severity: z.enum(['critical', 'major', 'minor', 'info']),
  claim: z.string().min(1),
  contradiction: z.string().min(1),
  /** WAJIB id yang benar-benar ada di bundle — divalidasi di kode, bukan dipercaya (R5). */
  evidenceIds: z.array(z.string().min(1)),
});

// Mencerminkan `AgentAssessment` di lib/types.ts persis.
const AssessmentSchema = z.object({
  verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  confidence: z.number().int().min(0).max(100),
  findings: z.array(FindingSchema),
  summary: z.string().min(1),
});

export interface CitationValidation {
  valid: boolean;
  /** evidenceId yang disitir model tapi tidak ada di bundle */
  invalidIds: string[];
}

/**
 * Validator sitasi murni (tanpa efek samping) — diekspor supaya bisa diuji
 * langsung tanpa memanggil model (R5, kebutuhan test #3).
 */
export function validateCitations(
  assessment: AgentAssessment,
  validEvidenceIds: readonly string[],
): CitationValidation {
  const validSet = new Set(validEvidenceIds);
  const cited = assessment.findings.flatMap((f) => f.evidenceIds);
  const invalidIds = [...new Set(cited.filter((id) => !validSet.has(id)))];
  return { valid: invalidIds.length === 0, invalidIds };
}

function correctionSuffix(invalidIds: string[], validIds: readonly string[]): string {
  return [
    ``,
    `# KOREKSI WAJIB`,
    `Percobaan sebelumnya menyitir evidenceId yang TIDAK ADA di bundle ini:`,
    JSON.stringify(invalidIds),
    `Ini tidak bisa diterima — setiap evidenceIds pada setiap finding HARUS persis`,
    `salah satu dari daftar id sah berikut (tidak ada id lain yang boleh dipakai):`,
    JSON.stringify(validIds),
    `Hasilkan ulang AgentAssessment lengkap dari awal. Kalau kamu tidak yakin id mana`,
    `yang tepat untuk sebuah temuan, JANGAN tuliskan temuan itu sama sekali.`,
  ].join('\n');
}

async function callModel(prompt: string): Promise<AgentAssessment> {
  const startedAt = Date.now();
  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: AssessmentSchema,
      schemaName: 'AgentAssessment',
      schemaDescription:
        'Penilaian kontradiksi kepatuhan EUDR: verdict, tingkat keyakinan, dan daftar non-conformance bersitasi.',
      instructions: SYSTEM_PROMPT,
      prompt,
      temperature: 0,
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    return object;
  } catch (e) {
    // `AbortSignal.timeout` melempar error yang pesannya kosong; kalau
    // diteruskan apa adanya, reviewer melihat verifikasi berstatus `failed`
    // dengan keterangan "{}" dan tidak punya cara tahu apa yang terjadi.
    // Error yang tidak bisa dibaca sama tidak bergunanya dengan error yang
    // ditelan (§9).
    const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(
        `Model tidak menjawab dalam ${MODEL_TIMEOUT_MS / 1000} detik (berhenti pada ${elapsedS} s). ` +
          'Penilaian tidak dilakukan — ini kegagalan memeriksa, bukan hasil bersih. Coba jalankan ulang.',
      );
    }
    const detail = e instanceof Error && e.message ? e.message : String(e);
    throw new Error(`Panggilan model gagal setelah ${elapsedS} s: ${detail}`);
  }
}

/**
 * Menilai satu bundle bukti terhadap konteks petak. Tidak pernah memanggil API
 * eksternal — hanya menalar atas bukti yang sudah diringkas ke dalam prompt.
 */
export async function assessBundle(bundle: EvidenceBundle, ctx: AssessContext): Promise<AssessResult> {
  if (bundle.items.length === 0) {
    throw new Error('assessBundle dipanggil dengan bundle kosong — tidak ada bukti untuk dinilai.');
  }

  const validIds = bundle.items.map((i) => i.id);
  const basePrompt = buildUserPrompt({ bundle, ctx });

  const { assessment, retried } = await guardCitations(
    (correction) => callModel(correction ? basePrompt + correction : basePrompt),
    validIds,
  );

  return { assessment, retried, model: MODEL_NAME_FOR_LOGS, assessedAt: new Date().toISOString() };
}

/**
 * Menghasilkan satu penilaian; `correction` berisi sufiks prompt koreksi pada
 * percobaan kedua, `null` pada percobaan pertama.
 */
export type AssessmentProducer = (
  correction: string | null,
) => Promise<AgentAssessment>;

/**
 * Disiplin sitasi (R5), dipisahkan dari pemanggilan model supaya bisa diuji.
 *
 * ─── Kenapa ini dipisah ──────────────────────────────────────────────────────
 * Jalur paling penting di modul ini justru jalur yang paling jarang jalan:
 * apa yang terjadi ketika model menyitir bukti yang tidak ada. Dengan model
 * sungguhan, cabang itu tidak pernah terpicu — Sonnet konsisten menyitir id
 * yang benar sejak percobaan pertama — jadi selama ini ia hanya "diperiksa
 * dengan dibaca". Kode penanganan kegagalan yang belum pernah dijalankan
 * adalah kode yang belum diketahui bekerja.
 *
 * Memisahkannya membuat penjaga ini bisa diuji dengan produser yang kita
 * kendalikan. Itu BUKAN pelanggaran §0: yang disuntikkan di test adalah
 * fungsi penghasil, bukan data bukti karangan yang berpura-pura hasil
 * pengukuran. Tidak ada angka dari sini yang pernah sampai ke layar pengguna.
 */
export async function guardCitations(
  produce: AssessmentProducer,
  validIds: readonly string[],
): Promise<{ assessment: AgentAssessment; retried: boolean }> {
  const first = await produce(null);
  const firstCheck = validateCitations(first, validIds);
  if (firstCheck.valid) {
    return { assessment: first, retried: false };
  }

  // Satu kali percobaan ulang dengan pesan koreksi eksplisit (aturan keras #2).
  const second = await produce(correctionSuffix(firstCheck.invalidIds, validIds));
  const secondCheck = validateCitations(second, validIds);
  if (secondCheck.valid) {
    return { assessment: second, retried: true };
  }

  // Percobaan kedua masih menghasilkan sitasi tak sah: jangan diam-diam menyaring
  // finding yang salah dan berpura-pura sisanya bisa dipercaya. Nyatakan gagal.
  return {
    assessment: {
      verdict: 'INCONCLUSIVE',
      confidence: 0,
      findings: [],
      summary:
        `Agen kontradiksi menghasilkan evidenceId yang tidak ada di bundle bahkan setelah ` +
        `satu kali percobaan koreksi (id tak sah: ${JSON.stringify(secondCheck.invalidIds)}). ` +
        `Penilaian ini TIDAK DAPAT DIPERCAYA dan sengaja dikosongkan — bukan berarti petak ` +
        `ini bersih, melainkan agen gagal bernalar dengan disiplin sitasi yang diwajibkan.`,
    },
    retried: true,
  };
}
