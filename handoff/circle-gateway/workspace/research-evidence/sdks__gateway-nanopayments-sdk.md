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

# Gateway Nanopayments SDK reference

> Reference for the @circle-fin/x402-batching SDK: buyer and seller integrations for Gateway Nanopayments

This page documents the public API of the `@circle-fin/x402-batching` package,
which provides buyer and seller integrations for Circle Gateway nanopayments.

```shell theme={null}
npm install @circle-fin/x402-batching
```

## Buyer APIs

### `GatewayClient`

```ts theme={null}
import { GatewayClient } from "@circle-fin/x402-batching/client";
```

The primary client for buyers. Handles deposits, gasless payments, withdrawals,
and balance queries.

#### Constructor

```ts theme={null}
new GatewayClient(config: GatewayClientConfig)
```

| Parameter | Type | Required | Description |
| - | - | - | - |
| `config.chain` | `SupportedChainName` | Yes | Blockchain to connect to (for example, `'arcTestnet'`, `'baseSepolia'`) |
| `config.privateKey` | `Hex` | Yes | Private key for signing (`'0x...'`) |
| `config.rpcUrl` | `string` | No | Custom RPC URL (overrides the default for the chain) |

#### Properties

| Property | Type | Description |
| - | - | - |
| `address` | `Address` | The account's wallet address |
| `chainName` | `string` | Human-readable chain name |
| `domain` | `number` | Gateway domain identifier |
| `publicClient` | `PublicClient` | viem public client instance |
| `walletClient` | `WalletClient` | viem wallet client instance |

#### `deposit(amount, options?)`

Deposits USDC from your wallet into the Gateway Wallet contract. This is an
onchain transaction that requires gas.

| Parameter | Type | Required | Description |
| - | - | - | - |
| `amount` | `string` | Yes | Amount in decimal USDC (for example, `'10.5'`) |
| `options.approveAmount` | `string` | No | ERC-20 approval amount (defaults to `amount`) |

Returns `Promise<DepositResult>`:

```ts theme={null}
interface DepositResult {
  approvalTxHash?: Hex;
  depositTxHash: Hex;
  amount: bigint;
  formattedAmount: string;
}
```

#### `pay<T>(url, options?)`

Pays for an x402-protected resource. Handles the full `402` negotiation flow
automatically: sends the request, receives payment requirements, signs the
authorization, and retries with the payment header.

| Parameter | Type | Required | Description |
| - | - | - | - |
| `url` | `string` | Yes | URL of the x402-protected resource |
| `options` | `RequestInit` | No | Standard fetch options (method, body, headers) |

Returns `Promise<PayResult<T>>`:

```ts theme={null}
interface PayResult<T> {
  data: T;
  amount: bigint;
  formattedAmount: string;
  transaction: string;
  status: number;
}
```

#### `withdraw(amount, options?)`

Withdraws USDC from Gateway to your wallet. Supports same-chain (instant) and
crosschain withdrawals.

| Parameter | Type | Required | Description |
| - | - | - | - |
| `amount` | `string` | Yes | Amount in decimal USDC |
| `options.chain` | `SupportedChainName` | No | Destination blockchain (defaults to same chain) |
| `options.recipient` | `Address` | No | Recipient address (defaults to your address) |

Returns `Promise<WithdrawResult>`:

```ts theme={null}
interface WithdrawResult {
  mintTxHash: Hex;
  amount: bigint;
  formattedAmount: string;
  sourceChain: string;
  destinationChain: string;
  recipient: Address;
}
```

#### `getBalances(address?)`

Returns both the wallet's USDC balance and the Gateway balance.

