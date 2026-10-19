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

# How-to: Sign EIP-3009 payment authorizations

> Manually construct and sign EIP-3009 TransferWithAuthorization messages for Circle Gateway batched payments

Authorize Circle Gateway to transfer USDC from your Gateway balance by signing
an EIP-3009 `TransferWithAuthorization` message directly. Sign manually when
integrating a custom payment workflow, building a non-JavaScript client, or
debugging what the SDK handles automatically.

## Prerequisites

Before you begin, ensure that you've:

* Generated an EVM wallet private key for signing.
* Deposited USDC into a Gateway Wallet contract (see the
  [buyer quickstart](/gateway-nanopayments/quickstarts/buyer)).
* Familiarized yourself with [EIP-712](https://eips.ethereum.org/EIPS/eip-712)
  typed data signing.
* Installed the [viem](https://viem.sh/) library (`npm install viem`).

## Steps

<Steps>
  <Step title="Construct the EIP-712 domain">
    Gateway uses a custom EIP-712 domain named `GatewayWalletBatched`. This is
    specific to Gateway's batching feature and is not the standard USDC domain.

    ```ts sign.ts theme={null}
    const domain = {
      name: "GatewayWalletBatched",
      version: "1",
      chainId: 5042002, // Arc Testnet — replace with your target chain's EVM chain ID
      verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", // GatewayWallet on Arc Testnet
    };
    ```

    The `verifyingContract` is the GatewayWallet contract address for the blockchain
    you are transacting on. Find the address for your target blockchain in the
    [EVM contract addresses](/gateway/references/contract-addresses) reference. You
    can also retrieve it programmatically using `getVerifyingContract()` from the
    SDK or from the `402` response's `accepts` array (in the
    `extra.verifyingContract` field).

    <Warning>
      The `chainId` must be the standard EVM chain ID for your target network (for
      example, `5042002` for Arc Testnet), not the Gateway domain identifier. Using
      the wrong chain ID causes the signature to fail silently.
    </Warning>
  </Step>

  <Step title="Define the typed data">
    The `TransferWithAuthorization` type follows the
    [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009) specification:

    ```ts sign.ts theme={null}
    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };
    ```

    Populate the message fields.

    USDC uses 6 decimal places: `$1.00` = `1000000`, `$0.01` = `10000`, `$0.001` =
    `1000`. Always convert dollar amounts to base units before signing.

    ```ts sign.ts theme={null}
    import { randomBytes } from "crypto";

    const message = {
      from: "0xYOUR_ADDRESS", // Your wallet address (the payer)
      to: "0xSELLER_ADDRESS", // The seller's wallet address
      value: 10000n, // Amount in USDC base units (0.01 USDC = 10000)
      validAfter: 0n, // Signature is valid immediately
      validBefore: BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 5), // Valid for 5 days
      nonce: `0x${randomBytes(32).toString("hex")}`, // Unique random nonce
    };
    ```

    <Warning>
      The `validBefore` timestamp must be at least 3 days in the future. Gateway
      rejects signatures with shorter validity periods to ensure there is enough time
      to include them in a settlement batch.
    </Warning>
  </Step>

  <Step title="Sign the typed data">
    Use the `viem` library's `signTypedData` to produce the EIP-712 signature:

    ```ts sign.ts theme={null}
    import { privateKeyToAccount } from "viem/accounts";

    const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

    const signature = await account.signTypedData({
      domain,
      types,
      primaryType: "TransferWithAuthorization",
      message,
    });

    console.log("Signature:", signature);
    ```
  </Step>

  <Step title="Assemble and send the payment payload">
    Encode the payment payload as base64 JSON and attach it to your HTTP request in
    the `Payment-Signature` header. The server-side facilitator settles this payment
    through the
    [Settle x402 Payment](/api-reference/gateway-nanopayments/settle-x402payment)
    API endpoint:

    ```ts sign.ts theme={null}
    const paymentPayload = {
      x402Version: 2,
      payload: {
        authorization: {
          from: message.from,
          to: message.to,
          value: message.value.toString(),
          validAfter: message.validAfter.toString(),
          validBefore: message.validBefore.toString(),
          nonce: message.nonce,
        },
        signature,
      },
      resource: "...", // from 402 response
      accepted: {}, // the payment option chosen
    };

    const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

    const response = await fetch("http://localhost:3000/premium-data", {
      headers: {
        "Payment-Signature": encoded,
      },
    });

    console.log("Status:", response.status);
    console.log("Body:", await response.json());
    ```
  </Step>
</Steps>

## Alternative: sign through the x402 client scheme

If you are integrating with an existing x402 client (such as `@x402/core`), use
`BatchEvmScheme` instead of constructing the payload manually. It handles domain
construction, nonce generation, and payload encoding:

```ts sign-x402.ts theme={null}
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";

const batchScheme = new BatchEvmScheme({
  address: account.address,
  signTypedData: async (params) => account.signTypedData(params),
});

// Get requirements from a 402 response
const res = await fetch(url);
const header = res.headers.get("PAYMENT-REQUIRED");
const { accepts } = JSON.parse(Buffer.from(header, "base64").toString());
const gatewayOption = accepts.find(
  (opt) => opt.extra?.name === "GatewayWalletBatched",
);

// Create the payment payload
const payload = await batchScheme.createPaymentPayload(2, gatewayOption);

// Retry with the payload
const finalResponse = await fetch(url, {
  headers: {
    "Payment-Signature": Buffer.from(
      JSON.stringify({ ...payload, accepted: gatewayOption }),
    ).toString("base64"),
  },
});
```

## Troubleshoot rejected signatures

Gateway returns `invalid_signature` for any EIP-712 domain or field mismatch
without specifying which field is wrong. If your signature is rejected, check
every item in this list:

* **Domain name** must be exactly `"GatewayWalletBatched"`. Common mistakes
  include `"GatewayWallet"`, `"Gateway"`, and `"USDC"`.
* **`verifyingContract`** must be the GatewayWallet contract address, not the
  USDC token address or GatewayMinter. See
  [EVM contract addresses](/gateway/references/contract-addresses) for the
  correct address on each blockchain.
* **`chainId`** must be the standard EVM chain ID (for example, `5042002` for
  Arc Testnet). Do not use the Gateway domain identifier.
* **`nonce`** must be a unique random 32-byte value for every payment. Reusing a
  nonce causes the same `invalid_signature` error.
* **`validBefore`** must be at least 3 days in the future. Shorter validity
  periods are rejected with `authorization_validity_too_short`.
* **`value`** must be in USDC base units (6 decimals). Passing a dollar amount
  instead of base units causes an amount mismatch.
* **`from`** must match the address derived from the private key that signed the
  message.

For the full list of error codes, see the
[error reference](/sdks/gateway-nanopayments-sdk#gateway-api-error-codes).

<Note>
  The EIP-712 domain for payment authorizations (`GatewayWalletBatched`) is
  different from the domain used for Gateway withdrawal and crosschain transfer
  operations (`GatewayWallet`). If you are building manual signing for both
  payments and withdrawals, use the correct domain for each operation. The SDK's
  `client.withdraw()` and `client.pay()` methods handle this automatically.
</Note>
