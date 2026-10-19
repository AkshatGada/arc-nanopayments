# Local Circle testnet run evidence

This directory is the **test harness**, separate from the Rust seller. Read
`../gateway-axum-seller/LIVE_TESTNET.txt` for the result and limitations.

SDK versions are pinned in `package-lock.json`. Arc RPC is explicitly
`https://rpc.testnet.arc.io`; chain ID must be `5042002`. Funds came only from
Circle's public testnet faucet. The deposit was capped at 0.1 test USDC and
the logical purchase at 0.001 test USDC.

Do not rerun the deposit or payment scripts for this completed/accepted run.
Their exclusive marker files intentionally prevent resubmission. If a process
failed or timed out, inspect the saved nonce/transfer before considering any
new payment. The initial authorization was rejected before admission due to
missing resource MIME metadata, and later explicitly failed the remaining
validity check. The corrected authorization is the accepted transfer.

Read-only checks can be repeated:

```sh
node reconcile.mjs           # accepted/corrected nonce, if present
node reconcile.mjs --initial # rejected initial nonce
node poll-transfer.mjs       # follow accepted transfer and verify its batch
```

`paid-result-final.json` records the actual seller HTTP result and receipt.
`transfer-latest.json` records the last Circle transfer state. If present,
`onchain-settlement-proof.json` contains the verified batch receipt, matching
fresh-wallet balance deltas, and final Gateway balances. A transfer UUID alone
does not establish onchain confirmation.

Private keys and signed payloads are in the ignored `.secrets/` directory;
do not upload or copy it into public evidence. `run.json` contains only public
addresses and test policy. Sanitized evidence is copied into the Rust example's
`live-test-evidence/` directory. No mainnet transactions or withdrawals are
part of this run.
