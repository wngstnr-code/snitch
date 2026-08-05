# SNITCH — Living Compliance Attestations

> **"PDF certificates go stale silently. Ours revoke themselves."**

ChainHack 2026 / NeuralLedger 5.0 — Track: **Industrial 5.0** (+ AI × Web3, Real-World Finance)

Sertifikat bebas-deforestasi hari ini adalah PDF: ditandatangani sekali, berlaku
dua belas bulan. Kalau petak lahannya ditebang bulan depan, dokumen itu tetap
terlihat sah sampai audit berikutnya — mungkin sebelas bulan kemudian.

SNITCH adalah oracle verifikasi. Agen AI menguji klaim eksportir terhadap bukti
yang tidak mereka kendalikan, meminta keputusan manusia, lalu menerbitkan
attestation onchain yang **mencabut dirinya sendiri** ketika citra satelit baru
membantahnya.

---

## Cara kerjanya

| Tahap | Yang terjadi | Sumber |
|---|---|---|
| 1 | Polygon petak → daftar tile satelit → piksel didekode jadi alert deforestasi bertanggal | Global Forest Watch integrated alerts |
| 2 | Entitas disaring ke registri badan hukum dan daftar sanksi | GLEIF · OFAC SDN · EU consolidated |
| 3 | Dua dataset RSPO independen diadu — ketidaksepakatannya sendiri jadi temuan | Universal Mill List vs Unilever Mill List |
| 4 | Agen mencari kontradiksi; setiap temuan wajib menyitir ID bukti yang tervalidasi | Gemini 2.5 Flash, `generateObject` + zod |
| 5 | Manusia approve / reject / override dengan alasan tertulis | Tersimpan di jejak audit |
| 6 | Attestation EAS terbit di Base, `revocable: true` | EAS predeploy OP-Stack |
| 7 | Watcher memeriksa ulang; alert baru setelah jendela bukti → `revoke()` onchain | Cron + tombol manual |
| 8 | Siapa pun memverifikasi lewat `/v/<uid>` tanpa akun | Dibaca langsung dari chain |

Kenapa harus onchain: pencabutan harus **dapat diamati publik dan tidak dapat
disensor oleh penerbitnya sendiri**. Importir EU yang menyimpan referensi
attestation langsung melihat statusnya berubah — tanpa email, tanpa audit ulang,
tanpa perlu mempercayai SNITCH maupun eksportir.

---

## Aturan yang mengikat proyek ini

**Tidak ada mock data. Tidak ada fitur palsu. Tidak ada placeholder.**

Setiap angka di layar berasal dari respons HTTP nyata, hasil dekode piksel
nyata, atau transaksi onchain nyata. Setiap panggilan eksternal yang gagal
ditampilkan sebagai **error jujur di UI** — tidak pernah disembunyikan di balik
data cadangan. "Gagal memeriksa" tidak boleh terlihat seperti "bersih".

Seluruh pipeline bukti berjalan di atas sumber yang **tidak memerlukan API key
sama sekali**. Untuk sebuah lapisan kepercayaan itu bukan kompromi, itu
argumen: siapa pun dapat mereproduksi verdict kami secara independen.

---

## Menjalankan secara lokal

```bash
npm install
cp .env.example .env      # lalu isi nilainya (lihat tabel di bawah)
npm run db:migrate        # skema Postgres
npm run sanctions:sync    # unduh OFAC + EU (sekali, lalu harian lewat cron)
npm run mills:seed        # pabrik sawit nyata dari ArcGIS (default: 500 pabrik Malaysia)
npm run dev
```

Pemeriksaan:

```bash
npm run build       # wajib sebelum typecheck — tipe route digenerate saat build
npm run typecheck
npm run lint
npm test            # mengirim transaksi sungguhan ke Base Sepolia
npm run services:check
npm run chain:check
```

### Environment variable

Satu berkas `.env` di root, dipakai bersama. **Jangan pernah di-commit.**

