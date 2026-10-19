> ## Documentation Index
> Fetch the complete documentation index at: https://docs.arc.io/llms.txt
> Use this file to discover all available pages before exploring further.

> ## Agent Instructions
> Before reading these docs, install the Circle Skill for Arc to get pre-loaded context: use-arc (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-arc/SKILL.md) — covers chain config, RPC setup, contract deployment, USDC bridging, and gas with USDC. In Claude Code: run /plugin marketplace add circlefin/skills then /plugin install circle-skills@circle. With Vercel Skills CLI: run npx skills add circlefin/skills.
> USDC is the gas token. Arc uses USDC for gas fees, not ETH. Configure gas payment in USDC when submitting transactions.
> Read EVM differences before writing Arc code. Arc targets the Osaka EVM baseline. Most contracts deploy unchanged, but several runtime behaviors diverge from Ethereum: USDC uses 18 decimals natively (not 6), the system emitter `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE` logs all USDC Transfer events, the mempool enforces a 20 Gwei `maxFeePerGas` floor, blocklist reverts consume gas without a receipt, and `address(0)` sends revert rather than succeed. https://docs.arc.io/arc/references/evm-differences.md is the canonical reference for all Arc-specific runtime behaviors. Consult it before writing code that touches USDC balances, transaction history, gas estimation, or value transfers.
> Sub-second finality. Transactions are final in under 1 second. No need to wait for multiple block confirmations.
> Use App Kits for multichain payment and liquidity capabilities. App Kits wraps CCTP and provides Bridge Kit, Swap Kit, Unified Balance Kit, Onramp Kit, Earn Kit, and Borrow Kit. Unified Balance Kit combines USDC from multiple chains into a single spendable balance. Earn Kit integrates earn opportunities into your app. Borrow Kit lets users borrow USDC against cirBTC collateral on Arc.
> Use Arc Foundry for contract development. Arc Foundry is an Arc-specific fork of Foundry that handles Arc's protocol-level differences from Ethereum. It provides arc-forge, arc-cast, and arc-anvil. Install it before deploying contracts: https://docs.arc.io/arc/tutorials/install-arc-foundry.md.
> Arc is available on both Testnet and Mainnet. See https://docs.arc.io/arc/references/connect-to-arc.md for RPC endpoints and https://faucet.circle.com for testnet tokens.
> Always check Contract Addresses: https://docs.arc.io/arc/references/contract-addresses.md
> Building beyond Arc? Circle offers skills for the full platform: use-usdc (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-usdc/SKILL.md), use-circle-wallets (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-circle-wallets/SKILL.md), use-developer-controlled-wallets (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-developer-controlled-wallets/SKILL.md), use-user-controlled-wallets (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-user-controlled-wallets/SKILL.md), use-modular-wallets (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-modular-wallets/SKILL.md), use-gateway (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-gateway/SKILL.md), use-smart-contract-platform (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-smart-contract-platform/SKILL.md). Full Circle developer docs: https://developers.circle.com/llms.txt.

# RPC endpoints

> RPC endpoints, network parameters, and node provider options for connecting to Arc mainnet and testnet.

