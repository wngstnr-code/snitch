# SNITCH — Living Compliance Attestations

> **Ide terkunci** untuk ChainHack 2026 / NeuralLedger 5.0
> Track utama: **Industrial 5.0** · Track sekunder: AI × Web3, Real-World Finance
> Nama: *Snitch* — agen yang "mengadu" begitu klaim eksportir bertentangan dengan bukti satelit

---

## 1. Pitch satu kalimat

> **"PDF certificates go stale silently. Ours revoke themselves."**

SNITCH adalah oracle verifikasi kepatuhan rantai pasok: agen AI menantang klaim eksportir terhadap bukti satelit dan registri publik yang independen, meminta persetujuan manusia, lalu menerbitkan attestation onchain di Base yang **mencabut dirinya sendiri** ketika bukti baru bertentangan dengannya.

---

## 2. Masalah

### 2.1 Tekanan regulasi yang nyata dan sudah berjalan

Bukan masalah hipotetis. Dua regulasi Uni Eropa memukul tepat di jantung ekspor Malaysia dan Asia Tenggara:

**EUDR (EU Deforestation Regulation)**
- Berlaku **30 Desember 2026** untuk operator besar, **30 Juni 2027** untuk UKM
- Komoditas: **sawit, karet, kayu**, kedelai, sapi, kakao, kopi — tiga pertama adalah ekspor utama Malaysia
- Wajib: **koordinat geolokasi presisi tinggi per petak lahan** + bukti produksi bebas deforestasi setelah cutoff **31 Desember 2020**
- Malaysia diklasifikasikan sebagai *standard-risk origin* → tetap wajib due diligence penuh

**CBAM (Carbon Border Adjustment Mechanism)**
- Fase definitif dimulai **1 Januari 2026** — sudah berjalan sekarang
- Penalti €100/tCO₂e tanpa plafon
- Surcharge karbon diproyeksikan menambah **3–8% biaya freight** dari Malaysia hingga akhir 2026

**ESPR / Digital Product Passport**
- EU Central DPP Registry live **Juli 2026**, deadline perusahaan besar **30 Desember 2026**

Artinya: ada pembeli dengan pistol di kepala, deadline yang pasti, dan anggaran yang sudah dialokasikan.

### 2.2 Masalah inti yang belum dipecahkan siapa pun

Sertifikat kepatuhan hari ini adalah **PDF statis**. Ditandatangani sekali, berlaku 12 bulan.

Konsekuensinya fatal dan halus:

> Kalau petak lahan itu ditebang bulan depan, **PDF-nya tetap terlihat sah** sampai audit berikutnya — mungkin 11 bulan kemudian.

Ini bukan kelalaian administratif. Ini celah struktural EUDR: rezim yang menuntut jaminan berkelanjutan, tetapi ditegakkan dengan artefak yang membeku pada satu titik waktu. Sertifikat **membusuk secara diam-diam**, dan tidak ada yang tahu sampai terlambat.

### 2.3 Masalah kedua: biaya mengunci smallholder

Audit pihak ketiga berbiaya puluhan ribu euro per siklus. Smallholder Malaysia dan Indonesia — yang menyumbang porsi besar produksi sawit — tidak sanggup membayarnya. Hasilnya bukan kepatuhan yang lebih baik, melainkan **eksklusi dari pasar EU**, dan rantai pasok yang justru jadi lebih buram karena volume smallholder mengalir lewat jalur informal.

---

## 3. Solusi

### 3.1 Bukan platform traceability

Penting untuk positioning: **SNITCH bukan database rantai pasok.**

Pemain yang ada (FSC Trace, Hedera×Merck DPP, TraceX, Finboot) semuanya bekerja dengan pola yang sama: *supplier mengunggah data → kita hash → kita simpan di ledger*. Blockchain di situ hanya berfungsi sebagai notaris. Kalau supplier berbohong di input, ledger dengan patuh mengabadikan kebohongan itu selamanya.

SNITCH adalah **trust layer**: kami tidak mempercayai input. Kami mengujinya.

### 3.2 Tiga pilar

**Pilar 1 — Verifikasi adversarial**

