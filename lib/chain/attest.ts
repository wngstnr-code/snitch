/**
 * B7 — penerbitan & pencabutan attestation SNITCH di EAS (Base Sepolia default).
 *
 * viem murni, TANPA @ethereum-attestation-service/eas-sdk (aturan proyek).
 * UID selalu diambil dari log `Attested` yang benar-benar tercatat di receipt,
 * lalu dikonfirmasi ulang lewat `getAttestation(uid)` on-chain — bukan dari
 * return value `simulateContract`. UID EAS bergantung pada `block.timestamp`
 * saat tx benar-benar dieksekusi, jadi nilai hasil simulasi nyaris selalu
 * berbeda begitu tx pindah blok (terverifikasi empiris terhadap Base Sepolia
 * sungguhan — lihat komentar di `issueAttestation`).
 */

import {
  decodeAbiParameters,
  decodeEventLog,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
} from 'viem';
import type { Verdict } from '../types';
import {
  EAS_ADDRESS,
  getChainConfig,
  SNITCH_SCHEMA,
  txExplorerUrl,
  attestationUrl,
} from './config';
import {
  EAS_ABI,
  ZERO_ADDRESS,
  getAttesterAccount,
  getPublicClient,
  getWalletClient,
} from './eas';
import { readAttestation } from './read';

// Tipe ABI parameter yang persis mengikuti SNITCH_SCHEMA (CLAUDE.md §4).
// Diturunkan dari string schema, bukan ditulis ulang sebagai literal terpisah,
// supaya encode/decode tidak bisa diam-diam desync dari schema yang terdaftar.
const SNITCH_ABI_PARAMS = parseAbiParameters(SNITCH_SCHEMA);

const VERDICT_TO_UINT8: Record<Verdict, number> = {
  PASS: 0,
  FAIL: 1,
  INCONCLUSIVE: 2,
};

const UINT8_TO_VERDICT: Record<number, Verdict> = {
  0: 'PASS',
  1: 'FAIL',
  2: 'INCONCLUSIVE',
};

export interface SnitchAttestationData {
  plotId: string;
  plotGeohash: string;
  evidenceHash: Hex; // 0x + 64 hex — sha256 bundle
  evidenceUri: string; // URL blob publik
  verdict: Verdict;
  confidence: number; // 0-100
  evidenceAsOf: string; // ISO
  reviewedBy: string;
  legalEntityLEI: string; // '' bila operator EU tidak diketahui
}

export interface AttestResult {
  uid: Hex;
  txHash: Hex;
  attester: Hex;
  attestedAt: string; // ISO, dari timestamp blok — BUKAN Date.now()
  chainId: number;
  schemaUid: Hex;
  explorerUrl: string;
  easscanUrl: string;
  gasUsed: string;
}

export interface RevokeResult {
  txHash: Hex;
  revokedAt: string; // ISO, dari timestamp blok
  explorerUrl: string;
  gasUsed: string;
}

const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;

/** Melempar bila data tidak layak dikirim ke chain — jangan pernah kirim sampah. */
function validateSnitchData(d: SnitchAttestationData): void {
  if (!HEX32_RE.test(d.evidenceHash)) {
    throw new Error(
      `evidenceHash harus 0x + 64 hex, dapat: ${d.evidenceHash}`,
    );
  }
  if (
    !Number.isInteger(d.confidence) ||
    d.confidence < 0 ||
    d.confidence > 100
  ) {
    throw new Error(`confidence harus integer 0-100, dapat: ${d.confidence}`);
  }
  const asOfMs = Date.parse(d.evidenceAsOf);
  if (Number.isNaN(asOfMs)) {
    throw new Error(`evidenceAsOf bukan ISO date sah: ${d.evidenceAsOf}`);
  }
  const asOfSec = BigInt(Math.floor(asOfMs / 1000));
  if (asOfSec < 0n || asOfSec > 0xffffffffffffffffn) {
    throw new Error(`evidenceAsOf tidak muat di uint64: ${d.evidenceAsOf}`);
  }
  if (!d.plotId) {
    throw new Error('plotId tidak boleh kosong.');
  }
  if (!(d.verdict in VERDICT_TO_UINT8)) {
    throw new Error(`verdict tidak dikenal: ${String(d.verdict)}`);
  }
}

/**
 * Encode data SNITCH sesuai `SNITCH_SCHEMA`. Urutan field DIIKAT oleh string
 * schema yang terdaftar di EAS SchemaRegistry — jangan mengubah urutan di
 * sini tanpa mendaftarkan ulang schema on-chain.
 */
export function encodeSnitchData(d: SnitchAttestationData): Hex {
  validateSnitchData(d);
  const evidenceAsOfSec = BigInt(Math.floor(Date.parse(d.evidenceAsOf) / 1000));
  return encodeAbiParameters(SNITCH_ABI_PARAMS, [
    d.plotId,
    d.plotGeohash,
    d.evidenceHash,
    d.evidenceUri,
    VERDICT_TO_UINT8[d.verdict],
    d.confidence,
    evidenceAsOfSec,
    d.reviewedBy,
    d.legalEntityLEI,
  ]);
}

