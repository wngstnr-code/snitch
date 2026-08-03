# SNITCH — Living Compliance Attestations

> ChainHack 2026 / NeuralLedger 5.0 — Track: **Industrial 5.0** (+ AI × Web3, Real-World Finance)

**Peta dokumen — jangan duplikasi isi antar file:**
- `IDEA.md` — produk, masalah, diferensiasi, pasar, alur demo, limitasi. Sumber kebenaran untuk *apa* dan *kenapa*.
- `PLAN.md` — kontrak tipe, pembagian tugas, urutan kerja, register risiko. Sumber kebenaran untuk *siapa mengerjakan apa, kapan*.
- `CLAUDE.md` (file ini) — aturan operasional, endpoint terverifikasi, konvensi kode. Sumber kebenaran untuk *bagaimana*.
- `AGENTS.md` — panduan Next.js versi ini dari scaffold. **Baca sebelum menulis kode Next.js**; API dan konvensinya berbeda dari yang mungkin kamu hafal.

Bila terjadi konflik: §0 di bawah menang atas segalanya.

---

## 0. Aturan mutlak proyek ini

**TIDAK ADA MOCK DATA. TIDAK ADA MOCK FITUR. TIDAK ADA PLACEHOLDER.**

Ini bukan preferensi gaya — ini alasan tim ini pernah gagal lolos sebelumnya. Berlaku untuk semua orang dan semua agen.

Yang dilarang keras:
- `const MOCK_ALERTS = [...]`, fixture palsu, seed data karangan
- Tombol yang tidak melakukan apa-apa, halaman "coming soon", chart dengan angka hardcoded
- `setTimeout` untuk mensimulasikan loading atau mensimulasikan hasil
- Menghasilkan angka dari LLM lalu menampilkannya seolah-olah itu data terukur
- Screenshot/GIF di demo yang bukan aplikasi yang benar-benar berjalan

Yang wajib:
- Setiap angka di layar berasal dari respons HTTP nyata, hasil dekode piksel nyata, atau transaksi onchain nyata
- Setiap panggilan eksternal yang gagal ditampilkan sebagai **error jujur di UI**, bukan disembunyikan di balik data cadangan karangan
- Kalau sebuah fitur belum jadi, **jangan render UI-nya sama sekali**. Lebih baik aplikasi kecil yang seluruhnya nyata daripada aplikasi besar yang separuh teater.

Satu-satunya "data statis" yang diizinkan adalah **dokumen referensi resmi yang dipublikasikan** (mis. nilai default CBAM terbitan Komisi Eropa, daftar OFAC SDN). Itu bukan mock — itu dataset otoritatif. Wajib disertai URL sumber dan tanggal unduh di dalam repo.

---

## 1. Produk dalam satu paragraf

Sertifikat kepatuhan rantai pasok hari ini adalah PDF: ditandatangani sekali, berlaku 12 bulan, dan membusuk diam-diam — kalau petak lahan ditebang bulan depan, PDF-nya tetap terlihat sah. SNITCH adalah **oracle verifikasi**: agen AI yang menantang klaim eksportir terhadap bukti independen (alert deforestasi satelit, registri badan hukum, daftar sanksi), meminta persetujuan manusia, lalu menerbitkan **attestation onchain yang mencabut dirinya sendiri** ketika bukti satelit baru bertentangan dengannya.

Target pengguna: eksportir sawit/karet/kayu Malaysia & SEA yang menghadapi EUDR (berlaku 30 Des 2026), dan importir EU yang harus memverifikasi mereka.

**Kalimat pitch:** *"PDF certificates go stale silently. Ours revoke themselves."*

---

## 2. Scope terkunci

### IN — wajib jadi (definition of done proyek)

