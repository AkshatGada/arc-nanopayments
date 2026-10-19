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

# How-to: Integrate nanopayments into your existing facilitator

> Add nanopayments gas-free settlement to your x402 facilitator service

Route Gateway payments through your existing x402 facilitator alongside standard
onchain payments. Connected sellers gain gas-free batched settlement without
changing seller-side code.

<Note>
  This guide is for infrastructure providers and payment processors running x402
  facilitators.
</Note>

## Prerequisites

Before you begin, ensure that you've:

* Built an x402 facilitator service using `@x402/core`.
* Installed [Node.js](https://nodejs.org/) v18+.
* Familiarized yourself with the [x402 protocol](/x402-facilitators/x402) and
  how facilitators verify and settle payments.

## Steps

<Steps>
  <Step title="Install the SDK">
    Install `@circle-fin/x402-batching` alongside its required peer dependencies:

    ```shell theme={null}
    npm install @circle-fin/x402-batching @x402/core viem
    ```
  </Step>

  <Step title="Add a Gateway client for verification, settlement, and discovery">
    The `BatchFacilitatorClient` handles all communication with Circle Gateway,
    including verification using the
    [Verify x402 Payment](/api-reference/gateway-nanopayments/verify-x402payment)
    API endpoint, settlement using the
    [Settle x402 Payment](/api-reference/gateway-nanopayments/settle-x402payment)
    API endpoint, and supported-network discovery using the
    [Get Supported x402 Payment Kinds](/api-reference/gateway-nanopayments/get-supported-x402payment-kinds)
    API endpoint. See the [SDK reference](/sdks/gateway-nanopayments-sdk) for the
    full `BatchFacilitatorClient` API.

    ```ts theme={null}
    import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";

    const gatewayClient = new BatchFacilitatorClient();
    ```
  </Step>

  <Step title="Route payments by type">
    Your facilitator acts as a router. Use `isBatchPayment()` to detect Gateway
    payments and delegate them to the `BatchFacilitatorClient`. Route all other
    payments to your existing onchain logic.

    Gateway payments are identified by the `extra` metadata field:
    `extra.name === "GatewayWalletBatched"`.

    ```ts theme={null}
    import { isBatchPayment } from "@circle-fin/x402-batching/server";

    async function handleVerify(
      payload: PaymentPayload,
      requirements: PaymentRequirements,
    ) {
      if (isBatchPayment(requirements)) {
        return gatewayClient.verify(payload, requirements);
      }
      return existingOnChainHandler.verify(payload, requirements);
    }

    async function handleSettle(
      payload: PaymentPayload,
      requirements: PaymentRequirements,
    ) {
      if (isBatchPayment(requirements)) {
        return gatewayClient.settle(payload, requirements);
      }
      return existingOnChainHandler.settle(payload, requirements);
    }

    async function handleSupported() {
      const gateway = await gatewayClient.getSupported();
      const existing = await existingOnChainHandler.getSupported();

      return {
        kinds: [...existing.kinds, ...gateway.kinds],
        extensions: [...existing.extensions, ...gateway.extensions],
        signers: { ...existing.signers, ...gateway.signers },
      };
    }
    ```

    <Note>
      Gateway's `settle()` endpoint is optimized for low latency and guarantees
      settlement. Use `settle()` directly rather than calling `verify()` followed by
      `settle()` in production flows.
    </Note>

    For background on how Gateway batches payments, see
    [How batched settlement works](/gateway-nanopayments/concepts/batched-settlement).
  </Step>

  <Step title="Wire up HTTP endpoints">
    Expose your routing logic through standard x402 facilitator endpoints:

    ```ts theme={null}
    app.post("/v1/x402/verify", async (req, res) => {
      const { paymentPayload, paymentRequirements } = req.body;
      const response = await handleVerify(paymentPayload, paymentRequirements);
      res.json(response);
    });

    app.post("/v1/x402/settle", async (req, res) => {
      const { paymentPayload, paymentRequirements } = req.body;
      const response = await handleSettle(paymentPayload, paymentRequirements);
      res.json(response);
    });

    app.get("/v1/x402/supported", async (_req, res) => {
      const response = await handleSupported();
      res.json(response);
    });
    ```
  </Step>

  <Step title="Connect sellers to your facilitator">
    Once your facilitator supports Gateway, sellers connect to it and automatically
    gain access to both standard and gas-free payment options. Sellers new to the
    Gateway middleware can start from the
    [seller quickstart](/gateway-nanopayments/quickstarts/seller).

    Sellers connect using one of two setups.

    <Tabs>
      <Tab title="x402ResourceServer">
        Sellers using `x402ResourceServer` connect to your facilitator with
        `HTTPFacilitatorClient`:

        ```ts theme={null}
        import { x402ResourceServer } from "@x402/core/server";
        import { HTTPFacilitatorClient } from "@x402/core/server";

        const server = new x402ResourceServer([
          new HTTPFacilitatorClient({ url: "https://your-facilitator-service.com" }),
        ]);

        await server.initialize();
        ```
      </Tab>

      <Tab title="Gateway middleware">
        Sellers using the Gateway middleware can route verification and settlement
        through your facilitator by setting `facilitatorUrl`:

        ```ts theme={null}
        import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

        const gateway = createGatewayMiddleware({
          sellerAddress: "0xSELLER_ADDRESS",
          facilitatorUrl: "https://your-facilitator-service.com",
        });
        ```
      </Tab>
    </Tabs>
  </Step>
</Steps>

## Alternative: gas-free-only facilitator

If you are building a new facilitator that only needs to support gas-free
payments (without standard onchain settlement), use `BatchFacilitatorClient`
directly with `x402ResourceServer`:

```shell theme={null}
npm install @x402/core @x402/express @x402/evm
```

```ts theme={null}
import { x402ResourceServer } from "@x402/core/server";
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";

const server = new x402ResourceServer([new BatchFacilitatorClient()]);

await server.initialize();
```

### Preserve Gateway signing metadata

When using `x402ResourceServer` with `BatchFacilitatorClient`, register
`GatewayEvmScheme` to ensure payment requirements include the metadata that
Gateway clients need for EIP-712 signing. `GatewayEvmScheme` extends the
standard `ExactEvmScheme` to:

* Preserve `extra` metadata (`verifyingContract`, `name`, `version`) in payment
  requirements
* Set `maxTimeoutSeconds` to 604900 (7 days plus a small buffer) for batched
  settlement
* Register USDC money parsers for all Gateway-supported networks

```ts theme={null}
import { x402ResourceServer } from "@x402/express";
import {
  BatchFacilitatorClient,
  GatewayEvmScheme,
} from "@circle-fin/x402-batching/server";

const circleClient = new BatchFacilitatorClient();
const server = new x402ResourceServer([circleClient]);
server.register("eip155:*", new GatewayEvmScheme());
await server.initialize();
```

<Note>
  The base `ExactEvmScheme` discards the `extra` field from supported kinds when
  building payment requirements. Gateway clients require `extra.verifyingContract`
  to construct valid EIP-712 signatures. `GatewayEvmScheme` preserves this data.
</Note>
