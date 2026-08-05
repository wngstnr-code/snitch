'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

const UID_RE = /^0x[0-9a-fA-F]{64}$/;

export default function LookupPage() {
  const router = useRouter();
  const [uid, setUid] = useState('');
  const [touched, setTouched] = useState(false);

  const trimmed = uid.trim();
  const valid = UID_RE.test(trimmed);

  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">No account, no API key</p>
      <h1 className="mt-3 text-3xl">Check an attestation</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Paste an attestation UID to see its status. The answer is read straight
        from the EAS contract on the blockchain, and the evidence bundle is
        downloaded from the address recorded inside the attestation itself, then
        re-hashed and compared against the hash anchored onchain. That means this
        page stays correct even if our database is wrong — and anyone can repeat
        the steps without us.
      </p>

      <form
        className="mt-6 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (valid) router.push(`/v/${trimmed}`);
        }}
      >
        <input
          value={uid}
          onChange={(e) => setUid(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="0x…"
          aria-label="Attestation UID"
          className="datum min-w-0 flex-1 rounded-sm border border-rule bg-card px-3 py-2.5"
        />
        <Button type="submit" size="lg" disabled={!valid}>
          Check
        </Button>
      </form>

      {touched && trimmed.length > 0 && !valid ? (
        <p className="mt-2 text-xs text-alert">
          A UID must be bytes32: `0x` followed by 64 hexadecimal characters.
          What you pasted is {trimmed.length} characters long.
        </p>
      ) : null}
    </div>
  );
}