| # | Fitur | Bukti "nyata"-nya |
|---|---|---|
| F1 | Intake petak lahan: upload GeoJSON **atau** pilih dari dataset pabrik sawit asli | 1.431 pabrik nyata dari ArcGIS Hub |
| F2 | Evidence: alert deforestasi per polygon sejak cutoff EUDR (2020-12-31) | Dekode tile GFW live |
| F3 | Evidence: verifikasi badan hukum **operator EU** (bukan eksportir MY — lihat §3.2) | GLEIF LEI API |
| F4 | Evidence: screening sanksi entitas | OFAC SDN + EU consolidated list |
| F5 | Agen kontradiksi AI → daftar non-conformance terstruktur bersitasi | AI SDK `generateObject`, sitasi wajib ke evidence ID |
| F6 | Human review: approve / reject / override + alasan | Tersimpan & ikut masuk attestation |
| F7 | Terbitkan attestation EAS di Base Sepolia (revocable) | Tx hash nyata, bisa dibuka di explorer |
| F8 | Watcher: cek ulang alert → **auto-revoke onchain** | Tx revoke nyata |
| F9 | Halaman verifikasi publik: paste UID → verdict + bukti + status live | Baca dari EAS GraphQL |

### STRETCH — hanya kalau IN sudah 100% selesai dan stabil
- **S1 — x402 paywall** di `GET /api/v1/verify/[uid]`: agen importir bayar USDC per panggilan.
- **S2 — Ekstraksi dokumen**: OCR/LLM atas PDF asli (delivery order, sertifikat MSPO).
- **S3 — Pin evidence bundle ke IPFS** (Storacha) selain Vercel Blob.

### OUT — jangan sentuh, ini roadmap untuk slide, bukan kode
- Perhitungan emisi CBAM
- Multi-tenant, billing, org management
- Mobile app
- Smart contract kustom di luar EAS

Kalau ada yang ingin menambah scope: jawabannya tidak. Kedalaman mengalahkan keluasan di rubrik ini.

---

## 3. Sumber data — semua sudah diuji, semua tanpa pendaftaran

Semua baris di bawah ini **sudah diverifikasi dengan panggilan nyata pada 3 Agustus 2026.** Jangan ganti tanpa menguji ulang.

### 3.1 GFW Integrated Deforestation Alerts — INTI PRODUK

```
https://tiles.globalforestwatch.org/gfw_integrated_alerts/latest/default/{z}/{x}/{y}.png
```

- **Tanpa API key.** (Endpoint `data-api.globalforestwatch.org/query` BUTUH key → **jangan dipakai**, akan kena 403.)
- Redirect ke versi bertanggal, mis. `v20260803` — diperbarui harian.
- **Zoom ADAPTIF menurut luas AOI** — jangan pakai z14 tetap. Terukur pada 2026-08-03:

| AOI | Zoom | Jumlah tile | Waktu (konkurensi 40) |
|---|---|---|---|
| Petak lahan ≤ 2.000 ha | **z14** (9,5 m/px) | 4–9 | < 1 s |
| Radius sourcing pabrik 50 km | **z12** (38 m/px) | 121 | **4,0 s**, 2,1 MB |
| *(z14 untuk radius 50 km)* | ~~z14~~ | ~~1.681~~ | ~~≈ 6 menit — tidak layak~~ |

  Aturan: `zoom = luas_AOI > 5.000 ha ? 12 : 14`. Resolusi native Sentinel 10 m, jadi z15+ hanya upsampling.
- Tersedia z12–z17 (terverifikasi).
- **Konkurensi 40 aman** — 121/121 sukses, tidak ada rate limiting terdeteksi. Jangan lampaui tanpa uji ulang.
- **Sematkan versi bertanggal ke dalam bukti.** `latest` me-redirect ke mis. `v20260803`; catat versi hasil resolusi itu di evidence, jangan `latest`, supaya verifikasi dapat direproduksi.

**Encoding piksel (channel tanggal sudah diverifikasi benar):**
```
hari = R * 255 + G
tanggal_alert = 2014-12-31 + hari
```
**Confidence — TERPECAHKAN 2026-08-03.** Bukan di channel B (itu intensitas render, 105–255 kontinu). Confidence ada di **channel ALPHA**, yang hanya punya tiga nilai diskret:

```
alpha 4  → 'low'      alpha 8  → 'high'      alpha 24 → 'highest'
```

Diverifikasi lewat prediksi yang terkonfirmasi: alert baru semestinya berconfidence rendah (belum dikonfirmasi sistem satelit kedua). Terukur — median `low` = 2026-05-28, median `high` = 2023-08-16. Kohort `low` memang yang termuda.

Nilai alpha di luar tiga itu → kembalikan `null`, jangan ditebak.

