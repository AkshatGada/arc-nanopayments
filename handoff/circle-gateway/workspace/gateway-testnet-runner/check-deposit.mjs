import { readFile } from 'node:fs/promises';
import { decodeFunctionData, parseAbi } from 'viem';
import { gateway, record, checkChain, json } from './common.mjs';

await checkChain();
const result = JSON.parse(await readFile(new URL('./deposit-result.json', import.meta.url), 'utf8'));
const abi = parseAbi(['function approve(address spender, uint256 amount)', 'function deposit(address token, uint256 amount)']);
const receipts = [];
for (const hash of [result.approvalTxHash, result.depositTxHash].filter(Boolean)) {
  const [receipt, transaction] = await Promise.all([
    gateway.publicClient.getTransactionReceipt({ hash }), gateway.publicClient.getTransaction({ hash }),
  ]);
  if (receipt.status !== 'success') throw new Error('Testnet transaction reverted');
  const call = decodeFunctionData({ abi, data: transaction.input });
  if (call.args[1] !== 100000n) throw new Error('Unexpected onchain test deposit/approval amount');
  receipts.push({ hash, status: receipt.status, blockNumber: receipt.blockNumber,
    from: transaction.from, to: transaction.to, call,
    gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice });
}
await record('deposit-onchain-proof.json', receipts);
console.log(json({ receipts }));
const deadline = Date.now() + 180000;
while (true) {
  const balances = await gateway.getBalances();
  await record('balances-ready.json', balances);
  if (balances.gateway.available >= 100000n) {
    console.log(json({ gatewayReady: balances.gateway }));
    break;
  }
  if (Date.now() >= deadline) throw new Error('Gateway deposit remains unavailable; do not deposit again');
  await new Promise(resolve => setTimeout(resolve, 5000));
}
