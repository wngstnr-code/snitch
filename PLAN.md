# PLAN — SNITCH

> Rencana eksekusi. Ide lengkap: `IDEA.md`. Aturan operasional: `CLAUDE.md`.
> Tim: **2 orang** — Dev A (Frontend), Dev B (Backend + Onchain).

---

## Prinsip: contract-first, lalu paralel penuh

Satu-satunya hal yang menghalangi dua orang bekerja bersamaan adalah **ketidaksepakatan tentang bentuk data**. Maka urutannya:

```
FASE 0  ──  bersama, serial, tidak boleh dilewati
            scaffold + kunci kontrak + schema onchain
                            │
                    🔒 GATE KONTRAK
                            │
            ┌───────────────┴───────────────┐
FASE 1      Dev A (FE)              Dev B (BE + onchain)
            paralel penuh, tanpa saling menunggu
            └───────────────┬───────────────┘
                            │
FASE 2  ──  bersama: integrasi, demo, deck
```

Setelah gate kontrak lewat, **tidak ada satu pun tugas Dev A yang memblokir Dev B, dan sebaliknya.** Dev A membangun melawan tipe, bukan melawan endpoint yang hidup.

> **Aturan penting saat paralel:** Dev A memanggil endpoint sungguhan sejak awal. Kalau endpoint belum ada dan mengembalikan 404, **tampilkan 404 itu**. Jangan pernah membuat mock response "sementara" — mock sementara punya kebiasaan buruk bertahan sampai hari demo. Lihat `CLAUDE.md` §0.

---

## FASE 0 — Fondasi (bersama, serial)

Kerjakan berdua di satu layar. Ini investasi 3–4 jam yang membeli paralelisme penuh sesudahnya.

### 0.1 — Wallet

**Base Sepolia (default).** Buat wallet, ambil ETH dari faucet Sepolia — instan, gratis, tanpa lead-time. Simpan private key di env var, **jangan pernah di-commit**.

Tidak ada lagi blocker ber-lead-time di proyek ini. *(Opsional, hanya bila sempat: danai wallet mainnet untuk satu attestation showcase di akhir. Bukan prasyarat apa pun.)*

### 0.2 — Scaffold

```bash
npx create-next-app@latest . --typescript --tailwind --app --eslint
npx shadcn@latest init
npm i viem ai zod drizzle-orm @neondatabase/serverless maplibre-gl
# CATATAN: JANGAN pasang @ethereum-attestation-service/eas-sdk (berbasis ethers v6).
# viem murni sudah terbukti cukup — lihat prototype/eas.mjs dan R13.
npm i -D drizzle-kit
```

- Neon Postgres lewat Vercel Marketplace (`vercel integration`)
- Vercel Blob
- AI Gateway (model string `"anthropic/claude-sonnet-5"` — jangan hardcode provider package)
- TypeScript `strict: true`
- Buat `.env.example` lengkap

### 0.3 — 🔒 KUNCI KONTRAK — `lib/types.ts`

**Ini gerbangnya. Tulis berdua, sepakati setiap field, lalu jangan diubah sepihak.**

Kerangka yang harus ada:

```ts
// ---------- Evidence ----------
export type EvidenceKind = 'deforestation' | 'legal_entity' | 'sanctions';

export interface EvidenceBase {
  id: string;              // stabil, disitir oleh agen
  kind: EvidenceKind;
  sourceUrl: string;
  fetchedAt: string;       // ISO
  rawHash: string;         // sha256 respons mentah
}

export type AlertConfidence = 'low' | 'high' | 'highest';   // channel alpha 4/8/24 (R3)

export interface DeforestationAlert {
  date: string;            // ISO, hasil dekode R*255+G
  lat: number;
  lon: number;
  confidence: AlertConfidence | null;   // null HANYA bila alpha tak dikenal — jangan ditebak
  tile: { z: number; x: number; y: number };
}

export interface DeforestationEvidence extends EvidenceBase {
  kind: 'deforestation';
  alerts: DeforestationAlert[];        // penuh hanya bila <= 5.000 (R16)
  summary: {                            // selalu ada, deterministik
    byMonth: Record<string, number>;
    byConfidence: Record<AlertConfidence, number>;
    truncated: boolean;
  };
  alertsAfterCutoff: number;   // cutoff EUDR 2020-12-31
  tilesScanned: number;
  zoom: number;
  tileVersion: string;         // mis. 'v20260803' — reproducibility (R14)
  areaHa: number;
}

export interface LegalEntityEvidence extends EvidenceBase {
  kind: 'legal_entity';
  lei: string | null;
  legalName: string | null;
  entityStatus: string | null;     // ACTIVE / INACTIVE
  registrationStatus: string | null;
  jurisdiction: string | null;
  matchQuality: 'exact' | 'fuzzy' | 'none';
}

export interface SanctionsEvidence extends EvidenceBase {
  kind: 'sanctions';
  lists: Array<{ list: 'OFAC_SDN' | 'EU_CONSOLIDATED'; listDate: string }>;
  matches: Array<{ name: string; list: string; score: number; entryId: string }>;
}

export type Evidence = DeforestationEvidence | LegalEntityEvidence | SanctionsEvidence;

export interface EvidenceBundle {
  bundleId: string;
  evidenceAsOf: string;    // ISO — BUKAN now(). Lihat R4.
  items: Evidence[];
  bundleHash: string;      // sha256, di-anchor onchain
  blobUrl: string;
}

// ---------- Agent ----------
export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface Finding {
  severity: 'critical' | 'major' | 'minor' | 'info';
  claim: string;
  contradiction: string;
  evidenceIds: string[];   // WAJIB ada di bundle — divalidasi kode, bukan dipercaya
}

export interface AgentAssessment {
  verdict: Verdict;
  confidence: number;      // 0-100
  findings: Finding[];
  summary: string;
}

// ---------- Verification ----------
export type VerificationStatus =
  | 'pending' | 'collecting' | 'assessing'
  | 'awaiting_review' | 'attested' | 'revoked' | 'failed';

export interface Plot {
  id: string;
  name: string;
  geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  geohash: string;
  areaHa: number;
  operatorName: string;
  source: 'upload' | 'mill_dataset';
}

export interface HumanReview {
  decision: 'approve' | 'reject' | 'override';
  overrideVerdict?: Verdict;
  reason: string;
  reviewedBy: string;
  reviewedAt: string;
}

export interface Verification {
  id: string;
  status: VerificationStatus;
  plot: Plot;
  bundle: EvidenceBundle | null;
  assessment: AgentAssessment | null;
  review: HumanReview | null;
  attestation: AttestationRef | null;
  error: string | null;        // error jujur, ditampilkan di UI
  createdAt: string;
}

export interface AttestationRef {
  uid: `0x${string}`;
  txHash: `0x${string}`;
  chainId: number;
  schemaUid: `0x${string}`;
  attestedAt: string;
  revoked: boolean;
  revokedAt: string | null;
  revokeTxHash: `0x${string}` | null;
  revokeReason: string | null;
  explorerUrl: string;
  easscanUrl: string;
}
```

**Kontrak endpoint** (bekukan path dan bentuknya sekarang juga):

| Method | Path | Body → Response |
|---|---|---|
| `GET` | `/api/mills?bbox=` | → `Plot[]` (seed 1.431 pabrik) |
| `POST` | `/api/verifications` | `{ plot, operatorName, evidenceAsOf? }` → `Verification` |
| `GET` | `/api/verifications` | → `Verification[]` |
| `GET` | `/api/verifications/[id]` | → `Verification` |
| `POST` | `/api/verifications/[id]/review` | `HumanReview` → `Verification` |
| `POST` | `/api/verifications/[id]/attest` | → `Verification` (dengan `attestation`) |
| `POST` | `/api/verifications/[id]/recheck` | → `Verification` (bisa memicu revoke) |
| `GET` | `/api/v1/verify/[uid]` | → status publik, dibaca dari chain |
| `GET` | `/api/cron/watch` | cron watcher |

### 0.4 — Daftarkan EAS schema (Dev B) ✅ SELESAI 2026-08-03