Piksel dengan `alpha == 0` atau `R == 0 && G == 0` = tidak ada alert.

Hasil uji referensi (pakai ini sebagai test fixture regresi — ini nilai nyata, bukan mock):
```
Riau      z12/3202/2042 → 293 piksel   | 2021-02-15 .. 2026-07-15
Sarawak   z12/3333/2019 → 4.889 piksel | 2020-01-12 .. 2026-07-23
Kalimantan z12/3333/2065 → 2.956 piksel | 2020-01-31 .. 2026-07-23
```

**Lisensi: CC BY 4.0 — atribusi WAJIB** di footer aplikasi dan README.

### 3.2 GLEIF — identitas badan hukum ⚠️ PERAN DIUBAH 2026-08-03
```
https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=<nama>&page[size]=10
Header: Accept: application/vnd.api+json
```
Tanpa key. Ambil: `legalName`, `entity.status`, `registration.status`, yurisdiksi.

**Temuan yang mengubah desain — jangan diulangi kesalahannya.** LEI adalah identifier pasar keuangan Eropa, bukan registri perusahaan universal. Terukur:

| Yurisdiksi | Entitas di GLEIF |
|---|---|
| Jerman | 394.915 |
| Italia | 256.223 |
| Belanda | 194.567 |
| **Malaysia** | **2.256** |
| **Entitas MY mengandung "PLANTATION"** | **0** |

Sime Darby Plantation, IOI Corporation, IJM Plantations, TSH — **tidak satu pun ada**. Lebih buruk: pencocokan nama naif menghasilkan **false positive lintas yurisdiksi** — "FELDA" cocok ke entitas Swiss, "PROSPER" ke Prancis. Pada produk verifikasi, itu kesalahan fatal.

**Maka:**
- ❌ **JANGAN** pakai GLEIF untuk memverifikasi eksportir Malaysia. Cakupannya nihil.
- ✅ **PAKAI** GLEIF untuk memverifikasi **operator/importir EU** — pihak yang secara hukum wajib mengajukan DDS di bawah EUDR revisi. Cakupan di sana sangat baik, dan ini justru lebih tepat secara hukum.
- ✅ **Wajib** sertakan `filter[entity.jurisdiction]` dan tolak match lintas yurisdiksi.
- ⚠️ `filter[fulltext]` berperingkat buruk (KLK → "Metso Minerals"). Jangan dipakai tanpa filter yurisdiksi + verifikasi nama.

**Pengganti sisi eksportir:** cross-check sertifikasi RSPO (§3.4c).

### 3.3 Sanksi
- OFAC SDN CSV: `https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV` (~5,6 MB, wajib follow redirect `-L`)
- EU consolidated: `https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw`

Unduh saat build/cron, simpan di DB, cocokkan dengan normalisasi nama + fuzzy match. Simpan tanggal unduh.

### 3.4 Dataset pabrik sawit (seed F1) — terverifikasi

FeatureServer publik, tanpa key, **1.431 fitur** (terhitung nyata):
```
https://services1.arcgis.com/RTK5Unh1Z71JKIiR/arcgis/rest/services/Mills/FeatureServer/0/query
  ?where=1=1&outFields=*&f=geojson&resultOffset=<n>&resultRecordCount=1000
```
Paginasi wajib — respons menandai `exceededTransferLimit: true`.

Field nyata yang tersedia: `Mill_Name`, **`Parent_Company`** (nama Sdn Bhd/Berhad asli), **`RSPO_Certified`** (klaim nyata untuk diuji), `Country`, `Province`, `District`.

⚠️ **Geometrinya POINT, bukan polygon.** Pabrik adalah titik, bukan petak lahan. Maka:
- Untuk pabrik → bangun **radius sourcing 50 km** (metodologi standar industri sawit yang dipakai WRI/GFW, bukan akal-akalan) → analisis pada z12
- Untuk petak lahan sungguhan → polygon dari upload GeoJSON pengguna → z14

Bedakan keduanya di UI dengan jujur: yang satu adalah *mill sourcing risk*, yang lain adalah *plot-level verification*. Jangan menyebut analisis radius sebagai verifikasi petak.

### 3.4b Poligon konsesi