Agen AI tidak meringkas klaim eksportir. Ia **menyerangnya**, dengan mengadu setiap klaim ke bukti independen yang tidak dikendalikan eksportir:

| Klaim | Diuji terhadap |
|---|---|
| "Petak ini bebas deforestasi sejak 2020" | Alert satelit GFW (GLAD-L, GLAD-S2, RADD, DIST-ALERT) di dalam polygon |
| "Pabrik ini bersertifikat RSPO" | Universal Mill List (1.994 pabrik) vs Unilever Mill List (1.431) — **dua dataset independen diadu** |
| "Operator EU ini sah dan aktif" | GLEIF Global LEI Index (yurisdiksi EU, cakupan tinggi) |
| "Pihak-pihak ini tidak disanksi" | OFAC SDN + EU consolidated sanctions list |

> **Catatan desain yang mahal dipelajari.** Rancangan awal memakai GLEIF untuk memverifikasi eksportir Malaysia. Pengujian nyata membatalkannya: GLEIF hanya memuat 2.256 entitas Malaysia dan **nol** yang mengandung "PLANTATION" — Sime Darby Plantation, IOI, IJM semuanya absen. Lebih berbahaya lagi, pencocokan nama naif menghasilkan false positive lintas yurisdiksi (FELDA → entitas Swiss).
>
> GLEIF adalah identifier pasar keuangan Eropa, bukan registri perusahaan universal. Maka perannya dipindah ke **sisi operator EU** — yang justru lebih tepat secara hukum, karena di bawah EUDR revisi kewajiban DDS memang berada pada operator pertama yang menempatkan barang di pasar EU. Verifikasi sisi eksportir digantikan cross-check sertifikasi RSPO, yang lebih kuat karena mengadu dua dataset independen.

Output bukan ringkasan naratif. Output adalah **daftar non-conformance terstruktur, setiap butir bersitasi ke bukti mentah** yang bisa diklik dan diperiksa sendiri oleh siapa pun.

**Pilar 2 — Manusia yang memutuskan**

Agen tidak pernah menerbitkan sendiri. Ia menyiapkan berkas; **compliance officer manusia** meninjau, lalu approve, reject, atau override dengan alasan tertulis. Keputusan manusia itu ikut terekam ke dalam attestation, lengkap dengan identitas peninjau.

Ini bukan sekadar demi kepatuhan. Ini posisi desain: AI mempercepat pengumpulan dan penalaran atas bukti; manusia memikul tanggung jawab. Persis definisi **Industrial 5.0** — kolaborasi manusia-mesin, bukan penggantian manusia.

**Pilar 3 — Sertifikat yang hidup**

Ini jantung produknya, dan satu-satunya bagian yang **benar-benar tidak bisa dibangun tanpa blockchain**.

Attestation diterbitkan onchain di Base lewat EAS, dengan flag `revocable: true`. Sebuah watcher terus memantau polygon lahan tersebut terhadap alert satelit terbaru. Begitu muncul alert baru di dalam polygon setelah tanggal bukti attestation, sistem memanggil **`revoke()` onchain**.

Efeknya:
- Importir EU yang menyimpan referensi attestation **langsung melihat status berubah menjadi REVOKED**
- Tanpa email, tanpa audit ulang, tanpa perlu mempercayai SNITCH maupun eksportir
- Verifikasi bisa dilakukan siapa saja, langsung dari chain, bahkan bila SNITCH sebagai perusahaan lenyap besok

**Rantai kepercayaan yang menyembuhkan diri sendiri.** Inilah kenapa harus onchain: pencabutan harus dapat diamati secara publik dan tidak dapat disensor oleh penerbitnya sendiri.

---

## 4. Kenapa arsitekturnya bebas pendaftaran — dan kenapa itu argumen, bukan kompromi

Seluruh pipeline bukti berjalan di atas sumber yang **tidak memerlukan API key sama sekali** (semua diverifikasi dengan panggilan nyata pada 3 Agustus 2026).

Ini awalnya keputusan mitigasi risiko. Tapi untuk sebuah *trust layer*, ia berubah menjadi argumen arsitektural yang kuat:

