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

# How-to: Add nanopayments to an x402 seller

> Add gas-free nanopayments to your x402 resource server alongside standard onchain payments

Add gas-free nanopayments to an existing `x402ResourceServer` so it accepts them
alongside your current onchain payment methods. Your existing payment setup
continues to work unchanged: the server includes nanopayment options in its
`402` responses in addition to what your facilitator already supports, and
buyers choose whichever method they have funded. For the client-side
counterpart, see the
[x402 buyer integration](/gateway-nanopayments/howtos/x402-buyer).

## Prerequisites

Before you begin, ensure that you've:

* Set up an x402 seller with `@x402/express` or `@x402/core` using
  `x402ResourceServer`.
* Installed [Node.js](https://nodejs.org/) v18+.

## Steps

<Steps>
  <Step title="Install the SDK">
    ```shell theme={null}
    npm install @circle-fin/x402-batching @x402/evm
    ```
  </Step>

  <Step title="Wire in Gateway settlement alongside your existing facilitator">
    Add `BatchFacilitatorClient` alongside your existing `HTTPFacilitatorClient`.
    Each facilitator handles a different payment type. Your existing
    facilitator continues to handle standard onchain payments, and
    `BatchFacilitatorClient` handles Gateway payments:

    ```ts theme={null}
    import { x402ResourceServer } from "@x402/express";
    import { HTTPFacilitatorClient } from "@x402/core/server";
    import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";

    const server = new x402ResourceServer([
      new HTTPFacilitatorClient({ url: "https://facilitator.example.com" }),
      new BatchFacilitatorClient(),
    ]);
    ```
  </Step>

  <Step title="Advertise Gateway options in your 402 responses">
    Replace `ExactEvmScheme` with `GatewayEvmScheme`. `GatewayEvmScheme` extends
    `ExactEvmScheme`, so standard onchain payments continue to work. It also
    preserves the `extra` metadata (such as `verifyingContract`) that Gateway
    clients need for EIP-712 signing:

    ```ts theme={null}
    import { GatewayEvmScheme } from "@circle-fin/x402-batching/server";

    server.register("eip155:*", new GatewayEvmScheme());
    await server.initialize();
    ```

    After initialization, the server's `402` responses include Gateway
    nanopayment options in the `accepts` array alongside any options your
    existing facilitator supports.

    <Tip>
      If you don't have an existing onchain payment setup or are a new seller,
      you can add onchain payment support by connecting to an existing x402
      facilitator using `HTTPFacilitatorClient`. See the
      [x402 documentation](https://docs.x402.org/) for a list of available
      facilitators.
    </Tip>
  </Step>

  <Step title="Route through a custom facilitator (optional)">
    If you run your own x402 facilitator that supports Gateway (see
    [facilitator integration](/gateway-nanopayments/howtos/facilitator-integration)),
    you can route payments through it instead of connecting to Circle Gateway
    directly. Use `facilitatorUrl` with `createGatewayMiddleware`:

    ```ts theme={null}
    import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

    const gateway = createGatewayMiddleware({
      sellerAddress: "0xSELLER_ADDRESS",
      facilitatorUrl: "https://your-facilitator.com",
    });
    ```
  </Step>

  <Step title="Check your balance and withdraw">
    After buyers pay for your resources, funds accumulate in your Gateway
    balance. Use `GatewayClient` to check your earnings using the
    [Get Token Balances](/api-reference/gateway/all/get-token-balances) API
    endpoint and withdraw using the
    [Create Transfer Attestation](/api-reference/gateway/all/create-transfer-attestation)
    API endpoint:

    ```ts theme={null}
    import { GatewayClient } from "@circle-fin/x402-batching/client";

    const client = new GatewayClient({
      chain: "arcTestnet",
      privateKey: process.env.PRIVATE_KEY as `0x${string}`,
    });

    const balances = await client.getBalances();
    console.log(`Available: ${balances.gateway.formattedAvailable} USDC`);
    console.log(`Total: ${balances.gateway.formattedTotal} USDC`);
    ```

    <Warning>
      This example uses one or more private keys for local testing. In production,
      use a secure key management solution and never expose or share private keys.
    </Warning>

    Withdraw to your wallet on the same blockchain or to a different one:

    ```ts theme={null}
    await client.withdraw("50");

    await client.withdraw("50", { chain: "baseSepolia" });
    ```

    To trace individual payments back to the requests that triggered them, see
    [Reconcile nanopayments](/gateway-nanopayments/howtos/x402-seller-reconciliation).

    <Note>
      Gateway handles settlement automatically. When you call `settle()` in the
      middleware, the payment is submitted for batched processing. Your Gateway
      `available` balance increases after the batch settles onchain.
    </Note>
  </Step>

  <Step title="Verify the integration">
    Send an unauthenticated request to a protected route to trigger a `402`
    response, then inspect the `PAYMENT-REQUIRED` header:

    ```bash theme={null}
    curl -si http://localhost:3000/protected-resource | grep -i "^payment-required:"
    ```

    The header value is a base64-encoded JSON payload. After decoding, the
    `accepts` array should include an entry where `extra.name` is
    `"GatewayWalletBatched"`:

    ```json theme={null}
    { "extra": { "name": "GatewayWalletBatched" }, ... }
    ```

    If both standard and Gateway entries appear in `accepts`, the server is
    correctly offering both payment methods.
  </Step>
</Steps>
