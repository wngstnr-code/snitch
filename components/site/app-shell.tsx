import Link from 'next/link';
import { Wordmark } from '@/components/site/wordmark';

/**
 * Kerangka aplikasi.
 *
 * Dua hal di sini bukan hiasan dan tidak boleh dihapus:
 *  1. Pita disclaimer di bawah header — kita menerbitkan "verdict kepatuhan"
 *     tanpa menjadi badan sertifikasi (CLAUDE.md B7). Menyatakannya terbuka
 *     menambah kredibilitas, bukan menguranginya.
 *  2. Atribusi CC BY 4.0 di footer — syarat lisensi data Global Forest Watch.
 */

const nav = [
  { href: '/', label: 'Dossiers' },
  { href: '/new', label: 'New verification' },
  { href: '/v', label: 'Public check' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-rule bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="shrink-0" aria-label="SNITCH — home">
            <Wordmark />
          </Link>
          <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Main">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-sm px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="border-t border-rule bg-foreground px-4 py-1.5 text-center font-[family-name:var(--font-data)] text-[0.6875rem] tracking-[0.08em] text-background sm:px-6">
          Indicative verification. Not a legal EUDR Due Diligence Statement.
        </p>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>

      <SiteFooter />
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-rule bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="eyebrow">Evidence sources</p>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">
              <li>
                Deforestation alerts:{' '}
                <a
                  className="text-chain underline underline-offset-2"
                  href="https://www.globalforestwatch.org/"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Global Forest Watch integrated alerts
                </a>{' '}
                — © WRI, licensed{' '}
                <a
                  className="text-chain underline underline-offset-2"
                  href="https://creativecommons.org/licenses/by/4.0/"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  CC BY 4.0
                </a>
              </li>
              <li>Legal entity: GLEIF Global LEI Index</li>
              <li>Sanctions: OFAC SDN · EU consolidated list</li>
              <li>Mills &amp; RSPO: Universal Mill List · Unilever Palm Oil Mills</li>
              <li>Basemap: OpenStreetMap contributors · Esri World Imagery</li>
            </ul>
          </div>
          <div className="sm:text-right">
            <p className="eyebrow">Limitations</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground sm:ml-auto sm:max-w-xs">
              SNITCH is not a certification body. Verdicts here are indicative and
              do not replace an official EUDR Due Diligence Statement. Mill
              sourcing-radius analysis is not plot-level verification.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