| Variabel | Untuk apa | Wajib |
|---|---|---|
| `DATABASE_URL` | Postgres (Neon) | ya |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Agen kontradiksi | ya |
| `BLOB_READ_WRITE_TOKEN` | Simpan berkas bukti (Vercel Blob) | ya |
| `ATTESTER_PRIVATE_KEY` | Penandatangan attestation | ya |
| `CHAIN_ID` | `84532` Base Sepolia · `8453` mainnet | ya |
| `EAS_SCHEMA_UID` | UID schema SNITCH (sudah terisi di contoh) | ya |
| `CRON_SECRET` | Pengaman endpoint watcher | di deployment |

Wallet baru: `npm run wallet:new`, lalu isi dari faucet Base Sepolia.

---

## Peta aplikasi

| Rute | Isi |
|---|---|
| `/` | Daftar berkas verifikasi + ringkasan alur |
| `/new` | Intake: pilih pabrik dari peta, atau unggah GeoJSON petak |
| `/verifications/[id]` | Berkas lengkap: garis hidup, bukti, temuan agen, review, attestation |
| `/v` | Tempel UID untuk memeriksa attestation |
| `/v/[uid]` | Verifikasi publik tanpa akun — status dibaca dari chain |

Grafik utamanya adalah **garis hidup attestation**: satu sumbu waktu dari cutoff
EUDR (2020-12-31) sampai tanggal bukti terakhir diambil. Bagian pejal adalah
rentang yang benar-benar dijamin attestation; setelahnya putus-putus karena
belum dijamin dan masih dipantau. Begitu ada alert satelit jatuh di rentang
putus-putus itu, garisnya terputus dan berubah magenta — itulah momen sebuah
sertifikat mati, digambar apa adanya dari data.

---

## Onchain

Base Sepolia (chainId 84532). EAS adalah predeploy OP-Stack, alamatnya identik
di testnet maupun mainnet:

```
EAS            0x4200000000000000000000000000000000000021
SchemaRegistry 0x4200000000000000000000000000000000000020
```

Testnet **bukan mock**: konsensus, finalitas, attestation, dan revocation
semuanya nyata. Dipilih karena menghapus satu-satunya blocker ber-lead-time
(pendanaan wallet) dan menghilangkan risiko dana nyata di belakang kunci privat
yang disimpan di env var. Chain dibaca dari `CHAIN_ID` — pindah ke mainnet
adalah pertukaran satu variabel.

---

## Batasan yang kami nyatakan terbuka

- **Bukan badan sertifikasi.** Verdict di sini bersifat indikatif dan tidak
  menggantikan Due Diligence Statement resmi EUDR.
- **Analisis radius sourcing pabrik bukan verifikasi tingkat petak.** Pabrik
  bergeometri titik; yang dianalisis adalah radius 50 km di sekelilingnya
  (metodologi standar industri sawit). Dibedakan secara eksplisit di UI.
- **Polygon petak supplier asli bersifat privat**, jadi demo memakai dataset
  pabrik publik dan unggahan GeoJSON pengguna.
- **Poligon konsesi ber-vintage 2010** dan lisensinya tidak jelas — dipakai
  hanya sebagai pemilih kemudahan, bukan jalur utama.
- **Kunci privat penandatangan disimpan di env var.** Untuk produk sungguhan
  ini tidak memadai; KMS/multisig ada di roadmap.
- **Belum ada integrasi ke sistem TRACES/DDS resmi EU**, dan belum ada mekanisme
  banding bagi eksportir yang menyanggah verdict.

---

## Atribusi

Data alert deforestasi berasal dari
[Global Forest Watch](https://www.globalforestwatch.org/) integrated alerts
(GLAD-L, GLAD-S2, RADD, DIST-ALERT), © World Resources Institute, dilisensikan
di bawah [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Sumber lain: GLEIF Global LEI Index · OFAC Specially Designated Nationals List ·
EU Consolidated Financial Sanctions List · Universal Mill List dan Unilever Palm
Oil Mills (ArcGIS Hub) · citra peta Esri World Imagery · OpenStreetMap
contributors.
