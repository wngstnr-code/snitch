import { cn } from '@/lib/utils';

/**
 * Keadaan kosong, gagal, dan sedang memuat.
 *
 * Aturan menulisnya (CLAUDE.md §0): error ditampilkan **apa adanya**, dengan
 * pesan asli dari server. Tidak dihaluskan, tidak diganti kalimat generik, dan
 * tidak pernah disembunyikan di balik data cadangan. Layar kosong adalah
 * ajakan bertindak, bukan permintaan maaf.
 */

export function ErrorState({
  title = 'This request failed',
  message,
  action,
  className,
}: {
  title?: string;
  message: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'sheet border-alert/40 bg-alert-soft/60 p-5',
        className,
      )}
    >
      <p className="eyebrow text-alert">Error</p>
      <h3 className="mt-1 text-base text-alert">{title}</h3>
      <p className="datum mt-2 leading-relaxed break-words text-foreground/80">
        {message}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'sheet border-dashed p-10 text-center',
        className,
      )}
    >
      <h3 className="text-lg">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Balok abu yang menahan tempat — bukan spinner tanpa arti. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-sm border border-rule bg-muted/60"
        />
      ))}
    </div>
  );
}

export function LoadingLine({ label }: { label: string }) {
  return (
    <p className="eyebrow flex items-center gap-2" aria-live="polite">
      <span className="animate-live size-1.5 rounded-full bg-chain" aria-hidden />
      {label}
    </p>
  );
}
