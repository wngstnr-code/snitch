/**
 * Bukti "contract verified" untuk SNITCH (PLAN.md §0.6).
 *
 *   npm run chain:verify
 *
 * SNITCH tidak men-deploy kontrak kustom (CLAUDE.md §2 — OUT). Yang kita pakai
 * adalah dua predeploy OP-Stack: EAS dan SchemaRegistry. Karena itu "verified"
 * di proyek ini berarti tiga hal yang semuanya dibuktikan lewat panggilan nyata,
 * bukan asumsi:
 *
 *   1. Kontrak yang kita panggil punya bytecode di chain ini.
 *   2. Source code-nya ter-verify di block explorer (Blockscout), termasuk
 *      implementasi di balik proxy EIP-1967 — jadi juri bisa membaca kode
 *      yang benar-benar dieksekusi.
 *   3. Schema SNITCH terdaftar di registry itu, `revocable == true`, dan string
 *      schema-nya identik dengan SNITCH_SCHEMA. `revocable: false` = produk mati.
 *
 * Keluar dengan kode 1 bila salah satu gagal. Tidak ada fallback diam-diam.
 */

import { z } from 'zod';
import {
  EAS_ADDRESS,
  SCHEMA_REGISTRY_ADDRESS,
  SNITCH_SCHEMA,
  SNITCH_SCHEMA_REVOCABLE,
  getChainConfig,
  schemaUrl,
} from '../lib/chain/config';
import {
  SCHEMA_REGISTRY_ABI,
  ZERO_ADDRESS,
  computeSchemaUid,
  getPublicClient,
} from '../lib/chain/eas';

const EMPTY_UID = '0x'.padEnd(66, '0');
const FETCH_TIMEOUT_MS = 15_000;

/** Bentuk respons Blockscout v2 — divalidasi di batas sistem (CLAUDE.md §9). */
const BlockscoutContract = z.object({
  name: z.string().nullable().optional(),
  is_verified: z.boolean().nullable().optional(),
  compiler_version: z.string().nullable().optional(),
  proxy_type: z.string().nullable().optional(),
  implementations: z
    .array(
      z.object({
        address_hash: z.string(),
        name: z.string().nullable().optional(),
      }),
    )
    .optional(),
});
type BlockscoutContract = z.infer<typeof BlockscoutContract>;

async function fetchContract(address: string): Promise<BlockscoutContract> {
  const { blockscoutApiUrl } = getChainConfig();
  const url = `${blockscoutApiUrl}/smart-contracts/${address}`;
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  return BlockscoutContract.parse(await res.json());
}

const failures: string[] = [];

function check(ok: boolean, label: string, detail: string) {
  console.log(`  ${ok ? '✔' : '✘'} ${label}: ${detail}`);
  if (!ok) failures.push(label);
}

async function checkVerified(label: string, address: string) {
  console.log(`\n${label} — ${address}`);

  const code = await getPublicClient().getCode({ address: address as `0x${string}` });
  check(
    Boolean(code && code !== '0x'),
    'bytecode di chain',
    code ? `${code.length} hex chars` : 'TIDAK ADA',
  );

  const c = await fetchContract(address);
  check(
    c.is_verified === true,
    'source verified di explorer',
    `${c.name ?? '?'} · ${c.compiler_version ?? '?'}`,
  );

  // Proxy yang verified belum berarti kode yang dieksekusi bisa dibaca —
  // implementasinya yang penting.
  for (const impl of c.implementations ?? []) {
    const ic = await fetchContract(impl.address_hash);
    check(
      ic.is_verified === true,
      `implementasi (${c.proxy_type ?? 'proxy'}) ${impl.name ?? ''} ${impl.address_hash}`,
      ic.is_verified ? `verified · ${ic.compiler_version ?? '?'}` : 'TIDAK VERIFIED',
    );
  }
}

async function checkSchema() {
  const uid = computeSchemaUid(SNITCH_SCHEMA, ZERO_ADDRESS, SNITCH_SCHEMA_REVOCABLE);
  console.log(`\nSchema SNITCH — ${uid}`);

  const record = await getPublicClient().readContract({
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: 'getSchema',
    args: [uid],
  });

  check(record.uid !== EMPTY_UID, 'terdaftar di registry', record.uid);
  check(
    record.schema === SNITCH_SCHEMA,
    'string schema cocok dengan SNITCH_SCHEMA',
    record.schema === SNITCH_SCHEMA ? 'identik' : `chain: ${record.schema}`,
  );
  check(record.revocable === true, 'revocable', String(record.revocable));
  check(
    record.resolver.toLowerCase() === ZERO_ADDRESS,
    'resolver kosong (tanpa kontrak kustom)',
    record.resolver,
  );

  const envUid = process.env.EAS_SCHEMA_UID;
  check(
    envUid === record.uid,
    'EAS_SCHEMA_UID di env cocok dengan chain',
    envUid ?? '(tidak diset)',
  );

  console.log(`  ${schemaUrl(uid)}`);
}

async function main() {
  const cfg = getChainConfig();
  console.log(`Chain ${cfg.chainId} · ${cfg.rpcUrl}`);
  console.log(`Explorer ${cfg.explorerBaseUrl} · Blockscout ${cfg.blockscoutApiUrl}`);

  await checkVerified('EAS', EAS_ADDRESS);
  await checkVerified('SchemaRegistry', SCHEMA_REGISTRY_ADDRESS);
  await checkSchema();

  console.log('');
  if (failures.length > 0) {
    console.error(`GAGAL (${failures.length}): ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('✔ Semua kontrak yang dipakai SNITCH verified, schema revocable & cocok.');
}

main().catch((err: unknown) => {
  console.error('GAGAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