Skrip `scripts/register-schema.ts` (idempoten — UID schema deterministik, jadi ia membaca registry dulu dan hanya mengirim tx bila belum ada). Field ada di `IDEA.md` §5. **`revocable: true`.**

Terdaftar di **Base Sepolia (84532)**:

```
EAS_SCHEMA_UID=0x9e8b55aca7c009f585ab66efee61cd48edf3167f8e03a858508bd85f1e2c9c25
https://base-sepolia.easscan.org/schema/view/0x9e8b55aca7c009f585ab66efee61cd48edf3167f8e03a858508bd85f1e2c9c25
```

Sudah masuk `.env`. **Jangan daftarkan ulang** — string schema yang sama menghasilkan UID yang sama; kalau string-nya diubah sedikit saja, UID berubah dan semua attestation lama jadi tak sepadan.

### 0.5 — Skema DB (Dev B, disepakati bersama)

Tabel: `plots`, `verifications`, `evidence_items`, `attestations`, `sanctions_entries`, `review_log`, `watch_runs`.
Selaraskan dengan `lib/types.ts` — jangan biarkan bentuk DB dan bentuk API menyimpang.

Migrasi `drizzle/0000_minor_luminals.sql` sudah diterapkan ke Neon (7 tabel terbaca lewat `npm run db:check`).

### 0.6 — 🔍 Kontrak wajib **verified** (Dev B)

Kita tidak men-deploy kontrak kustom — itu ada di daftar OUT (`CLAUDE.md` §2). Tapi juri tetap harus bisa **membaca kode yang benar-benar mengeksekusi attestation kita**. Maka "verified" di proyek ini punya definisi yang tegas dan diuji otomatis:

```bash
npm run chain:verify     # scripts/verify-contracts.ts — exit 1 bila ada yang gagal
```

Yang dibuktikan (semuanya lewat panggilan nyata, bukan asumsi):

| # | Klaim | Cara dibuktikan |
|---|---|---|
| 1 | Kontrak yang kita panggil punya bytecode di chain ini | `eth_getCode` via viem |
| 2 | Source code EAS + SchemaRegistry ter-verify di explorer | Blockscout v2 `/smart-contracts/{addr}` |
| 3 | **Implementasi di balik proxy EIP-1967 juga verified** | resolve `implementations[]`, cek satu per satu |
| 4 | Schema SNITCH terdaftar, `revocable == true`, string identik, resolver kosong | `getSchema()` di registry |
| 5 | `EAS_SCHEMA_UID` di env cocok dengan yang di chain | bandingkan env vs record chain |

Poin 3 penting dan mudah terlewat: proxy yang verified **tidak** berarti logikanya bisa dibaca. Yang dieksekusi adalah implementasinya.

**Hasil terukur 2026-08-03, Base Sepolia — semuanya hijau:**

| Kontrak | Alamat | Status |
|---|---|---|
| EAS (proxy) | `0x4200…0021` | verified · Solidity 0.8.15 |
| ↳ implementasi EAS | `0xC0D3…0021` | **verified** · 0.8.19 |
| SchemaRegistry (proxy) | `0x4200…0020` | verified · Solidity 0.8.15 |
| ↳ implementasi SchemaRegistry | `0xc0d3…0020` | **verified** · 0.8.19 |
| Schema SNITCH | `0x9e8b…9c25` | terdaftar · `revocable: true` · resolver `0x0` |

Host Blockscout diturunkan dari `CHAIN_ID` (`blockscoutApiUrl` di `lib/chain/config.ts`), jadi cek ini ikut berpindah sendiri kalau kita menukar ke mainnet — konsisten dengan B1.

**Aturan yang mengikat ke depan:** kalau suatu saat kita benar-benar men-deploy kontrak (mis. resolver EAS untuk stretch goal), kontrak itu **wajib** di-verify di explorer pada commit yang sama dengan deploy-nya, dan alamatnya wajib masuk daftar yang dicek `chain:verify`. Kontrak tak-terverifikasi di produk verifikasi adalah kontradiksi telanjang — kita menuntut transparansi dari eksportir; kita tidak boleh lebih buram dari mereka.

