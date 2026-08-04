/**
 * Test penyaring host non-publik.
 *
 * Penting karena `evidenceUri` datang dari data attestation, dan schema SNITCH
 * bersifat publik — siapa pun boleh menerbitkan attestation di atasnya, jadi
 * string itu adalah masukan tak tepercaya yang menyuruh server kita melakukan
 * permintaan HTTP.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { isNonPublicHost } from '../../app/api/v1/verify/[uid]/route';

test('host internal dan alamat privat ditolak', () => {
  const blocked = [
    'localhost',
    'foo.localhost',
    'metadata.google.internal',
    'printer.local',
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '10.255.255.255',
    '192.168.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '169.254.169.254', // metadata cloud — target SSRF paling klasik
    '0.0.0.0',
    '[::1]',
    '[fd00::1]',
  ];
  for (const h of blocked) {
    assert.equal(isNonPublicHost(h), true, `${h} seharusnya ditolak`);
  }
});

test('host publik diloloskan', () => {
  const allowed = [
    'ops0tisvygz8bcas.public.blob.vercel-storage.com',
    'example.com',
    'sub.domain.example.co.uk',
    '8.8.8.8',
    '1.1.1.1',
    '172.15.0.1', // tepat di luar 172.16/12
    '172.32.0.1', // tepat di luar 172.16/12
    '192.169.0.1', // bukan 192.168/16
    '11.0.0.1',
  ];
  for (const h of allowed) {
    assert.equal(isNonPublicHost(h), false, `${h} seharusnya lolos`);
  }
});

test('penyaringan tidak peka huruf besar-kecil', () => {
  assert.equal(isNonPublicHost('LOCALHOST'), true);
  assert.equal(isNonPublicHost('Metadata.Google.Internal'), true);
});
