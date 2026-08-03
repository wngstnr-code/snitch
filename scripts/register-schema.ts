/**
 * Mendaftarkan schema SNITCH ke EAS SchemaRegistry (PLAN.md §0.4).
 *
 *   npm run schema:register
 *
 * Idempoten: UID schema deterministik, jadi skrip mengecek dulu apakah schema
 * sudah terdaftar. Kalau sudah, ia hanya mencetak UID-nya tanpa mengirim tx.
 */

import { formatEther } from 'viem';
import {
  getChainConfig,
  SCHEMA_REGISTRY_ADDRESS,
  SNITCH_SCHEMA,
  SNITCH_SCHEMA_REVOCABLE,
  schemaUrl,
  txExplorerUrl,
} from '../lib/chain/config';
import {
  SCHEMA_REGISTRY_ABI,
  ZERO_ADDRESS,
  computeSchemaUid,
  getAttesterAccount,
  getPublicClient,
  getWalletClient,
} from '../lib/chain/eas';

async function main() {
  const cfg = getChainConfig();
  const publicClient = getPublicClient();

  const uid = computeSchemaUid(
    SNITCH_SCHEMA,
    ZERO_ADDRESS,
    SNITCH_SCHEMA_REVOCABLE,
  );

  console.log('Chain      :', cfg.chainId, '·', cfg.rpcUrl);
  console.log('Registry   :', SCHEMA_REGISTRY_ADDRESS);
  console.log('Schema     :', SNITCH_SCHEMA);
  console.log('Revocable  :', SNITCH_SCHEMA_REVOCABLE);
  console.log('UID (calc) :', uid);
  console.log('');

  const existing = await publicClient.readContract({
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: 'getSchema',
    args: [uid],
  });

  if (existing.uid !== '0x'.padEnd(66, '0')) {
    console.log('✔ Schema SUDAH terdaftar di chain ini — tidak mengirim tx.');
    console.log('  EAS_SCHEMA_UID=' + existing.uid);
    console.log('  ' + schemaUrl(existing.uid));
    return;
  }

  const account = getAttesterAccount();
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('Attester   :', account.address);
  console.log('Balance    :', formatEther(balance), 'ETH');
  if (balance === 0n) {
    throw new Error(
      `Saldo 0 di ${account.address}. Danai lewat faucet Base Sepolia dulu.`,
    );
  }

  const walletClient = getWalletClient();
  const { request } = await publicClient.simulateContract({
    account,
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: 'register',
    args: [SNITCH_SCHEMA, ZERO_ADDRESS, SNITCH_SCHEMA_REVOCABLE],
  });

  const txHash = await walletClient.writeContract(request);
  console.log('');
  console.log('Tx terkirim:', txHash);
  console.log('  ' + txExplorerUrl(txHash));

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`Transaksi gagal (status=${receipt.status}): ${txHash}`);
  }

  // Konfirmasi lewat READ, bukan sekadar percaya receipt. Node RPC bisa
  // tertinggal beberapa detik dari blok yang baru saja memuat tx kita, jadi
  // baca ulang dengan backoff sebelum menyatakan gagal.
  const EMPTY_UID = '0x'.padEnd(66, '0');
  let confirmed = EMPTY_UID;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const record = await publicClient.readContract({
      address: SCHEMA_REGISTRY_ADDRESS,
      abi: SCHEMA_REGISTRY_ABI,
      functionName: 'getSchema',
      args: [uid],
    });
    if (record.uid !== EMPTY_UID) {
      if (record.schema !== SNITCH_SCHEMA) {
        throw new Error(
          `Schema di chain tidak cocok dengan SNITCH_SCHEMA:\n  chain: ${record.schema}`,
        );
      }
      if (record.revocable !== SNITCH_SCHEMA_REVOCABLE) {
        throw new Error(
          `revocable di chain = ${record.revocable}, seharusnya ${SNITCH_SCHEMA_REVOCABLE}. Attestation tanpa revocable = produk mati.`,
        );
      }
      confirmed = record.uid;
      break;
    }
    if (attempt < 6) {
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }

  if (confirmed === EMPTY_UID) {
    throw new Error(
      `Tx ${txHash} sukses tapi schema tetap tidak terbaca di registry setelah 6 percobaan — periksa manual di ${schemaUrl(uid)}`,
    );
  }

  console.log('');
  console.log('✔ Terdaftar & terkonfirmasi (schema + revocable cocok).');
  console.log('  EAS_SCHEMA_UID=' + confirmed);
  console.log('  ' + schemaUrl(confirmed));
}

main().catch((err: unknown) => {
  console.error('GAGAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