> Verifikasi SNITCH berjalan di atas data publik yang sama persis yang dirender peta Global Forest Watch di browser, ditambah registri pemerintah terbuka. **Siapa pun dapat mereproduksi verdict kami secara independen.** Tidak ada gatekeeper berbayar, tidak ada satu pun vendor yang bisa mematikan kami.

Sebuah lapisan kepercayaan yang bergantung pada satu API komersial bukanlah lapisan kepercayaan — ia adalah titik kegagalan tunggal yang menyamar.

---

## 5. Arsitektur

```
┌─────────────────────────────────────────────────────────────┐
│  INTAKE                                                      │
│  Upload GeoJSON petak  ·  atau pilih dari 1.431 pabrik asli  │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  EVIDENCE COLLECTOR  (deterministik, tanpa LLM)              │
│                                                              │
│  polygon → daftar tile z14 → dekode piksel PNG               │
│     → alert deforestasi bertanggal, hanya di dalam polygon   │
│  nama entitas → GLEIF LEI  (status, yurisdiksi, kepemilikan) │
│  entitas → OFAC SDN + EU consolidated  (fuzzy name match)    │
│                                                              │
│  setiap bukti membawa: sourceUrl · fetchedAt · rawHash       │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  CONTRADICTION AGENT   (Claude via AI Gateway)               │
│  generateObject + zod · temperature 0                        │
│  HANYA menalar atas bundle · tidak memanggil API sendiri     │
│  setiap temuan WAJIB menyitir evidenceId yang tervalidasi    │
│  → daftar non-conformance + skor keyakinan                   │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  HUMAN REVIEW                                                │
│  approve · reject · override + alasan → masuk ke attestation │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  ONCHAIN — EAS di Base mainnet (predeploy OP-Stack)          │
│  evidence bundle → Vercel Blob · sha256 di-anchor            │
│  attestation revocable: verdict · confidence · evidenceAsOf  │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  WATCHER  (cron + tombol manual)                             │
│  alert baru setelah evidenceAsOf?  →  revoke() ONCHAIN       │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  VERIFIKASI PUBLIK  /v/[uid]                                 │
│  dibaca dari EAS GraphQL Base · tanpa akun · tanpa key       │
└─────────────────────────────────────────────────────────────┘
```

### Stack
Next.js 16 App Router · TypeScript strict · Tailwind + shadcn/ui · MapLibre GL (tanpa token) · Neon Postgres + Drizzle · Vercel AI SDK v6 + AI Gateway · viem + EAS SDK · Vercel Blob · Vercel Cron

### Onchain (terverifikasi)
```
Base Sepolia (default), chainId 84532
EAS            0x4200000000000000000000000000000000000021   (predeploy, sama di mainnet)
SchemaRegistry 0x4200000000000000000000000000000000000020
RPC            https://sepolia.base.org                  (publik)
EAS GraphQL    https://base-sepolia.easscan.org/graphql   (publik)
Opsional       Base mainnet 8453 — satu attestation showcase
```
Testnet **bukan mock**: konsensus, finalitas, attestation, dan revocation semuanya nyata. Dipilih karena menghapus satu-satunya blocker ber-lead-time dan menghilangkan risiko dana di belakang kunci privat env var.

### Schema EAS
```solidity
string  plotId,
string  plotGeohash,
bytes32 evidenceHash,
string  evidenceUri,
uint8   verdict,        // 0=PASS 1=FAIL 2=INCONCLUSIVE
uint8   confidence,     // 0-100
uint64  evidenceAsOf,
string  reviewedBy,
string  legalEntityLEI
```
`revocable: true` — non-negotiable.

---

## 6. Sumber data (semua terverifikasi, semua tanpa pendaftaran)

| Sumber | Fungsi | Status uji 2026-08-03 |
|---|---|---|
| `tiles.globalforestwatch.org` | Alert deforestasi | `200`, versi `v20260803` (harian) |
| GLEIF LEI API | Identitas badan hukum | `200`, golden copy `2026-08-03` |
| OFAC SDN CSV | Screening sanksi | `200`, 5,6 MB |
| EU consolidated sanctions | Screening sanksi | `200` |
| ArcGIS Hub — Unilever Palm Oil Mills | Seed 1.431 pabrik asli | `200` |
| Base RPC + EAS GraphQL | Onchain | `200` |
| Earth Search STAC, Open-Meteo, NASA POWER, Overpass | Cadangan | `200` |

