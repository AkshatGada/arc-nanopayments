import { readFile, writeFile } from 'node:fs/promises';
import { GatewayClient } from '@circle-fin/x402-batching/client';

const wallets = JSON.parse(await readFile(new URL('./.secrets/wallets.json', import.meta.url), 'utf8'));
const client = new GatewayClient({ chain: 'arcTestnet', rpcUrl: 'https://rpc.testnet.arc.io', privateKey: wallets.buyer });
if (await client.publicClient.getChainId() !== 5042002) throw new Error('Wrong chain; refusing test');
const balances = await client.getBalances();
const record = { chainId: 5042002, buyer: client.account.address, balances };
const json = JSON.stringify(record, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2);
await writeFile(new URL('./balances-before.json', import.meta.url), json);
console.log(json);
