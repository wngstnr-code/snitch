/**
 * Test otorisasi cron. Yang dijaga di sini bukan kenyamanan, melainkan wallet:
 * endpoint di baliknya mengirim transaksi onchain.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCronAuth } from './cron-auth';

const req = (auth?: string): Request =>
  new Request('https://example.com/api/cron/watch', {
    headers: auth ? { authorization: auth } : {},
  });

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('deployment tanpa CRON_SECRET GAGAL, bukan terbuka', () => {
  const res = withEnv({ CRON_SECRET: undefined, VERCEL: '1' }, () =>
    checkCronAuth(req()),
  );
  assert.ok(res, 'harus menolak');
  assert.equal(res.status, 500);
});

test('localhost tanpa CRON_SECRET diizinkan supaya demo tidak terhambat', () => {
  const res = withEnv(
    { CRON_SECRET: undefined, VERCEL: undefined, NODE_ENV: 'development' },
    () => checkCronAuth(req()),
  );
  assert.equal(res, null);
});

test('secret salah ditolak 401', () => {
  const res = withEnv({ CRON_SECRET: 'rahasia', VERCEL: '1' }, () =>
    checkCronAuth(req('Bearer salah')),
  );
  assert.ok(res);
  assert.equal(res.status, 401);
});

test('tanpa header authorization ditolak walau secret ada', () => {
  const res = withEnv({ CRON_SECRET: 'rahasia', VERCEL: '1' }, () =>
    checkCronAuth(req()),
  );
  assert.ok(res);
  assert.equal(res.status, 401);
});

test('secret benar diloloskan', () => {
  const res = withEnv({ CRON_SECRET: 'rahasia', VERCEL: '1' }, () =>
    checkCronAuth(req('Bearer rahasia')),
  );
  assert.equal(res, null);
});
