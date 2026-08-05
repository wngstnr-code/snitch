'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { DeforestationEvidence, PublicVerifyResponse } from '@/lib/types';
import { fetchPublicVerification } from '@/lib/ui/api';
import { Lifeline } from '@/components/lifeline';
import { EvidencePanel } from '@/components/evidence/panel';
import { Pill, VerdictBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { ErrorState, SkeletonRows } from '@/components/ui/states';
import { formatConfidence, formatDateTime, shortHash } from '@/lib/ui/format';

/**
 * Halaman verifikasi publik.
 *
 * Keadaan REVOKED harus mencolok — inilah pemandangan yang menjelaskan seluruh
 * produk dalam satu layar: sebuah sertifikat yang mati sendiri karena bukti
 * baru membantahnya, dan siapa pun bisa melihatnya tanpa izin siapa pun.
 */

export function PublicVerify({ uid }: { uid: string }) {
  const [data, setData] = useState<PublicVerifyResponse | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await fetchPublicVerification(uid);
      setData(next);
      setFatal(null);
      return next;
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [uid]);

  /** Dipakai tombol "baca ulang" — di sana `setBusy` memang disengaja. */
  const reload = useCallback(() => {
    setBusy(true);
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    async function read() {
      const next = await load();
      if (!alive || !next) return;
    }
    void read();
    return () => {
      alive = false;
    };
  }, [load]);

  if (fatal) return <ErrorState title="The check failed" message={fatal} />;
  if (!data) return <SkeletonRows rows={4} />;

  if (!data.found) {
    return (
      <div>
        <p className="eyebrow">UID</p>
        <p className="datum mt-1 break-all">{uid}</p>
        <ErrorState
          className="mt-4"
          title="No attestation with this UID"
          message={data.error ?? 'The contract does not recognise that UID.'}
          action={
            <Link
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              href="/v"
            >
              Try another UID
            </Link>
          }
        />
      </div>
    );
  }

  const revoked = data.onchain?.revoked ?? false;
  const deforestation = data.bundle?.items.find(
    (e): e is DeforestationEvidence => e.kind === 'deforestation',
  );

  return (
    <div className="space-y-8">
      {/* ── vonis ── */}
      <section
        className={`sheet overflow-hidden ${revoked ? 'border-alert' : 'border-chain/50'}`}
      >
        <div
          className={`px-5 py-5 ${revoked ? 'bg-alert-soft' : 'bg-chain-soft'} sm:px-6`}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="eyebrow">Onchain status</p>
              <p
                className={`mt-1.5 font-[family-name:var(--font-display)] text-4xl font-extrabold sm:text-5xl ${
                  revoked ? 'text-alert' : 'text-chain'
                }`}
                style={{ fontStretch: '110%' }}
              >
                {revoked ? 'REVOKED' : 'VALID'}
              </p>
            </div>
            {data.decoded ? (
              <div className="text-right">
                <p className="eyebrow">Recorded verdict</p>
                <div className="mt-1.5">
                  <VerdictBadge verdict={data.decoded.verdict} size="lg" />
                </div>
                <p className="datum mt-1.5 text-muted-foreground">
                  agent confidence {formatConfidence(data.decoded.confidence)}
                </p>
              </div>
            ) : null}
          </div>

          <p className="mt-4 max-w-2xl text-sm leading-relaxed">
            {revoked ? (
              <>
                This attestation is <strong>no longer valid</strong>. Satellite
                evidence published after its evidence window contradicts it, and
                the revocation is recorded permanently on the blockchain — not on
                our server. Revoked at{' '}
                <strong>{formatDateTime(data.onchain?.revocationTime)}</strong>.
              </>
            ) : (
              <>
                This attestation is still valid according to the EAS contract at
                the moment this page loaded. It stays monitored; if new satellite
                imagery contradicts it, its status changes by itself with nobody
                needing to notify anyone.
              </>
            )}
          </p>
        </div>

        {data.onchain ? (
          <dl className="grid gap-px bg-rule sm:grid-cols-2">
            <Cell label="UID">
              <a
                href={data.onchain.easscanUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-chain underline underline-offset-2"
                title={data.uid}
              >
                {shortHash(data.uid, 14, 8)}
              </a>
            </Cell>
            <Cell label="Issued">{formatDateTime(data.onchain.time)}</Cell>
            <Cell label="Attester">
              <span title={data.onchain.attester}>
                {shortHash(data.onchain.attester, 10, 6)}
              </span>
            </Cell>
            <Cell label="Chain">{data.onchain.chainId}</Cell>
            {data.decoded ? (
              <>
                <Cell label="Plot">{data.decoded.plotId}</Cell>
                <Cell label="Geohash">{data.decoded.plotGeohash || '—'}</Cell>
                <Cell label="Evidence window">
                  {formatDateTime(data.decoded.evidenceAsOf)}
                </Cell>
                <Cell label="Reviewed by">{data.decoded.reviewedBy || '—'}</Cell>
                <Cell label="EU operator LEI">
                  {data.decoded.legalEntityLEI || (
                    <span className="text-muted-foreground italic">
                      not verified
                    </span>
                  )}
                </Cell>
                <Cell label="Evidence hash">
                  <span title={data.decoded.evidenceHash}>
                    {shortHash(data.decoded.evidenceHash, 12, 6)}
                  </span>
                </Cell>
              </>
            ) : null}
          </dl>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-rule px-5 py-3 sm:px-6">
          {data.onchain ? (
            <>
              <a
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                href={data.onchain.easscanUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                View on EASScan
              </a>
              <a
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                href={data.onchain.explorerUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                View on block explorer
              </a>
            </>
          ) : null}
          <Button variant="ghost" size="sm" onClick={reload} disabled={busy}>
            {busy ? 'Reading chain…' : 'Re-read from chain'}
          </Button>
        </div>
      </section>

      {/* ── integritas berkas bukti ── */}
      {data.error ? (
        <ErrorState title="The evidence bundle could not be proven" message={data.error} />
      ) : data.bundle ? (
        <p className="flex flex-wrap items-center gap-2 rounded-sm border border-chain/40 bg-chain-soft px-3 py-2 text-xs">
          <Pill tone="chain">Hash matches</Pill>
          <span className="leading-relaxed">
            The evidence bundle was re-downloaded from the address recorded in
            the attestation, and its sha256 matches the hash anchored onchain
            exactly.
          </span>
        </p>
      ) : null}

      {/* ── garis hidup ── */}
      {data.bundle && deforestation ? (
        <section className="sheet px-4 pt-4 pb-3 sm:px-6">
          <p className="eyebrow">Lifeline</p>
          <h2 className="mt-1 mb-3 text-xl">
            {revoked
              ? 'This is where the certificate died'
              : 'What is covered, and what is still being watched'}
          </h2>
          <Lifeline
            variant="hero"
            evidenceAsOf={data.bundle.evidenceAsOf}
            byMonth={deforestation.summary.byMonth}
            revokedAt={data.onchain?.revocationTime ?? null}
            dataAsOf={deforestation.fetchedAt}
          />
        </section>
      ) : null}

      {/* ── bukti ── */}
      {data.bundle && data.bundle.items.length > 0 ? (
        <section>
          <h2 className="mb-3 text-lg">Anchored evidence</h2>
          <EvidencePanel items={data.bundle.items} />
        </section>
      ) : null}
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card px-5 py-2.5 sm:px-6">
      <dt className="eyebrow">{label}</dt>
      <dd className="datum mt-0.5 break-all">{children}</dd>
    </div>
  );
}
