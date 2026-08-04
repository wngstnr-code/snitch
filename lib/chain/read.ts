/**
 * B8 — baca attestation SNITCH langsung dari kontrak EAS (sumber kebenaran),
 * plus daftar via EAS GraphQL (indexer, hanya untuk listing — bukan sumber
 * kebenaran status revoke/waktu, itu selalu dibaca ulang dari kontrak).
 */

import type { Hex } from 'viem';
import {
  EAS_ADDRESS,
  attestationUrl,
  getChainConfig,
  txExplorerUrl,
} from './config';
import { EAS_ABI, getAttesterAccount, getPublicClient } from './eas';
import { decodeSnitchData, type SnitchAttestationData } from './attest';

export interface OnchainAttestation {
  uid: Hex;
  schemaUid: Hex;
  attester: Hex;
  recipient: Hex;
  time: string; // ISO
  revoked: boolean;
  revocationTime: string | null; // ISO
  revocable: boolean;
  chainId: number;
  explorerUrl: string;
  easscanUrl: string;
  decoded: SnitchAttestationData | null; // null bila data tidak sesuai schema SNITCH
}

const EMPTY_UID: Hex = `0x${'0'.repeat(64)}`;

/**
 * Dibaca per panggilan, bukan sekali saat modul dimuat. Modul ini juga dipakai
 * dari script dan test yang memuat `.env` setelah import teratasi; nilai yang
 * dibekukan saat load bisa `undefined` di jalur itu, dan akibatnya seluruh
 * attestation kita akan dilaporkan "bukan schema SNITCH" — gagal senyap.
 */
function snitchSchemaUid(): Hex | undefined {
  return process.env.EAS_SCHEMA_UID as Hex | undefined;
}

/**
 * Baca satu attestation langsung dari kontrak EAS. `null` HANYA bila
 * attestation benar-benar tidak ada (kontrak mengembalikan struct nol) —
 * kegagalan jaringan/RPC dilempar, bukan disamarkan jadi `null` (aturan
 * keras #6 / CLAUDE.md §9: "gagal memeriksa" ≠ "tidak ada").
 */
export async function readAttestation(uid: Hex): Promise<OnchainAttestation | null> {
  const cfg = getChainConfig();
  const publicClient = getPublicClient();

  const record = await publicClient.readContract({
    address: EAS_ADDRESS,
    abi: EAS_ABI,
    functionName: 'getAttestation',
    args: [uid],
  });

  if (record.uid === EMPTY_UID) {
    return null;
  }

  const ourSchema = snitchSchemaUid();
  let decoded: SnitchAttestationData | null = null;
  const isSnitchSchema =
    !!ourSchema && record.schema.toLowerCase() === ourSchema.toLowerCase();
  if (isSnitchSchema) {
    try {
      decoded = decodeSnitchData(record.data);
    } catch {
      // Data ada di schema SNITCH tapi gagal didekode — jangan menebak,
      // biarkan decoded = null (aturan keras #7).
      decoded = null;
    }
  }

  return {
    uid: record.uid,
    schemaUid: record.schema,
    attester: record.attester,
    recipient: record.recipient,
    time: new Date(Number(record.time) * 1000).toISOString(),
    revoked: record.revocationTime !== 0n,
    revocationTime:
      record.revocationTime === 0n
        ? null
        : new Date(Number(record.revocationTime) * 1000).toISOString(),
    revocable: record.revocable,
    chainId: cfg.chainId,
    // Struct `Attestation` di kontrak EAS TIDAK menyimpan txHash, jadi dari
    // kontrak saja tidak ada cara jujur membangun tautan transaksi. Pemanggil
    // yang membutuhkannya memakai `lookupAttestationTxHash` (indexer).
    explorerUrl: attestationUrl(record.uid),
    easscanUrl: attestationUrl(record.uid),
    decoded,
  };
}

const TX_QUERY = `
  query TxOfAttestation($uid: String!) {
    attestation(where: { id: $uid }) {
      txid
    }
  }
`;

/**
 * Tx hash penerbitan sebuah attestation, dari indexer EAS.
 *
 * `null` bila indexer belum/tidak mengenalnya — dan itu memang jawaban yang
 * benar, bukan kegagalan. Sengaja TIDAK melempar: pemanggilnya adalah halaman
 * verifikasi publik, yang kebenarannya bersandar pada kontrak. Indexer di sini
 * cuma pemanis tautan; membuat halaman verifikasi mati gara-gara indexer
 * sedang sakit akan menukar hal yang penting demi hal yang tidak.
 */