### ✅ Gate keluar Fase 0

- [x] `lib/types.ts` disepakati, di-commit, dan **dibekukan** (225 baris, semua tipe §0.3 ada)
- [x] Semua path endpoint disepakati (tabel §0.3)
- [x] EAS schema terdaftar, UID di `.env` — `0x9e8b…9c25`, `revocable: true`
- [x] Migrasi DB jalan — 7 tabel di Neon, `npm run db:check` hijau
- [x] `npm run build` hijau (Next 16.2.12 + `tsc --noEmit` bersih)
- [x] Wallet Base Sepolia terdanai dari faucet, `CHAIN_ID` dibaca dari env
- [x] **Kontrak verified** — `npm run chain:verify` hijau (§0.6)
- [x] AI Gateway + Vercel Blob hidup — `npm run services:check` hijau (panggilan nyata: `anthropic/claude-sonnet-5` menjawab, blob write→read→delete 200)
- [ ] **Commit pertama** — repo belum punya satu commit pun; semuanya masih staged. "Dibekukan" baru berarti sesuatu setelah `lib/types.ts` ada di history

⚠️ Saldo attester `0x92233F6a1E7881c2605D50494eEF56aa833bFAa9` per 2026-08-03 ≈ **0,0000986 ETH**. Cukup untuk puluhan attest/revoke di Base Sepolia, tapi **top up dari faucet sebelum hari demo** — kehabisan gas di depan juri adalah kegagalan yang tidak perlu.

**Fase 0 tertutup secara teknis — gate kontrak lewat, Fase 1 boleh jalan paralel.** Sisa satu kotak (commit pertama) tidak memblokir Dev A maupun Dev B, tapi kerjakan sebelum menulis baris berikutnya: bekerja paralel tanpa history bersama adalah cara tercepat kehilangan pekerjaan orang lain.

---

## FASE 1 — Paralel

### Kepemilikan file (batas keras — jangan pernah edit milik orang lain)

| Dev A — Frontend | Dev B — Backend + Onchain |
|---|---|
| `app/(ui)/**` | `app/api/**` |
| `components/**` | `lib/evidence/**` |
| `lib/ui/**` | `lib/chain/**` |
| `app/globals.css` | `lib/agent/**` |
| | `lib/db/**` |
| | `scripts/**`, `drizzle/**` |

**Bersama — ubah hanya dengan kesepakatan eksplisit dua orang:**
`lib/types.ts` · `package.json` · `.env.example` · `CLAUDE.md` · `IDEA.md` · `PLAN.md`

---

### Dev B — Backend + Onchain

Urutan ini disengaja: **B1 lebih dulu**, karena ia risiko teknis terbesar. Kalau ia gagal, seluruh produk berubah — dan lebih baik tahu di jam ke-3 daripada di jam ke-30.

**B1 — Dekode tile GFW → alert dalam polygon** ✅ **SELESAI 2026-08-03** — `lib/evidence/gfw.ts` + `gfw.test.ts`, **13 test hijau** (`npm test`)

Prototipe sudah di-commit ke `prototype/` dan diport ke TypeScript ketat. Semua test menyentuh GFW sungguhan — yang diuji adalah kemampuan membaca data nyata, bukan tiruannya.

Terimplementasi dan teruji:
- `pickZoom(ha)` — zoom adaptif (R11)
- `tilesFor()`, `bbox()`, `areaHa()` — luas geodesik spherical-excess, akurasi 0,7% vs elipsoid
- `decodePng()` — dekode + unfilter PNG murni `node:zlib`, nol dependensi
- `pointInPolygon()` — ray casting, menangani MultiPolygon **dan lubang**
- `resolveVersion()` — sematkan versi bertanggal (R14)
- `collectAlerts()` — konkurensi 40, melempar bila tile gagal (R10)
- Confidence dari channel alpha (R3)

**Tereproduksi dari repo**, bukan dari ingatan: petak Sarawak 3.095 ha → z14 → 16 tile → **3.577 alert**, 3.568 setelah cutoff EUDR, semuanya terverifikasi di dalam polygon. Tiga fixture tile `CLAUDE.md` §3.1 cocok persis (293 / 4.889 / 2.956 piksel, rentang tanggal sama), dengan versi dipin ke `v20260803`.

