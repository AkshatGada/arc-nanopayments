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

# How-to: Reconcile nanopayments as a seller

> Attribute each settled nanopayment to the request that triggered it and reconcile Gateway transfer history

As a seller accepting nanopayments, Gateway settles them in batches, so a
completed request on your server confirms only that the payment was accepted,
not that it settled. Reconcile payments to attribute each settled nanopayment to
the request that triggered it, look up a payment's full state, or produce ledger
exports from Gateway's transfer history.

## Prerequisites

Before you begin, ensure that you've:

* Completed the [seller quickstart](/gateway-nanopayments/quickstarts/seller) or
  the [x402 seller integration](/gateway-nanopayments/howtos/x402-seller).
* Set up a datastore (database, key-value store, or ledger) where you can record
  payment metadata.

## Steps

<Steps>
  <Step title="Record settlement metadata">
    Register an [`onAfterSettle`](/sdks/gateway-nanopayments-sdk#lifecycle-hooks)
    hook to capture attribution data the moment settlement succeeds. If you
    added nanopayments to an existing x402 server
    ([using `x402ResourceServer`](/gateway-nanopayments/howtos/x402-seller)),
    register the equivalent hook on your `x402ResourceServer` instead. The
    payload and result fields are the same either way.

    ```ts theme={null}
    import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

    const gateway = createGatewayMiddleware({
      sellerAddress: "0xYourSellerAddress",
    });

    gateway.onAfterSettle(async (ctx) => {
      if (!ctx.result.success) return;

      const authorization = ctx.paymentPayload.payload.authorization as {
        from: string;
        to: string;
        nonce: string;
        value: string;
      };

      // db is pseudocode; replace with your datastore client
      await db.payments.insert({
        // resource.url is the URL the buyer paid for; encode a task or
        // request ID in the path (e.g. /tasks/abc123/output) for attribution
        resource: ctx.paymentPayload.resource?.url,
        // nonce is unique per payment; use it to look up the transfer later
        nonce: authorization.nonce,
        payer: ctx.result.payer,
        amount: ctx.requirements.amount,
        network: ctx.result.network,
        txHash: ctx.result.transaction,
        settledAt: new Date().toISOString(),
      });
    });
    ```

    If your attribution scheme relies on a request header the buyer sends
    rather than the resource URL, read the header from
    [`onProtectedRequest`](/sdks/gateway-nanopayments-sdk#lifecycle-hooks) and
    thread the value through to `onAfterSettle` using `AsyncLocalStorage` or a
    per-request context object.
  </Step>

  <Step title="Look up a payment by nonce">
    When you need the full transfer record for a single payment, look it up by
    nonce and then fetch by ID.

    ```ts theme={null}
    import { GatewayClient } from "@circle-fin/x402-batching/client";

    const client = new GatewayClient({
      chain: "arcTestnet",
      privateKey: process.env.PRIVATE_KEY as `0x${string}`,
    });

    async function lookupPayment(resourceUrl: string) {
      const record = await db.payments.findOne({ resource: resourceUrl });
      if (!record) throw new Error(`no payment recorded for ${resourceUrl}`);

      // nonce is unique per payment, so this returns at most one transfer
      const { transfers } = await client.searchTransfers({
        nonce: record.nonce as `0x${string}`,
      });

      const transferId = transfers[0]?.id;
      if (!transferId) return null;

      return client.getTransferById(transferId);
    }
    ```
  </Step>

  <Step title="Reconcile a date range">
    Using the `GatewayClient` from Step 2, search by recipient address and
    date range, paginate through the results, and match each transfer to a
    local record by nonce.

    ```ts theme={null}
    async function reconcile(
      sellerAddress: `0x${string}`,
      startDate: string,
    ): Promise<void> {
      let pageAfter: string | undefined = undefined;

      do {
        const page = await client.searchTransfers({
          to: sellerAddress,
          startDate,
          pageSize: 100,
          pageAfter,
        });

        for (const transfer of page.transfers) {
          const localRecord = await db.payments.findOne({
            nonce: transfer.nonce,
          });

          // Missing localRecord: payment received without attribution
          // Mismatched amount or status: flag for review
        }

        pageAfter = page.pagination?.pageAfter;
      } while (pageAfter);
    }
    ```

    Transfers with no matching local record are typically test payments or
    direct transfers sent outside the x402 flow.
  </Step>

  <Step title="Handle settlement outcomes">
    Before treating a payment as final, check `transfer.status`. Wait for
    `confirmed` before crediting the payer for accounting purposes and
    `completed` before initiating any dependent onchain operation. Transfers
    that end in `failed` were never charged. Do not fulfill the resource in
    that case.

    Register an `onSettleFailure` hook so failed settlements are recorded when
    they happen rather than surfaced later during reconciliation.

    ```ts theme={null}
    gateway.onSettleFailure(async (ctx) => {
      const authorization = ctx.paymentPayload.payload.authorization as {
        nonce: string;
      };

      await db.paymentFailures.insert({
        nonce: authorization.nonce,
        resource: ctx.paymentPayload.resource?.url,
        error: ctx.error.message,
        failedAt: new Date().toISOString(),
      });
    });
    ```

    Transfer status definitions are in the
    [SDK reference](/sdks/gateway-nanopayments-sdk#gettransferbyid-id).
  </Step>
</Steps>
