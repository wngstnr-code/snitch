import { ImageResponse } from 'next/og';
import type { Hex } from 'viem';
import { readAttestation } from '@/lib/chain/read';

// ImageResponse jalan di Node.js — proyek ini melarang runtime edge (CLAUDE.md §5).
export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt =
  'SNITCH attestation status card: verdict, UID, and onchain revoke status';

const UID_RE = /^0x[0-9a-fA-F]{64}$/;

function shorten(uid: string): string {
  return `${uid.slice(0, 10)}…${uid.slice(-8)}`;
}

type Status =
  | { kind: 'revoked'; verdict: string; revokedAt: string | null; uid: string }
  | { kind: 'active'; verdict: string; evidenceAsOf: string | null; uid: string }
  | { kind: 'not_found'; uid: string }
  | { kind: 'invalid'; uid: string }
  | { kind: 'unavailable'; uid: string };

async function resolveStatus(uid: string): Promise<Status> {
  if (!UID_RE.test(uid)) {
    return { kind: 'invalid', uid };
  }
  try {
    const record = await readAttestation(uid as Hex);
    if (!record) {
      return { kind: 'not_found', uid };
    }
    const verdict = record.decoded?.verdict ?? 'UNKNOWN';
    if (record.revoked) {
      return { kind: 'revoked', verdict, revokedAt: record.revocationTime, uid };
    }
    return {
      kind: 'active',
      verdict,
      evidenceAsOf: record.decoded?.evidenceAsOf ?? null,
      uid,
    };
  } catch {
    // Pembacaan chain gagal — jangan pernah ditampilkan sebagai "active" atau
    // "not found", keduanya bohong. Tampilkan sebagai kegagalan yang jujur.
    return { kind: 'unavailable', uid };
  }
}

function statusLabel(status: Status): { text: string; color: string } {
  switch (status.kind) {
    case 'revoked':
      return { text: 'REVOKED', color: '#ef4444' };
    case 'active':
      return { text: 'ACTIVE', color: '#22c55e' };
    case 'not_found':
      return { text: 'NOT FOUND', color: '#a1a1aa' };
    case 'invalid':
      return { text: 'INVALID UID', color: '#a1a1aa' };
    case 'unavailable':
      return { text: 'UNAVAILABLE', color: '#a1a1aa' };
  }
}

function detailLine(status: Status): string {
  const short = shorten(status.uid);
  switch (status.kind) {
    case 'revoked':
      return `${short} · verdict ${status.verdict} · revoked ${status.revokedAt ? new Date(status.revokedAt).toISOString().slice(0, 10) : 'unknown date'}`;
    case 'active':
      return `${short} · verdict ${status.verdict}${status.evidenceAsOf ? ` · evidence as of ${status.evidenceAsOf.slice(0, 10)}` : ''}`;
    case 'not_found':
      return `${short} · no attestation with this UID on this chain`;
    case 'invalid':
      return `${short} · not a valid attestation UID`;
    case 'unavailable':
      return `${short} · chain read failed — status unknown right now`;
  }
}

export default async function Image(
  props: PageProps<'/v/[uid]'>,
): Promise<ImageResponse> {
  const { uid } = await props.params;
  const status = await resolveStatus(uid);
  const label = statusLabel(status);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#0a0a0a',
          padding: '56px 64px',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            letterSpacing: 4,
            color: '#71717a',
            fontWeight: 700,
          }}
        >
          SNITCH
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 96,
              fontWeight: 800,
              color: label.color,
              letterSpacing: 2,
            }}
          >
            {label.text}
          </div>
          {status.kind === 'revoked' ? (
            <div
              style={{
                display: 'flex',
                marginTop: 20,
                fontSize: 24,
                color: '#f4f4f5',
                textAlign: 'center',
              }}
            >
              self-revoked when new satellite evidence contradicted it
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 22,
            color: '#a1a1aa',
          }}
        >
          {detailLine(status)}
        </div>
      </div>
    ),
    { ...size },
  );
}
