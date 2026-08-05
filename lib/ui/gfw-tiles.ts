/**
 * Merender ulang tile alert Global Forest Watch supaya bisa dilihat manusia.
 *
 * ─── Kenapa ini perlu ada ────────────────────────────────────────────────────
 * Tile GFW bukan gambar untuk ditampilkan; ia data yang dikemas sebagai PNG.
 * Channel alpha-nya dipakai menyimpan tingkat keyakinan alert, bukan
 * transparansi, dan nilainya hanya tiga: 4, 8, dan 24 — dari 255.
 *
 * Terukur pada tile nyata, 2026-08-05:
 *
 *     alpha  8 → 18.840 piksel   (3,1% opasitas bila dirender apa adanya)
 *     alpha  4 →  5.587 piksel   (1,6%)
 *     alpha 24 →     41 piksel   (9,4%)
 *
 * Dipasang sebagai lapisan raster biasa, hasilnya praktis tembus pandang.
 * Situs Global Forest Watch sendiri tidak menampilkannya begitu — mereka
 * mendekode tiap piksel lalu menggambarnya ulang. Itu yang dilakukan berkas
 * ini, memakai aturan yang sama persis dengan pengumpul bukti di server.
 *
 * ─── Ini bukan pelanggaran §0 ────────────────────────────────────────────────
 * Tidak ada nilai yang dikarang. Piksel yang digambar adalah piksel yang
 * benar-benar dikirim server GFW, dibaca dengan aturan yang didokumentasikan,
 * dan yang berubah hanya opasitasnya. Piksel tanpa alert tetap dibiarkan
 * kosong. Alpha di luar tiga nilai yang dikenal TIDAK ditebak jadi salah satu
 * tingkat — ia diberi warna netralnya sendiri dan disebut "unverified", sama
 * seperti perlakuan di kartu bukti.
 */

const GFW_ORIGIN = 'https://tiles.globalforestwatch.org';
const GFW_LATEST = '/gfw_integrated_alerts/latest/default';

/** Skema URL yang dipakai sumber peta; dicegat oleh protokol di bawah. */
export const GFW_PROTOCOL = 'gfwdecoded';
export const GFW_TILE_URL = `${GFW_PROTOCOL}://tiles/{z}/{x}/{y}.png`;

/**
 * Bentuk URL tile yang sudah tuntas, diselesaikan sekali lalu dipakai semua.
 *
 * `latest` tidak menunjuk langsung ke berkasnya. Terukur 2026-08-05:
 *
 *   latest/default/…  →307→  v20260805/default/…
 *                     →307→  v20260805/dynamic/…?implementation=default  →200
 *
 * Dua pengalihan itu TIDAK membawa header cache, sementara berkas tujuannya
 * membawa `Cache-Control: max-age=31536000`. Jadi setiap tile membayar dua
 * perjalanan bolak-balik yang tak boleh disimpan, hanya untuk sampai ke berkas
 * yang sebenarnya boleh disimpan setahun — dan browser tidak pernah bisa
 * melayani permintaan ulang sepenuhnya dari salinannya.
 *
 * Selisihnya bukan sedikit:
 *
 *   lewat `latest`  : 0,87 detik per tile
 *   bentuk akhir    : 0,08 detik per tile
 *
 * Itulah kenapa lapisan alert terasa dimuat ulang dari nol setiap kali peta
 * digeser jauh lalu kembali. Menyematkan versinya juga yang diminta
 * CLAUDE.md §3.1: yang terlihat di layar harus dapat direproduksi, dan
 * `latest` berubah tiap hari.
 *
 * Polanya TIDAK ditulis mati — ia dibaca dari `response.url` setelah seluruh
 * pengalihan diikuti, jadi ia ikut menyesuaikan kalau GFW mengubah bentuknya.
 */
interface TileTemplate {
  prefix: string;
  suffix: string;
}

