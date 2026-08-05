'use client';

import { useState } from 'react';
import type { AttestationRef } from '@/lib/types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Pill } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/states';
import { formatDateTime, shortHash } from '@/lib/ui/format';

/**
 * Kartu attestation onchain.
 *
 * Semua tautan di sini datang dari server, diturunkan dari `CHAIN_ID` — tidak
 * ada URL explorer yang dirakit di sisi klien. Kalau chain-nya ditukar, tautan
 * ikut berubah tanpa satu baris pun diubah di sini.
 *
 * Tombol "Periksa ulang sekarang" memanggil runner watcher yang sama persis
 * dengan cron. Kalau bukti satelit baru membantah attestation ini, pencabutan
 * benar-benar terjadi saat tombol itu ditekan — bukan simulasi.
 */

export function AttestationCard({
  attestation,
  onRecheck,
}: {
  attestation: AttestationRef;
  onRecheck?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoked = attestation.revoked;

  async function recheck() {
    if (!onRecheck) return;
    setError(null);
    setBusy(true);
    try {
      await onRecheck();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`sheet overflow-hidden ${revoked ? 'border-alert/50' : 'border-chain/40'}`}
    >
      <header
        className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5 ${
          revoked ? 'border-alert/40 bg-alert-soft' : 'border-chain/30 bg-chain-soft'
        }`}
      >
        <div>
          <p className="eyebrow">Onchain attestation</p>
          <h2 className={`mt-1 text-lg ${revoked ? 'text-alert' : 'text-chain'}`}>
            {revoked ? 'Revoked' : 'Active and monitored'}
          </h2>
        </div>
        <Pill tone={revoked ? 'alert' : 'chain'} dot live={!revoked}>
          {revoked ? 'Revoked' : 'Live'}
        </Pill>
      </header>

      <dl className="px-4 py-3">
        <Field label="UID">
          <a
            href={attestation.easscanUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-chain underline underline-offset-2"
            title={attestation.uid}
          >
            {shortHash(attestation.uid, 14, 8)}
          </a>
        </Field>
        <Field label="Issuing transaction">
          <a
            href={attestation.explorerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-chain underline underline-offset-2"
            title={attestation.txHash}
          >
            {shortHash(attestation.txHash, 14, 8)}
          </a>
        </Field>
        <Field label="Issued">{formatDateTime(attestation.attestedAt)}</Field>
        <Field label="Chain">{attestation.chainId}</Field>
        <Field label="Schema">{shortHash(attestation.schemaUid, 10, 6)}</Field>

        {revoked ? (
          <>
            <Field label="Revoked at" tone="alert">
              {formatDateTime(attestation.revokedAt)}
            </Field>
            {attestation.revokeTxHash ? (
              <Field label="Revocation transaction" tone="alert">
                <a
                  href={attestation.easscanUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-alert underline underline-offset-2"
                  title={attestation.revokeTxHash}
                >
                  {shortHash(attestation.revokeTxHash, 14, 8)}
                </a>
              </Field>
            ) : (
              <Field label="Revocation transaction">
                <span className="text-muted-foreground italic">
                  revoked through another route — no transaction from this system
                </span>
              </Field>
            )}
          </>
        ) : null}
      </dl>

      {revoked && attestation.revokeReason ? (
        <div className="border-t border-alert/30 bg-alert-soft px-4 py-3">
          <p className="eyebrow text-alert">Reason for revocation</p>
          <p className="mt-1 text-sm leading-relaxed">{attestation.revokeReason}</p>
        </div>
      ) : null}

      <div className="border-t border-rule px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <a
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            href={attestation.easscanUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open in EASScan
          </a>
          <a
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            href={attestation.explorerUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open in block explorer
          </a>
          <a
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            href={`/v/${attestation.uid}`}
          >
            Public verification page
          </a>
          {onRecheck && !revoked ? (
            <Button onClick={recheck} disabled={busy} size="sm">
              {busy ? 'Checking satellite…' : 'Re-verify now'}
            </Button>
          ) : null}
        </div>
        {onRecheck && !revoked ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Runs the same watcher the cron job runs: it pulls the latest GFW
            tiles for this plot. If alerts appeared after the evidence date,
            this attestation is revoked onchain right now.
          </p>
        ) : null}
        {error ? (
          <ErrorState
            className="mt-3"
            title="Re-verification failed"
            message={error}
          />
        ) : null}
      </div>
    </section>
  );
}

function Field({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: 'alert';
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule/60 py-1.5 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`datum text-right ${tone === 'alert' ? 'text-alert' : ''}`}>
        {children}
      </dd>
    </div>
  );
}
