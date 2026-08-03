/**
 * Konfigurasi chain — SELURUHNYA diturunkan dari env `CHAIN_ID` (B1).
 * Jangan pernah hardcode RPC, explorer, atau alamat kontrak di tempat lain.
 *
 * EAS adalah predeploy OP-Stack, jadi alamatnya identik di Base mainnet
 * maupun Base Sepolia (CLAUDE.md §4).
 */

import { base, baseSepolia } from 'viem/chains';
import type { Chain } from 'viem';

export const EAS_ADDRESS =
  '0x4200000000000000000000000000000000000021' as const;
export const SCHEMA_REGISTRY_ADDRESS =
  '0x4200000000000000000000000000000000000020' as const;

export interface ChainConfig {
  chain: Chain;
  chainId: number;
  rpcUrl: string;
  explorerBaseUrl: string;
  easscanBaseUrl: string;
  easGraphqlUrl: string;
  /** Blockscout v2 API — dipakai untuk membuktikan source-verification kontrak (npm run chain:verify). */
  blockscoutApiUrl: string;
}

const CHAINS: Record<number, ChainConfig> = {
  84532: {
    chain: baseSepolia,
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    explorerBaseUrl: 'https://sepolia.basescan.org',
    easscanBaseUrl: 'https://base-sepolia.easscan.org',
    easGraphqlUrl: 'https://base-sepolia.easscan.org/graphql',
    blockscoutApiUrl: 'https://base-sepolia.blockscout.com/api/v2',
  },
  8453: {
    chain: base,
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    explorerBaseUrl: 'https://basescan.org',
    easscanBaseUrl: 'https://base.easscan.org',
    easGraphqlUrl: 'https://base.easscan.org/graphql',
    blockscoutApiUrl: 'https://base.blockscout.com/api/v2',
  },
};

/** Membaca `CHAIN_ID` dari env. Melempar bila tidak dikenal — jangan diam-diam fallback. */
export function getChainConfig(): ChainConfig {
  const raw = process.env.CHAIN_ID;
  if (!raw) {
    throw new Error(
      'CHAIN_ID tidak diset. Isi di .env (84532 = Base Sepolia, 8453 = Base mainnet).',
    );
  }
  const id = Number(raw);
  const cfg = CHAINS[id];
  if (!cfg) {
    throw new Error(
      `CHAIN_ID=${raw} tidak didukung. Yang tersedia: ${Object.keys(CHAINS).join(', ')}.`,
    );
  }
  return cfg;
}

export function txExplorerUrl(txHash: string): string {
  return `${getChainConfig().explorerBaseUrl}/tx/${txHash}`;
}

export function attestationUrl(uid: string): string {
  return `${getChainConfig().easscanBaseUrl}/attestation/view/${uid}`;
}

export function schemaUrl(schemaUid: string): string {
  return `${getChainConfig().easscanBaseUrl}/schema/view/${schemaUid}`;
}

/**
 * Schema SNITCH (CLAUDE.md §4). Urutan field ini mengikat encode & decode —
 * jangan diubah tanpa mendaftarkan ulang schema.
 */
export const SNITCH_SCHEMA =
  'string plotId,string plotGeohash,bytes32 evidenceHash,string evidenceUri,uint8 verdict,uint8 confidence,uint64 evidenceAsOf,string reviewedBy,string legalEntityLEI';

/** `revocable: true` wajib — jantung produk (CLAUDE.md §4). */
export const SNITCH_SCHEMA_REVOCABLE = true;
