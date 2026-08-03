import { createPublicClient, http, parseAbi, encodeAbiParameters, keccak256, toHex } from 'viem';
import { base } from 'viem/chains';

const client = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
const EAS = '0x4200000000000000000000000000000000000021';
const REG = '0x4200000000000000000000000000000000000020';

const easAbi = parseAbi([
  'struct Attestation { bytes32 uid; bytes32 schema; uint64 time; uint64 expirationTime; uint64 revocationTime; bytes32 refUID; address recipient; address attester; bool revocable; bytes data; }',
  'function getAttestation(bytes32 uid) view returns (Attestation)',
]);
const regAbi = parseAbi([
  'struct SchemaRecord { bytes32 uid; address resolver; bool revocable; string schema; }',
  'function getSchema(bytes32 uid) view returns (SchemaRecord)',
]);

const uid = '0xa275f8693a930ed7b3fd8550e31268ae81e9d4e306e7fb7a1b2a02b0dd70b98f';
const att = await client.readContract({ address: EAS, abi: easAbi, functionName: 'getAttestation', args: [uid] });
console.log('✅ getAttestation via viem murni (tanpa eas-sdk):');
console.log('   schema   :', att.schema);
console.log('   attester :', att.attester);
console.log('   revocable:', att.revocable);
console.log('   revoked  :', att.revocationTime > 0n, '(revocationTime=' + att.revocationTime + ')');
console.log('   time     :', new Date(Number(att.time) * 1000).toISOString());

const sch = await client.readContract({ address: REG, abi: regAbi, functionName: 'getSchema', args: [att.schema] });
console.log('\n✅ getSchema:', sch.schema.slice(0, 90));
console.log('   revocable:', sch.revocable);

// Buktikan encoding schema data JEJAK dengan viem murni
const jejakSchema = [
  { name: 'plotId', type: 'string' }, { name: 'plotGeohash', type: 'string' },
  { name: 'evidenceHash', type: 'bytes32' }, { name: 'evidenceUri', type: 'string' },
  { name: 'verdict', type: 'uint8' }, { name: 'confidence', type: 'uint8' },
  { name: 'evidenceAsOf', type: 'uint64' }, { name: 'reviewedBy', type: 'string' },
  { name: 'legalEntityLEI', type: 'string' },
];
const encoded = encodeAbiParameters(jejakSchema, [
  'plot-sarawak-001', 'w4b8k2', keccak256(toHex('evidence-bundle')),
  'https://blob.example/bundle.json', 1, 87, 1780272000n, 'reviewer@jejak', '',
]);
console.log('\n✅ Encoding schema data JEJAK dengan viem murni:', encoded.length, 'char hex');
console.log('   → eas-sdk TIDAK diperlukan. R13 selesai.');
