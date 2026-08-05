/**
 * Pemetaan status → bahasa manusia dan nada warna.
 *
 * Teks di sini berbahasa Inggris karena pembacanya importir Uni Eropa,
 * auditor, dan juri internasional. Komentar tetap berbahasa Indonesia — itu
 * untuk kita berdua yang menulis kodenya.
 *
 * Setiap status SELALU dirender bersama labelnya. Warna di sistem ini adalah
 * penguat, tidak pernah satu-satunya penanda — pembaca dengan buta warna harus
 * mendapat informasi yang sama persis.
 */

import type { VerificationStatus, Verdict } from '@/lib/types';

/** Tiga nada yang ada di sistem, plus netral. */
export type Tone = 'alert' | 'chain' | 'hold' | 'neutral';

export const toneClass: Record<Tone, string> = {
  alert: 'text-alert bg-alert-soft border-alert/30',
  chain: 'text-chain bg-chain-soft border-chain/30',
  hold: 'text-hold bg-hold-soft border-hold/30',
  neutral: 'text-muted-foreground bg-muted border-rule',
};

export const toneDot: Record<Tone, string> = {
  alert: 'bg-alert',
  chain: 'bg-chain',
  hold: 'bg-hold',
  neutral: 'bg-muted-foreground',
};

interface StatusMeta {
  label: string;
  tone: Tone;
  /** Kalimat yang menjelaskan apa yang sedang terjadi, untuk orang non-teknis. */
  hint: string;
  /** Sedang berjalan → UI melakukan polling. */
  running: boolean;
}

export const statusMeta: Record<VerificationStatus, StatusMeta> = {
  pending: {
    label: 'Queued',
    tone: 'neutral',
    hint: 'Created, but evidence collection has not started.',
    running: true,
  },
  collecting: {
    label: 'Collecting evidence',
    tone: 'hold',
    hint: 'Downloading satellite tiles, entity registries, and sanctions lists.',
    running: true,
  },
  assessing: {
    label: 'Agent assessing',
    tone: 'hold',
    hint: 'The agent is testing each claim against the evidence collected.',
    running: true,
  },
  awaiting_review: {
    label: 'Awaiting reviewer',
    tone: 'hold',
    hint: 'The machine is done. A human decides what happens next.',
    running: false,
  },
  attested: {
    label: 'Issued onchain',
    tone: 'chain',
    hint: 'The attestation is live on Base and the watcher is monitoring it.',
    running: false,
  },
  revoked: {
    label: 'Revoked',
    tone: 'alert',
    hint: 'New satellite evidence contradicted this attestation. It was revoked onchain.',
    running: false,
  },
  failed: {
    label: 'Failed',
    tone: 'alert',
    hint: 'Verification stopped before finishing. The original error is shown below.',
    running: false,
  },
};

interface VerdictMeta {
  label: string;
  tone: Tone;
  hint: string;
}

export const verdictMeta: Record<Verdict, VerdictMeta> = {
  PASS: {
    label: 'PASS',
    tone: 'chain',
    hint: 'No contradiction found between the claims and independent evidence.',
  },
  FAIL: {
    label: 'FAIL',
    tone: 'alert',
    hint: 'Independent evidence contradicts at least one claim.',
  },
  INCONCLUSIVE: {
    label: 'INCONCLUSIVE',
    tone: 'hold',
    hint: 'The evidence is not sufficient to decide either way.',
  },
};

export const severityMeta: Record<
  'critical' | 'major' | 'minor' | 'info',
  { label: string; tone: Tone; rank: number }
> = {
  critical: { label: 'Critical', tone: 'alert', rank: 0 },
  major: { label: 'Major', tone: 'alert', rank: 1 },
  minor: { label: 'Minor', tone: 'hold', rank: 2 },
  info: { label: 'Note', tone: 'neutral', rank: 3 },
};

export const evidenceKindMeta: Record<
  'deforestation' | 'legal_entity' | 'sanctions' | 'certification',
  { label: string; source: string }
> = {
  deforestation: {
    label: 'Deforestation alerts',
    source: 'Global Forest Watch — integrated alerts',
  },
  legal_entity: {
    label: 'EU operator legal entity',
    source: 'GLEIF Global LEI Index',
  },
  sanctions: {
    label: 'Sanctions screening',
    source: 'OFAC SDN + EU consolidated list',
  },
  certification: {
    label: 'RSPO certification cross-check',
    source: 'Universal Mill List vs Unilever Mill List',
  },
};