❌ **JANGAN pakai `gis-gfw.wri.org/arcgis/rest/services/commodities/MapServer`.** Sudah diuji tuntas 2026-08-03: metadata cepat (1 s), tetapi **setiap query timeout** — termasuk `returnCountOnly` dan `returnIdsOnly`, query termurah yang ada. Server ArcGIS 10.61 itu tidak melayani query. Jangan buang waktu mencobanya lagi.

✅ **Pakai mirror yang di-host** — cepat dan terverifikasi:
```
https://services1.arcgis.com/Hkc3bAqSR3WGz2YJ/arcgis/rest/services/Oil_Palm_Concessions/FeatureServer/0
```

| Metrik | Nilai terukur |
|---|---|
| Total poligon | 2.235 |
| **Malaysia (`country='MYS'`)** | **248** |
| Indonesia | 1.855 |
| Kecepatan | count 1,6 s · fetch 0,8 s |

Field: `name`, `company`, `group_comp`, `type`, `area_ha`, `source`, `last_updat`, `country`.
Konsesi Malaysia nyata di dalamnya: Samling, Rimbunan Hijau, Woodijaya, Tamar Holding — dengan atribusi sumber per-fitur ("Sarawak Forest Department maps, 2010", EIA via NREB/Aidenvironment).

⚠️ **Batasan yang wajib dinyatakan terbuka:**
- Vintage data **2010** — tua. Sebut ini di UI dan pitch.
- Sebagian fitur ber-`area_ha = 0` dan `type` kosong → hitung ulang luas sendiri dengan `areaHa()`, jangan percaya field-nya.
- Ini **re-upload pihak ketiga** dengan lisensi tidak jelas. Maka: pakai sebagai **pemilih kemudahan untuk demo**, tampilkan field `source` per fitur, dan jaga **upload GeoJSON pengguna tetap sebagai jalur utama**.

### 3.4c Universal Mill List — sumber cross-check RSPO ✅ TERVERIFIKASI

```
https://services1.arcgis.com/Hkc3bAqSR3WGz2YJ/arcgis/rest/services/Universal_Mill_List/FeatureServer/0
```
Hosted, cepat, tanpa key. **1.994 pabrik total · 500 Malaysia (140 RSPO Certified, 360 tidak).**

Field kunci: **`UML_ID`** (identifier pabrik universal stabil, mis. `PO1000000019` — pakai ini sebagai join key), `RSPO_Statu` (`RSPO Certified` / `Not RSPO Certified`), **`RSPO_Type`** (model rantai pasok: `MB` = Mass Balance, `IP` = Identity Preserved), `Mill_Name`, `Parent_Com`, `Group_Name`, `Country`, `Confidence` (keyakinan lokasi), lat/long.

**Inilah cross-check adversarialnya — dua dataset independen diadu:**

| Dataset | Klaim | Jumlah |
|---|---|---|
| Unilever Palm Oil Mills (§3.4) | `RSPO_Certified: Yes/No` | 1.431 |
| **Universal Mill List** (di sini) | `RSPO_Statu` | 1.994 |

Join berdasarkan `UML_ID` bila ada, jika tidak berdasarkan nama + kedekatan koordinat. **Ketidaksepakatan antara keduanya = non-conformance nyata** — ditemukan tanpa mempercayai pihak mana pun. Ini menggantikan peran GLEIF di sisi eksportir, dan lebih kuat karena buktinya berasal dari dua sumber yang tidak saling mengendalikan.

### 3.5 Cadangan (pakai hanya bila perlu)
- Earth Search STAC (Sentinel-2/Landsat): `https://earth-search.aws.element84.com/v1` — tanpa auth
- Open-Meteo, NASA POWER, Overpass/OSM — semua tanpa key

---

## 4. Onchain — terverifikasi

**Jaringan default: Base Sepolia** (chainId 84532). EAS adalah **predeploy OP-Stack**, jadi native di Base dan **alamatnya identik di mainnet maupun testnet**:

```
EAS            0x4200000000000000000000000000000000000021   (sama di kedua chain)
SchemaRegistry 0x4200000000000000000000000000000000000020   (sama di kedua chain)

DEFAULT — Base Sepolia (84532)          OPSIONAL — Base mainnet (8453)
RPC      https://sepolia.base.org        RPC      https://mainnet.base.org
Explorer https://sepolia.basescan.org    Explorer https://basescan.org
EAS      https://base-sepolia.easscan.org  EAS    https://base.easscan.org
```

