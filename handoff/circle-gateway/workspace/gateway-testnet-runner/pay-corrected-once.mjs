import { readFile } from 'node:fs/promises';
import { BatchEvmScheme } from '@circle-fin/x402-batching/client';
import { gateway, manifest, record, checkChain, json, SELLER_URL } from './common.mjs';

await checkChain();
const previous = JSON.parse(await readFile(new URL('./payment-authorization-metadata.json', import.meta.url), 'utf8'));
const rejected = JSON.parse(await readFile(new URL('./corrected-verification.json', import.meta.url), 'utf8'));
if (rejected.result?.invalidReason !== 'authorization_validity_too_short') throw new Error('Prior outcome is not an explicit validity rejection');
const oldTransfers = await gateway.searchTransfers({ nonce: previous.nonce, network: 'eip155:5042002' });
const balances = await gateway.getBalances();
await record('prior-authorization-uncharged.json', { oldTransfers, balances, at: new Date().toISOString() });
if (oldTransfers.transfers.length || balances.gateway.available !== 100000n) throw new Error('Prior outcome needs reconciliation; refusing new authorization');
const response = await fetch(SELLER_URL, { redirect: 'error', signal: AbortSignal.timeout(10000) });
if (response.status !== 402) throw new Error('Expected unpaid 402');
const required = JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64').toString());
const offer = required.accepts[0];
if (required.resource?.url !== SELLER_URL || required.resource?.mimeType !== 'application/json'
  || offer.scheme !== 'exact' || offer.network !== 'eip155:5042002' || offer.amount !== '1000'
  || offer.payTo.toLowerCase() !== manifest.seller.toLowerCase()
  || offer.asset.toLowerCase() !== '0x3600000000000000000000000000000000000000'
  || offer.extra?.name !== 'GatewayWalletBatched' || offer.extra?.version !== '1'
  || offer.extra?.verifyingContract?.toLowerCase() !== '0x0077777d7eba4688bdef3e311b846f25870a19b9'
  || offer.maxTimeoutSeconds !== 604900) throw new Error('Offer exceeds fixed test policy');
await record('corrected-attempt-started.json', { buyer: manifest.buyer, seller: manifest.seller,
  amountAtomic: '1000', priorNonce: previous.nonce, priorResult: 'rejected before admission; balance unchanged',
  at: new Date().toISOString() }, { flag: 'wx' });
const scheme = new BatchEvmScheme(gateway.account);
const partial = await scheme.createPaymentPayload(2, offer);
const paymentPayload = { ...partial, accepted: offer, resource: required.resource };
await record('.secrets/final-payment-payload.json', paymentPayload, { flag: 'wx' });
await record('payment-corrected-metadata.json', { buyer: manifest.buyer, seller: manifest.seller,
  nonce: partial.payload.authorization.nonce, amountAtomic: '1000', resource: required.resource,
  at: new Date().toISOString() });
const verify = await fetch('https://gateway-api-testnet.circle.com/v1/x402/verify', {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: offer }),
});
const verification = { status: verify.status, result: await verify.json() };
await record('final-authorization-verification.json', verification);
console.log(json({ verification }));
if (verification.status !== 200 || verification.result.isValid !== true) throw new Error('Fresh authorization did not verify; no paid request sent');
await record('corrected-paid-request-started.json', { nonce: partial.payload.authorization.nonce,
  amountAtomic: '1000', at: new Date().toISOString() }, { flag: 'wx' });
const paid = await fetch(SELLER_URL, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
  headers: { 'Payment-Signature': Buffer.from(JSON.stringify(paymentPayload)).toString('base64') } });
const receiptHeader = paid.headers.get('payment-response');
const receipt = receiptHeader ? JSON.parse(Buffer.from(receiptHeader, 'base64').toString()) : null;
const result = { status: paid.status, receipt, cacheControl: paid.headers.get('cache-control'), data: await paid.json() };
await record('paid-result-final.json', result);
console.log(json(result));
if (paid.status !== 200 || receipt?.success !== true || receipt.network !== 'eip155:5042002'
  || result.data?.payment?.status !== 'accepted' || result.data.payment.transferId !== receipt.transaction) {
  throw new Error('Paid result unexpected; reconcile final nonce, never retry automatically');
}
const transfer = await gateway.getTransferById(receipt.transaction);
await record('transfer-latest.json', transfer);
console.log(json({ transfer }));
