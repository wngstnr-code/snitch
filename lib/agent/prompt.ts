/**
 * B5 — Prompt agen kontradiksi.
 *
 * Dipisah dari `assess.ts` supaya konteks domain (cutoff EUDR, semantik channel
 * confidence, batas cakupan GLEIF, dst.) bisa diaudit dan diubah tanpa menyentuh
 * logika pemanggilan model/validasi sitasi.
 */

import type { AssessContext } from './assess';
import type { Evidence } from '../types';

/** Cutoff EUDR — alert deforestasi setelah tanggal ini adalah non-conformance inti. */
export const EUDR_CUTOFF = '2020-12-31';

/**
 * Prompt sistem: peran agen, batas kewenangannya, dan semantik bukti yang wajib
 * dipahami sebelum menalar. Tidak menyebut bukti spesifik — itu ada di prompt
 * pengguna, supaya prompt sistem tetap stabil lintas panggilan (cache-friendly).
 */
export const SYSTEM_PROMPT = `Kamu adalah agen kontradiksi SNITCH: sistem verifikasi kepatuhan rantai pasok
untuk EUDR (EU Deforestation Regulation).

TUGASMU:
Bandingkan klaim petak/operator terhadap bukti yang SUDAH DIKUMPULKAN oleh kode
deterministik (tile satelit GFW, registri badan hukum GLEIF, daftar sanksi OFAC/EU,
cross-check RSPO dua dataset independen). Temukan kontradiksi nyata dan tuliskan
sebagai daftar non-conformance terstruktur.

ATURAN KERAS — PELANGGARAN MEMBUAT OUTPUTMU DITOLAK OTOMATIS:
1. Kamu TIDAK PUNYA akses ke internet atau API apa pun. Kamu hanya menalar atas
   bukti yang diberikan di prompt ini. Jangan pernah berpura-pura memeriksa sumber
   lain atau mengasumsikan data yang tidak disertakan.
2. Setiap "evidenceIds" pada setiap finding WAJIB berisi id persis yang tercantum
   di daftar bukti yang diberikan (field "id" pada tiap butir bukti). Jangan pernah
   mengarang, memparafrase, atau menebak id. Kalau kamu tidak punya bukti yang
   pas untuk sebuah temuan, JANGAN tuliskan temuan itu.
3. KETIADAAN BUKTI BUKAN KELULUSAN. Kalau tidak ada bukti "legal_entity" di dalam
   bundle, kamu TIDAK BOLEH menyimpulkan operator EU tersebut sah/terverifikasi.
   Nyatakan sebagai "belum terverifikasi", jangan "PASS" secara diam-diam.
4. Cutoff EUDR adalah ${EUDR_CUTOFF}. Alert deforestasi bertanggal SETELAH cutoff
   ini, di dalam batas petak/radius sourcing, adalah non-conformance EUDR utama —
   severity minimal "major", "critical" bila jumlahnya besar atau confidence-nya
   "high"/"highest".
5. Pada bukti deforestasi, "confidence: null" pada sebuah alert berarti TIDAK
   TERVERIFIKASI (channel alpha tak dikenal), BUKAN nol/tidak ada alert. Jangan
   menyamakan null dengan aman.
6. Pada bukti badan hukum (GLEIF): "entityStatus" (status entitas hukum) dan
   "registrationStatus" (status registrasi LEI-nya) adalah DUA HAL BERBEDA.
   entityStatus ACTIVE tapi registrationStatus bukan ISSUED/ACTIVE (mis. LAPSED,
   DUPLICATE, RETIRED) adalah kontradiksi nyata yang wajib ditangkap sebagai
   finding tersendiri. matchQuality "none" berarti entitas TIDAK DITEMUKAN di
   yurisdiksi yang dicari — ini bukan bukti bahwa entitasnya tidak sah, tapi
   berarti klaim operator BELUM TERVERIFIKASI lewat GLEIF.
7. Pada bukti sanksi: ambang kecocokan sengaja longgar (0,6) supaya tidak ada
   yang lolos begitu saja. Match berskor rendah (mendekati 0,6) adalah KANDIDAT
   untuk direview manusia, BUKAN vonis "tersanksi". Bedakan bahasanya: skor
   tinggi (>=0,85) boleh disebut "kemungkinan match kuat"; skor rendah harus
   disebut "kandidat, perlu review manusia".
8. Klaim sertifikasi RSPO datang dari DUA dataset independen (Universal Mill List
   dan Unilever Palm Oil Mills). Kalau keduanya BERTENTANGAN soal status RSPO
   pabrik yang sama, itu non-conformance nyata — sebutkan kedua sumbernya secara
   eksplisit di "claim" dan "contradiction".
9. Kamu BUKAN badan sertifikasi dan hasilmu BUKAN EUDR Due Diligence Statement
   resmi. Jangan menulis seolah kamu punya kewenangan hukum untuk memutuskan
   kepatuhan — gunakan bahasa "indikasi", "belum terverifikasi", "kontradiksi
   ditemukan", bukan "resmi tidak patuh".
10. "summary" wajib berbahasa Indonesia, ringkas (2-4 kalimat), jujur tentang
    keterbatasan bukti yang tersedia (mis. bila bukti sanksi tidak ada, katakan
    itu belum discreening — jangan diam-diam mengabaikannya).

VERDICT:
- FAIL: ada non-conformance severity "critical" atau beberapa "major" yang jelas.
- PASS: seluruh bukti yang tersedia konsisten, tidak ada kontradiksi berarti.
  PASS TIDAK BOLEH dipakai hanya karena bukti tertentu tidak ada — ketiadaan bukti
  membuat area itu "belum terverifikasi", dan itu semestinya membuat verdict
  paling tinggi INCONCLUSIVE kecuali area lain sudah cukup untuk FAIL.
- INCONCLUSIVE: bukti tidak cukup untuk memutuskan PASS maupun FAIL dengan yakin.

confidence (0-100) mencerminkan seberapa yakin kamu pada verdict itu SENDIRI,
berdasarkan kelengkapan dan kekuatan bukti yang tersedia — bukan seberapa besar
pelanggarannya.`;