| Parameter | Type | Required | Description |
| - | - | - | - |
| `address` | `Address` | No | Address to query (defaults to the client's address) |

Returns `Promise<Balances>`:

```ts theme={null}
interface Balances {
  wallet: { balance: bigint; formatted: string };
  gateway: GatewayBalance;
}

interface GatewayBalance {
  total: bigint;
  available: bigint;
  withdrawing: bigint;
  withdrawable: bigint;
  formattedTotal: string;
  formattedAvailable: string;
}
```

#### `supports(url)`

Checks whether a URL supports Gateway batching before attempting payment.

| Parameter | Type | Required | Description |
| - | - | - | - |
| `url` | `string` | Yes | URL to check |

Returns `Promise<SupportsResult>`:

```ts theme={null}
interface SupportsResult {
  supported: boolean;
  requirements?: Record<string, unknown>;
  error?: string;
}
```

#### `getTransferById(id)`

Fetches a single x402 transfer by its UUID.

| Parameter | Type | Required | Description |
| - | - | - | - |
| `id` | `string` | Yes | UUID of the transfer to fetch |

Returns `Promise<TransferResponse>`:

```ts theme={null}
type TransferStatus =
  "received" | "batched" | "confirmed" | "completed" | "failed";

interface TransferResponse {
  id: string;
  status: TransferStatus;
  token: "USDC";
  sendingNetwork: string;
  recipientNetwork: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  nonce: string;
  txHash: string | null;
  createdAt: string;
  updatedAt: string;
}
```

#### `searchTransfers(params?)`

Searches x402 transfers with optional filters and paginated results. When
`network` is omitted, the client defaults to its own blockchain. When you
provide `status`, also provide `from`, `to`, or `nonce` to narrow the search.

| Parameter | Type | Required | Description |
| - | - | - | - |
| `params.from` | `Hex` | No | Filter by sender address |
| `params.to` | `Hex` | No | Filter by recipient address |
| `params.nonce` | `Hex` | No | Filter by EIP-3009 nonce |
| `params.network` | `string` | No | CAIP-2 network ID (defaults to the client's blockchain) |
| `params.status` | `TransferStatus` | No | Filter by status; requires `params.from`, `params.to`, or `params.nonce` |
| `params.token` | `'USDC'` | No | Filter by token type |
| `params.startDate` | `string` | No | ISO-8601 date; include transfers created on or after this date |
| `params.endDate` | `string` | No | ISO-8601 date; include transfers created on or before this date |
| `params.pageSize` | `number` | No | Number of results per page |
| `params.pageAfter` | `string` | No | Cursor for the next page |
| `params.pageBefore` | `string` | No | Cursor for the previous page |

Returns `Promise<SearchTransfersResponse>`:

```ts theme={null}
interface SearchTransfersResponse {
  transfers: TransferResponse[];
  pagination?: CursorPagination;
}

interface CursorPagination {
  self?: string;
  first?: string;
  prev?: string;
  next?: string;
  pageAfter?: string;
  pageBefore?: string;
}
```

`self`, `first`, `prev`, and `next` are full pagination URLs parsed from the
HTTP `Link` header. `pageAfter` and `pageBefore` are the cursor values extracted
from those URLs, which you can pass back into `searchTransfers()` when
requesting the next or previous page.

Use `pagination.pageAfter` or `pagination.pageBefore` to request adjacent pages.

***

### `BatchEvmScheme`

```ts theme={null}
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
```

A `SchemeNetworkClient` implementation for Circle Gateway batched payments. Use
this when integrating with an existing `x402Client` instance or building a
custom payment flow.

#### Constructor

```ts theme={null}
new BatchEvmScheme(signer: BatchEvmSigner)
```

| Parameter | Type | Required | Description |
| - | - | - | - |
| `signer` | `BatchEvmSigner` | Yes | Object with `address` and `signTypedData` function |

#### `createPaymentPayload(x402Version, paymentRequirements)`

Creates a signed payment payload by constructing and signing an EIP-3009
`TransferWithAuthorization` message.

| Parameter | Type | Required | Description |
| - | - | - | - |
| `x402Version` | `number` | Yes | x402 protocol version (use `2`) |
| `paymentRequirements` | `PaymentRequirements` | Yes | Requirements from the `402` response |

Returns `Promise<PaymentPayload>`.

***

### `CompositeEvmScheme`

```ts theme={null}
import { CompositeEvmScheme } from "@circle-fin/x402-batching/client";
```

Routes payment requests between Gateway batched payments and standard onchain
payments. Use this when your client needs to support both payment methods
simultaneously.

#### Constructor

```ts theme={null}
new CompositeEvmScheme(batchScheme: BatchEvmScheme, fallbackScheme: SchemeNetworkClient)
```

| Parameter | Type | Required | Description |
| - | - | - | - |
| `batchScheme` | `BatchEvmScheme` | Yes | Handles Gateway batched payments |
| `fallbackScheme` | `SchemeNetworkClient` | Yes | Handles standard onchain payments (must use the `'exact'` scheme) |

#### Behavior

* If the payment requirements include `extra.name === "GatewayWalletBatched"`,
  delegates to `batchScheme`.
* Otherwise, delegates to `fallbackScheme`.

#### Usage

```ts theme={null}
import { ExactEvmScheme } from "@x402/evm/exact/client";
import {
  CompositeEvmScheme,
  BatchEvmScheme,
} from "@circle-fin/x402-batching/client";

const composite = new CompositeEvmScheme(
  new BatchEvmScheme(signer),
  new ExactEvmScheme(signer),
);

client.register("eip155:*", composite);
```

***

### `registerBatchScheme`

```ts theme={null}
import { registerBatchScheme } from "@circle-fin/x402-batching/client";
```

Helper that registers a `BatchEvmScheme` with an `x402Client`. If you need to
support both Gateway and standard onchain `exact` payments, pass a
`fallbackScheme` so one registration handles both paths:

```ts theme={null}
import { ExactEvmScheme } from "@x402/evm/exact/client";

registerBatchScheme(client, {
  signer: account,
  fallbackScheme: new ExactEvmScheme(account),
});
```

***

## Seller APIs

### `createGatewayMiddleware`

```ts theme={null}
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
```

Creates Express-compatible middleware that handles x402 payment negotiation,
verification, and settlement.

#### Configuration

```ts theme={null}
createGatewayMiddleware(config: GatewayMiddlewareConfig)
```

| Parameter | Type | Required | Description |
| - | - | - | - |
| `config.sellerAddress` | `string` | Yes | Your wallet address for receiving payments |
| `config.networks` | `string \| string[]` | No | Networks to accept (defaults to all supported) |
| `config.facilitatorUrl` | `string` | No | Custom facilitator URL for verify/settle. Routes through this facilitator instead of Circle Gateway directly. |
| `config.description` | `string` | No | Resource description included in `402` responses |

#### `require(price)`

Returns Express middleware that requires payment for the route.

| Parameter | Type | Description |
| - | - | - |
| `price` | `string` | Price in USD (for example, `'$0.01'` or `'0.01'`) |

The middleware attaches payment information to `req.payment`:

```ts theme={null}
interface PaymentInfo {
  verified: boolean;
  payer: string;
  amount: string;
  network: string;
  transaction?: string;
}
```

#### Lifecycle hooks

The middleware exposes chainable hooks that let you observe or influence the
payment flow at each stage: request arrival, verification, settlement, and
cancellation. The hook signatures mirror the
[standard x402 lifecycle hooks](https://docs.x402.org/advanced-concepts/lifecycle-hooks),
but each hook receives a Gateway-specific context shape.

Register hooks on the object returned from `createGatewayMiddleware`. Each
method returns the same object, so registrations can be chained:

```ts theme={null}
const gateway = createGatewayMiddleware({
  sellerAddress: "0xYourSellerAddress",
});

gateway
  .onProtectedRequest(async (ctx) => {
    /* inspect request headers, path, or method */
  })
  .onAfterSettle(async (ctx) => {
    /* record settlement metadata */
  });
```

| Hook | Fires when | Context |
| - | - | - |
| `onProtectedRequest` | A request hits a paid route, before payment handling | `method`, `path`, `url`, `getHeader(name)` |
| `onBeforeVerify` | Before the middleware verifies a payment signature | `paymentPayload`, `requirements` |
| `onAfterVerify` | The verify call returns (valid or invalid) | `paymentPayload`, `requirements`, `result` |
| `onVerifyFailure` | The verify call threw | `paymentPayload`, `requirements`, `error` |
| `onBeforeSettle` | Before settlement is submitted to Gateway | `paymentPayload`, `requirements` |
| `onAfterSettle` | The settle call returns (success or failure) | `paymentPayload`, `requirements`, `result` (with `transaction`) |
| `onSettleFailure` | The settle call threw | `paymentPayload`, `requirements`, `error` |
| `onVerifiedPaymentCanceled` | A verified payment never reaches settlement | `paymentPayload`, `requirements`, `reason`, `error` |

Some hooks accept return values that change the flow:

* `onBeforeVerify` and `onBeforeSettle` can return `{ abort: true, reason }` to
  halt processing or `{ skip: true, result }` to substitute a canned response.
* `onAfterVerify` can return `{ skipHandler: true, response }` to skip the
  protected handler after successful verification.
* `onVerifyFailure` and `onSettleFailure` can return
  `{ recovered: true, result }` to replace the error with a result.
* All other hooks return `void`.

The `paymentPayload` context field carries the decoded EIP-3009 authorization
under `paymentPayload.payload.authorization`, which is where the payment's
`nonce`, `from`, `to`, and `value` fields live. `paymentPayload.resource?.url`
identifies the resource the buyer paid for. `onAfterSettle` is a common place to
record payment metadata for later reconciliation. See
[Reconcile nanopayments](/gateway-nanopayments/howtos/x402-seller-reconciliation)
for a worked example.

If a hook throws, the SDK logs the failure and continues with the next
registered hook. Payment processing is not interrupted.

***

### `BatchFacilitatorClient`

```ts theme={null}
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
```

A `FacilitatorClient` implementation that communicates with Circle Gateway's
x402 endpoints. Use this for custom server frameworks or when you need
fine-grained control over verification and settlement.

#### Constructor

```ts theme={null}
new BatchFacilitatorClient(config?: BatchFacilitatorConfig)
```

#### `verify(payload, requirements)`

Verifies a payment signature through the Gateway API.

| Parameter | Type | Description |
| - | - | - |
| `payload` | `PaymentPayload` | The payment payload from the client |
| `requirements` | `PaymentRequirements` | The payment requirements you declared |

Returns `Promise<VerifyResponse>`:

```ts theme={null}
interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}
```

#### `settle(payload, requirements)`

Submits a payment for batched settlement through the Gateway API. This is the
recommended method for production flows because it has low latency and
guarantees settlement.

| Parameter | Type | Description |
| - | - | - |
| `payload` | `PaymentPayload` | The payment payload from the client |
| `requirements` | `PaymentRequirements` | The payment requirements you declared |

Returns `Promise<SettleResponse>`:

```ts theme={null}
interface SettleResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
}
```

#### `getSupported()`

Fetches the payment kinds (networks and contract addresses) supported by
Gateway.

Returns `Promise<SupportedResponse>`:

```ts theme={null}
interface SupportedResponse {
  kinds: Array<{
    x402Version: number;
    scheme: string;
    network: string;
    extra?: { verifyingContract?: string };
  }>;
}
```

***

### `GatewayEvmScheme`

```ts theme={null}
import { GatewayEvmScheme } from "@circle-fin/x402-batching/server";
```

Server-side EVM scheme that extends `ExactEvmScheme` with Gateway-specific
behavior. Required when using `x402ResourceServer` with
`BatchFacilitatorClient`.

#### Constructor

```ts theme={null}
new GatewayEvmScheme();
```

No parameters required. On construction, it automatically registers USDC money
parsers for all Gateway-supported networks.

#### Key behaviors

* **`enhancePaymentRequirements()`**: Merges `extra` metadata
  (`verifyingContract`, `name`, `version`) from supported kinds into payment
  requirements. Sets `maxTimeoutSeconds` to `604900` (7 days plus a small
  buffer) for batched settlement.
* **USDC money parsers**: Automatically converts dollar amounts to USDC atomic
  units (6 decimals) for all supported networks using the USDC addresses from
  `CHAIN_CONFIGS`.

<Note>
  The base `ExactEvmScheme` discards the `extra` field from supported kinds when
  building payment requirements. Gateway clients require `extra.verifyingContract`
  to construct valid EIP-712 signatures. `GatewayEvmScheme` preserves this data.
</Note>

#### Usage

```ts theme={null}
import { x402ResourceServer } from "@x402/express";
import {
  BatchFacilitatorClient,
  GatewayEvmScheme,
} from "@circle-fin/x402-batching/server";

const server = new x402ResourceServer([new BatchFacilitatorClient()]);
server.register("eip155:*", new GatewayEvmScheme());
await server.initialize();
```

***

## Utilities

### `supportsBatching`

```ts theme={null}
import { supportsBatching } from "@circle-fin/x402-batching";
```

Checks whether a `PaymentRequirements` object supports Gateway batched
settlement. Returns `true` if the requirements include the
`GatewayWalletBatched` scheme.

### `isBatchPayment`

```ts theme={null}
import { isBatchPayment } from "@circle-fin/x402-batching/server";
```

Server-side alias for `supportsBatching`. Use this in facilitator routing logic
to determine whether a payment should be routed to Gateway.

### `getVerifyingContract`

```ts theme={null}
import { getVerifyingContract } from "@circle-fin/x402-batching";
```

Extracts the Gateway Wallet contract address from a `PaymentRequirements`
object.

***

## Constants

```ts theme={null}
import {
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_VERSION,
  CIRCLE_BATCHING_SCHEME,
} from "@circle-fin/x402-batching";
```

| Constant | Value | Description |
| - | - | - |
| `CIRCLE_BATCHING_NAME` | `'GatewayWalletBatched'` | EIP-712 domain name used for batch payment signatures |
| `CIRCLE_BATCHING_VERSION` | `'1'` | EIP-712 domain version |
| `CIRCLE_BATCHING_SCHEME` | `'exact'` | x402 payment scheme identifier |

***

## Chain configuration

```ts theme={null}
import {
  CHAIN_CONFIGS,
  GATEWAY_DOMAINS,
} from "@circle-fin/x402-batching/client";
```

* `CHAIN_CONFIGS`: Full configuration (USDC address, Gateway Wallet address, RPC
  URL) for all supported blockchains, keyed by `SupportedChainName`.
* `GATEWAY_DOMAINS`: Gateway domain IDs for EIP-712 signing, keyed by chain
  name.

Use these constants to retrieve the correct addresses programmatically instead
of hardcoding them:

```ts theme={null}
import {
  CHAIN_CONFIGS,
  GATEWAY_DOMAINS,
} from "@circle-fin/x402-batching/client";

// Retrieve chain configuration for Arc Testnet
const config = CHAIN_CONFIGS["arcTestnet"];
// config.gatewayWallet → "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
// config.usdc → "0x3600000000000000000000000000000000000000"

const domainId = GATEWAY_DOMAINS["arcTestnet"]; // → 26
```

For reference, the Gateway Wallet and USDC contract addresses for each chain are
listed in the [EVM contract addresses](/gateway/references/contract-addresses)
and [USDC contract addresses](/stablecoins/usdc-contract-addresses) pages.

***

## Error reference

### Gateway API error codes

These are the `errorReason` (settle) and `invalidReason` (verify) values
returned by the Gateway API:

| Error code | Cause | Recovery |
| - | - | - |
| `unsupported_scheme` | Scheme is not `exact` | Only the `exact` scheme is supported |
| `unsupported_network` | Network not supported for batching | Use a supported network |
| `unsupported_asset` | Token address not recognized on this blockchain | Use the correct USDC address for the network |
| `invalid_payload` | Malformed payment payload | Check EIP-712 signature fields |
| `address_mismatch` | Authorization `to` address does not match `payTo` | Ensure the payment is addressed to the correct seller |
| `amount_mismatch` | Authorization `value` does not match required `amount` | Ensure the signed amount matches the price |
| `invalid_signature` | EIP-3009 signature verification failed | Re-sign the payment and check the signing key matches `from` |
| `authorization_not_yet_valid` | Authorization `validAfter` is in the future | Wait until the authorization becomes valid |
| `authorization_expired` | Authorization `validBefore` has passed | Create a new payment with a future expiry |
| `authorization_validity_too_short` | Validity window is shorter than 3 days | Set `validBefore` to at least 3 days in the future |
| `self_transfer` | `from` and `to` are the same address | Buyer and seller must be different addresses |
| `insufficient_balance` | Buyer's Gateway balance is too low | Deposit more USDC before paying |
| `nonce_already_used` | Payment nonce was already submitted | Create a new payment (each payment needs a unique nonce) |
| `unsupported_domain` | Gateway domain not configured for this blockchain | Check network configuration |
| `wallet_not_found` | Gateway Wallet contract not found on this blockchain | Verify contract addresses for the network |
| `unexpected_error` | Infrastructure error (HTTP 500) | Retry the request and contact support if the error persists |

### `GatewayClient` errors

All errors are thrown as standard `Error` objects with descriptive messages.

| Error message | Cause | Recovery |
| - | - | - |
| `Unsupported chain: {chain}` | Invalid `SupportedChainName` passed to the constructor | Use a valid chain name from the chain configuration table |
| `Request failed with status {N}` | Non-402, non-2xx response from the server | Check server status and URL |
| `Missing PAYMENT-REQUIRED header in 402 response` | Server returned 402 without the required header | Verify the server uses x402 v2 |
| `No payment options in 402 response` | Empty `accepts` array in the 402 response | The server may not have configured payment options |
| `No Gateway batching option available` | Server does not support Gateway batching | Use `supports()` to check first; the server may only accept onchain |
| `Payment failed: {reason}` | Server rejected the payment | Check the Gateway API error code in the message |
| `Insufficient USDC balance` | Wallet USDC balance is less than the deposit amount | Get more USDC from the faucet or transfer from another wallet |
| `Approval transaction failed: {txHash}` | USDC approval transaction reverted onchain | Check gas, wallet balance, and network status |
| `Deposit transaction failed: {txHash}` | Deposit transaction reverted onchain | Check gas and contract state |
| `Insufficient available balance` | Gateway balance is too low for the withdrawal | Deposit more or reduce the amount |
| `Unsupported destination chain: {chain}` | Invalid chain name for crosschain withdrawal | Use a valid `SupportedChainName` |
| `Gateway getTransferById failed ({status}): {details}` | Cannot fetch transfer by ID | Verify the transfer UUID and API connectivity |
| `Gateway searchTransfers failed ({status}): {details}` | Transfer search endpoint returned an error | Validate filters and check API connectivity |

### Middleware errors

| Error message | Cause | Recovery |
| - | - | - |
| `Invalid price: {price}` | Price string could not be parsed | Use format `'$0.01'` or `'0.01'` |
| `No payment networks available` | No supported networks found (503 response) | Check Gateway API connectivity |
| `Payment verification failed` | Verify returned `isValid: false` | Check the Gateway API error code in the response body `reason` field |
| `Payment settlement failed` | Settle returned `success: false` | Check the Gateway API error code in the response body `reason` field |

### `BatchFacilitatorClient` errors

| Error message | Cause | Recovery |
| - | - | - |
| `Circle Gateway verify failed ({status}): {details}` | Verify endpoint returned an unexpected response | Check payload format and API status |
| `Circle Gateway settle failed ({status}): {details}` | Settle endpoint returned an unexpected response | Retry the request and contact support if the error persists |
| `Circle Gateway settle returned empty response ({status})` | Empty body from settle endpoint | Retry the request |
| `Circle Gateway getSupported failed ({status}): {details}` | Cannot fetch supported networks | Check API connectivity and URL |

### `BatchEvmScheme` errors

| Error message | Cause | Recovery |
| - | - | - |
| `BatchEvmScheme: unsupported network format "{network}"` | Network string is not in `eip155:<chainId>` format | Use CAIP-2 format (for example, `eip155:5042002`) |
| `BatchEvmScheme can only handle Circle batching options` | Payment requirements missing `extra.name="GatewayWalletBatched"` | Use this scheme only for Gateway payments |
| `Circle batching option missing extra.verifyingContract` | Payment requirements missing the Gateway Wallet address | Ensure the server includes `verifyingContract` in `extra` |
