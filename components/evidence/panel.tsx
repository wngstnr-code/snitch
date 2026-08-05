import { cn } from '@/lib/utils';
import type {
  AlertConfidence,
  CertificationEvidence,
  DeforestationEvidence,
  Evidence,
  LegalEntityEvidence,
  SanctionsEvidence,
} from '@/lib/types';
import { Pill } from '@/components/ui/badge';
import { evidenceKindMeta } from '@/lib/ui/status';
import {
  EUDR_CUTOFF,
  formatArea,
  formatDate,
  formatDateTime,
  formatNumber,
  hostOf,
  shortHash,
} from '@/lib/ui/format';

/**
 * Panel bukti.
 *
 * Setiap kartu di sini wajib bisa dilacak: strip provenans di kakinya membawa
 * host sumber, waktu pengambilan, dan sha256 respons mentahnya. Itu perangkat
 * struktural sistem visual ini — bukan hiasan. Juri harus bisa mengklik dari
 * angka apa pun di layar ke data yang menghasilkannya.
 *
 * Kartu diberi `id` supaya sitasi agen (`#ev-<id>`) bisa melompat ke sini.
 */

export function EvidencePanel({ items }: { items: Evidence[] }) {
  return (
    <div className="space-y-4">
      {items.map((e) => (
        <EvidenceCard key={e.id} evidence={e} />
      ))}
    </div>
  );
}

export function EvidenceCard({ evidence }: { evidence: Evidence }) {
  const meta = evidenceKindMeta[evidence.kind];
  return (
    <article
      id={`ev-${evidence.id}`}
      data-evidence
      className="sheet scroll-mt-32 overflow-hidden"
    >
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3.5 pb-3">
        <div>
          <h3 className="text-[0.9375rem] leading-tight">{meta.label}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{meta.source}</p>
        </div>
        <code className="datum shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
          {evidence.id}
        </code>
      </header>

      <div className="px-4 pb-4">
        {evidence.kind === 'deforestation' ? (
          <DeforestationBody e={evidence} />
        ) : null}
        {evidence.kind === 'legal_entity' ? <LegalEntityBody e={evidence} /> : null}
        {evidence.kind === 'sanctions' ? <SanctionsBody e={evidence} /> : null}
        {evidence.kind === 'certification' ? <CertificationBody e={evidence} /> : null}
      </div>

      <Provenance
        sourceUrl={evidence.sourceUrl}
        fetchedAt={evidence.fetchedAt}
        rawHash={evidence.rawHash}
      />
    </article>
  );
}

export function Provenance({
  sourceUrl,
  fetchedAt,
  rawHash,
}: {
  sourceUrl: string;
  fetchedAt: string;
  rawHash: string;
}) {
  return (
    <div className="provenance flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
      <a
        href={sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="text-chain underline underline-offset-2 hover:no-underline"
        title={sourceUrl}
      >
        {hostOf(sourceUrl)}
      </a>
      <span title={fetchedAt}>fetched {formatDateTime(fetchedAt)}</span>
      <span title={rawHash}>sha256 {shortHash(rawHash, 8, 4)}</span>
    </div>
  );
}

// ---------- Baris data ----------

function Row({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: 'alert' | 'chain' | 'hold';
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule/60 py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          'datum text-right',
          tone === 'alert' && 'text-alert',
          tone === 'chain' && 'text-chain',
          tone === 'hold' && 'text-hold',
        )}
      >
        {children}
      </span>
    </div>
  );
}

/** Nilai yang memang tidak diketahui — jangan pernah ditebak jadi angka. */
function Unknown({ children = 'unknown' }: { children?: string }) {
  return <span className="text-muted-foreground italic">{children}</span>;
}

// ---------- Deforestasi ----------

const CONFIDENCE_ORDER: AlertConfidence[] = ['low', 'high', 'highest'];
const CONFIDENCE_LABEL: Record<AlertConfidence, string> = {
  low: 'Low',
  high: 'High',
  highest: 'Highest',
};
/** Deret satu warna, terang → gelap. Urutan confidence itu ordinal. */
const CONFIDENCE_FILL: Record<AlertConfidence, string> = {
  low: 'var(--chart-2)',
  high: 'var(--chart-4)',
  highest: 'var(--chart-5)',
};

