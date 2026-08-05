'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeforestationEvidence, HumanReview, Verification } from '@/lib/types';
import {
  fetchVerification,
  issueAttestation,
  recheck,
  submitReview,
} from '@/lib/ui/api';
import { Lifeline } from '@/components/lifeline';
import { PlotMap } from '@/components/plot-map';
import { EvidencePanel } from '@/components/evidence/panel';
import { FindingsPanel } from '@/components/findings-panel';
import { ReviewForm } from '@/components/review-form';
import { AttestationCard } from '@/components/attestation-card';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingLine, SkeletonRows } from '@/components/ui/states';
import { statusMeta } from '@/lib/ui/status';
import { formatArea, formatDate, formatDateTime, shortHash } from '@/lib/ui/format';

/**
 * Berkas verifikasi lengkap.
 *
 * Urutan di layar mengikuti urutan yang sebenarnya terjadi: garis waktu bukti
 * lebih dulu (karena itulah pertanyaannya), lalu temuan agen, lalu bukti
 * mentahnya, lalu keputusan manusia, baru onchain. Sitasi di panel temuan
 * melompat ke kartu bukti di bawahnya.
 */

const POLL_MS = 3000;

export function VerificationDetail({ id }: { id: string }) {
  const [v, setV] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attestBusy, setAttestBusy] = useState(false);
  const [attestError, setAttestError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchVerification(id);
      setV(data);
      setError(null);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    async function tick() {
      const data = await load();
      if (!alive) return;
      if (data && statusMeta[data.status].running) {
        timer.current = setTimeout(tick, POLL_MS);
      }
    }
    void tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  async function onReview(review: HumanReview) {
    setV(await submitReview(id, review));
  }

  async function onAttest() {
    setAttestError(null);
    setAttestBusy(true);
    try {
      setV(await issueAttestation(id));
    } catch (e) {
      setAttestError(e instanceof Error ? e.message : String(e));
    } finally {
      setAttestBusy(false);
    }
  }

  async function onRecheck() {
    setV(await recheck(id));
  }

  if (error && !v) {
    return <ErrorState title="This dossier could not be loaded" message={error} />;
  }
  if (!v) return <SkeletonRows rows={5} />;

  const meta = statusMeta[v.status];
  const deforestation = v.bundle?.items.find(
    (e): e is DeforestationEvidence => e.kind === 'deforestation',
  );
  const canAttest =
    !!v.review && v.review.decision !== 'reject' && !v.attestation && !!v.assessment;

  return (
    <div className="space-y-8">
      {/* ── kepala berkas ── */}
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">
              {v.plot.source === 'mill_dataset'
                ? 'Mill sourcing risk'
                : 'Plot verification'}
            </p>
            <h1 className="mt-1.5 text-3xl">{v.plot.name}</h1>
            <p className="datum mt-1 text-muted-foreground">
              {v.plot.operatorName} · {formatArea(v.plot.areaHa)} · geohash{' '}
              {v.plot.geohash || '—'}
            </p>
          </div>
          <StatusBadge status={v.status} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{meta.hint}</p>
        {meta.running ? (
          <div className="mt-3">
            <LoadingLine label="refreshing automatically…" />
          </div>
        ) : null}
      </header>

      {v.error ? (
        <ErrorState title="Verification stopped with an error" message={v.error} />
      ) : null}

      {/* ── garis hidup: grafik utama ── */}
      {v.bundle && deforestation ? (
        <section className="sheet px-4 pt-4 pb-3 sm:px-6">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="eyebrow">Attestation lifeline</p>
              <h2 className="mt-1 text-xl">
                {v.attestation?.revoked
                  ? 'Contradicted by new evidence'
                  : 'What is covered, and what is still being watched'}
              </h2>
            </div>
            <p className="datum text-muted-foreground">
              GFW data {deforestation.tileVersion}
            </p>
          </div>
          <Lifeline
            variant="hero"
            evidenceAsOf={v.bundle.evidenceAsOf}
            byMonth={deforestation.summary.byMonth}
            revokedAt={v.attestation?.revokedAt ?? null}
            dataAsOf={deforestation.fetchedAt}
          />
        </section>
      ) : null}

      {/* ── peta + bukti mentah ── */}
      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <h2 className="text-lg">Plot and alerts</h2>
          <PlotMap
            focus={v.plot}
            alerts={deforestation?.alerts ?? []}
            className="h-[340px]"
          />
          {deforestation?.summary.truncated ? (
            <p className="text-xs text-muted-foreground">
              The alert point list is truncated because there are so many. The
              monthly summary figures still count every pixel.
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <h2 className="text-lg">Evidence bundle</h2>
          {v.bundle ? (
            <dl className="sheet px-4 py-3">
              <Row label="Evidence window">{formatDateTime(v.bundle.evidenceAsOf)}</Row>
              <Row label="Evidence items">{v.bundle.items.length}</Row>
              <Row label="Bundle hash">
                <span title={v.bundle.bundleHash}>
                  {shortHash(v.bundle.bundleHash, 12, 6)}
                </span>
              </Row>
              <Row label="Raw bundle">
                <a
                  href={v.bundle.blobUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-chain underline underline-offset-2"
                >
                  download JSON
                </a>
              </Row>
              <Row label="Created">{formatDate(v.createdAt)}</Row>
            </dl>
          ) : (
            <p className="sheet px-4 py-6 text-center text-sm text-muted-foreground">
              Evidence has not been collected yet.
            </p>
          )}
        </div>
      </section>

      {/* ── temuan agen ── */}
      {v.assessment && v.bundle ? (
        <FindingsPanel assessment={v.assessment} evidence={v.bundle.items} />
      ) : null}

      {/* ── bukti per butir ── */}
      {v.bundle && v.bundle.items.length > 0 ? (
        <section>
          <h2 className="mb-3 text-lg">Raw evidence</h2>
          <EvidencePanel items={v.bundle.items} />
        </section>
      ) : null}

      {/* ── keputusan manusia ── */}
      {v.assessment ? (
        <ReviewForm
          agentVerdict={v.assessment.verdict}
          existing={v.review}
          onSubmit={onReview}
          disabled={!!v.attestation && !v.attestation.revoked}
        />
      ) : null}

      {/* ── terbitkan ── */}
      {canAttest ? (
        <section className="sheet px-4 py-4">
          <p className="eyebrow">Final step</p>
          <h2 className="mt-1 text-lg">Issue the attestation onchain</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Writes the verdict, evidence bundle hash, time window, and reviewer
            name to the EAS contract. Permanent, and revocable. Once issued, the
            watcher begins monitoring this plot.
          </p>
          {attestError ? (
            <ErrorState
              className="mt-3"
              title="Issuing failed"
              message={attestError}
            />
          ) : null}
          <Button className="mt-4" size="lg" onClick={onAttest} disabled={attestBusy}>
            {attestBusy ? 'Sending transaction…' : 'Issue attestation'}
          </Button>
        </section>
      ) : null}

      {/* ── kartu onchain ── */}
      {v.attestation ? (
        <AttestationCard attestation={v.attestation} onRecheck={onRecheck} />
      ) : null}

      {error ? (
        <ErrorState title="The latest refresh failed" message={error} />
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule/60 py-1.5 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="datum text-right">{children}</dd>
    </div>
  );
}