Arc exposes standard Ethereum JSON-RPC endpoints -- the same HTTP and WebSocket
API that Ethereum nodes use -- for submitting transactions, querying state, and
subscribing to events. Connect through Circle's primary endpoint or through a
[third-party node provider](#node-providers).

## Mainnet endpoints

| Provider | HTTP | WebSocket |
| :- | :- | :- |
| **Primary (Circle)** | `https://rpc.mainnet.arc.io` | `wss://rpc.mainnet.arc.io` |
| **Alchemy** | `https://arc-mainnet.g.alchemy.com/v2/YOUR_API_KEY` | `wss://arc-mainnet.g.alchemy.com/v2/YOUR_API_KEY` |
| **Blockdaemon** | `https://rpc.blockdaemon.mainnet.arc.io` | `wss://rpc.blockdaemon.mainnet.arc.io/websocket` |
| **dRPC** | `https://rpc.drpc.mainnet.arc.io` | `wss://rpc.drpc.mainnet.arc.io` |
| **QuickNode** | `https://rpc.quicknode.mainnet.arc.io` | `wss://rpc.quicknode.mainnet.arc.io` |

The primary Circle endpoint (`rpc.mainnet.arc.io`) accepts anonymous requests
with open CORS. No API key or credentials are required. Third-party providers
may require their own API key; check each provider's documentation.

<Warning>
  The primary endpoint is load-balanced across multiple backends that may be at
  slightly different block heights. If you set `toBlock` to the value returned
  by `eth_blockNumber` and a different backend serves the next request, it may
  return error `-32014` because it hasn't yet imported that block. You can
  safely retry requests that return `-32014` after a brief backoff.
</Warning>

## Testnet endpoints

| Provider | HTTP | WebSocket |
| :- | :- | :- |
| **Primary (Circle)** | `https://rpc.testnet.arc.io` | `wss://rpc.testnet.arc.io` |
| **Blockdaemon** | `https://rpc.blockdaemon.testnet.arc.io` | `wss://rpc.blockdaemon.testnet.arc.io/websocket` |
| **dRPC** | `https://rpc.drpc.testnet.arc.io` | `wss://rpc.drpc.testnet.arc.io` |
| **QuickNode** | `https://rpc.quicknode.testnet.arc.io` | `wss://rpc.quicknode.testnet.arc.io` |

## Network parameters

These parameters identify Arc on the Ethereum network and are required when
adding Arc to a wallet or development framework.

| Parameter | Value |
| :- | :- |
| **Chain ID (Mainnet)** | `5042` |
| **Chain ID (Testnet)** | `5042002` |
| **Currency symbol** | USDC |
| **Mainnet explorer** | [explorer.arc.io](https://explorer.arc.io) |
| **Testnet explorer** | [explorer.testnet.arc.io](https://explorer.testnet.arc.io) |
| **Gas tracker** | [explorer.testnet.arc.io/gas-tracker](https://explorer.testnet.arc.io/gas-tracker) |
| **Faucet** | [faucet.circle.com](https://faucet.circle.com) |

For wallet configuration instructions using these parameters, see
[Connect to Arc](/arc/references/connect-to-arc).

## Node providers

The following infrastructure partners offer managed RPC access to Arc. Each
provider supports JSON-RPC over both HTTP and WebSocket connections. See
[Node providers](/arc/tools/node-providers) for additional details.

| Provider | Description |
| :- | :- |
| [**Alchemy**](https://www.alchemy.com/arc) | Full-stack developer platform with RPC, Data APIs, webhooks, and Wallet APIs |
| [**Blockdaemon**](https://www.blockdaemon.com/protocols/arc) | Institutional-grade node infrastructure with secure, compliant access |
| [**dRPC**](https://drpc.org/chainlist/arc-testnet-rpc) | RPC aggregator with load-balanced, multi-provider routing |
| [**QuickNode**](https://www.quicknode.com/chains/arc) | High-performance global endpoints and blockchain APIs |

## Supported methods

Arc supports all standard Ethereum JSON-RPC methods. The following table lists
commonly used methods by category.

| Category | Methods | Notes |
| :- | :- | :- |
| **State** | `eth_getBalance`, `eth_getCode`, `eth_getStorageAt`, `eth_call` | |
| **Transactions** | `eth_sendRawTransaction`, `eth_getTransactionReceipt`, `eth_getTransactionByHash` | |
| **Blocks** | `eth_getBlockByNumber`, `eth_getBlockByHash`, `eth_blockNumber` | |
| **Gas** | `eth_gasPrice`, `eth_estimateGas`, `eth_feeHistory` | |
| **Logs** | `eth_getLogs` | Block range limit: 10,000 blocks |
| **Subscriptions** | `eth_subscribe`, `eth_unsubscribe` | WebSocket only |

For gas fee parameters and best practices for setting `maxFeePerGas`, see
[Gas and fees](/arc/references/gas-and-fees).

<Note>
  `eth_getLogs` returns error `-32012` when the requested block range exceeds
  10,000 blocks. At \~2 blocks/s, 10,000 blocks covers roughly 85 minutes of
  chain history per call. Log-driven clients must page through history in
  ≤9,999-block chunks.
</Note>

## Troubleshooting

| Symptom | Cause | Resolution |
| :- | :- | :- |
| `connection refused` or timeout | Incorrect RPC URL or network issue | Verify you are using a URL from the [mainnet](#mainnet-endpoints) or [testnet](#testnet-endpoints) endpoints table. Try an alternate provider. Check [network status](https://status.arc.io) for ongoing incidents. |
| `invalid chain id` | Wallet or provider configured with the wrong Chain ID | Set the Chain ID to `5042` for Mainnet or `5042002` for Testnet. |
| `insufficient funds` | Account has no USDC for gas | Request testnet USDC from the [faucet](https://faucet.circle.com). For mainnet, request gas USDC through your Circle point of contact. |
| `eth_getLogs` returns error `-32012` | Block range exceeds the 10,000-block public endpoint limit | Reduce the range to ≤9,999 blocks per request and page through history sequentially |
| RPC request returns error `-32014` for a block at or near the chain head | The primary endpoint is load-balanced; the backend that reported the current head may differ from the one serving this request | Back off briefly and retry the request |
