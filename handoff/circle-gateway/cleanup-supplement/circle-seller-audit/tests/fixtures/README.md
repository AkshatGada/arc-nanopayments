# Fixture provenance

These are **synthetic compatibility fixtures**, constructed from Circle's public
Nanopayments OpenAPI schema and the `@circle-fin/x402-batching` **3.5.0** source
maps inspected on 16 October 2026. They are not captured live API responses.

- `supported.json`: x402 V2 `exact`, Arc Testnet, GatewayWalletBatched domain.
- `accepted.json`: a transfer UUID in `transaction`, rather than an onchain hash.
- `rejected.json`: HTTP-200-style `success: false` settlement outcome.

The authorization in tests is deliberately fake. The mock does not validate
cryptography, balances, expiry or nonce uniqueness. Negative signature outcomes
can only be simulated as hosted rejections. Tests prove seller behavior against
the documented wire contract, not Circle's runtime behavior or final settlement.

Sources:

- [Circle OpenAPI](https://developers.circle.com/openapi/gateway-nanopayments.yaml)
- [SDK reference](https://developers.circle.com/sdks/gateway-nanopayments-sdk)
- [npm 3.5.0 distribution](https://registry.npmjs.org/@circle-fin/x402-batching/-/x402-batching-3.5.0.tgz)
- [Seller integration](https://developers.circle.com/gateway-nanopayments/howtos/x402-seller)

SDK 3.5.0 advertises seven days plus a 100-second buffer. This example follows
that SDK value; the manual-signing guide's three-day text remains inconsistent.
The live minimum was not established by the offline fixtures.