export async function lookupAttestationTxHash(uid: Hex): Promise<Hex | null> {
  const cfg = getChainConfig();
  try {
    const res = await fetchWithTimeout(
      cfg.easGraphqlUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: TX_QUERY, variables: { uid } }),
      },
      GRAPHQL_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { attestation?: { txid?: string } | null };
    };
    const txid = json.data?.attestation?.txid;
    return txid && /^0x[0-9a-fA-F]{64}$/.test(txid) ? (txid as Hex) : null;
  } catch {
    return null;
  }
}

interface GraphqlAttestationNode {
  id: Hex;
  txid: Hex;
  schemaId: Hex;
  attester: Hex;
  recipient: Hex;
  time: number;
  revoked: boolean;
  revocationTime: number;
  revocable: boolean;
  data: Hex;
}

interface GraphqlResponse {
  data?: { attestations: GraphqlAttestationNode[] };
  errors?: Array<{ message: string }>;
}

const GRAPHQL_QUERY = `
  query SnitchAttestations($schemaId: String!, $attester: String!, $take: Int!) {
    attestations(
      where: { schemaId: { equals: $schemaId }, attester: { equals: $attester } }
      orderBy: { time: desc }
      take: $take
    ) {
      id
      txid
      schemaId
      attester
      recipient
      time
      revoked
      revocationTime
      revocable
      data
    }
  }
`;

const GRAPHQL_TIMEOUT_MS = 10_000;
const GRAPHQL_MAX_RETRIES = 3;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function queryGraphql(
  url: string,
  variables: Record<string, unknown>,
): Promise<GraphqlResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= GRAPHQL_MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: GRAPHQL_QUERY, variables }),
        },
        GRAPHQL_TIMEOUT_MS,
      );
      if (!res.ok) {
        throw new Error(`EAS GraphQL HTTP ${res.status}: ${await res.text()}`);
      }
      const json = (await res.json()) as GraphqlResponse;
      if (json.errors && json.errors.length > 0) {
        throw new Error(`EAS GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
      }
      return json;
    } catch (err) {
      lastError = err;
      if (attempt < GRAPHQL_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, attempt * 500));
      }
    }
  }
  throw new Error(
    `Gagal memanggil EAS GraphQL setelah ${GRAPHQL_MAX_RETRIES} percobaan: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Daftar attestation pada schema SNITCH oleh attester kita, via EAS GraphQL.
 * Ini hanya untuk keperluan listing (indexer bisa lag) — status revoke per
 * item tetap dari field yang dikembalikan indexer, kode pemanggil yang butuh
 * kepastian real-time harus memanggil `readAttestation` per UID.
 */
export async function listOurAttestations(limit = 50): Promise<OnchainAttestation[]> {
  const cfg = getChainConfig();
  const schemaUid = process.env.EAS_SCHEMA_UID as Hex | undefined;
  if (!schemaUid) {
    throw new Error('EAS_SCHEMA_UID tidak diset di .env.');
  }
  const attester = getAttesterAccount().address;

  const json = await queryGraphql(cfg.easGraphqlUrl, {
    schemaId: schemaUid,
    attester,
    take: limit,
  });

  const nodes = json.data?.attestations ?? [];

  return nodes.map((n) => {
    let decoded: SnitchAttestationData | null = null;
    if (n.schemaId.toLowerCase() === schemaUid.toLowerCase()) {
      try {
        decoded = decodeSnitchData(n.data);
      } catch {
        decoded = null;
      }
    }
    return {
      uid: n.id,
      schemaUid: n.schemaId,
      attester: n.attester,
      recipient: n.recipient,
      time: new Date(n.time * 1000).toISOString(),
      revoked: n.revoked,
      revocationTime: n.revoked ? new Date(n.revocationTime * 1000).toISOString() : null,
      revocable: n.revocable,
      chainId: cfg.chainId,
      explorerUrl: txExplorerUrl(n.txid),
      easscanUrl: attestationUrl(n.id),
      decoded,
    };
  });
}
