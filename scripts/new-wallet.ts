/**
 * Membuat keypair attester baru (PLAN.md §0.1).
 *
 *   npm run wallet:new
 *
 * Private key dicetak ke stdout SEKALI. Salin ke `.env` sebagai
 * ATTESTER_PRIVATE_KEY. Jangan pernah commit, jangan tempel ke chat grup (§9).
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);

console.log('');
console.log('  Address      :', account.address);
console.log('  Private key  :', pk);
console.log('');
console.log('  → Salin ke .env:  ATTESTER_PRIVATE_KEY=' + pk);
console.log('  → Danai address di atas lewat faucet Base Sepolia.');
console.log('');