Semua diverifikasi 2026-08-03: kedua predeploy ada di Sepolia, GraphQL indexer aktif, dan ditemukan attestation yang benar-benar ter-revoke di sana → **fitur revoke hidup di testnet.**

> **Kenapa testnet, bukan mainnet.** Testnet **bukan mock** — Base Sepolia adalah chain sungguhan dengan konsensus dan finalitas kriptografis nyata. Attestation dan revocation-nya nyata. Aturan §0 tidak dilanggar sama sekali.
>
> Memilih mainnet berarti menciptakan sendiri satu-satunya blocker ber-lead-time di proyek ini (pendanaan wallet), dan menaruh dana nyata di belakang kunci privat yang disimpan di env var. Faucet Sepolia instan dan risikonya nol. Bug pada watcher yang melakukan loop attest/revoke membakar uang di mainnet, gratis di testnet.
>
> **Mainnet = opsional.** Bila wallet kebetulan sudah terdanai sebelum demo, terbitkan **satu** attestation showcase di mainnet sebagai pelengkap. Chain dibaca dari env (`CHAIN_ID`), jadi ini pertukaran satu variabel — tanpa menunggu, tanpa risiko.

**Schema EAS** (daftarkan sekali via SchemaRegistry, catat UID-nya di `.env`):

```solidity
string  plotId,
string  plotGeohash,
bytes32 evidenceHash,
string  evidenceUri,
uint8   verdict,          // 0=PASS 1=FAIL 2=INCONCLUSIVE
uint8   confidence,       // 0-100
uint64  evidenceAsOf,     // unix ts data bukti
string  reviewedBy,
string  legalEntityLEI
```

**`revocable: true` — ini wajib, jantung produk.** Attestation tanpa revocable = produk mati.

---

## 5. Stack

- **Next.js 16 App Router + TypeScript**, deploy ke Vercel. Runtime Node.js (jangan pakai `runtime = 'edge'`).
- **Tailwind + shadcn/ui**
- **Postgres via Neon** (Vercel Marketplace) + **Drizzle ORM**
- **AI: Vercel AI SDK v6 + AI Gateway.** Model string: `"anthropic/claude-sonnet-5"`. Jangan hardcode `@ai-sdk/anthropic`.
- **Onchain: viem.** **JANGAN pasang `@ethereum-attestation-service/eas-sdk`** (berbasis ethers v6) — viem murni sudah terbukti cukup untuk baca kontrak EAS dan encode schema data.
- **Evidence bundle: Vercel Blob** (publik) + sha256 di-anchor onchain
- **Peta: MapLibre GL** (tanpa token) — jangan Mapbox, butuh key.
- **Cron: Vercel Cron** untuk watcher

---

## 6. Pembagian kerja — 2 orang

> Ringkasan saja. **Rencana lengkap dengan urutan tugas dan DoD ada di `PLAN.md`** — itu yang mengikat.

**Batas file itu keras. Jangan pernah mengedit file milik orang lain — buka PR atau minta.**

### Dev A — Frontend
Memiliki: `app/(ui)/**`, `components/**`, `app/globals.css`, `lib/ui/**`

### Dev B — Backend + Onchain
Memiliki: `app/api/**`, `lib/evidence/**`, `lib/chain/**`, `lib/agent/**`, `lib/db/**`, `scripts/**`, `drizzle/**`

**Milik bersama — ubah hanya lewat kesepakatan eksplisit dua orang:**
`lib/types.ts` (kontrak API), `package.json`, `CLAUDE.md`, `.env.example`

### Urutan kerja

**Fase 0 — bersama (jangan paralel sebelum ini selesai)**
1. Scaffold Next.js, Tailwind, shadcn, Drizzle, Neon
2. **Kunci `lib/types.ts` lebih dulu** — semua tipe request/response. Ini kontraknya. Setelah terkunci, dua orang bisa jalan penuh paralel.
3. Dev B daftarkan EAS schema di Base Sepolia, simpan UID
4. Ambil ETH testnet dari faucet

**Fase 1 — paralel**