const FALLBACK: TileTemplate = {
  prefix: `${GFW_ORIGIN}${GFW_LATEST}`,
  suffix: '',
};

let templatePromise: Promise<TileTemplate> | null = null;

async function tileTemplate(): Promise<TileTemplate> {
  if (!templatePromise) {
    templatePromise = (async () => {
      try {
        // Tile 0/0/0 hanya dipakai untuk membaca ke mana `latest` bermuara.
        const probe = await fetch(`${GFW_ORIGIN}${GFW_LATEST}/0/0/0.png`, {
          mode: 'cors',
          signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
        });
        const at = probe.url.indexOf('/0/0/0.png');
        if (at > 0) {
          return {
            prefix: probe.url.slice(0, at),
            suffix: probe.url.slice(at + '/0/0/0.png'.length),
          };
        }
      } catch {
        /* jatuh ke bentuk `latest` di bawah */
      }
      // Gagal menyelesaikan bukan alasan mematikan lapisan: `latest` tetap
      // bekerja, hanya kehilangan manfaat penyimpanan browser.
      return FALLBACK;
    })();
  }
  return templatePromise;
}

/** Versi tile yang benar-benar dipakai — untuk ditampilkan bila perlu. */
export async function gfwTileVersion(): Promise<string> {
  const { prefix } = await tileTemplate();
  return /(v\d{8})/.exec(prefix)?.[1] ?? 'latest';
}

/**
 * Warna per tingkat keyakinan, ditulis sebagai [r, g, b, a].
 *
 * Deret ini berjalan gelap → terang seiring naiknya keyakinan, kebalikan dari
 * kartu bukti. Itu disengaja: kartu bukti berlatar kertas terang, sedangkan
 * peta berlatar citra satelit gelap, dan pada latar gelap yang lebih terang
 * yang terbaca sebagai "lebih kuat".
 */
const FILL = {
  low: [198, 60, 110, 120],
  high: [240, 52, 122, 195],
  highest: [255, 138, 180, 255],
  /** Alpha tak dikenal — tidak ditebak, diberi warna netral. */
  unverified: [225, 225, 225, 150],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export const GFW_LEGEND = [
  { label: 'Low confidence', rgba: FILL.low },
  { label: 'High', rgba: FILL.high },
  { label: 'Highest', rgba: FILL.highest },
  { label: 'Unverified', rgba: FILL.unverified },
] as const;

/** Diekspor supaya pemetaannya bisa diuji tanpa browser. */
export function paintFor(alpha: number): readonly [number, number, number, number] {
  if (alpha === 4) return FILL.low;
  if (alpha === 8) return FILL.high;
  if (alpha === 24) return FILL.highest;
  return FILL.unverified;
}

/** Kanvas sekali pakai bersama — menghindari alokasi per tile. */
let scratch: OffscreenCanvas | HTMLCanvasElement | null = null;
let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

function context(w: number, h: number) {
  if (!scratch) {
    scratch =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : document.createElement('canvas');
    ctx = null;
  }
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
    ctx = null;
  }
  if (!ctx) {
    ctx = scratch.getContext('2d', { willReadFrequently: true }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
  }
  if (!ctx) throw new Error('Kanvas 2D tidak tersedia di peramban ini.');
  return { canvas: scratch, ctx };
}

/**
 * ─── Kenapa semua perkakas ini perlu ────────────────────────────────────────
 * Diukur langsung ke server GFW pada 2026-08-05:
 *
 *   32 permintaan serentak  ->  24 berhasil, 6x HTTP 500, 2x HTTP 502
 *
 * Menurunkan konkurensi dan menambah retry TIDAK menolong: delapan tile yang
 * sama tetap gagal, bahkan saat diminta sendirian lima kali berturut-turut.
 * Ternyata seluruhnya berada di luar sabuk tropis — z5 baris y=10..12 (di atas
 * 32 derajat LU) dan y=20 (di bawah 41 derajat LS). GFW hanya menyajikan alert
 * di daerah tropis, dan di luar cakupannya servernya membalas HTTP 500 alih-
 * alih tile kosong atau 404.
 *
 * Maka penanganannya dibedakan: sebagian kegagalan memang sementara dan pantas
 * diulang, sebagian permanen dan harus menyerah cepat supaya peta tidak
 * tersendat. Yang menyerah TIDAK disembunyikan — jumlahnya dilaporkan ke UI.
 */

/** CLAUDE.md §9 mewajibkan timeout eksplisit untuk tiap panggilan eksternal. */
const TILE_TIMEOUT_MS = 15_000;
/** Sekali ulang saja: kegagalan yang berulang di sini terbukti permanen. */
const RETRIES = 1;
/**
 * Peramban sendiri membatasi koneksi per host, tapi MapLibre bisa meminta
 * puluhan tile sekaligus saat peta diperkecil. Enam menjaga antreannya pendek
 * tanpa membuat pemuatan terasa lambat.
 */
const MAX_INFLIGHT = 6;

let inflight = 0;
const queue: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_INFLIGHT) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
    queue.shift()?.();
  }
}

