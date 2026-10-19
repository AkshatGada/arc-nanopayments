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

# Quickstart: Accept payments with nanopayments

> Add gasless USDC payment support to your Express API using Circle Gateway

Add Circle Gateway payment middleware to an Express API so that it accepts
gasless USDC payments through the x402 protocol. The API returns
`402 Payment Required` for unpaid requests and serves resources when a valid
payment signature is provided.

## Prerequisites

Before you begin, ensure that you've:

* Installed [Node.js v22.18+](https://nodejs.org/).
* Chosen an EVM wallet address to receive USDC payments.

## Step 1: Set up your project

### 1.1. Create the project and install dependencies

```shell theme={null}
# Set up your directory and initialize a Node.js project
mkdir nanopayments-seller
cd nanopayments-seller

npm init -y

# Set up module type and start command
npm pkg set type=module
npm pkg set scripts.start="node server.ts"

# Install runtime dependencies
npm install @circle-fin/x402-batching @x402/core @x402/evm viem express typescript

# Install dev dependencies
npm install --save-dev @types/node @types/express
```

### 1.2. Configure TypeScript (optional)

<Tip>
  This step is optional. It helps prevent missing types in your IDE or editor.
</Tip>

Create a `tsconfig.json` file:

```shell theme={null}
npx tsc --init
```

Then, update the `tsconfig.json` file:

```shell theme={null}
cat <<'EOF' > tsconfig.json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["node"]
  }
}
EOF
```

## Step 2: Create the server

Create a new file `server.ts` with an Express app and the Gateway middleware:

```ts server.ts theme={null}
import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { formatUnits } from "viem";

// Extended Express Request type to include payment information
type PaidRequest = express.Request & {
  payment?: {
    verified: boolean;
    payer: string;
    amount: string;
    network: string;
    transaction?: string;
  };
};

const app = express();

const gateway = createGatewayMiddleware({
  sellerAddress: "0xYOUR_WALLET_ADDRESS",
  facilitatorUrl: "https://gateway-api-testnet.circle.com",
});
```

Replace `0xYOUR_WALLET_ADDRESS` with a valid EVM address where you want to
receive payments. This quickstart uses Arc Testnet, so it points to the testnet
Gateway API. The middleware still accepts payments from
[all supported networks](/gateway-nanopayments/supported-networks).

## Step 3: Protect a route

Use `gateway.require()` to protect any route with a price. When a request
arrives without a valid payment, the middleware returns `402 Payment Required`
with the payment details. When a valid payment signature is attached, the
middleware settles it with Gateway using the
[Settle x402 Payment](/api-reference/gateway-nanopayments/settle-x402payment)
API endpoint and calls `next()`:

```ts server.ts theme={null}
app.get("/premium-data", gateway.require("$0.01"), (req: PaidRequest, res) => {
  const { payer, amount, network } = req.payment!;
  const formattedAmount = formatUnits(BigInt(amount), 6);
  console.log(`Paid ${formattedAmount} USDC by ${payer} on ${network}`);

  res.json({
    secret: "The treasure is hidden under the doormat.",
    paid_by: payer,
  });
});

app.listen(3000, () => {
  console.log("Server listening at http://localhost:3000");
});
```

## Step 4: Test the server

### 4.1. Start the server

```shell theme={null}
npm start
```

### 4.2. Send an unpaid request

In a separate terminal, use `curl` to verify the server returns a `402`
response:

```shell theme={null}
curl -i http://localhost:3000/premium-data
```

You should see a `402 Payment Required` response with a `PAYMENT-REQUIRED`
header. The header contains the payment options.

### 4.3. Pay with a buyer client

Use the [buyer quickstart](/gateway-nanopayments/quickstarts/buyer) client to
make a gasless payment to your server:

```ts theme={null}
import { GatewayClient } from "@circle-fin/x402-batching/client";

const client = new GatewayClient({
  chain: "arcTestnet",
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

const { data, status } = await client.pay("http://localhost:3000/premium-data");
console.log(`Status: ${status}`);
console.log("Data:", data);
```

If the payment succeeds, you'll see the JSON response from your protected
endpoint. If it's rejected, the
[error reference](/sdks/gateway-nanopayments-sdk#error-reference) covers each
error code, including `insufficient_funds`, `expired_authorization`,
`invalid_payload`, and `invalid_signature`. Each entry explains the cause and
how to recover. To attribute settled payments back to the requests that
triggered them, see
[Reconcile nanopayments](/gateway-nanopayments/howtos/x402-seller-reconciliation).

## Handle payments without the middleware (advanced)

If you are not using Express, or need custom logic like dynamic pricing, use the
`BatchFacilitatorClient` directly. The `settle()` method calls the
[Settle x402 Payment](/api-reference/gateway-nanopayments/settle-x402payment)
API endpoint:

```ts server.ts expandable theme={null}
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";

const facilitator = new BatchFacilitatorClient({
  url: "https://gateway-api-testnet.circle.com",
});

const requirements = {
  scheme: "exact",
  network: "eip155:5042002", // CAIP-2 identifier for Arc Testnet (chain ID 5042002)
  asset: "0x...", // USDC contract address on Arc Testnet — see supported chains reference
  amount: "10000", // 0.01 USDC
  maxTimeoutSeconds: 604900,
  payTo: "0xYOUR_ADDRESS", // seller address that receives the payment
  extra: {
    name: "GatewayWalletBatched",
    version: "1",
    verifyingContract: "0x...", // Gateway Wallet contract on Arc Testnet — see supported chains reference
  },
};

async function handleRequest(paymentSignature?: string) {
  if (!paymentSignature) {
    const paymentRequired = {
      x402Version: 2,
      resource: {
        url: "/premium-data",
        description: "Paid resource",
        mimeType: "application/json",
      },
      accepts: [requirements],
    };

    return {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": Buffer.from(
          JSON.stringify(paymentRequired),
        ).toString("base64"),
      },
      body: {},
    };
  }

  const payload = JSON.parse(
    Buffer.from(paymentSignature, "base64").toString("utf8"),
  );

  const settlement = await facilitator.settle(payload, requirements);

  if (!settlement.success) {
    return {
      status: 402,
      body: { error: "Settlement failed" },
    };
  }

  return {
    status: 200,
    body: { data: "Your paid content" },
  };
}
```

<Note>
  Gateway's `settle()` endpoint is optimized for low latency and guarantees
  settlement. Use `settle()` directly rather than calling `verify()` followed by
  `settle()` in production flows.
</Note>

## Limit accepted networks (optional)

By default, the middleware accepts payments from any Gateway-supported
blockchain, discovered through the
[Get Supported x402 Payment Kinds](/api-reference/gateway-nanopayments/get-supported-x402payment-kinds)
API endpoint. This maximizes your reach since any buyer with a Gateway balance
on one of those accepted networks can pay you.

If you need to restrict payments to specific networks:

```ts theme={null}
const gateway = createGatewayMiddleware({
  sellerAddress: "0x...",
  networks: ["eip155:5042002"], // Only accept Arc Testnet
});
```

<Note>
  Payment signatures must have at least 7 days plus a small buffer of validity.
  The `validBefore` timestamp in the buyer's EIP-3009 authorization must be at
  least 7 days in the future, or Gateway will reject it.
</Note>