/** Decode data mentah attestation sesuai `SNITCH_SCHEMA`. */
export function decodeSnitchData(data: Hex): SnitchAttestationData {
  const [
    plotId,
    plotGeohash,
    evidenceHash,
    evidenceUri,
    verdictRaw,
    confidenceRaw,
    evidenceAsOfRaw,
    reviewedBy,
    legalEntityLEI,
  ] = decodeAbiParameters(SNITCH_ABI_PARAMS, data) as [
    string,
    string,
    Hex,
    string,
    number,
    number,
    bigint,
    string,
    string,
  ];

  const verdict = UINT8_TO_VERDICT[verdictRaw];
  if (!verdict) {
    throw new Error(`verdict on-chain tak dikenal: ${verdictRaw}`);
  }

  return {
    plotId,
    plotGeohash,
    evidenceHash,
    evidenceUri,
    verdict,
    confidence: confidenceRaw,
    evidenceAsOf: new Date(Number(evidenceAsOfRaw) * 1000).toISOString(),
    reviewedBy,
    legalEntityLEI,
  };
}

/** UID nol EAS — dipakai sebagai penanda "attestation tidak ditemukan". */
const EMPTY_UID: Hex = `0x${'0'.repeat(64)}`;

/**
 * Memastikan wallet attester sanggup membayar transaksi INI, sebelum dikirim.
 *
 * Tanpa ini, wallet yang kehabisan dana menghasilkan error RPC yang tidak
 * memberi tahu apa pun yang bisa ditindaklanjuti ("insufficient funds for
 * gas * price + value"), dan pada alur demo ia muncul sebagai verifikasi
 * berstatus `failed` yang misterius. Saldo adalah hal paling gampang habis di
 * proyek ini karena test memang mengirim transaksi sungguhan tiap kali jalan.
 */
async function assertAttesterFunded(
  publicClient: ReturnType<typeof getPublicClient>,
  address: Hex,
  estimatedGas: bigint | undefined,
): Promise<void> {
  const balance = await publicClient.getBalance({ address });
  const gasPrice = await publicClient.getGasPrice();
  const needed = (estimatedGas ?? 0n) * gasPrice;

  if (balance > 0n && (needed === 0n || balance >= needed)) return;

  const { chainId } = getChainConfig();
  const topUp =
    chainId === 84532
      ? 'Ambil ETH testnet gratis di https://portal.cdp.coinbase.com/products/faucet (Base Sepolia).'
      : 'Danai wallet ini sebelum menerbitkan attestation.';

  throw new Error(
    `Wallet attester ${address} tidak cukup dana: saldo ${balance} wei, ` +
      `perkiraan biaya ${needed} wei (gas ${estimatedGas ?? 0n} × ${gasPrice} wei). ${topUp}`,
  );
}

/**
 * `getBlock(blockNumber)` kadang menjawab "not found" tepat setelah
 * `waitForTransactionReceipt` sukses — RPC load-balanced Base Sepolia bisa
 * melayani node yang belum mengejar blok itu. Retry singkat dengan backoff,
 * bukan gagal diam-diam.
 */