**Ditolak secara sadar:** `data-api.globalforestwatch.org/query` (403, butuh key), OpenSanctions (401), Climatiq (butuh key).

### Encoding tile GFW
```
hari  = R * 255 + G
tanggal_alert = 2014-12-31 + hari
alpha == 0  atau  R == 0 && G == 0  →  tidak ada alert
```
Zoom kerja **z14** (~9,5 m/piksel; resolusi native Sentinel 10 m — z15+ hanya upsampling).

Channel B (confidence) **belum terkalibrasi** — bila kalibrasi gagal, tampilkan `unverified` secara jujur.

Bukti dekode nyata:
```
Riau       z12/3202/2042 →   293 piksel | 2021-02-15 .. 2026-07-15
Sarawak    z12/3333/2019 → 4.889 piksel | 2020-01-12 .. 2026-07-23
Kalimantan z12/3333/2065 → 2.956 piksel | 2020-01-31 .. 2026-07-23
```

**Lisensi GFW: CC BY 4.0 — atribusi wajib** di footer dan README.

---

## 7. Diferensiasi

| | Pemain lama | SNITCH |
|---|---|---|
| Sumber data | Supplier mengunggah | Bukti independen, supplier tidak mengendalikannya |
| Peran blockchain | Notaris (hash dokumen) | Pencabutan publik yang tak dapat disensor |
| Umur sertifikat | Statis 12 bulan | Hidup, dipantau terus |
| Kegagalan | Diam-diam, sampai audit berikutnya | Terlihat publik dalam hitungan hari |
| Peran AI | Chatbot / ekstraksi | Penalaran adversarial atas bukti |
| Target | Enterprise EU | Eksportir & smallholder SEA |
| Biaya | Puluhan ribu euro/siklus | Sen per verifikasi |
| Ketergantungan | Vendor API berbayar | Nol — data publik saja |

**Klaim orisinalitas yang bisa dipertahankan:** tidak ada produk yang menggabungkan *verifikasi adversarial otomatis* dengan *attestation yang mencabut dirinya sendiri berdasarkan bukti satelit baru*. Kombinasi itu adalah kategori produk yang berbeda, bukan fitur tambahan.

---

## 8. Pasar & model bisnis

**Pengguna:** eksportir sawit/karet/kayu Malaysia & SEA, koperasi smallholder, trader/mill
**Pembayar:** importir EU dan trader yang memikul kewajiban DDS

**Pendapatan**
1. Langganan per petak yang dipantau (recurring — dan secara alami recurring, karena pemantauan memang berkelanjutan)
2. Bayar per verifikasi untuk importir EU yang memeriksa pemasok baru
3. *(Roadmap)* metering agen-ke-agen lewat x402 dalam USDC — agen procurement importir membayar sendiri per panggilan

Poin ekonomi yang penting: **biaya turun dari puluhan ribu euro ke sen per verifikasi.** Ini bukan sekadar penghematan — ini yang membuka pintu bagi smallholder yang selama ini terkunci di luar pasar EU. Inklusi, bukan efisiensi.

**Jalur mitra:** MPOB, skema MSPO, freight forwarder, asosiasi eksportir Malaysia.

---

## 9. Pemetaan ke rubrik penjurian

| Kriteria | Bobot | Bagaimana SNITCH menang |
|---|---|---|
| Relevance to Industrial 5.0 | 20% | Rantai pasok resilien, keberlanjutan, kolaborasi manusia-mesin eksplisit (human-in-the-loop adalah keputusan desain, bukan tempelan) |
| Innovation & Originality | 20% | Attestation self-revoking berbasis bukti satelit + verifikasi adversarial + arsitektur nol-gatekeeper |
| Technical Execution | 20% | 5+ sumber data nyata, dekode raster kustom, agen berkendala skema, transaksi onchain nyata yang bisa diklik juri |
| Real-World Use Case | 15% | EUDR Des 2026 + CBAM sudah berjalan; Malaysia produsen sawit #2 dunia; penyelenggara berbasis KL |
| Feasibility & Scalability | 15% | Nol biaya API, gas ~$0,001/attestation, model pendapatan jalan sejak baris pertama, jalur mitra jelas |
| Pitch & Demo | 10% | Revocation live di depan juri + satu klik ke block explorer |