Dua temuan baru saat port:
- **Tile di luar sabuk tropis GFW menjawab HTTP 500 secara konsisten** (terukur: `12/2000/1000`, tiga kali berturut-turut — bukan gangguan sesaat). `fetchTile` melempar setelah retry habis dan **tidak pernah** mengembalikan tile kosong. Ada test khusus untuk klaim ini (R10).
- `rawHash` mencakup piksel mentah **plus** parameter query (versi, zoom, geometri) — tanpa itu dua verifikasi ber-zoom beda bisa berbagi hash yang sama.

**Sisa pekerjaan:** integrasi ke job runner (B6) dan pemakaian di bundler (B4).

**B2 — Konektor GLEIF** ✅ **SELESAI 2026-08-03** — `lib/evidence/gleif.ts` + 7 test hijau

⚠️ **DoD lama diganti karena salah arah.** Bunyinya dulu: *"query 'Sime Darby' mengembalikan entitas nyata"*. Itu justru mendorong bug yang paling berbahaya di modul ini — query itu memang mengembalikan entitas nyata, tapi entitas **Hong Kong, Australia, dan Selandia Baru**. Lulus DoD sambil salah total.

**DoD baru (semuanya sudah lulus):**
- `jurisdiction` ISO alpha-2 **wajib**, divalidasi sebelum request, dan hasilnya difilter ulang di sisi kita
- "Sime Darby" @ MY → `matchQuality: 'none'`, `lei: null` — bukan entitas HK
- "FELDA" @ MY → `none`, tidak pernah menjadi Felda AG (Swiss)
- Operator EU nyata (Unilever N.V. @ NL) → `exact`, LEI `549300TK7G7NZTVM1Z30`
- `entityStatus` dan `registrationStatus` dilaporkan terpisah
- `filter[fulltext]` tidak dipakai sama sekali

**Temuan yang berguna untuk B5:** UNILEVER N.V. ber-`entityStatus: ACTIVE` tapi `registrationStatus: LAPSED`. Kontradiksi semacam ini persis yang harus ditangkap agen — dan hanya terlihat kalau dua status itu tidak disatukan.

**B3 — Konektor sanksi** — `lib/evidence/sanctions.ts`
Unduh OFAC SDN (wajib follow redirect) + EU list → simpan DB → normalisasi nama + fuzzy match. Simpan tanggal daftar.

**B4 — Evidence bundler** — `lib/evidence/bundle.ts`
Rakit bundle, hitung sha256, unggah ke Vercel Blob. **`evidenceAsOf` adalah parameter, bukan `now()`** (R4).

**B5 — Contradiction agent** — `lib/agent/assess.ts`
`generateObject` + zod, `temperature: 0`. Agen hanya menerima bundle; **tidak boleh memanggil API eksternal**.
**Validasi keras:** setiap `evidenceId` di output harus ada di bundle. Kalau tidak → tolak dan ulangi sekali; masih gagal → `INCONCLUSIVE` + error jujur.

**B6 — Job runner + endpoint** — `app/api/**`
Semua endpoint di §0.3. Setiap panggilan eksternal: timeout eksplisit + retry backoff.
**Kritis:** jangan pernah menelan error lalu mengembalikan array kosong. *"Gagal memeriksa" ≠ "bersih"* — kalau tertukar, produk ini justru menerbitkan attestation palsu. Error → status `failed` + pesan di UI.

**B7 — Terbit attestation** — `lib/chain/attest.ts`
viem + EAS SDK. **Chain dari env** (`CHAIN_ID`) supaya mainnet ↔ Sepolia bisa ditukar satu variabel.
Simpan `uid`, `txHash`, URL explorer & easscan.

**B8 — Baca attestation** — `lib/chain/read.ts`
EAS GraphQL Base (publik). Sumber kebenaran untuk halaman publik.

