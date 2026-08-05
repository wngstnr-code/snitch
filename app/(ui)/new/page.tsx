import type { Metadata } from 'next';
import { IntakeForm } from '@/components/intake-form';

export const metadata: Metadata = { title: 'New verification' };

export default function NewVerificationPage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Intake</p>
        <h1 className="mt-2 text-3xl">Choose what to test</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Pick one of the 500 real Malaysian palm oil mills on the map, or upload
          a plot GeoJSON. Either way the server decodes Global Forest Watch
          satellite tiles over that exact area — pixel by pixel — into dated
          deforestation alerts.
        </p>
      </header>
      <IntakeForm />
    </div>
  );
}