async function getBlockWithRetry(
  publicClient: ReturnType<typeof getPublicClient>,
  blockNumber: bigint,
): Promise<{ timestamp: bigint }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await publicClient.getBlock({ blockNumber });
    } catch (err) {
      lastError = err;
      if (attempt < 5) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }
  throw new Error(
    `Gagal membaca blok ${blockNumber} setelah 5 percobaan: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Terbitkan attestation SNITCH on-chain (F7). UID diambil dari event
 * `Attested` di log receipt, bukan dari return value `simulateContract` —
 * simulasi cuma prediksi, log adalah fakta on-chain (aturan keras #3).
 */
export async function issueAttestation(
  d: SnitchAttestationData,
): Promise<AttestResult> {
  validateSnitchData(d);

  const cfg = getChainConfig();
  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  const account = getAttesterAccount();

  const schemaUid = process.env.EAS_SCHEMA_UID as Hex | undefined;
  if (!schemaUid) {
    throw new Error('EAS_SCHEMA_UID tidak diset di .env.');
  }

  const encoded = encodeSnitchData(d);

  const attestArgs = [
    {
      schema: schemaUid,
      data: {
        recipient: ZERO_ADDRESS,
        expirationTime: 0n,
        revocable: true,
        refUID: EMPTY_UID,
        data: encoded,
        value: 0n,
      },
    },
  ] as const;

  // `simulateContract` dipakai untuk membangun `request` (encode call + gas)
  // dan menangkap revert sebelum mengirim tx apa pun — bukan sebagai sumber
  // UID. UID EAS bergantung pada `block.timestamp` saat attest benar-benar
  // dieksekusi (bukan saat simulasi), jadi nilai `result` simulasi HAMPIR
  // SELALU berbeda dari UID final begitu tx pindah blok — terverifikasi
  // empiris: simulate di blok N, mined di blok N+2, UID berbeda walau input
  // identik. Membandingkannya secara ketat membuat fungsi ini selalu gagal
  // di jaringan nyata. Konfirmasi UID dilakukan lewat dua langkah independen
  // di bawah: (1) event `Attested` di log receipt, (2) baca ulang
  // `getAttestation(uid)` on-chain dan cocokkan datanya — itu bukti UID
  // benar-benar tercatat dengan payload yang kita kirim, bukan tebakan.
  const { request } = await publicClient.simulateContract({
    account,
    address: EAS_ADDRESS,
    abi: EAS_ABI,
    functionName: 'attest',
    args: attestArgs,
  });

  await assertAttesterFunded(publicClient, account.address, request.gas);

  const txHash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`Transaksi attest gagal (status=${receipt.status}): ${txHash}`);
  }

  // Konfirmasi #1: UID dari log `Attested` — fakta on-chain, bukan tebakan.
  let uidFromLog: Hex | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== EAS_ADDRESS.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: EAS_ABI,
        data: log.data,
        topics: log.topics,
        eventName: 'Attested',
      });
      uidFromLog = decoded.args.uid;
      break;
    } catch {
      // log bukan event Attested — lanjut cari log lain.
    }
  }

  if (!uidFromLog) {
    throw new Error(
      `Tx attest ${txHash} sukses tapi event Attested tidak ditemukan di log — tidak bisa mengonfirmasi UID.`,
    );
  }

  // Konfirmasi #2: baca ulang attestation langsung dari kontrak dan
  // cocokkan attester + data mentah dengan yang kita kirim. Ini konfirmasi
  // yang jauh lebih kuat daripada mencocokkan UID simulasi (yang time-
  // dependent) — ia membuktikan payload yang benar-benar tersimpan on-chain
  // sama persis dengan yang kita maksud, bukan sekadar UID yang "terlihat
  // benar".
  // RPC load-balanced Base Sepolia bisa melayani node yang belum mengejar
  // blok tempat tx ini mined (sama seperti getBlockWithRetry di atas) —
  // retry singkat sebelum menyerah.
  const readGetAttestation = () =>
    publicClient.readContract({
      address: EAS_ADDRESS,
      abi: EAS_ABI,
      functionName: 'getAttestation',
      args: [uidFromLog as Hex],
    });
  let onchainRecord: Awaited<ReturnType<typeof readGetAttestation>> | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const record = await readGetAttestation();
    if (record.uid !== EMPTY_UID) {
      onchainRecord = record;
      break;
    }
    if (attempt < 5) {
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  if (!onchainRecord) {
    throw new Error(
      `UID ${uidFromLog} dari log Attested tidak ditemukan lewat getAttestation setelah 5 percobaan — menolak melaporkan UID yang tidak terkonfirmasi.`,
    );
  }
  if (onchainRecord.attester.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `Attester on-chain (${onchainRecord.attester}) tidak cocok dengan attester kita (${account.address}) untuk UID ${uidFromLog}.`,
    );
  }
  if (onchainRecord.data.toLowerCase() !== encoded.toLowerCase()) {
    throw new Error(
      `Data on-chain untuk UID ${uidFromLog} tidak cocok dengan payload yang dikirim — menolak melaporkan UID yang tidak terkonfirmasi.`,
    );
  }

  const block = await getBlockWithRetry(publicClient, receipt.blockNumber);

  return {
    uid: uidFromLog,
    txHash,
    attester: account.address,
    attestedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    chainId: cfg.chainId,
    schemaUid,
    explorerUrl: txExplorerUrl(txHash),
    easscanUrl: attestationUrl(uidFromLog),
    gasUsed: receipt.gasUsed.toString(),
  };
}

/**
 * Cabut attestation SNITCH (bagian dari F8/watcher). Memeriksa dulu status
 * on-chain via `readAttestation` supaya tidak diam-diam "sukses" mencabut
 * sesuatu yang sudah tercabut atau tidak pernah ada (aturan keras #5).
 */
export async function revokeAttestation(uid: Hex): Promise<RevokeResult> {
  const existing = await readAttestation(uid);
  if (!existing) {
    throw new Error(`Attestation ${uid} tidak ditemukan on-chain — tidak bisa dicabut.`);
  }
  if (existing.revoked) {
    throw new Error(
      `Attestation ${uid} sudah ter-revoke pada ${existing.revocationTime ?? '(waktu tidak diketahui)'} — tidak mencabut ulang.`,
    );
  }
  if (!existing.revocable) {
    throw new Error(`Attestation ${uid} dibuat dengan revocable=false — tidak bisa dicabut.`);
  }

  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  const account = getAttesterAccount();

  const { request } = await publicClient.simulateContract({
    account,
    address: EAS_ADDRESS,
    abi: EAS_ABI,
    functionName: 'revoke',
    args: [
      {
        schema: existing.schemaUid,
        data: { uid, value: 0n },
      },
    ],
  });

  await assertAttesterFunded(publicClient, account.address, request.gas);

  const txHash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`Transaksi revoke gagal (status=${receipt.status}): ${txHash}`);
  }

  const block = await getBlockWithRetry(publicClient, receipt.blockNumber);

  return {
    txHash,
    revokedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    explorerUrl: txExplorerUrl(txHash),
    gasUsed: receipt.gasUsed.toString(),
  };
}
