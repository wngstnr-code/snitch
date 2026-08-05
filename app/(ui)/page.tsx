import Link from 'next/link';
import { VerificationList } from '@/components/verification-list';
import { buttonVariants } from '@/components/ui/button';

export default function HomePage() {
  return (
    <div className="space-y-12">
      <section>
        <p className="eyebrow">Supply chain verification oracle · EUDR</p>
        <h1
          className="mt-3 max-w-3xl text-4xl leading-[1.02] sm:text-5xl"
          style={{ fontStretch: '108%' }}
        >
          PDF certificates go stale silently.
          <br />
          <span className="text-alert">Ours revoke themselves.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
          A deforestation-free certificate today is signed once and valid for
          twelve months. If the land is cleared next month, the document still
          looks valid until the next audit. SNITCH tests an exporter&rsquo;s claims
          against evidence they do not control, asks a human to decide, then
          issues an onchain attestation that{' '}
          <strong className="text-foreground">revokes itself</strong> the moment
          new satellite imagery contradicts it.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link className={buttonVariants({ size: 'lg' })} href="/new">
            Start a verification
          </Link>
          <Link
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
            href="/v"
          >
            Check a public attestation
          </Link>
        </div>
      </section>

      <section aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="sr-only">
          How it works
        </h2>
        <ol className="grid gap-px overflow-hidden rounded-sm border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="bg-card p-4">
              <p className="eyebrow">Stage {String(i + 1).padStart(2, '0')}</p>
              <h3 className="mt-2 text-base">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
              <p className="datum mt-2.5 border-t border-rule pt-2 text-[0.6875rem] text-muted-foreground">
                {s.source}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="dossiers">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Dossiers</p>
            <h2 id="dossiers" className="mt-1 text-2xl">
              Verifications run so far
            </h2>
          </div>
          <Link className={buttonVariants({ variant: 'outline' })} href="/new">
            New verification
          </Link>
        </div>
        <VerificationList />
      </section>
    </div>
  );
}

/**
 * Empat tahap ini memang sebuah urutan, jadi penomorannya membawa informasi —
 * bukan hiasan. Setiap tahap menyebut sumber datanya, karena di produk ini
 * asal-usul angka adalah bagian dari produknya.
 */
const STEPS = [
  {
    title: 'Collect evidence',
    body: 'The plot polygon becomes a list of satellite tiles whose pixels decode into dated deforestation alerts. Entities are screened against registries and sanctions lists.',
    source: 'GFW · GLEIF · OFAC · EU',
  },
  {
    title: 'Challenge the claims',
    body: 'The agent does not summarise what the exporter claims — it attacks it. Every finding must cite an evidence ID that genuinely exists in the dossier.',
    source: 'Two independent RSPO datasets set against each other',
  },
  {
    title: 'A human decides',
    body: 'The agent prepares the dossier; a reviewer approves, rejects, or overrides it with a written reason. Their name goes onchain with it.',
    source: 'Without this step, nothing is ever issued',
  },
  {
    title: 'Watch and revoke',
    body: 'A watcher re-checks the same plot against the newest imagery. A fresh alert after the evidence date triggers revocation onchain.',
    source: 'EAS on Base · revocable',
  },
];
