/**
 * Pemformat tampilan. Tidak ada yang mengarang nilai di sini — semuanya hanya
 * mengubah bentuk nilai yang sudah ada. Kalau sebuah nilai tidak ada, yang
 * dikembalikan adalah penanda "tidak diketahui" yang jujur, bukan tebakan.
 *
 * Locale `en-GB`: urutan hari-bulan-tahun (04 Aug 2026) lazim di dokumen
 * kepatuhan Uni Eropa, dan pemisah ribuannya koma seperti yang diharapkan
 * pembaca berbahasa Inggris.
 */

/** Tanggal cutoff EUDR. Semua bukti deforestasi dibaca relatif terhadap ini. */
export const EUDR_CUTOFF = '2020-12-31';

const LOCALE = 'en-GB';

const DATE_FMT = new Intl.DateTimeFormat(LOCALE, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  timeZone: 'UTC',
});

const DATETIME_FMT = new Intl.DateTimeFormat(LOCALE, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return DATE_FMT.format(new Date(t));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return `${DATETIME_FMT.format(new Date(t))} UTC`;
}

/** "3 days ago" — dipakai hanya sebagai pelengkap tanggal absolut. */
export function relativeFromNow(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diffMs = Date.now() - t;
  const past = diffMs >= 0;
  const days = Math.floor(Math.abs(diffMs) / 86_400_000);
  const phrase = (n: number, unit: string) => {
    const plural = `${n} ${unit}${n === 1 ? '' : 's'}`;
    return past ? `${plural} ago` : `in ${plural}`;
  };
  if (days === 0) return 'today';
  if (days < 30) return phrase(days, 'day');
  const months = Math.floor(days / 30);
  if (months < 24) return phrase(months, 'month');
  return phrase(Math.floor(months / 12), 'year');
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(LOCALE).format(n);
}

export function formatArea(ha: number): string {
  const digits = ha >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(ha)} ha`;
}

/** `0xabc123…def456` — hash panjang tetap bisa dikenali tanpa merusak baris. */
export function shortHash(hash: string | null | undefined, head = 10, tail = 6): string {
  if (!hash) return '—';
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** Host dari sebuah URL — dipakai di strip provenans tiap kartu bukti. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Bulan `YYYY-MM` → `Mar 2024`. Sumbu histogram alert memakai ini. */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split('-');
  const idx = Number(m) - 1;
  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${names[idx] ?? m} ${y}`;
}

/** Persen bilangan bulat untuk skor keyakinan agen. */
export function formatConfidence(n: number): string {
  return `${Math.round(n)}%`;
}
