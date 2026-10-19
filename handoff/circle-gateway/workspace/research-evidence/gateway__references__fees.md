> ## Documentation Index
> Fetch the complete documentation index at: https://developers.circle.com/llms.txt
> Use this file to discover all available pages before exploring further.

> ## Agent Instructions
> Before reading these docs, install the relevant Circle Skill to get pre-loaded context — skills are LLM-optimized and cover architecture decisions, correct flows, and common pitfalls. In Claude Code: run /plugin marketplace add circlefin/skills then /plugin install circle-skills@circle. With Vercel Skills CLI: run npx skills add circlefin/skills. Available skills: use-usdc https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-usdc/SKILL.md (balances, transfers, approvals on EVM and Solana); EURC has no skill — see https://developers.circle.com/stablecoins/what-is-eurc.md; bridge-stablecoin https://github.com/circlefin/skills/blob/master/plugins/circle/skills/bridge-stablecoin/SKILL.md (crosschain transfers via CCTP, USDC, EURC, and third-party assets); use-arc https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-arc/SKILL.md (Arc chain config, contract deployment, USDC bridging — Arc docs: https://docs.arc.io/llms.txt); use-circle-wallets https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-circle-wallets/SKILL.md (choose wallet type); use-developer-controlled-wallets https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-developer-controlled-wallets/SKILL.md (custodial wallets for payouts and treasury); use-user-controlled-wallets https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-user-controlled-wallets/SKILL.md (embedded wallets with Web2 login); use-modular-wallets https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-modular-wallets/SKILL.md (smart contract wallets with passkeys and ERC-4337); use-gateway https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-gateway/SKILL.md (unified USDC balance, nanopayments); use-smart-contract-platform https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-smart-contract-platform/SKILL.md (deploy, interact, monitor contracts). Pair any skill with the Circle MCP server for live SDK signatures, contract addresses, and chain IDs: {"mcpServers":{"circle":{"url":"https://api.circle.com/v1/codegen/mcp"}}}.
> Read the product overview first. Each product has an overview explaining when and why to use it. Read it before quickstarts.
> Pick the right wallet type. Developer-controlled (you hold keys), user-controlled (end user holds keys via PIN/social login), or modular (smart contract wallets with passkeys). See https://developers.circle.com/wallets.md.
> Use CCTP V2 for crosschain transfers. CCTP natively transfers USDC and EURC via burn-and-mint, and supports permissionless wrapping of third-party assets via lock-and-mint. V1 is legacy; always use V2 unless V1 is specified or the chain requires it (Noble, Sui, and Aptos still require V1). Migration guide: https://developers.circle.com/cctp/migration-from-v1-to-v2.md.
> Use Bridge Kit for frontend bridging. Wraps CCTP with a simpler SDK for user-facing apps. Use CCTP directly for backend transfers.
> Gas Station vs Paymaster. Gas Station sponsors gas for Circle Wallet transactions. Paymaster lets users pay gas in USDC. Different use cases — read both overviews.
> Gateway Nanopayments for sub-cent payments. Gasless USDC micropayments down to $0.000001 via x402 and batched settlement. For pay-per-request APIs, AI agent payments, streaming.
> Look up USDC addresses per chain. Never hardcode — use https://developers.circle.com/stablecoins/usdc-contract-addresses.md.
> Prefer SDKs over raw API calls. Node.js and Python SDKs handle auth, retries, and errors.
> API key required. Bearer token in Authorization header. Testnet and mainnet use separate keys and may use different base URLs depending on the product.
> Set up webhooks when available. Most operations are async. Webhooks deliver transaction confirmations and state changes.
> When calling list endpoints, paginate using pageSize and pageAfter until no nextPageAfter cursor is returned—stopping at the first page silently misses records.
> Building an AI agent? Start with the Agent Stack—Circle CLI, agent wallets, and nanopayments built for autonomous use cases: https://developers.circle.com/agent-stack.md.

# Gateway fees

