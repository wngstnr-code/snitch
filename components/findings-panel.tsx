import type { AgentAssessment, Evidence } from '@/lib/types';
import { SeverityBadge, VerdictBadge } from '@/components/ui/badge';
import { severityMeta, verdictMeta } from '@/lib/ui/status';
import { formatConfidence } from '@/lib/ui/format';

/**
 * Temuan agen.
 *
 * Momen kredibilitas produk ini: setiap temuan membawa sitasi ke ID bukti, dan
 * sitasi itu adalah tautan yang benar-benar melompat ke kartu buktinya. Juri
 * bisa menelusuri klaim → bukti mentah → URL sumbernya tanpa mempercayai kita.
 *
 * ID sitasi divalidasi di sisi server terhadap isi bundle sebelum sampai ke
 * sini (CLAUDE.md B5), jadi tautan yang mati berarti ada yang salah — dan itu
 * ditampilkan apa adanya, bukan disembunyikan.
 */

export function FindingsPanel({
  assessment,
  evidence,
}: {
  assessment: AgentAssessment;
  evidence: Evidence[];
}) {
  const known = new Set(evidence.map((e) => e.id));
  const findings = [...assessment.findings].sort(
    (a, b) => severityMeta[a.severity].rank - severityMeta[b.severity].rank,
  );

  return (
    <section className="sheet overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3.5">
        <div>
          <p className="eyebrow">Agent assessment</p>
          <h2 className="mt-1 text-lg">
            {findings.length === 0
              ? 'No contradictions found'
              : `${findings.length} contradictions found`}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="eyebrow">Confidence</p>
            <p className="datum text-base">{formatConfidence(assessment.confidence)}</p>
          </div>
          <VerdictBadge verdict={assessment.verdict} size="lg" />
        </div>
      </header>

      <div className="border-b border-rule px-4 py-3">
        <p className="text-sm leading-relaxed">{assessment.summary}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {verdictMeta[assessment.verdict].hint}
        </p>
      </div>

      {findings.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          The agent found no conflict between the claims and the evidence
          collected. That is not a guarantee — it only means the available
          evidence does not contradict them.
        </p>
      ) : (
        <ol className="divide-y divide-rule">
          {findings.map((f, i) => (
            <li key={`${f.claim}-${i}`} className="px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={f.severity} />
              </div>

              <dl className="mt-2.5 space-y-2">
                <div>
                  <dt className="eyebrow">Claim</dt>
                  <dd className="mt-0.5 text-sm leading-relaxed">{f.claim}</dd>
                </div>
                <div>
                  <dt className="eyebrow text-alert">Contradicted by</dt>
                  <dd className="mt-0.5 border-l-2 border-alert pl-3 text-sm leading-relaxed">
                    {f.contradiction}
                  </dd>
                </div>
              </dl>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="eyebrow">Evidence</span>
                {f.evidenceIds.map((id) =>
                  known.has(id) ? (
                    <a
                      key={id}
                      href={`#ev-${id}`}
                      className="datum rounded-sm border border-chain/40 bg-chain-soft px-1.5 py-0.5 text-[0.6875rem] text-chain transition-colors hover:bg-chain hover:text-background"
                    >
                      {id}
                    </a>
                  ) : (
                    <span
                      key={id}
                      title="This evidence ID is not in the bundle — the citation cannot be traced."
                      className="datum rounded-sm border border-alert/40 bg-alert-soft px-1.5 py-0.5 text-[0.6875rem] text-alert"
                    >
                      {id} · not found
                    </span>
                  ),
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
