'use client';

import { useState } from 'react';
import type { HumanReview, Verdict } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { VerdictBadge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/ui/format';

/**
 * Keputusan manusia.
 *
 * Ini bukan formalitas UI. Attestation membawa nama peninjau ke onchain dan
 * sifatnya permanen — server menolak menerbitkan apa pun tanpa langkah ini.
 * Karena itu `reason` wajib untuk SEMUA keputusan, bukan hanya penolakan:
 * tanda tangan tanpa alasan tidak bisa dipertanggungjawabkan siapa pun nanti.
 *
 * Batas minimal 10 karakter ditegakkan server; di sini ditegakkan juga supaya
 * orang tidak menunggu bolak-balik jaringan untuk tahu.
 */

const MIN_REASON = 10;

export function ReviewForm({
  agentVerdict,
  existing,
  onSubmit,
  disabled,
}: {
  agentVerdict: Verdict;
  existing: HumanReview | null;
  onSubmit: (review: HumanReview) => Promise<void>;
  disabled?: boolean;
}) {
  const [decision, setDecision] = useState<HumanReview['decision']>(
    existing?.decision ?? 'approve',
  );
  const [overrideVerdict, setOverrideVerdict] = useState<Verdict>(
    existing?.overrideVerdict ?? (agentVerdict === 'PASS' ? 'FAIL' : 'PASS'),
  );
  const [reason, setReason] = useState(existing?.reason ?? '');
  const [reviewedBy, setReviewedBy] = useState(existing?.reviewedBy ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonTooShort = reason.trim().length < MIN_REASON;
  const noName = reviewedBy.trim().length === 0;
  const blocked = busy || disabled || reasonTooShort || noName;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        decision,
        overrideVerdict: decision === 'override' ? overrideVerdict : undefined,
        reason: reason.trim(),
        reviewedBy: reviewedBy.trim(),
        reviewedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sheet overflow-hidden">
      <header className="border-b border-rule px-4 py-3.5">
        <p className="eyebrow">Human step</p>
        <h2 className="mt-1 text-lg">Review the agent assessment</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          The agent prepares the dossier; you decide. Your decision and reason
          are carried into the onchain attestation, along with your name.
        </p>
      </header>

      {existing ? (
        <div className="border-b border-rule bg-muted/40 px-4 py-3">
          <p className="eyebrow">Saved decision</p>
          <p className="datum mt-1">
            {DECISIONS.find((d) => d.value === existing.decision)?.label} by{' '}
            {existing.reviewedBy} · {formatDateTime(existing.reviewedAt)}
          </p>
          <p className="mt-1 text-sm">{existing.reason}</p>
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-4 px-4 py-4">
        <fieldset disabled={disabled}>
          <legend className="eyebrow mb-2">Decision</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {DECISIONS.map((d) => (
              <label
                key={d.value}
                className={`cursor-pointer rounded-sm border px-3 py-2.5 transition-colors ${
                  decision === d.value
                    ? 'border-foreground bg-muted'
                    : 'border-rule hover:bg-muted/50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="decision"
                    value={d.value}
                    checked={decision === d.value}
                    onChange={() => setDecision(d.value)}
                    className="accent-[var(--chain)]"
                  />
                  <span className="text-sm font-medium">{d.label}</span>
                </span>
                <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                  {d.hint}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {decision === 'override' ? (
          <div>
            <label className="eyebrow mb-1.5 block" htmlFor="override">
              Replacement verdict
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <select
                id="override"
                value={overrideVerdict}
                onChange={(e) => setOverrideVerdict(e.target.value as Verdict)}
                disabled={disabled}
                className="datum rounded-sm border border-rule bg-card px-2.5 py-1.5"
              >
                <option value="PASS">PASS</option>
                <option value="FAIL">FAIL</option>
                <option value="INCONCLUSIVE">INCONCLUSIVE</option>
              </select>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                agent says <VerdictBadge verdict={agentVerdict} /> → you override to{' '}
                <VerdictBadge verdict={overrideVerdict} />
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              The confidence score written onchain still belongs to the agent
              and its original verdict. The schema has no field for that, so the
              override is recorded in the reviewer-name field to stop onchain
              readers from misreading the number.
            </p>
          </div>
        ) : null}

        <div>
          <label className="eyebrow mb-1.5 block" htmlFor="reviewedBy">
            Reviewer name
          </label>
          <input
            id="reviewedBy"
            value={reviewedBy}
            onChange={(e) => setReviewedBy(e.target.value)}
            disabled={disabled}
            placeholder="e.g. Nabil A. — Compliance Officer"
            className="datum w-full rounded-sm border border-rule bg-card px-2.5 py-2"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            This name is written permanently to the blockchain.
          </p>
        </div>

        <div>
          <label className="eyebrow mb-1.5 block" htmlFor="reason">
            Reason
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={disabled}
            rows={3}
            placeholder="Why did you decide this? It enters the audit trail and cannot be deleted."
            className="w-full rounded-sm border border-rule bg-card px-2.5 py-2 text-sm"
          />
          <p
            className={`mt-1 text-xs ${reasonTooShort && reason.length > 0 ? 'text-alert' : 'text-muted-foreground'}`}
          >
            {reason.trim().length}/{MIN_REASON} characters minimum
          </p>
        </div>

        {error ? <ErrorState message={error} title="Review could not be saved" /> : null}

        <Button type="submit" disabled={blocked} size="lg">
          {busy ? 'Saving…' : existing ? 'Update decision' : 'Save decision'}
        </Button>
      </form>
    </section>
  );
}

const DECISIONS: Array<{
  value: HumanReview['decision'];
  label: string;
  hint: string;
}> = [
  {
    value: 'approve',
    label: 'Approve',
    hint: 'Accept the agent assessment as it stands.',
  },
  {
    value: 'reject',
    label: 'Reject',
    hint: 'Not fit to publish. Nothing goes onchain.',
  },
  {
    value: 'override',
    label: 'Override',
    hint: 'You disagree with the verdict and replace it.',
  },
];