| Dev A (FE) | Dev B (BE/chain) |
|---|---|
| Layout, peta MapLibre, upload GeoJSON | Modul dekode tile GFW + point-in-polygon |
| Halaman daftar & detail verifikasi | Konektor GLEIF + sanksi + cross-check RSPO |
| Panel bukti (timeline alert, kartu entitas) | Skema DB + job runner |
| UI human review (approve/reject/override) | Agen kontradiksi (`generateObject` + zod) |
| Halaman verifikasi publik `/v/[uid]` | Terbit attestation EAS + baca GraphQL |
| Deck & alur demo | Watcher cron + auto-revoke |

Dev A bekerja melawan `lib/types.ts` sejak menit pertama — **jangan menunggu API Dev B jadi**. Tapi **jangan pula membuat mock response**: sampai endpoint hidup, tampilkan state loading/error yang nyata. Panggil endpoint sungguhan; kalau 404, itu memang 404.

**Fase 2 — bersama**
Integrasi, jalankan alur ujung-ke-ujung dengan petak nyata, latih demo, tulis README + deck.

---

## 7. Blocker & gap — analisis jujur

> Register risiko lengkap dan mutakhir (R1–R20, sebagian besar sudah TERPECAHKAN) ada di `PLAN.md`. Bagian ini hanya ringkasan yang perlu diingat saat menulis kode.

### B1 — Chain harus dibaca dari env
Default Base Sepolia; mainnet opsional. **Jangan pernah hardcode chain, RPC, atau URL explorer** — semuanya diturunkan dari `CHAIN_ID`. Ini yang membuat pertukaran mainnet↔testnet jadi satu variabel.

### B2 — Presisi polygon dari raster tile
Tile adalah raster; polygon adalah vektor. Perlu: konversi polygon→daftar tile, dekode piksel, inverse piksel→lat/lon, uji point-in-polygon. Polygon bisa melintasi batas tile. Tulis unit test memakai tile referensi di §3.1.

### B3 — Channel confidence
Sudah terpecahkan (channel alpha, §3.1). Nilai alpha tak dikenal → `null`, jangan ditebak.

### B4 — Demo revocation tidak bisa menunggu alert asli 🔴 PENTING
Alert satelit tidak menyala sesuai jadwal demo. Jangan pernah memalsukannya.
**Solusi sah:** terbitkan attestation dengan `evidenceAsOf` = tanggal lampau (mis. 2026-06-01) pada petak yang **memang** punya alert setelah tanggal itu. Jalankan watcher dengan data hari ini → menemukan alert baru yang sungguh-sungguh nyata → revoke onchain. Seluruhnya data asli, hanya jendela waktunya yang dipilih.
Sarawak z12/3333/2019 punya alert sampai 2026-07-23 — kandidat sempurna.
**Rancang ini masuk model data sejak awal** (`evidenceAsOf` adalah field, bukan `now()`).

### B5 — Halusinasi LLM
**Mitigasi wajib:** agen hanya boleh menyitir `evidenceId` dari bundle yang sudah terkumpul. Pakai `generateObject` + zod, `temperature: 0`. Validasi setiap `evidenceId` di output benar-benar ada di bundle; kalau tidak, tolak dan ulangi. Agen **tidak pernah** memanggil API eksternal sendiri — ia hanya menalar atas bukti yang sudah dikumpulkan kode deterministik.

### B6 — Interval cron Vercel
Hobby plan: minimum harian. Demo butuh on-demand.
**Mitigasi:** tombol "Re-verify now" yang memanggil job runner yang sama. Cron tetap ada untuk cerita produksi.

### B7 — Risiko klaim hukum
Kita menerbitkan "verdict kepatuhan". Kita bukan badan sertifikasi.
**Mitigasi:** label di UI dan attestation: *"Indicative verification. Not a legal EUDR Due Diligence Statement."* Sebut di pitch — ini menambah kredibilitas, bukan mengurangi.

### B8 — Kunci privat di server
Signer key di env var. Untuk produk nyata ini tidak memadai.
**Mitigasi:** akui di slide roadmap (KMS/multisig). Untuk hackathon, wallet testnet berdana faucet sudah cukup. **Jangan pernah commit key.**

