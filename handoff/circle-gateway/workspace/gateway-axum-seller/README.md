# Native Rust/Axum Gateway seller

A small, testnet-only seller using **existing x402-rs middleware** and Circle's
hosted Gateway Nanopayments API. `GET /quote` costs 1,000 USDC atomic units
($0.001) by default. The route returns a read-only quote after Gateway accepts
payment. This server has no wallet private key and implements no cryptography.

The x402-rs dependencies are pinned to upstream revision
`e75adda8a0e3cf23db446883ba91b88bbab2fe28`. This independent Cargo workspace avoids
unrelated Aptos dependencies and does not modify any upstream crate. Requires
Rust 1.93 or newer; the included lockfile was resolved with Rust 1.94.1.

## Run the offline demonstration

Fetch/build once (requires public GitHub/crates.io access):

```sh
cd /Users/akshat/circle/gateway-axum-seller
cargo fetch --locked
cargo build --locked --example mock_gateway
cargo build --locked
```

Terminal 1 starts the **fake** facilitator, bound only to loopback:

```sh
cargo run --offline --locked --example mock_gateway
```

Terminal 2 starts the actual seller against that mock:

```sh
SELLER_ADDRESS=0x1111111111111111111111111111111111111111 \
GATEWAY_FACILITATOR_URL=http://127.0.0.1:4020/v1/x402/ \
cargo run --offline --locked
```

Terminal 3 exercises both HTTP servers:

```sh
python3 scripts/offline_smoke.py
```

The smoke script refuses a seller that does not report loopback mock mode. It
uses a fake signature and demonstrates `402 -> synthetic acceptance -> 200`.
There are no keys, deposits, RPC requests, real payments or onchain settlement.
Stop both servers with Ctrl-C.

## Connect a seller to Circle testnet

```sh
SELLER_ADDRESS=0xYourActualReceiveAddress \
PUBLIC_URL=https://your-public-testnet-service.example/ \
cargo run --locked
```

Replace the address and public origin. Environment variables are read directly;
`.env.example` lists the settings but is not loaded automatically. Startup only
performs the read-only `/supported` request. See [LIVE_TESTNET.txt](LIVE_TESTNET.txt)
for the separately recorded live Circle testnet run and settlement status.

| Setting | Default / constraint |
| --- | --- |
| `SELLER_ADDRESS` | Required nonzero 20-byte EVM receive address |
| `GATEWAY_NETWORK` | `eip155:5042002` (Arc Testnet); also supports Base Sepolia `eip155:84532` |
| `PRICE_ATOMIC` | `1000`; integer between 1 and 1,000,000, with six USDC decimals |
| `GATEWAY_FACILITATOR_URL` | `https://gateway-api-testnet.circle.com/v1/x402/`; HTTP loopback mocks also allowed |
| `GATEWAY_TIMEOUT_MS` | `5000`; 10–30,000 ms, no automatic settlement retries |
| `BIND_ADDRESS` | `127.0.0.1:3000` |
| `PUBLIC_URL` | `http://127.0.0.1:3000/`; HTTPS public origin or HTTP loopback origin |

The configured network must be advertised by the facilitator as x402 V2
`exact` with the pinned testnet GatewayWallet address. Missing or incompatible
capabilities, HTTP failures and invalid JSON fail startup. There is no fallback
to plain x402 or mainnet. A public deployment also needs the operator's normal
HTTPS/reverse-proxy setup; `PUBLIC_URL` describes the buyer-facing origin.

`src/transport.rs` is a small Gateway-specific HTTP adapter. It disables all
redirects and automatic retries and requires **HTTP 200** before parsing a
response. This applies to startup discovery and payment calls. The pinned
generic upstream client does not expose redirect controls and also parses
400/412 responses, so the example uses its own strict transport while retaining
the existing x402-rs paygate. Capabilities are pinned at startup for the life of
this seller instance; restart to rediscover them.

## Integration boundaries

