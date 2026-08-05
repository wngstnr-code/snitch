/**
 * Logo. Tanda di sebelah kiri adalah bentuk kecil dari grafik utama produk
 * ini: garis attestation yang berjalan utuh, lalu terputus oleh satu alert.
 * Logonya menceritakan produknya.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <svg
        width="26"
        height="16"
        viewBox="0 0 26 16"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        <path d="M1 8h13" stroke="var(--chain)" strokeWidth="2" strokeLinecap="square" />
        <path
          d="M17 8h8"
          stroke="var(--muted-foreground)"
          strokeWidth="1.5"
          strokeDasharray="1.5 2.5"
          strokeLinecap="butt"
        />
        <path d="M15 2v12" stroke="var(--alert)" strokeWidth="2.5" strokeLinecap="butt" />
      </svg>
      <span
        className="font-[family-name:var(--font-display)] text-[1.0625rem] font-extrabold tracking-[-0.01em]"
        style={{ fontStretch: '115%' }}
      >
        SNITCH
      </span>
    </span>
  );
}