// ── pelaporan tile yang tidak tersedia ──────────────────────────────────────
let unavailable = 0;
const listeners = new Set<(n: number) => void>();

/**
 * Berlangganan jumlah tile yang tidak bisa diambil dari GFW.
 *
 * Ini ada supaya kegagalan tidak lenyap diam-diam. Tile alert yang kosong
 * terbaca persis seperti "tidak ada deforestasi di sini", dan menurut §0
 * "gagal memeriksa" tidak boleh terlihat sama dengan "bersih". Angka onchain
 * dan angka di berkas bukti tidak berasal dari lapisan ini — mereka dihitung
 * server dari tile yang sama — tapi pengguna tetap berhak tahu bahwa sebagian
 * peta tidak terisi karena sumbernya menolak, bukan karena hutannya utuh.
 */
export function subscribeTileIssues(fn: (n: number) => void): () => void {
  listeners.add(fn);
  fn(unavailable);
  return () => listeners.delete(fn);
}

function noteUnavailable(): void {
  unavailable++;
  for (const fn of listeners) fn(unavailable);
}

/** Tile kosong yang dipakai saat GFW tidak punya cakupan di koordinat itu. */
let blank: ImageData | null = null;
function blankTile(w = 256, h = 256): ImageData {
  if (!blank || blank.width !== w || blank.height !== h) {
    blank = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
  }
  return blank;
}

/** Mengambil satu tile dengan timeout, batas konkurensi, dan satu kali ulang. */
async function fetchTile(url: string, signal: AbortSignal): Promise<Response | null> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const timeout = AbortSignal.timeout(TILE_TIMEOUT_MS);
    const merged = AbortSignal.any([signal, timeout]);
    try {
      const res = await withSlot(() => fetch(url, { signal: merged, mode: 'cors' }));
      if (res.ok) return res;
      // 4xx berarti permintaannya sendiri salah — mengulang tidak akan menolong.
      if (res.status < 500) return null;
    } catch (e) {
      // Dibatalkan karena peta digeser: itu bukan kegagalan, teruskan apa adanya.
      if (signal.aborted) throw e;
    }
    if (attempt < RETRIES) {
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
  return null;
}

/**
 * Membaca satu tile GFW dan mengembalikannya sebagai gambar yang terlihat.
 *
 * Aturan dekodenya sama dengan `decodeTileAlerts` di lib/evidence/gfw.ts:
 * piksel dengan `alpha == 0`, atau `R == 0 && G == 0`, berarti TIDAK ADA alert
 * (kanal R dan G menyimpan tanggal; nol berarti kosong, bukan 31-12-2014).
 */