### Gap yang diterima secara sadar
- Polygon petak supplier asli bersifat privat → demo pakai data pabrik/konsesi publik + upload GeoJSON. **Sebut ini di depan.**
- Poligon konsesi ber-vintage 2010 dan lisensinya tidak jelas → jalur utama tetap upload GeoJSON.
- Belum ada integrasi ke sistem TRACES/DDS resmi EU → roadmap.
- Belum ada mekanisme banding kalau eksportir menyanggah verdict → roadmap.

---

## 8. Alur demo (latih sampai hafal, 7 menit)

1. Pilih pabrik sawit asli dari peta (1.431 titik nyata) atau upload GeoJSON
2. Jalankan verifikasi — tunjukkan panggilan API nyata mengalir: tile GFW, GLEIF, sanksi, cross-check RSPO
3. Agen menemukan kontradiksi nyata; buka sitasinya ke bukti mentah
4. Human reviewer approve → attestation terbit → **buka sepolia.basescan.org, tunjukkan transaksi nyata**
5. Jalankan watcher pada attestation ber-`evidenceAsOf` lampau → alert baru ditemukan → **revoke live di depan juri**
6. Buka halaman publik `/v/[uid]` → status berubah jadi REVOKED, terbaca dari chain
7. Tutup: limitasi jujur + roadmap (CBAM, x402, DDS integration)

---

## 9. Konvensi kode

- TypeScript strict. Tanpa `any`. Tanpa `@ts-ignore`.
- Semua respons API eksternal divalidasi dengan zod di batas sistem.
- Setiap panggilan eksternal: timeout eksplisit, retry dengan backoff, dan **error yang dipropagasi ke UI** — jangan pernah menelan error lalu mengembalikan array kosong yang terlihat seperti "tidak ada alert". Itu bug yang berbahaya secara semantik: "gagal memeriksa" ≠ "bersih".
- Setiap bukti yang tersimpan wajib membawa: `sourceUrl`, `fetchedAt`, `rawHash`.
- Commit message: conventional commits. Branch: `feat/`, `fix/`.
- **Satu file `.env` untuk seluruh proyek** — taruh di root, dipakai bersama Dev A & Dev B. Next.js otomatis membaca `.env`/`.env.local` di root untuk API routes maupun client, jadi tidak perlu file terpisah per package atau per orang. Ini menghindari drift ("punyaku kok error, punyamu jalan") yang muncul kalau tiap orang punya salinan env sendiri-sendiri.
  - `.env.example` di root harus selalu mutakhir — setiap kali menambah variabel baru, tambahkan juga placeholder-nya di sini pada commit yang sama.
  - `.env` **tidak pernah** di-commit (sudah di `.gitignore`). Bagikan isinya lewat kanal aman (DM, bukan chat grup/publik) saat menambah variabel baru — jangan tempel ke commit message atau issue.
  - Variabel yang wajib ada sejak Fase 0: `CHAIN_ID`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `EAS_SCHEMA_UID`, signer private key (nama jelas, mis. `ATTESTER_PRIVATE_KEY`).

---

## 10. Instruksi untuk agen AI di repo ini

1. **Baca §0 sebelum menulis satu baris pun.** Kalau kamu tergoda menulis data contoh, berhenti dan tanya.
2. Hormati batas kepemilikan file di §6.
3. Jangan mengubah `lib/types.ts` tanpa menyatakannya terang-terangan — itu memutus kerja orang lain.
4. Sebelum memakai API eksternal apa pun yang belum ada di §3, **uji dulu dengan curl** dan laporkan status code sebenarnya. Jangan berasumsi.
5. Kalau sebuah pendekatan gagal dua kali, berhenti dan laporkan — jangan terus mencoba varian.
6. Jangan menambah dependensi yang butuh API key tanpa persetujuan eksplisit. Seluruh arsitektur ini sengaja dibangun bebas-pendaftaran.
7. Saat melaporkan selesai: sebutkan apa yang benar-benar diuji dan apa yang belum. Kalau tes gagal, katakan dan tunjukkan outputnya.
8. **Sebelum operasi file massal (`mv`, `cp`, `rm` dengan glob), periksa dulu apa yang akan tertimpa.** Scaffold dan generator sering membuat file bernama sama (`CLAUDE.md`, `README.md`, `AGENTS.md`) — file dokumen proyek pernah hilang persis karena ini.
