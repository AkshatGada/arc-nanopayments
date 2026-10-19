import { gateway, manifest, record, checkChain, json } from './common.mjs';

await checkChain();
const before = await gateway.getBalances();
if (before.gateway.available > 0n) throw new Error('Existing Gateway funds: reconcile this run rather than making another deposit');
if (before.wallet.balance < 100000n) throw new Error('Faucet funding has not arrived');
// Exclusive marker prevents an accidental rerun after any ambiguous outcome.
await record('deposit-started.json', { buyer: manifest.buyer, amountTestUsdc: '0.1', chainId: 5042002, at: new Date().toISOString() }, { flag: 'wx' });
const result = await gateway.deposit('0.1', { approveAmount: '0.1' });
await record('deposit-result.json', result);
console.log(json(result));
const balances = await gateway.getBalances();
await record('balances-after-deposit.json', balances);
console.log(json({ gateway: balances.gateway }));
