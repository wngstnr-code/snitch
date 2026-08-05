import { cn } from '@/lib/utils';
import { EUDR_CUTOFF, formatDate, formatMonth, formatNumber } from '@/lib/ui/format';

/**
 * GARIS HIDUP — grafik utama produk ini.
 *
 * Satu sumbu waktu yang menceritakan seluruh tesis SNITCH sekaligus:
 *
 *   cutoff EUDR ──────── dijamin attestation ────┤ dipantau ─ ─ ─ ─ ─ ─ hari ini
 *        │           ▁▃  ▂▅   alert deforestasi          ▇  ← yang membantahnya
 *
 * Bagian pejal biru adalah rentang yang benar-benar diklaim attestation
 * (cutoff → `evidenceAsOf`). Setelah itu garisnya putus-putus: belum dijamin,
 * masih dipantau. Begitu ada alert satelit jatuh di rentang putus-putus itu,
 * garis tersebut TERPUTUS di titik tersebut dan berubah magenta — itulah
 * momen sebuah sertifikat mati, digambar apa adanya.
 *
 * Setiap nilai di sini berasal dari `summary.byMonth` bundle bukti, yang
 * dihitung deterministik dari piksel tile GFW. Tidak ada yang diperhalus.
 */

const DAY = 86_400_000;

export interface LifelineProps {
  /** ISO — jendela bukti yang di-anchor onchain. */
  evidenceAsOf: string;
  /** `YYYY-MM` → jumlah piksel alert. Selalu ada, walau daftar alert dipotong. */
  byMonth: Record<string, number>;
  /** Terisi bila attestation sudah dicabut onchain. */
  revokedAt?: string | null;
  /**
   * ISO — kapan bukti satelitnya benar-benar diambil (`fetchedAt`). Ini yang
   * menutup sumbu di sebelah kanan, BUKAN jam dinding: grafik yang memakai
   * `Date.now()` akan berbeda tiap kali dibuka dan tidak bisa direproduksi.
   * Di sini ujung kanannya selalu menunjuk sebuah peristiwa yang tercatat.
   */
  dataAsOf?: string | null;
  variant?: 'default' | 'hero';
  className?: string;
}

interface Tick {
  month: string;
  count: number;
  pct: number;
  after: boolean;
}

function monthMidpoint(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return NaN;
  return Date.UTC(y, m - 1, 15);
}

