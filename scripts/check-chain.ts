import { getChainConfig, EAS_ADDRESS, SCHEMA_REGISTRY_ADDRESS, SNITCH_SCHEMA, SNITCH_SCHEMA_REVOCABLE } from '../lib/chain/config';
import { getPublicClient, getAttesterAccount, computeSchemaUid, SCHEMA_REGISTRY_ABI, ZERO_ADDRESS } from '../lib/chain/eas';

async function main() {
  const cfg = getChainConfig();
  const pc = getPublicClient();
  const block = await pc.getBlockNumber();
  const easCode = await pc.getCode({ address: EAS_ADDRESS });
  const regCode = await pc.getCode({ address: SCHEMA_REGISTRY_ADDRESS });
  const acct = getAttesterAccount();
  const bal = await pc.getBalance({ address: acct.address });
  const uid = computeSchemaUid(SNITCH_SCHEMA, ZERO_ADDRESS, SNITCH_SCHEMA_REVOCABLE);
  const existing = await pc.readContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: SCHEMA_REGISTRY_ABI, functionName: 'getSchema', args: [uid] });

  console.log('chainId          :', cfg.chainId);
  console.log('block            :', block);
  console.log('EAS bytecode     :', easCode ? easCode.length + ' hex chars' : 'TIDAK ADA');
  console.log('Registry bytecode:', regCode ? regCode.length + ' hex chars' : 'TIDAK ADA');
  console.log('attester         :', acct.address);
  console.log('balance (wei)    :', bal.toString());
  console.log('schema UID (calc):', uid);
  console.log('sudah terdaftar? :', existing.uid !== '0x'.padEnd(66, '0'));
}
main().catch((e) => { console.error(e); process.exit(1); });