function DeforestationBody({ e }: { e: DeforestationEvidence }) {
  const graded = CONFIDENCE_ORDER.reduce(
    (s, k) => s + (e.summary.byConfidence[k] ?? 0),
    0,
  );

  /**
   * Alert yang tingkat keyakinannya TIDAK DIKETAHUI.
   *
   * Pengumpul bukti menghitung setiap alert ke `byMonth`, tapi hanya memasukkan
   * ke `byConfidence` bila nilainya dikenali — nilai alpha di luar 4/8/24
   * dikembalikan sebagai null dan tidak pernah ditebak (CLAUDE.md §3.1).
   * Selisih kedua jumlah itu karena itu tepat sama dengan jumlah alert yang
   * tak terverifikasi.
   *
   * PLAN.md A4 mewajibkan keadaan ini dirender sebagai "unverified", bukan
   * angka. Tanpa baris ini alert tersebut hilang dari layar tanpa jejak, dan
   * total di bawah tidak akan pernah menjumlah — kehilangan diam-diam persis
   * jenis yang dilarang §0.
   */
  const counted = Object.values(e.summary.byMonth).reduce((s, n) => s + n, 0);
  const unverified = Math.max(0, counted - graded);
  const total = graded + unverified;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div>
          <p
            className={cn(
              'font-[family-name:var(--font-display)] text-3xl font-extrabold tabular-nums',
              e.alertsAfterCutoff > 0 ? 'text-alert' : 'text-chain',
            )}
          >
            {formatNumber(e.alertsAfterCutoff)}
          </p>
          <p className="eyebrow mt-0.5">
            alert pixels after the {EUDR_CUTOFF} cutoff
          </p>
        </div>
        {e.alertsAfterCutoff === 0 ? (
          <Pill tone="chain">Clean since cutoff</Pill>
        ) : (
          <Pill tone="alert">Canopy loss detected</Pill>
        )}
      </div>

      {total > 0 ? (
        <div className="mb-3">
          <p className="eyebrow mb-1.5">Alert confidence</p>
          <div className="flex h-2.5 w-full gap-[2px] overflow-hidden">
            {CONFIDENCE_ORDER.map((k) => {
              const n = e.summary.byConfidence[k] ?? 0;
              if (n === 0) return null;
              return (
                <span
                  key={k}
                  title={`${CONFIDENCE_LABEL[k]}: ${formatNumber(n)} pixels`}
                  className="h-full rounded-[1px]"
                  style={{
                    width: `${(n / total) * 100}%`,
                    background: CONFIDENCE_FILL[k],
                  }}
                />
              );
            })}
            {unverified > 0 ? (
              <span
                title={`Unverified: ${formatNumber(unverified)} pixels — the alpha value was outside the three known levels, so confidence is not guessed`}
                className="h-full rounded-[1px] border border-dashed border-muted-foreground/70 bg-transparent"
                style={{ width: `${(unverified / total) * 100}%` }}
              />
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            {CONFIDENCE_ORDER.map((k) => {
              const n = e.summary.byConfidence[k] ?? 0;
              if (n === 0) return null;
              return (
                <span
                  key={k}
                  className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground"
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-[1px]"
                    style={{ background: CONFIDENCE_FILL[k] }}
                  />
                  {CONFIDENCE_LABEL[k]} · {formatNumber(n)}
                </span>
              );
            })}
            {unverified > 0 ? (
              <span className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2 rounded-[1px] border border-dashed border-muted-foreground/70"
                />
                <em>unverified</em> · {formatNumber(unverified)}
              </span>
            ) : null}
          </div>
          {unverified > 0 ? (
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {formatNumber(unverified)} alert pixels carry an alpha value
              outside the three known confidence levels. Their confidence is
              reported as <strong>unverified</strong> rather than guessed.
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <Row label="Area analysed">{formatArea(e.areaHa)}</Row>
        <Row label="Tiles scanned">
          {formatNumber(e.tilesScanned)} tiles · zoom z{e.zoom}
        </Row>
        <Row label="GFW data version">{e.tileVersion}</Row>
        {e.summary.truncated ? (
          <Row label="Alert list" tone="hold">
            truncated — the monthly summary still covers every pixel
          </Row>
        ) : (
          <Row label="Alerts listed">{formatNumber(e.alerts.length)} points</Row>
        )}
      </div>
    </div>
  );
}

// ---------- Badan hukum ----------

const MATCH_LABEL = {
  exact: 'exact match',
  fuzzy: 'fuzzy match',
  none: 'no match',
} as const;

function LegalEntityBody({ e }: { e: LegalEntityEvidence }) {
  const active = e.entityStatus?.toUpperCase() === 'ACTIVE';
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {e.matchQuality === 'none' ? (
          <Pill tone="hold">No match in GLEIF</Pill>
        ) : (
          <Pill tone={active ? 'chain' : 'alert'}>
            {active ? 'Entity active' : `Status: ${e.entityStatus ?? 'unknown'}`}
          </Pill>
        )}
        <Pill tone="neutral">{MATCH_LABEL[e.matchQuality]}</Pill>
      </div>
      <Row label="Legal name">{e.legalName ?? <Unknown />}</Row>
      <Row label="LEI">{e.lei ?? <Unknown>not verified</Unknown>}</Row>
      <Row label="Jurisdiction">{e.jurisdiction ?? <Unknown />}</Row>
      <Row label="Registration status">{e.registrationStatus ?? <Unknown />}</Row>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        GLEIF verifies the <strong>EU operator</strong> that is legally required
        to file the DDS — not the Malaysian exporter. GLEIF coverage in Malaysia
        is effectively nil, and naive name matching there produces false matches
        across jurisdictions.
      </p>
    </div>
  );
}

// ---------- Sanksi ----------

function SanctionsBody({ e }: { e: SanctionsEvidence }) {
  const hit = e.matches.length > 0;
  return (
    <div>
      <div className="mb-3">
        {hit ? (
          <Pill tone="alert">{e.matches.length} matches found</Pill>
        ) : (
          <Pill tone="chain">No matches</Pill>
        )}
      </div>

      {hit ? (
        <ul className="mb-3 space-y-1.5">
          {e.matches.map((m) => (
            <li
              key={`${m.list}-${m.entryId}`}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-sm border border-alert/30 bg-alert-soft px-2.5 py-1.5"
            >
              <span className="datum text-alert">{m.name}</span>
              <span className="datum text-[0.6875rem] text-muted-foreground">
                {m.list} · entry {m.entryId} · score {m.score.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="eyebrow mb-1">Lists screened against</p>
      {e.lists.map((l) => (
        <Row key={l.list} label={l.list.replace('_', ' ')}>
          version {formatDate(l.listDate)}
        </Row>
      ))}
    </div>
  );
}

// ---------- Sertifikasi RSPO ----------

function CertificationBody({ e }: { e: CertificationEvidence }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {e.disagreement ? (
          <Pill tone="alert">Two sources disagree</Pill>
        ) : (
          <Pill tone="neutral">No conflict</Pill>
        )}
        {e.supplyChainType ? (
          <Pill tone="neutral">Supply chain {e.supplyChainType}</Pill>
        ) : null}
      </div>

      {e.disagreement ? (
        <p className="mb-3 rounded-sm border border-alert/30 bg-alert-soft px-3 py-2 text-xs leading-relaxed">
          Two datasets that do not control one another give different answers
          about the same mill&rsquo;s RSPO status. The disagreement itself is the
          finding — it surfaces without trusting either party.
        </p>
      ) : null}

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        {e.claims.map((c) => (
          <div
            key={c.dataset}
            className={cn(
              'rounded-sm border px-3 py-2',
              c.certified === true && 'border-chain/40 bg-chain-soft',
              c.certified === false && 'border-hold/40 bg-hold-soft',
              c.certified === null && 'border-rule bg-muted/50',
            )}
          >
            <p className="eyebrow">{c.dataset}</p>
            <p className="datum mt-1">
              {c.certified === null ? (
                <Unknown>no record</Unknown>
              ) : (
                (c.raw ?? (c.certified ? 'certified' : 'not certified'))
              )}
            </p>
            <a
              href={c.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-block text-[0.6875rem] text-chain underline underline-offset-2"
            >
              {hostOf(c.sourceUrl)}
            </a>
          </div>
        ))}
      </div>

      <Row label="Mill">{e.millName}</Row>
      <Row label="UML ID">{e.millUmlId ?? <Unknown />}</Row>
      <Row label="Distance between records">
        {e.matchDistanceKm === null ? (
          <Unknown>only one source has data</Unknown>
        ) : (
          `${e.matchDistanceKm.toFixed(2)} km`
        )}
      </Row>
    </div>
  );
}
