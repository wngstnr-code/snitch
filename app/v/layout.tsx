import Link from 'next/link';
import { Wordmark } from '@/components/site/wordmark';
import { SiteFooter } from '@/components/site/app-shell';

/**
 * Kerangka halaman publik.
 *
 * Sengaja berbeda dari konsol internal: ini permukaan yang dipakai pihak
 * ketiga — importir, auditor, siapa pun — untuk memeriksa sebuah attestation
 * tanpa akun. Jawabannya dibaca langsung dari chain, bukan dari database kami.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-rule">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="SNITCH — home">
            <Wordmark />
          </Link>
          <span className="eyebrow">Public verification</span>
        </div>
        <p className="border-t border-rule bg-foreground px-4 py-1.5 text-center font-[family-name:var(--font-data)] text-[0.6875rem] tracking-[0.08em] text-background sm:px-6">
          Indicative verification. Not a legal EUDR Due Diligence Statement.
        </p>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
        {children}
      </main>

      <SiteFooter />
    </>
  );
}
