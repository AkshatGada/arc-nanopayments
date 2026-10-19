import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

process.umask(0o077);
await mkdir(new URL('./.secrets/', import.meta.url), { recursive: true, mode: 0o700 });
const location = new URL('./.secrets/wallets.json', import.meta.url);
let wallets;
try {
  wallets = JSON.parse(await readFile(location, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  wallets = { buyer: generatePrivateKey(), seller: generatePrivateKey() };
  await writeFile(location, JSON.stringify(wallets), { mode: 0o600, flag: 'wx' });
}
await chmod(location, 0o600);
const manifest = {
  chain: 'arcTestnet', chainId: 5042002,
  buyer: privateKeyToAccount(wallets.buyer).address,
  seller: privateKeyToAccount(wallets.seller).address,
  depositCapTestUsdc: '0.1', paymentCapTestUsdc: '0.001', maxPaidRequests: 1,
  funds: 'public testnet faucet only',
};
await writeFile(new URL('./run.json', import.meta.url), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