export function Lifeline({
  evidenceAsOf,
  byMonth,
  revokedAt,
  dataAsOf,
  variant = 'default',
  className,
}: LifelineProps) {
  const cutoff = Date.parse(`${EUDR_CUTOFF}T00:00:00Z`);
  const asOf = Date.parse(evidenceAsOf);

  const months = Object.entries(byMonth)
    .map(([month, count]) => ({ month, count, t: monthMidpoint(month) }))
    .filter((m) => Number.isFinite(m.t) && m.count > 0 && m.t >= cutoff)
    .sort((a, b) => a.t - b.t);

  const latest = months.length ? months[months.length - 1]!.t : cutoff;
  const observed = Math.max(
    latest,
    asOf,
    revokedAt ? Date.parse(revokedAt) : 0,
    dataAsOf ? Date.parse(dataAsOf) : 0,
  );
  // Sedikit ruang di ujung kanan supaya batang terakhir tidak menempel tepi.
  const domainEnd = observed + 21 * DAY;
  const span = Math.max(domainEnd - cutoff, DAY);

  const pct = (t: number) => Math.min(100, Math.max(0, ((t - cutoff) / span) * 100));

  const maxCount = months.reduce((m, x) => Math.max(m, x.count), 0);
  const ticks: Tick[] = months.map((m) => ({
    month: m.month,
    count: m.count,
    pct: pct(m.t),
    after: m.t > asOf,
  }));

  /** Bulan pertama yang membantah attestation — titik garisnya terputus. */
  const breach = ticks.find((t) => t.after) ?? null;
  const asOfPct = pct(asOf);
  const breachPct = breach ? breach.pct : null;

  /**
   * Pencabutan onchain adalah peristiwa TERSENDIRI, bukan turunan dari isi
   * bundle. Ini bukan detail: alert yang membantah sebuah attestation biasanya
   * BELUM ADA saat attestation itu diterbitkan — watcher menemukannya kemudian
   * dari tile yang lebih baru. Pada berkas nyata pertama yang tercabut, bundle
   * berhenti di Mei 2026 sementara alasan pencabutannya menyebut 6.899 alert
   * setelah 1 Juni 2026. Kalau penanda putus hanya dihitung dari `byMonth`,
   * attestation yang sudah mati akan tampil dengan garis yang terlihat utuh —
   * persis kontradiksi yang produk ini ada untuk mencegah.
   */
  const revokedAtMs = revokedAt ? Date.parse(revokedAt) : NaN;
  const revokedPct = Number.isFinite(revokedAtMs) ? pct(revokedAtMs) : null;
  /** Titik garis benar-benar berakhir: dicabut, atau dibantah bukti di bundle. */
  const endPct = revokedPct ?? breachPct;

  const tall = variant === 'hero';
  const trackTop = tall ? 88 : 60;
  const ROW_H = 30;

  /**
   * Label ditaruh bertingkat, bukan berjejer.
   *
   * `evidenceAsOf` sering hanya beberapa minggu dari tanggal bukti terakhir
   * diambil — pada berkas nyata pertama 96% vs 100% — sehingga label keduanya
   * tumpang tindih dan terbaca sebagai satu kalimat rusak.
   *
   * Baris 0 disediakan untuk dua ujung sumbu, yang menurut definisinya tidak
   * mungkin bertabrakan. Penanda di tengah dijatah baris secara serakah: turun
   * satu baris setiap kali terlalu dekat dengan penanda yang sudah ditempatkan.
   */
  const MIN_GAP_PCT = 24;
  const midMarkers: Array<{
    pct: number;
    eyebrow: string;
    value: string;
    tone: 'chain' | 'alert';
    row: number;
  }> = [];
  const rowTail: number[] = [];
  const candidates: Array<Omit<(typeof midMarkers)[number], 'row'>> = [
    {
      pct: asOfPct,
      eyebrow: 'Covered through',
      value: formatDate(evidenceAsOf),
      tone: 'chain' as const,
    },
    ...(breach && breachPct !== null
      ? [
          {
            pct: breachPct,
            eyebrow: 'Contradicted from',
            value: `${formatMonth(breach.month)} · ${formatNumber(breach.count)} px`,
            tone: 'alert' as const,
          },
        ]
      : []),
    ...(revokedPct !== null
      ? [
          {
            pct: revokedPct,
            eyebrow: 'Revoked onchain',
            value: formatDate(revokedAt ?? null),
            tone: 'alert' as const,
          },
        ]
      : []),
  ].sort((a, b) => a.pct - b.pct);

  for (const c of candidates) {
    let row = 0;
    while (rowTail[row] !== undefined && Math.abs(c.pct - rowTail[row]!) < MIN_GAP_PCT) {
      row++;
    }
    rowTail[row] = c.pct;
    midMarkers.push({ ...c, row: row + 1 });
  }

  const rowsUsed = midMarkers.reduce((m, x) => Math.max(m, x.row), 0) + 1;
  const boxHeight = trackTop + rowsUsed * ROW_H + 14;

  return (
    <figure className={cn('w-full', className)}>
      <div
        className="relative w-full"
        style={{ height: boxHeight }}
        role="img"
        aria-label={
          `Timeline from the EUDR cutoff ${EUDR_CUTOFF} to ${formatDate(new Date(observed).toISOString())}. ` +
          `The attestation covers up to ${formatDate(evidenceAsOf)}. ` +
          (revokedAt
            ? `The attestation was revoked onchain on ${formatDate(revokedAt)}.`
            : breach
              ? `Deforestation alerts appeared in ${formatMonth(breach.month)}, after the evidence window — the attestation is contradicted.`
              : `No alerts yet after the evidence window.`)
        }
      >
        {/* ── batang alert per bulan, tinggi = jumlah piksel alert ── */}
        <div
          className="absolute inset-x-0"
          style={{ top: 0, height: trackTop - 6 }}
          aria-hidden
        >
          {ticks.map((t) => {
            const h = Math.max(3, Math.sqrt(t.count / maxCount) * (trackTop - 12));
            return (
              <span
                key={t.month}
                title={`${formatMonth(t.month)} — ${formatNumber(t.count)} alert pixels${t.after ? ' (after the evidence window)' : ''}`}
                className={cn(
                  'absolute bottom-0 w-[3px] rounded-t-[1.5px]',
                  t.after ? 'bg-alert' : 'bg-alert/35',
                )}
                style={{ left: `calc(${t.pct}% - 1.5px)`, height: h }}
              />
            );
          })}
        </div>

        {/* ── rel waktu ── */}
        <div
          className="absolute inset-x-0 h-px bg-rule"
          style={{ top: trackTop }}
          aria-hidden
        />

        {/* rentang yang dijamin attestation */}
        <div
          className="absolute bg-chain"
          style={{ top: trackTop - 1.5, left: 0, width: `${asOfPct}%`, height: 3 }}
          aria-hidden
        />

        {/* Rentang setelah jendela bukti: dipantau, belum dijamin. Berhenti di
            titik pencabutan — setelah itu attestation tidak lagi ada, jadi
            tidak ada garis apa pun untuk digambar. */}
        <div
          className={cn(
            'absolute border-t-2 border-dashed',
            endPct !== null ? 'border-alert' : 'border-muted-foreground/50',
          )}
          style={{
            top: trackTop - 1,
            left: `${asOfPct}%`,
            width: `${Math.max(0, (endPct ?? 100) - asOfPct)}%`,
          }}
          aria-hidden
        />

        {/* penanda cutoff EUDR — baris 0, ujung kiri */}
        <Marker pct={0} top={trackTop} tone="rule" />
        <Caption pct={0} top={trackTop} row={0} rowH={ROW_H} align="start">
          <span className="eyebrow block">EUDR cutoff</span>
          <span className="datum block text-foreground">{EUDR_CUTOFF}</span>
        </Caption>

        {/* penanda tengah: jendela bukti, bantahan bukti, pencabutan onchain */}
        {midMarkers.map((mk) => (
          <span key={mk.eyebrow}>
            <span
              aria-hidden
              className={cn(
                'absolute',
                mk.tone === 'chain' ? 'w-px bg-chain' : 'w-[3px] bg-alert',
              )}
              // Penanda berhenti 8px di bawah sumbu, sementara baris label
              // pertama mulai di 10px. Versi sebelumnya menjulur 14px sehingga
              // batang pencabutan menembus tulisan "Checked through".
              style={{
                left:
                  mk.tone === 'chain' ? `${mk.pct}%` : `calc(${mk.pct}% - 1.5px)`,
                top: trackTop - (mk.tone === 'chain' ? 10 : 16),
                height: mk.tone === 'chain' ? 18 : 24,
              }}
            />
            <Caption
              pct={mk.pct}
              top={trackTop}
              row={mk.row}
              rowH={ROW_H}
              align={mk.pct > 55 ? 'end' : 'start'}
            >
              <span
                className={cn(
                  'eyebrow block',
                  mk.tone === 'chain' ? 'text-chain' : 'text-alert',
                )}
              >
                {mk.eyebrow}
              </span>
              <span className="datum block text-foreground">{mk.value}</span>
            </Caption>
          </span>
        ))}

        {/* ujung kanan: sejauh mana bukti sudah dilihat — baris 0 */}
        <Caption pct={100} top={trackTop} row={0} rowH={ROW_H} align="end">
          <span className="eyebrow block">Checked through</span>
          <span className="datum block text-foreground">
            {formatDate(new Date(observed).toISOString())}
          </span>
        </Caption>
      </div>

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-rule pt-2.5">
        <LegendItem swatch={<span className="h-[3px] w-5 bg-chain" />}>
          Covered by attestation
        </LegendItem>
        <LegendItem
          swatch={
            <span
              className={cn(
                'w-5 border-t-2 border-dashed',
                breach ? 'border-alert' : 'border-muted-foreground/60',
              )}
            />
          }
        >
          {revokedAt
            ? 'Monitored, then revoked'
            : breach
              ? 'Contradicted, monitored'
              : 'Not yet covered, monitored'}
        </LegendItem>
        <LegendItem swatch={<span className="h-3 w-[3px] bg-alert" />}>
          Deforestation alerts per month (height = pixel count)
        </LegendItem>
      </figcaption>
    </figure>
  );
}

