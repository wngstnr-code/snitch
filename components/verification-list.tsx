'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Verification } from '@/lib/types';
import { fetchVerifications } from '@/lib/ui/api';
import { StatusBadge, VerdictBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { buttonVariants } from '@/components/ui/button';
import { statusMeta } from '@/lib/ui/status';
import { formatArea, formatDate, relativeFromNow, shortHash } from '@/lib/ui/format';

/**
 * Daftar berkas verifikasi.
 *
 * Polling hanya berjalan selama ada verifikasi yang benar-benar sedang jalan,
 * dan berhenti sendiri begitu semuanya selesai — tidak ada timer yang berputar
 * tanpa alasan. Kalau permintaan gagal, yang muncul adalah pesan asli server,
 * bukan daftar kosong yang menyamar sebagai "belum ada apa-apa".
 */

const POLL_MS = 4000;

export function VerificationList() {
  const [items, setItems] = useState<Verification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchVerifications();
      setItems(data);
      setError(null);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;

    async function tick() {
      const data = await load();
      if (!alive) return;
      const running = data?.some((v) => statusMeta[v.status].running) ?? false;
      if (running) timer.current = setTimeout(tick, POLL_MS);
    }

    void tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  if (error) {
    return (
      <ErrorState
        title="The verification list could not be loaded"
        message={error}
        action={
          <button
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            onClick={() => void load()}
          >
            Try again
          </button>
        }
      />
    );
  }

  if (items === null) return <SkeletonRows rows={3} />;

  if (items.length === 0) {
    return (
      <EmptyState
        title="No dossiers yet"
        body="Start by picking a palm oil mill from the map, or upload a plot GeoJSON. The first verification pulls real satellite evidence."
        action={
          <Link className={buttonVariants({ size: 'lg' })} href="/new">
            Start a verification
          </Link>
        }
      />
    );
  }

  return (
    <ul className="divide-y divide-rule overflow-hidden rounded-sm border border-rule bg-card">
      {items.map((v) => (
        <li key={v.id}>
          <Link
            href={`/verifications/${v.id}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-muted/60"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{v.plot.name}</p>
              <p className="datum mt-0.5 truncate text-muted-foreground">
                {v.plot.operatorName} · {formatArea(v.plot.areaHa)} ·{' '}
                {v.plot.source === 'mill_dataset'
                  ? 'mill sourcing radius'
                  : 'uploaded plot'}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {v.assessment ? <VerdictBadge verdict={v.assessment.verdict} /> : null}
              <StatusBadge status={v.status} />
            </div>

            {/*
              Jangan tampilkan `evidenceAsOf` di sini. Endpoint daftar SENGAJA
              tidak mengirim bundle bukti — satu petak bisa membawa ribuan
              alert — sehingga `v.bundle` selalu null dan kolomnya selamanya
              berisi tanda strip. Yang ditampilkan hanya nilai yang memang
              benar-benar ada di muatan daftar.
            */}
            <div className="w-full shrink-0 sm:w-auto sm:text-right">
              {v.attestation ? (
                <p className="datum text-muted-foreground" title={v.attestation.uid}>
                  {shortHash(v.attestation.uid, 10, 6)}
                </p>
              ) : null}
              <p className="text-[0.6875rem] text-muted-foreground">
                created {formatDate(v.createdAt)} · {relativeFromNow(v.createdAt)}
              </p>
            </div>
          </Link>

          {v.error ? (
            <p className="datum border-t border-alert/30 bg-alert-soft px-4 py-2 text-alert">
              {v.error}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