**B9 — Watcher + revoke** — `app/api/cron/watch/route.ts`
Untuk tiap attestation aktif: ambil alert terbaru → ada alert baru setelah `evidenceAsOf`? → `revoke()` onchain, simpan `revokeTxHash` + alasan.
Juga terekspos sebagai `/recheck` manual (R6).

**B10 — Seed dataset pabrik** — `scripts/seed-mills.ts`
Unduh GeoJSON dari ArcGIS FeatureServer → tabel `plots`. 1.431 titik nyata.

---

### Dev A — Frontend

Bangun melawan `lib/types.ts` sejak menit pertama. Panggil endpoint sungguhan; sebelum jadi, tampilkan loading/error nyata.

**A1 — Shell aplikasi** — layout, nav, tema, **atribusi CC BY 4.0 di footer** (wajib lisensi), banner disclaimer *"Indicative verification. Not a legal EUDR Due Diligence Statement."*

**A2 — Peta + intake** — MapLibre GL (tanpa token). Render pabrik dari `/api/mills`, upload GeoJSON dengan validasi + gambar polygon. Tampilkan luas ha.

**A3 — Daftar verifikasi** — tabel berstatus, badge per `VerificationStatus`, polling saat berjalan.

**A4 — Detail verifikasi** — panel bukti:
- Timeline alert deforestasi (garis cutoff EUDR 2020-12-31 jelas terlihat)
- Alert di peta sebagai titik, di dalam polygon
- Kartu entitas GLEIF
- Hasil screening sanksi
- Setiap bukti menampilkan `sourceUrl` + `fetchedAt` yang bisa diklik
- `confidence: null` → render **"unverified"**, bukan angka

**A5 — Panel temuan agen** — findings berperingkat severity; klik sitasi → sorot bukti sumbernya. Ini momen kredibilitas: juri harus bisa melacak setiap klaim ke data mentah.

**A6 — UI human review** — approve / reject / override + alasan wajib. Tampilkan jelas bahwa manusia yang memutuskan.

**A7 — Kartu attestation** — UID, tx hash, tautan explorer + easscan (URL dari env, ikut `CHAIN_ID`), status live, tombol re-verify.

**A8 — Halaman publik `/v/[uid]`** — tanpa login. Verdict, bukti, status live dari chain. **Keadaan REVOKED harus mencolok** — ini pemandangan yang menjual produk.

**A9 — Poles + deck** — state kosong, state error, responsif, alur demo.

---

### 🔄 Titik sinkron (30 menit, jangan dilewati)

| Kapan | Cek |
|---|---|
| Setelah B1 & A2 | Alert nyata tampil di peta ujung-ke-ujung |
| Setelah B6 & A4 | Alur verifikasi penuh sampai `awaiting_review` |
| Setelah B7 & A7 | Attestation nyata terbit, terlihat di sepolia.basescan.org |
| Setelah B9 & A8 | **Revocation live** — demo money shot |

---

## FASE 2 — Integrasi & demo (bersama)

1. Uji ujung-ke-ujung dengan petak nyata (Sarawak, Riau, Kalimantan)
2. Siapkan skenario demo R4: attestation dengan `evidenceAsOf` lampau pada petak yang memang punya alert sesudahnya
3. README: arsitektur, sumber data, cara jalan, **atribusi CC BY 4.0**, limitasi
4. Deck mengikuti `IDEA.md` §9 dan §11
5. Latih demo 7 menit sampai hafal — termasuk jawaban Q&A untuk tiap limitasi
6. Sapuan terakhir: **grep seluruh repo untuk mock/dummy/placeholder/TODO.** Nol hasil.

---

## Definition of Done

- [ ] F1–F9 jalan dengan data nyata ujung-ke-ujung
- [ ] Nol mock data, nol mock fitur, nol placeholder
- [ ] Attestation nyata di Base Sepolia, bisa dibuka juri di explorer
- [x] **Semua kontrak yang dipakai verified di explorer** (termasuk implementasi di balik proxy) — `npm run chain:verify` hijau, §0.6
- [ ] Revocation nyata terbukti, dipicu bukti satelit asli
- [ ] Halaman publik memverifikasi tanpa akun
- [ ] Atribusi CC BY 4.0 tampil
- [ ] Disclaimer legal tampil
- [ ] README + deck selesai
- [ ] Demo dilatih, dengan jawaban Q&A untuk setiap limitasi
- [ ] Repo publik, commit history menunjukkan kerja selama periode hackathon

