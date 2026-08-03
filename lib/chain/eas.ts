/**
 * Klien EAS berbasis viem murni (R13 — TANPA @ethereum-attestation-service/eas-sdk).
 * Berisi ABI minimal yang benar-benar dipakai + helper UID schema.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodePacked,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getChainConfig } from './config';

export const SCHEMA_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'schema', type: 'string' },
      { name: 'resolver', type: 'address' },
      { name: 'revocable', type: 'bool' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getSchema',
    stateMutability: 'view',
    inputs: [{ name: 'uid', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'uid', type: 'bytes32' },
          { name: 'resolver', type: 'address' },
          { name: 'revocable', type: 'bool' },
          { name: 'schema', type: 'string' },
        ],
      },
    ],
  },
] as const;

export const EAS_ABI = [
  {
    type: 'function',
    name: 'attest',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'schema', type: 'bytes32' },
          {
            name: 'data',
            type: 'tuple',
            components: [
              { name: 'recipient', type: 'address' },
              { name: 'expirationTime', type: 'uint64' },
              { name: 'revocable', type: 'bool' },
              { name: 'refUID', type: 'bytes32' },
              { name: 'data', type: 'bytes' },
              { name: 'value', type: 'uint256' },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'revoke',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'schema', type: 'bytes32' },
          {
            name: 'data',
            type: 'tuple',
            components: [
              { name: 'uid', type: 'bytes32' },
              { name: 'value', type: 'uint256' },
            ],
          },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getAttestation',
    stateMutability: 'view',
    inputs: [{ name: 'uid', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'uid', type: 'bytes32' },
          { name: 'schema', type: 'bytes32' },
          { name: 'time', type: 'uint64' },
          { name: 'expirationTime', type: 'uint64' },
          { name: 'revocationTime', type: 'uint64' },
          { name: 'refUID', type: 'bytes32' },
          { name: 'recipient', type: 'address' },
          { name: 'attester', type: 'address' },
          { name: 'revocable', type: 'bool' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
  },
  {
    type: 'event',
    name: 'Attested',
    inputs: [
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'attester', type: 'address', indexed: true },
      { name: 'uid', type: 'bytes32', indexed: false },
      { name: 'schemaUID', type: 'bytes32', indexed: true },
    ],
  },
] as const;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/**
 * UID schema EAS bersifat deterministik:
 * keccak256(abi.encodePacked(schema, resolver, revocable)).
 * Dipakai untuk mengecek "sudah terdaftar?" sebelum mengirim transaksi.
 */
export function computeSchemaUid(
  schema: string,
  resolver: string = ZERO_ADDRESS,
  revocable: boolean = true,
): Hex {
  return keccak256(
    encodePacked(
      ['string', 'address', 'bool'],
      [schema, resolver as Hex, revocable],
    ),
  );
}

export function getPublicClient(): PublicClient {
  const { chain, rpcUrl } = getChainConfig();
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

/** Melempar bila `ATTESTER_PRIVATE_KEY` tidak ada — jangan pernah diam-diam no-op. */
export function getAttesterAccount(): Account {
  const pk = process.env.ATTESTER_PRIVATE_KEY;
  if (!pk || !pk.startsWith('0x') || pk.length !== 66) {
    throw new Error(
      'ATTESTER_PRIVATE_KEY tidak diset atau formatnya salah (harus 0x + 64 hex).',
    );
  }
  return privateKeyToAccount(pk as Hex);
}

export function getWalletClient(): WalletClient {
  const { chain, rpcUrl } = getChainConfig();
  return createWalletClient({
    account: getAttesterAccount(),
    chain,
    transport: http(rpcUrl),
  });
}
