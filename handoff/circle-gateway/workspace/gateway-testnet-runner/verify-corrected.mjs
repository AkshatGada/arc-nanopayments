import { readFile } from 'node:fs/promises';
import { gateway, manifest, record, json, SELLER_URL } from './common.mjs';

const response = await fetch(SELLER_URL, { redirect: 'error', signal: AbortSignal.timeout(10000) });
if (response.status !== 402) throw new Error('Expected unpaid 402');
const required = JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64').toString());
const offer = required.accepts[0];
if (required.resource?.mimeType !== 'application/json' || offer.amount !== '1000'
  || offer.network !== 'eip155:5042002' || offer.payTo.toLowerCase() !== manifest.seller.toLowerCase()) throw new Error('Corrected offer mismatch');
const signed = JSON.parse(await readFile(new URL('./.secrets/authorization.json', import.meta.url), 'utf8'));
const paymentPayload = { ...signed, accepted: offer, resource: required.resource };
const verify = await fetch('https://gateway-api-testnet.circle.com/v1/x402/verify', {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: offer }),
});
const result = { status: verify.status, result: await verify.json(), resource: required.resource };
await record('corrected-verification.json', result);
console.log(json(result));
if (verify.status !== 200 || result.result.isValid !== true) throw new Error('Corrected authorization did not verify');
await record('.secrets/corrected-payment-payload.json', paymentPayload, { flag: 'wx' });
const search = await gateway.searchTransfers({ nonce: paymentPayload.payload.authorization.nonce, network: 'eip155:5042002' });
const balances = await gateway.getBalances();
await record('before-original-authorization-recovery.json', { search, balances });
console.log(json({ transfersForNonce: search.transfers.length, available: balances.gateway.formattedAvailable }));
if (search.transfers.length || balances.gateway.available !== 100000n) throw new Error('Original payment outcome needs reconciliation before any recovery request');
