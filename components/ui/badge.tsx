import { cn } from '@/lib/utils';
import type { VerificationStatus, Verdict } from '@/lib/types';
import {
  severityMeta,
  statusMeta,
  toneClass,
  toneDot,
  verdictMeta,
  type Tone,
} from '@/lib/ui/status';

/**
 * Penanda status. Selalu membawa teks — warna tidak pernah berdiri sendiri.
 */
export function Pill({
  tone = 'neutral',
  children,
  className,
  dot = false,
  live = false,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
  live?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5',
        'font-[family-name:var(--font-data)] text-[0.6875rem] font-medium tracking-[0.08em] uppercase',
        toneClass[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn('size-1.5 rounded-full', toneDot[tone], live && 'animate-live')}
        />
      ) : null}
      {children}
    </span>
  );
}

export function StatusBadge({
  status,
  className,
}: {
  status: VerificationStatus;
  className?: string;
}) {
  const meta = statusMeta[status];
  return (
    <Pill tone={meta.tone} dot live={meta.running} className={className}>
      {meta.label}
    </Pill>
  );
}

export function VerdictBadge({
  verdict,
  size = 'default',
  className,
}: {
  verdict: Verdict;
  size?: 'default' | 'lg';
  className?: string;
}) {
  const meta = verdictMeta[verdict];
  if (size === 'lg') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-sm border-2 px-3 py-1',
          'font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight',
          toneClass[meta.tone],
          className,
        )}
        style={{ fontStretch: '112%' }}
      >
        {meta.label}
      </span>
    );
  }
  return (
    <Pill tone={meta.tone} className={className}>
      {meta.label}
    </Pill>
  );
}

export function SeverityBadge({
  severity,
}: {
  severity: 'critical' | 'major' | 'minor' | 'info';
}) {
  const meta = severityMeta[severity];
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}