function fmt(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Rentang tanggal min/max dari alert — dihitung di kode, bukan dikirim mentah. */
function alertDateRange(alerts: readonly { date: string }[]): { min: string | null; max: string | null } {
  if (alerts.length === 0) return { min: null, max: null };
  let min = alerts[0].date;
  let max = alerts[0].date;
  for (const a of alerts) {
    if (a.date < min) min = a.date;
    if (a.date > max) max = a.date;
  }
  return { min, max };
}

/**
 * Ringkas satu butir bukti untuk dikirim ke model. `DeforestationEvidence.alerts`
 * bisa berisi ribuan titik — TIDAK PERNAH dikirim mentah (CLAUDE.md B5 aturan 5).
 * `legal_entity` dan `sanctions` kecil, dikirim utuh.
 */
function summarizeEvidenceItem(item: Evidence): Record<string, unknown> {
  switch (item.kind) {
    case 'deforestation': {
      const range = alertDateRange(item.alerts);
      return {
        id: item.id,
        kind: item.kind,
        sourceUrl: item.sourceUrl,
        fetchedAt: item.fetchedAt,
        rawHash: item.rawHash,
        tileVersion: item.tileVersion,
        zoom: item.zoom,
        tilesScanned: item.tilesScanned,
        areaHa: item.areaHa,
        alertsAfterCutoff: item.alertsAfterCutoff,
        totalAlertsDalamBundle: item.alerts.length,
        summary: item.summary,
        rentangTanggalAlert: range,
      };
    }
    case 'legal_entity':
    case 'sanctions':
      // Kecil, kirim seluruh field apa adanya.
      return { ...item };
  }
}

export interface BuildPromptInput {
  bundle: {
    bundleId: string;
    evidenceAsOf: string;
    items: readonly Evidence[];
  };
  ctx: AssessContext;
}

/** Membangun prompt pengguna (bukan sistem) dari bundle + konteks petak. */
export function buildUserPrompt({ bundle, ctx }: BuildPromptInput): string {
  const evidenceSummaries = bundle.items.map(summarizeEvidenceItem);
  const validIds = bundle.items.map((i) => i.id);

  // Membedakan radius sourcing dari petak sungguhan itu wajib, bukan gaya
  // bahasa (CLAUDE.md §3.4). Lingkaran 50 km di sekitar pabrik BUKAN batas
  // lahan siapa pun; menyebut hasilnya "verifikasi petak" berarti mengklaim
  // presisi yang tidak dimiliki datanya.
  const geometryNote =
    ctx.plot.source === 'mill_dataset'
      ? 'RADIUS SOURCING PABRIK (lingkaran 50 km di sekitar titik pabrik, metodologi WRI/GFW). ' +
        'INI BUKAN BATAS LAHAN. Alert di dalamnya berarti deforestasi terjadi di dalam wilayah ' +
        'pasokan pabrik, BUKAN bahwa pabrik atau operatornya yang menebang. Sebut temuannya ' +
        'sebagai "risiko sourcing", jangan pernah sebagai "petak ditebang".'
      : 'PETAK SUNGGUHAN dari GeoJSON yang diunggah pengguna. Alert di dalamnya berada di dalam ' +
        'batas lahan yang diklaim, jadi temuan boleh dinyatakan sebagai deforestasi pada petak itu.';

  const parts: string[] = [
    `# Konteks petak`,
    fmt({
      plotId: ctx.plot.id,
      plotName: ctx.plot.name,
      areaHa: ctx.plot.areaHa,
      operatorName: ctx.plot.operatorName,
      source: ctx.plot.source,
    }),
    ``,
    `# Arti geometri yang dianalisis — WAJIB tercermin di bahasa temuanmu`,
    geometryNote,
    ``,
    `# Operator/importir EU (kalau diketahui)`,
    ctx.euOperator ? fmt(ctx.euOperator) : 'TIDAK DIKETAHUI — tidak ada operator EU yang diinput untuk verifikasi ini.',
    ``,
    `# Klaim sertifikasi pabrik (dua dataset independen, kalau ada)`,
    // Klaim ini belum menjadi butir bukti ber-evidenceId, jadi ia tidak bisa
    // disitir. Katakan itu terus terang ke model daripada membiarkannya
    // menghasilkan finding yang lalu ditolak validator sitasi.
    ctx.millClaims
      ? `${fmt(ctx.millClaims)}\nCATATAN: klaim ini BELUM punya evidenceId, jadi TIDAK BOLEH jadi finding formal. ` +
        `Kalau kedua dataset bertentangan, sebutkan di "summary" sebagai hal yang perlu diverifikasi manual.`
      : 'TIDAK ADA — plot ini bukan pabrik dari dataset, atau klaim tidak tersedia.',
    ``,
    `# Batas bukti (evidenceAsOf)`,
    bundle.evidenceAsOf,
    ``,
    `# Bukti yang tersedia (bundle ${bundle.bundleId}, ${bundle.items.length} butir)`,
    `Daftar evidenceId YANG SAH untuk disitir (dan HANYA ini): ${fmt(validIds)}`,
    fmt(evidenceSummaries),
    ``,
    `Sekarang hasilkan AgentAssessment sesuai skema yang diberikan. Ingat: setiap`,
    `evidenceIds pada setiap finding harus persis salah satu dari daftar id sah di atas.`,
  ];
  return parts.join('\n');
}
