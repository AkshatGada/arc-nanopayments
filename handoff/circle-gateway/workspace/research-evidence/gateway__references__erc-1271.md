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

# ERC-1271 programmable authorization

> How Gateway validates smart contract signatures with ERC-1271, including the offchain TEE and RPC quorum security model, usage, and limitations.

Gateway supports programmable authorization through
[ERC-1271](https://eips.ethereum.org/EIPS/eip-1271). Smart contracts and smart
contract accounts (SCAs) can authorize transfers directly with their own
validation logic. You can access a unified USDC balance from a multisig,
role-based permission system, passkey, administrator key, or any other
deterministic authorization model.

## What ERC-1271 enables

An Externally Owned Account (EOA) proves authorization with a cryptographic
signature from its associated private key. Because smart contracts don't have a
private key, they can't produce signatures in the same way. ERC-1271 solves this
with a standard function `isValidSignature(bytes32 hash, bytes signature)` that
contracts can implement to decide whether a signature is valid. Verifiers call
the validation function instead of recovering the cryptographic signer directly.

This enables more complex authorization logic that can be programmed into the
smart contract. Common examples include:

* Multisig wallets that require a threshold of signers
* Role-based or policy-based permission systems
* Passkey-based smart accounts
* Contracts that enforce allowlists, spending limits, or compliance checks
  before approving an action

Gateway can validate ERC-1271 signatures directly, so you don't need to add a
delegate or redesign how your application authorizes transfers.

## How ERC-1271 validation works

<Steps>
  <Step title="Submit the burn intent">
    You submit a burn intent to the Gateway
    [`/v1/transfer`](/api-reference/gateway/all/create-transfer-attestation)
    endpoint with the `contractSigner: true` flag and the contract's signature.
  </Step>

  <Step title="Validate the signature in a TEE">
    Gateway routes the request to a validation service, deployed as an AWS Nitro
    Enclave that validates the signature at request time. The enclave queries
    multiple independent blockchain RPC providers and simulates the contract's
    `isValidSignature` response against a recent target block height.
  </Step>

  <Step title="Reach RPC quorum">
    If a quorum of RPCs (at least 2 of 3) agree that the signature is valid, the
    validation service signs off on the request and the Gateway API returns the
    attestation as usual.
  </Step>

  <Step title="Complete the burn">
    When the attestation is used, Gateway performs the burn using the validation
    service's signature. The [Gateway Wallet contract](/gateway/references/technical-guide#gateway-wallet-contracts) recognizes the
    validation service signature and completes burns validated this way.
  </Step>
</Steps>

From your application's perspective, the request and response are the same as an
EOA transfer. The Trusted Execution Environment (TEE) and RPC quorum are
internal mechanisms that let Gateway extend its offchain validation guarantee to
contract signatures.

## Security model

ERC-1271 validation runs inside a Trusted Execution Environment (TEE) so that
Circle can't unilaterally control which signatures are accepted. The security
model relies on three components.

### Trusted execution environment (TEE)

A Trusted Execution Environment (TEE) is an isolated hardware enclave that runs
code in a secure, tamper-proof environment. Gateway uses an AWS Nitro Enclave to
validate the ERC-1271 signature, query the RPC quorum, and sign the burn intent
with the enclave's private key.

The enclave's signing key is protected by AWS Key Management Service (KMS) with
attestation-based access policies. Only the audited enclave image can access the
key. Circle can't access the signing key or extract it outside the enclave.

### Independent RPC quorum

The enclave validates each signature against a quorum of independent blockchain
RPC providers. Circle can't independently modify the quorum logic or the set of
RPC providers the enclave uses, because both are fixed in the audited enclave
image. In particular, Circle can't make its own RPCs the sole validator of a
request: a request is only accepted when a quorum of the enclave's independent
providers agree that the signature is valid.

### Cryptographic attestations

AWS Nitro Enclaves produce cryptographic attestation documents that prove the
enclave is running a specific, audited code image. These attestations can be
independently verified, providing transparency into the validation process.

## Opting into ERC-1271 validation

Requests that opt into ERC-1271 validation include `contractSigner: true`
alongside the burn intent and signature in each item of the
[`/v1/transfer`](/api-reference/gateway/all/create-transfer-attestation)
payload:

```json theme={null}
[
  {
    "burnIntent": { "...": "..." },
    "signature": "0x...",
    "contractSigner": true
  }
]
```

The burn intent's `sourceSigner` is the address of the signing contract, and the
`signature` is produced by that contract's ERC-1271 authorization logic. When
`contractSigner` is omitted or `false`, Gateway validates the signature as a
standard EOA signature.

For a complete walkthrough that signs a burn intent with a Circle smart contract
account, see
[How-to: Transfer USDC from a smart contract account](/gateway/howtos/transfer-with-erc-1271).

## Limitations and considerations

* **EVM-only:** ERC-1271 validation is supported only on EVM blockchains.
* **Read-only validation:** The validation service simulates `isValidSignature`
  offchain, so authorization logic that modifies onchain state during validation
  isn't supported.
* **Timing:** The validation service ensures that simulation is done against
  recent blocks. The validation service can validate signatures using blocks up
  to 5 minutes old. This means that it may take up to 5 minutes for key rotation
  or revocation transactions to apply.
* **RPC trust assumptions:** Gateway uses a quorum of multiple node operators on
  each request to mitigate incorrect responses, but Gateway can't guarantee that
  each RPC performed the validation correctly or that an RPC's network security
  wasn't compromised.
* **You remain responsible for your signing setup:** As with EOAs, using Gateway
  with ERC-1271 doesn't guarantee that your contract's authorization logic is
  secure. Depositors using insecure ERC-1271 implementations can have their
  balances drained. Be sure to audit and secure your signing setup.

<Note>
  Gateway Nanopayments, part of Circle Agent Stack, isn't available through
  ERC-1271. Nanopayment burn intents are batched and submitted through ERC-3009
  requests, which use a different validation path.
</Note>