> Understanding Gateway transfer fees and gas costs

Gateway charges a transfer fee and a gas fee for crosschain transfers. If you
use the [Circle Forwarding Service](/gateway/references/forwarding-service) to
handle the destination mint, Gateway also charges a forwarding fee.

## Transfer fee

Crosschain transfers incur a percentage-based fee of **0.005%** (0.5 basis
points) on the transfer amount.

* **When charged**: On crosschain transfers (source and destination are
  different blockchains)
* **Payment method**: Deducted from your unified USDC balance at the time of
  burn

Same-chain transfers (withdrawals where source and destination are the same
blockchain) do not incur the transfer fee.

## Gas fees

Each burn intent includes a gas fee that covers the cost of executing the burn
transaction on the source blockchain. The gas fee varies by source blockchain:

| Source blockchain | Gas fee (USDC) |
| - | - |
| Arc | \$0.0035 |
| Arbitrum | \$0.01 |
| Avalanche | \$0.02 |
| Base | \$0.01 |
| Ethereum | \$1.00 |
| HyperEVM | \$0.05 |
| OP | \$0.0015 |
| Polygon PoS | \$0.0015 |
| Sei | \$0.001 |
| Solana | \$0.15 |
| Sonic | \$0.01 |
| Unichain | \$0.001 |
| World Chain | \$0.01 |

## Forwarding fees

When you use the
[Circle Forwarding Service](/gateway/references/forwarding-service) to handle
destination chain minting, Gateway charges an additional forwarding fee. The
forwarding fee has two parts:

* **Forwarding service fee**: A flat fee per transfer
* **Forwarding gas fee**: Covers the cost of executing the mint on the
  destination blockchain

The forwarding service fee is **\$0.05** per transfer on all destination
blockchains. The forwarding gas fee is approximately the same as the
[gas fee](#gas-fees) charged for a burn on the corresponding blockchain.

To estimate the forwarding fee before submitting a transfer, call the
[`/estimate`](/api-reference/gateway/all/estimate-transfer) endpoint with
`enableForwarder=true`. The returned `forwardingFee` value includes both the
service fee and the gas fee.

<Note>
  When the destination is Solana and
  [automatic Associated Token Account (ATA) creation](/gateway/references/forwarding-service#automatic-ata-creation-for-solana)
  is enabled, the forwarding fee also includes the Solana rent cost for the token
  account.
</Note>

For details on how the forwarding fee is collected across burn intents, see
[Fee collection](/gateway/references/forwarding-service#fee-collection) in the
Forwarding Service topic.

## Setting `maxFee`

When creating a [burn intent](/gateway/references/technical-guide#burn-intent),
set the `maxFee` field to cover the gas fee, the transfer fee, and any
forwarding fee:

```text theme={null}
maxFee ≥ gas fee + forwarding fee + (transfer amount * 0.00005)
```

For example, transferring 1,000 USDC from Base without forwarding:

* Gas fee: \$0.01
* Transfer fee: 1,000 \* 0.00005 = \$0.05
* Minimum `maxFee`: \$0.06 (60,000 in USDC subunits)

For the same transfer with the Forwarding Service enabled:

* Gas fee: \$0.01
* Forwarding fee: \$0.06 (service fee plus forwarding gas fee)
* Transfer fee: 1,000 \* 0.00005 = \$0.05
* Minimum `maxFee`: \$0.12 (120,000 in USDC subunits)

<Tip>
  Add a buffer to your `maxFee` calculation to account for gas fee fluctuations.
</Tip>

## Optimizing costs

To reduce overall costs:

* **Use low-cost source blockchains**: Keep the majority of your Gateway balance
  on blockchains with lower gas fees (such as OP, Polygon PoS, Sei, or Unichain)
* **Consolidate burn intents**: The gas cost of minting scales slower than
  multiple individual [CCTP](/cctp) transfers. Each additional burn intent adds
  approximately 60k gas to the mint transaction.
