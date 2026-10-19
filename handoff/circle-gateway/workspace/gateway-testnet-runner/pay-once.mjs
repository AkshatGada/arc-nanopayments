import { gateway, manifest, record, checkChain, json, SELLER_URL } from './common.mjs';

await checkChain();
const health = await fetch('http://127.0.0.1:3000/health', { redirect: 'error', signal: AbortSignal.timeout(10000) });
if (!health.ok || (await health.json()).paymentRail !== 'circle_testnet') throw new Error('Seller is not using live Circle testnet');
const before = await gateway.getBalances();
if (before.gateway.available < 1000n) throw new Error('Gateway balance is not yet available');

gateway.onBeforePaymentCreation(async ({ selectedRequirements: r }) => {
  if (r.scheme !== 'exact' || r.network !== 'eip155:5042002' || r.amount !== '1000'
    || r.payTo.toLowerCase() !== manifest.seller.toLowerCase()
    || r.asset.toLowerCase() !== '0x3600000000000000000000000000000000000000'
    || r.extra?.name !== 'GatewayWalletBatched' || r.extra?.version !== '1'
    || r.extra?.verifyingContract?.toLowerCase() !== '0x0077777d7eba4688bdef3e311b846f25870a19b9'
    || r.maxTimeoutSeconds !== 604900) {
    throw new Error('Offer exceeds this single 0.001-test-USDC test authorization');
  }
});
gateway.onAfterPaymentCreation(async (ctx) => {
  await record('.secrets/authorization.json', ctx.paymentPayload, { flag: 'wx' });
  const authorization = ctx.paymentPayload.payload.authorization;
  await record('payment-authorization-metadata.json', {
    buyer: manifest.buyer, seller: manifest.seller, chainId: 5042002,
    amountAtomic: authorization.value, nonce: authorization.nonce,
    validAfter: authorization.validAfter, validBefore: authorization.validBefore,
    resource: SELLER_URL, at: new Date().toISOString(),
  });
});
gateway.onPaymentResponse(async (ctx) => {
  await record('payment-response-receipt.json', { receipt: ctx.settleResponse, error: ctx.error?.message });
});
await record('paid-call-started.json', { url: SELLER_URL, method: 'GET', chainId: 5042002,
  capAtomic: '1000', buyer: manifest.buyer, seller: manifest.seller, at: new Date().toISOString() }, { flag: 'wx' });
// Exactly one SDK pay call, no retry/recovery hook. An ambiguous result is reconciled by nonce.
const result = await gateway.pay(SELLER_URL, { method: 'GET' });
await record('paid-result.json', result);
console.log(json(result));
if (result.status !== 200 || result.amount !== 1000n || result.data?.payment?.status !== 'accepted'
  || result.data?.payment?.transferId !== result.transaction || result.data?.payment?.network !== 'eip155:5042002') {
  throw new Error('Unexpected paid result; do not retry');
}
const transfer = await gateway.getTransferById(result.transaction);
await record('transfer-latest.json', transfer);
console.log(json({ transfer }));