1. Startup discovers `/v1/x402/supported` and validates the configured domain.
2. An unpaid request receives a base64 JSON `PAYMENT-REQUIRED` header. The offer
   includes the USDC **asset** and a distinct GatewayWallet **verifyingContract**.
3. A Gateway-aware buyer signs and retries using `PAYMENT-SIGNATURE`.
4. x402-axum compares `accepted` against the seller's exact offer. It calls
   Circle's `/v1/x402/settle` directly before executing the handler; a separate
   `/verify` round trip is unnecessary for this flow.
5. The example checks a successful receipt's network, payer and UUID, then
   returns content and forwards `PAYMENT-RESPONSE` unchanged.

The JSON body calls the result `accepted`, with a `transferId`. Circle's
`transaction` field is a transfer UUID. **It is not an explorer transaction hash
or proof of onchain finality.** Reconciliation is a separate step using transfer
lookup: `received -> batched -> confirmed -> completed` (or `failed`), with a
nullable batch-level `txHash`. No reconciliation worker is implemented here.

The advertised resource explicitly includes `mimeType: "application/json"`.
Circle's live API requires this field even though the generic x402-rs resource
type permits omitting it. The compatibility suite checks it in the challenge.

All responses use `Cache-Control: no-store`. For a settlement rejection,
transport failure, timeout or malformed receipt, no quote is served. The pinned
upstream middleware currently emits a bare 402 for these errors; the outer
response policy replaces that with a redacted 502 and no new payment challenge.
This avoids treating an uncertain outcome as an invitation to sign a fresh
authorization. The example deliberately uses the same conservative response
for an explicit decline and an uncertain infrastructure outcome.

The paid route accepts only GET. HEAD, OPTIONS and POST are rejected before
payment processing, including when they contain a valid payment header.

**A timeout does not prove that payment failed.** Preserve the original
authorization/nonce and reconcile before any manual retry. This example has
no durable purchase store, response recovery or exactly-once guarantee. A fresh
authorization can pay again for the same logical request. Do not use the mock's
behavior as evidence of hosted replay or signature checks. The read-only route
avoids demonstrating an unrecoverable business side effect; adapting it to a
mutating endpoint requires durable admission and recovery design.

Nanopayments currently requires an EOA buyer. Standard Gateway ERC-1271 support
does not establish Nanopayments support. Solana and mainnet are outside this
example. Standard Rust `exact` buyer signing is also insufficient for Gateway;
use a Gateway-aware buyer such as Circle's batching SDK. No buyer, deposit,
withdrawal, Express proxy or generic facilitator implementation is added.

## Verify locally

```sh
cargo test --offline --locked
cargo fmt --all --check
cargo clippy --offline --locked --all-targets -- -D warnings
```

The integration tests bind ephemeral `127.0.0.1` HTTP servers. They never
contact Circle or a blockchain. They cover discovery, exact offer forwarding,
UUID receipts, no `/verify` round trip, altered terms, malformed headers,
hosted rejections, malformed successes, HTTP errors, post-submission timeouts,
configuration limits and Base Sepolia asset selection.

Transport regressions also cover success-shaped bodies on HTTP 400/412 and
other non-200 statuses, plus 301/302/303/307/308 redirects during discovery and
settlement. Two-origin tests require zero requests to the redirect destination.

Fixture provenance and limits are in [tests/fixtures/README.md](tests/fixtures/README.md).
The implementation and compatibility suite establish local behavior only.

Sources: [Circle seller integration](https://developers.circle.com/gateway-nanopayments/howtos/x402-seller),
[facilitator integration](https://developers.circle.com/gateway-nanopayments/howtos/facilitator-integration),
[reconciliation](https://developers.circle.com/gateway-nanopayments/howtos/x402-seller-reconciliation),
[x402-rs](https://github.com/x402-rs/x402-rs/tree/e75adda8a0e3cf23db446883ba91b88bbab2fe28).