---

## 10. Alur demo (7 menit)

1. Pilih pabrik sawit asli dari peta (1.431 titik nyata) — atau upload GeoJSON petak
2. Jalankan verifikasi; tunjukkan panggilan nyata mengalir: tile GFW, GLEIF, sanksi
3. Agen menemukan kontradiksi nyata → buka sitasinya ke bukti mentah
4. Human reviewer approve → attestation terbit → **buka sepolia.basescan.org, tunjukkan transaksi nyata**
5. Jalankan watcher pada attestation ber-`evidenceAsOf` lampau → alert baru yang benar-benar nyata ditemukan → **revoke live**
6. Buka `/v/[uid]` → status REVOKED, dibaca langsung dari chain
7. Tutup dengan limitasi jujur + roadmap

### Catatan integritas demo

Alert satelit tidak menyala sesuai jadwal demo, dan **memalsukannya tidak akan pernah dilakukan.**

Solusi yang sah: attestation diterbitkan dengan `evidenceAsOf` = tanggal lampau (mis. 2026-06-01) pada petak yang **memang** memiliki alert setelah tanggal itu. Watcher lalu berjalan dengan data hari ini dan menemukan alert yang sungguh-sungguh nyata. Seluruh data asli — hanya jendela waktunya yang dipilih. Sarawak (alert hingga 2026-07-23) adalah kandidat sempurna.

Ini harus dinyatakan terbuka kepada juri. Ia menunjukkan penguasaan sistem, bukan kelemahan.

---

## 11. Limitasi yang diakui terbuka

Rubrik secara eksplisit memberi nilai untuk *"honest explanation of current limitations"*. Sebut sendiri sebelum juri bertanya:

1. **Polygon petak supplier asli bersifat privat.** Demo memakai data pabrik & konsesi publik + upload GeoJSON. Untuk produksi, polygon datang dari eksportir sendiri.
2. **Resolusi 10 m** memadai untuk deteksi pembukaan lahan, tidak untuk sengketa batas per-pohon.
3. **Channel confidence belum terkalibrasi penuh** pada saat submission.
4. **Ini verifikasi indikatif, bukan Due Diligence Statement EUDR yang sah secara hukum.** SNITCH bukan badan sertifikasi. Label ini tampil di UI dan di dalam attestation.
5. **Kunci penandatangan disimpan di env var** — memadai untuk hackathon, tidak untuk produksi. Roadmap: KMS/multisig.
6. **Belum ada mekanisme banding** bila eksportir menyanggah verdict. Roadmap.

---

## 12. Roadmap pasca-hackathon

**Dekat** — kalibrasi confidence, ekstraksi dokumen (delivery order, sertifikat MSPO), x402 metering, pin evidence ke IPFS
**Menengah** — modul CBAM (faktor emisi default EU), Digital Product Passport / ESPR, integrasi TRACES/DDS, mekanisme banding
**Jauh** — perluasan komoditas (karet, kakao, kopi), signer multisig + KMS, program smallholder bersama koperasi & MPOB

---

## 13. Aturan yang tidak bisa ditawar

**Tidak ada mock data. Tidak ada mock fitur. Tidak ada placeholder.**

Setiap angka di layar berasal dari respons HTTP nyata, dekode piksel nyata, atau transaksi onchain nyata. Kegagalan ditampilkan sebagai error jujur, bukan disembunyikan di balik data cadangan karangan. Fitur yang belum jadi tidak dirender sama sekali.

Lebih baik aplikasi kecil yang seluruhnya nyata daripada aplikasi besar yang separuh teater.

Detail operasional lengkap: `CLAUDE.md`. Rencana eksekusi: `PLAN.md`.