async function decodeTile(path: string, signal: AbortSignal): Promise<ImageBitmap> {
  let bytes = recall(path);

  if (!bytes) {
    const { prefix, suffix } = await tileTemplate();
    const res = await fetchTile(`${prefix}${path}${suffix}`, signal);
    if (!res) {
      // GFW tidak punya cakupan di sini, atau menolak berulang kali. Kembalikan
      // tile kosong supaya peta tetap bisa dipakai, tapi catat kejadiannya.
      noteUnavailable();
      return createImageBitmap(blankTile());
    }
    bytes = await res.arrayBuffer();
    remember(path, bytes);
  }

  const source = await createImageBitmap(new Blob([bytes]));
  // Ukurannya WAJIB disalin sebelum `close()`: setelah ditutup, `width` dan
  // `height` sebuah ImageBitmap menjadi 0, dan `getImageData` gagal dengan
  // "The source width is 0".
  const w = source.width;
  const h = source.height;

  const { canvas, ctx } = context(w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0);
  source.close();

  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]!;
    const g = px[i + 1]!;
    const a = px[i + 3]!;

    if (a === 0 || (r === 0 && g === 0)) {
      px[i + 3] = 0;
      continue;
    }

    const [nr, ng, nb, na] = paintFor(a);
    px[i] = nr;
    px[i + 1] = ng;
    px[i + 2] = nb;
    px[i + 3] = na;
  }

  ctx.putImageData(img, 0, 0);
  return createImageBitmap(canvas);
}

/**
 * Simpanan hasil dekode, dibatasi jumlahnya.
 *
 * Tanpa ini, kembali ke area yang sudah pernah dilihat berarti mengambil ulang
 * tile dari server GFW lalu mendekodenya lagi dari nol — terlihat sebagai
 * lapisan yang berkedip hilang-muncul saat peta digeser bolak-balik.
 *
 * Yang disimpan adalah BYTE PNG mentah dari GFW, bukan `ImageData` hasil
 * olahan maupun `ImageBitmap`. Alasannya dua:
 *
 *  - MapLibre menutup bitmap yang sudah diunggah ke GPU, jadi bitmap yang
 *    disimpan akan tidak terpakai.
 *  - `ImageData` memakan 256x256x4 = 262 KB per tile, sedangkan byte PNG-nya
 *    hanya sekitar 50 KB. Untuk anggaran memori yang sama, byte mentah memuat
 *    lima kali lebih banyak tile — dan menggeser peta lintas benua memang
 *    menyentuh ratusan tile, cukup untuk membuang isi simpanan yang kecil.
 *
 * Yang mahal adalah jaringan (terukur ~0,8 detik per tile), bukan perulangan
 * pikselnya (beberapa milidetik). Jadi mengulang dekode dari byte yang sudah
 * ada praktis gratis.
 *
 * 400 tile x ~50 KB menahan pemakaian di sekitar 20 MB.
 */
const MAX_CACHED_TILES = 400;
const cache = new Map<string, ArrayBuffer>();

function remember(key: string, data: ArrayBuffer): void {
  cache.set(key, data);
  while (cache.size > MAX_CACHED_TILES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function recall(key: string): ArrayBuffer | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  // Disentuh ulang supaya jadi yang paling baru dipakai.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

let registered = false;

/**
 * Memasang protokol `gfwdecoded://` sekali per halaman. Aman dipanggil
 * berkali-kali; pemanggilan kedua dan seterusnya tidak melakukan apa-apa.
 */
export function registerGfwProtocol(
  addProtocol: (
    scheme: string,
    fn: (
      params: { url: string },
      abortController: AbortController,
    ) => Promise<{ data: ImageBitmap }>,
  ) => void,
): void {
  if (registered) return;
  registered = true;

  addProtocol(GFW_PROTOCOL, async (params, abortController) => {
    // `gfwdecoded://tiles/12/3202/2042.png` → `/12/3202/2042.png`
    const path = params.url.slice(`${GFW_PROTOCOL}://tiles`.length);
    return { data: await decodeTile(path, abortController.signal) };
  });
}
