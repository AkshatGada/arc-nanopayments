import { readFile, appendFile } from 'node:fs/promises';
import { decodeFunctionData, decodeAbiParameters, parseAbi, parseAbiParameters } from 'viem';
import { gateway, manifest, record, checkChain, json } from './common.mjs';

await checkChain();
const result = JSON.parse(await readFile(new URL('./paid-result-final.json', import.meta.url), 'utf8'));
const metadata = JSON.parse(await readFile(new URL('./payment-corrected-metadata.json', import.meta.url), 'utf8'));
const id = result.receipt.transaction;
const deadline = Date.now() + 20 * 60 * 1000;
let last = '';
while (true) {
  const transfer = await gateway.getTransferById(id);
  if (transfer.amount !== '1000' || transfer.nonce !== metadata.nonce
    || transfer.fromAddress.toLowerCase() !== manifest.buyer.toLowerCase()
    || transfer.toAddress.toLowerCase() !== manifest.seller.toLowerCase()
    || transfer.sendingNetwork !== 'eip155:5042002') throw new Error('Transfer attribution mismatch');
  await record('transfer-latest.json', transfer);
  const observation = { at: new Date().toISOString(), status: transfer.status, txHash: transfer.txHash };
  await appendFile(new URL('./transfer-observations.jsonl', import.meta.url), JSON.stringify(observation) + '\n');
  const state = `${transfer.status}:${transfer.txHash}`;
  if (state !== last) { console.log(json(observation)); last = state; }
  if (transfer.status === 'failed') throw new Error('Gateway reports failed transfer; do not retry automatically');
  if (['confirmed', 'completed'].includes(transfer.status) && transfer.txHash) {
    const [receipt, transaction, buyer, seller] = await Promise.all([
      gateway.publicClient.getTransactionReceipt({ hash: transfer.txHash }),
      gateway.publicClient.getTransaction({ hash: transfer.txHash }),
      gateway.getBalances(manifest.buyer), gateway.getBalances(manifest.seller),
    ]);
    if (receipt.status !== 'success' || transaction.to?.toLowerCase() !== '0x0077777d7eba4688bdef3e311b846f25870a19b9') throw new Error('Unexpected batch receipt');
    const call = decodeFunctionData({ abi: parseAbi(['function submitBatch(bytes calldataBytes, bytes signature)']), data: transaction.input });
    const [deltas, batchId, domain, token, wallet] = decodeAbiParameters(
      parseAbiParameters('(address depositor, int256 value)[] deltas, bytes32 batchId, uint32 domain, address tokenAddress, address gatewayWalletAddress'), call.args[0]);
    const ourDeltas = deltas.filter(d => [manifest.buyer.toLowerCase(), manifest.seller.toLowerCase()].includes(d.depositor.toLowerCase()));
    if (domain !== 26 || token.toLowerCase() !== '0x3600000000000000000000000000000000000000'
      || wallet.toLowerCase() !== transaction.to.toLowerCase()
      || !ourDeltas.some(d => d.depositor.toLowerCase() === manifest.buyer.toLowerCase() && d.value === -1000n)
      || !ourDeltas.some(d => d.depositor.toLowerCase() === manifest.seller.toLowerCase() && d.value === 1000n)) throw new Error('Batch deltas do not match this test');
    const proof = { chainId: 5042002, transfer, batch: { txHash: transfer.txHash,
      status: receipt.status, blockNumber: receipt.blockNumber, transactionTo: transaction.to,
      batchId, domain, token, wallet, ourDeltas }, buyer, seller };
    await record('onchain-settlement-proof.json', proof);
    console.log(json(proof));
    if (buyer.gateway.available !== 99000n || seller.gateway.available !== 1000n) throw new Error('Settled balances do not match expected 0.099 and 0.001');
    break;
  }
  if (Date.now() >= deadline) throw new Error('Transfer remains pending after observation window; payment must not be repeated');
  await new Promise(resolve => setTimeout(resolve, 10000));
}
