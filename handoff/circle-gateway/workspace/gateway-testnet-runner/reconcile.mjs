import { readFile, access } from 'node:fs/promises';
import { gateway, manifest, record, json } from './common.mjs';

let metadataFile = './payment-authorization-metadata.json';
if (!process.argv.includes('--initial')) {
  try { await access(new URL('./payment-corrected-metadata.json', import.meta.url)); metadataFile = './payment-corrected-metadata.json'; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const metadata = JSON.parse(await readFile(new URL(metadataFile, import.meta.url), 'utf8'));
const [search, buyer, seller] = await Promise.all([
  gateway.searchTransfers({ nonce: metadata.nonce, network: 'eip155:5042002' }),
  gateway.getBalances(manifest.buyer), gateway.getBalances(manifest.seller),
]);
const result = { nonce: metadata.nonce, search, buyer, seller, at: new Date().toISOString() };
await record(process.argv.includes('--initial') ? 'reconciliation-initial.json' : 'reconciliation-latest.json', result);
console.log(json(result));