---

## Register risiko

> **Status per 2026-08-03 (audit akhir Fase 0):** R1, R11, R13, R15, R18, R20, R21 tertutup dengan bukti yang **ada di repo ini**.
> R2 dan R14 sempat dibuka lagi saat audit (prototipe belum ter-commit), lalu **ditutup ulang dengan bukti yang bisa dijalankan** — `npm test`, 13 hijau.
> Pelajaran yang mahal: **risiko hanya tertutup kalau buktinya bisa dijalankan ulang dari repo.**

| ID | Risiko | Pemilik | Mitigasi |
|---|---|---|---|
| **R1** | ~~Pendanaan wallet mainnet lambat~~ **DIHILANGKAN 2026-08-03** | Dev B | **Default diubah ke Base Sepolia.** Faucet instan, risiko nol, EAS + indexer + revoke semuanya terverifikasi jalan di sana. Blocker ini tadinya kita ciptakan sendiri dengan memilih mainnet. Mainnet kini opsional: satu attestation showcase bila dana kebetulan siap |
| **R2** | ~~Presisi polygon dari raster tile~~ **TERTUTUP DI REPO 2026-08-03** | Dev B | `lib/evidence/gfw.ts` + 13 test hijau (`npm test`). Petak 3.095 ha → 16 tile → 3.577 alert, semuanya terverifikasi di dalam polygon; tiga fixture tile §3.1 cocok persis. Bukti bisa dijalankan ulang siapa pun dari repo |
| **R3** | ~~Channel confidence gagal dikalibrasi~~ **TERPECAHKAN** | Dev B | Confidence ada di **channel ALPHA** {4=low, 8=high, 24=highest}, bukan channel B. Diverifikasi lewat prediksi terkonfirmasi (kohort `low` = termuda) |
| **R4** | Demo revocation tak bisa menunggu alert asli | Berdua | `evidenceAsOf` lampau pada petak yang memang punya alert sesudahnya. Data 100% asli. **Rancang sebagai field sejak awal** |
| **R5** | Halusinasi LLM | Dev B | `generateObject` + zod, temp 0, validasi `evidenceId` terhadap bundle |
| **R6** | Cron Vercel minimum harian | Dev B | Tombol "Re-verify now" memicu job runner yang sama |
| **R7** | Klaim hukum | Berdua | Disclaimer di UI dan attestation. Sebut di pitch |
| **R8** | Kunci privat di env | Dev B | Wallet berdana kecil, jangan pernah di-commit. Akui di roadmap |
| **R9** | Scope creep | Berdua | Daftar OUT di `CLAUDE.md` §2 mengikat. Jawaban default: tidak |
| **R10** | Menelan error → dibaca sebagai "bersih" | Dev B | Larangan eksplisit di review kode. Error → status `failed` |
| **R11** | ~~z14 untuk radius 50 km = 1.681 tile ≈ 6 menit~~ **TERPECAHKAN 2026-08-03** | Dev B | Zoom adaptif: z12 untuk AOI luas (121 tile, **4,0 s** @ konkurensi 40), z14 untuk petak (4–9 tile). Sudah masuk `CLAUDE.md` §3.1 |
| **R12** | Dataset pabrik bergeometri **POINT, bukan polygon** | Dev B | Radius sourcing 50 km (metodologi standar WRI/GFW). Bedakan di UI: *mill sourcing risk* ≠ *plot-level verification* |
| **R13** | ~~EAS SDK berbasis ethers v6 vs stack viem~~ **TERPECAHKAN — kini terbukti di repo** | Dev B | **Buang `eas-sdk`.** `lib/chain/eas.ts` (viem murni) sudah dipakai nyata oleh `chain:check`, `schema:register`, dan `chain:verify` terhadap Base Sepolia: `getSchema` terbaca, UID schema dihitung deterministik, ABI attest/revoke siap. Satu web3 lib saja |
| **R14** | ~~Bukti tidak reproducible bila memakai `latest`~~ **TERTUTUP DI REPO 2026-08-03** | Dev B | `resolveVersion()` menyematkan versi bertanggal ke `tileVersion` dan ke `sourceUrl`; test menolak `latest` secara eksplisit. Fixture test dipin ke `v20260803` — tetap valid walau GFW terbit harian |
| **R15** | ~~Akun Vercel belum diverifikasi~~ **TERPECAHKAN** | Berdua | CLI terautentikasi (`wngstnr-code`). Provisioning Neon/Blob/AI Gateway tetap dilakukan di Fase 0.2, tapi bukan blocker |
| **R16** | **Bundle bukti membengkak** — 3.577 alert = 377 KB untuk 3.095 ha; AOI radius 50 km ≈ **93 MB** | Dev B | **Agregasi wajib di B4.** Simpan ringkasan deterministik (hitungan per bulan × confidence) selalu; daftar alert penuh hanya bila ≤ 5.000; di atas itu simpan agregat + N alert terbaru/terparah. Hash mencakup apa yang disimpan **plus** parameter query (versi, zoom, hash polygon) agar tetap reproducible |
| **R17** | **Cakupan GLEIF untuk eksportir MY nihil** (2.256 entitas MY, 0 "PLANTATION"); pencocokan naif menghasilkan false positive lintas yurisdiksi | Berdua | **Peran GLEIF diubah**: verifikasi **operator EU** (cakupan tinggi, dan secara hukum memang pihak yang wajib DDS). Sisi eksportir diganti **cross-check sertifikasi RSPO**. Lihat `CLAUDE.md` §3.2 & §3.4b |
| **R18** | ~~Server WRI commodities MapServer lambat~~ **TERPECAHKAN** | Dev B | WRI MapServer **tidak bisa dipakai sama sekali** (semua query timeout, bahkan `returnCountOnly`). Diganti mirror hosted `Oil_Palm_Concessions` — **248 poligon Malaysia, 1,6 s**. Lihat `CLAUDE.md` §3.4b |
| **R19** | Poligon konsesi ber-vintage **2010**, sebagian `area_ha=0`, lisensi re-upload tidak jelas | Berdua | Pakai sebagai pemilih kemudahan demo saja; **upload GeoJSON tetap jalur utama**. Hitung ulang luas dengan `areaHa()`. Tampilkan field `source` per fitur dan sebut vintage-nya terbuka di pitch |
| **R20** | ~~Sumber daftar RSPO otoritatif belum ketemu~~ **TERPECAHKAN** | Dev B | **Universal Mill List** hosted: 1.994 pabrik, 500 Malaysia (140 certified / 360 tidak), dengan `UML_ID` sebagai join key dan `RSPO_Type` (MB/IP). Cross-check dua-dataset kini penuh. Lihat `CLAUDE.md` §3.4c |
| **R21** | **Kontrak tak-terverifikasi merusak klaim transparansi** — juri tidak bisa membaca kode yang mengeksekusi attestation; proxy verified ≠ implementasi verified | Dev B | ~~Risiko~~ **TERTUTUP 2026-08-03**: `npm run chain:verify` membuktikan EAS + SchemaRegistry **beserta implementasi EIP-1967-nya** verified di Blockscout, plus schema `revocable: true` & UID cocok dengan env. Cek ini mengikuti `CHAIN_ID`. Kontrak baru apa pun wajib verified di commit yang sama dengan deploy-nya |

---

## Protokol harian

- **Sinkron pagi (10 menit):** kemarin apa, hari ini apa, terblokir di mana
- **Sinkron sore (15 menit):** integrasikan, jalankan alur ujung-ke-ujung, perbaiki penyimpangan kontrak
- Perubahan `lib/types.ts` **wajib diumumkan** — ia memutus kerja orang lain
- Branch `feat/`, conventional commits, PR untuk apa pun yang menyentuh file bersama
- Aturan dua-kali-gagal: satu pendekatan gagal dua kali → berhenti, laporkan, jangan terus mencoba varian
