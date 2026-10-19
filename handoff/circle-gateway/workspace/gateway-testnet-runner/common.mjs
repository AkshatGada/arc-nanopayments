import { readFile, writeFile } from 'node:fs/promises';
import { GatewayClient, CHAIN_CONFIGS } from '@circle-fin/x402-batching/client';

export const manifest = JSON.parse(await readFile(new URL('./run.json', import.meta.url), 'utf8'));
const keys = JSON.parse(await readFile(new URL('./.secrets/wallets.json', import.meta.url), 'utf8'));
export const gateway = new GatewayClient({ chain: 'arcTestnet', rpcUrl: 'https://rpc.testnet.arc.io', privateKey: keys.buyer });
if (manifest.chainId !== 5042002 || gateway.account.address !== manifest.buyer || CHAIN_CONFIGS.arcTestnet.chain.id !== 5042002) {
  throw new Error('Testnet identity mismatch');
}
export const json = (value) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
export async function record(name, data, options = {}) {
  await writeFile(new URL(name, import.meta.url), json(data), { mode: 0o600, ...options });
}
export async function checkChain() {
  if (await gateway.publicClient.getChainId() !== 5042002) throw new Error('Refusing non-Arc-testnet RPC');
}
export const SELLER_URL = 'http://127.0.0.1:3000/quote';