function Marker({
  pct,
  top,
  tone,
  tall = false,
}: {
  pct: number;
  top: number;
  tone: 'chain' | 'rule';
  tall?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute w-px',
        tone === 'chain' ? 'bg-chain' : 'bg-muted-foreground/50',
      )}
      // Berhenti di atas baris label pertama supaya tidak menembus tulisannya.
      style={{ left: `${pct}%`, top: top - (tall ? 10 : 8), height: tall ? 18 : 16 }}
    />
  );
}

function Caption({
  pct,
  top,
  row,
  rowH,
  align,
  children,
}: {
  pct: number;
  top: number;
  /** 0 = tepat di bawah sumbu; tiap baris berikutnya turun `rowH` piksel. */
  row: number;
  rowH: number;
  align: 'start' | 'end';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'absolute whitespace-nowrap leading-tight',
        align === 'end' ? 'text-right' : 'text-left',
      )}
      style={{
        left: align === 'start' ? `${pct}%` : undefined,
        right: align === 'end' ? `${100 - pct}%` : undefined,
        top: top + 10 + row * rowH,
        paddingLeft: align === 'start' ? 6 : 0,
        paddingRight: align === 'end' ? 6 : 0,
      }}
    >
      {children}
    </span>
  );
}

function LegendItem({
  swatch,
  children,
}: {
  swatch: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
      <span className="flex w-5 shrink-0 items-center" aria-hidden>
        {swatch}
      </span>
      {children}
    </span>
  );
}
