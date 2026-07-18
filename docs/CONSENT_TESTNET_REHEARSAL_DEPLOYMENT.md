# Consent migration testnet rehearsal deployment

This runbook is the only approved path for deploying the isolated `RMTTestnetSushiV3RehearsalVenue` and `RMTTestnetSushiV3ConsentStack`. It is a **valueless Robinhood Chain Testnet rehearsal**, not an official Sushi deployment, not a production AMM, and not authorization to migrate user assets.

The migrator must remain paused throughout deployment, verification, source publication, and product review. Do not add an unpause or migration transaction to this runbook.

## Fixed release identity

- Network: Robinhood Chain Testnet (`46630`)
- RPC: `https://rpc.testnet.chain.robinhood.com/`
- Operator, governance signer, and guardian: `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`
- Canonical CREATE2 deployer: `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- CREATE2 deployer runtime hash: `0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989`
- Terms document: `docs/CONSENT_MIGRATION_TESTNET_TERMS_V1.md`
- Terms document Keccak-256: `0x236ed1f849548c61a923152a92dc91593f22a6e2ff3d176a4b0db38b3b2d2b57`
- Pool fee: `3000`
- Tick spacing: `60`
- Governance delay: `86400` seconds
- Governance execution window: `604800` seconds
- Compiler: Solidity `v0.8.26+commit.8a97fa7a`, Cancun EVM, optimizer enabled with 200 runs, `viaIR: true`

The deployment creates exactly ten contracts that must be recorded and independently checked: venue, governance, paired token, rehearsal WETH, factory, pool, position manager, consent stack, session, and migrator.

## Before either wallet approval

1. Start from a clean reviewed commit and record its full 40-character commit ID. Do not deploy uncommitted contract changes.
2. Run the contract formatting, build, size, and complete test gates. Both **encoded** constructor payloads must remain below the EIP-3860 limit of 49,152 bytes.
3. Run `packages/contracts/scripts/verify-consent-testnet-terms.sh` and confirm the exact terms hash above.
4. Confirm the wallet is the fixed operator, the wallet network is chain `46630`, and only valueless test ETH is present.
5. Confirm the canonical CREATE2 deployer has exactly 69 bytes of runtime code and the fixed runtime hash above.
6. Copy `packages/contracts/deployments/robinhood-testnet-consent-rehearsal.template.json` to a dated, non-template JSON filename in the same directory. Do not overwrite the template.
7. Record the reviewed source commit and SHA-256 of `packages/contracts/src/RMTTestnetSushiV3RehearsalStack.sol` before approval.

Never enter a private key, seed phrase, or recovery phrase into a command, environment variable, page, chat, or deployment record. Both transactions are approved in the operator's wallet.

## Transaction 1 — valueless rehearsal venue

Open the operator-only `/deploy-consent-testnet` page from the reviewed build. Before approving, independently record:

- venue CREATE2 salt;
- Keccak-256 of the complete encoded venue initcode, including the operator constructor argument;
- predicted venue address;
- operator address and chain ID shown by the wallet.

Approve only a zero-value transaction from the fixed operator to the canonical CREATE2 deployer. After confirmation, record the transaction hash and exact block number. The venue transaction creates the venue plus governance, two fixed-supply tokens, one-pool factory, immutable sink pool, and minimal rehearsal position manager.

Do not send native currency or any real token to any resulting address.

## Transaction 2 — paused consent stack

The second CREATE2 salt is bound to the deployed venue. Before approving, independently record:

- consent-stack CREATE2 salt;
- Keccak-256 of the complete encoded consent-stack initcode, including operator and venue arguments;
- predicted consent-stack address;
- that the destination is still the canonical CREATE2 deployer and the transaction value is zero.

Approve only after transaction 1 is confirmed and the venue's `operator()` equals the fixed operator. Record the second transaction hash and exact block number. The consent-stack constructor atomically creates the session and migrator and rejects deployment unless the migrator starts paused with its expected bindings.

## Complete the durable record

Fill every non-template field in the copied JSON record. The record must contain:

- exact source repository, source commit, contract-source SHA-256, compiler settings, and deployment UTC time;
- both CREATE2 transactions, receipt block numbers, salts, full-initcode hashes, and predicted/deployed addresses;
- all ten contract addresses and live runtime code hashes;
- configuration hash, terms-document hash, migration-terms hash, and `paused: true`;
- a verification snapshot block at or after the second receipt block;
- source-verification status for each of the ten contracts.

Set `release.status` to `deployed-paused` while source verification is pending. After the read-only verifier passes and exact source records are published, set it to `verified-paused`, set `verification.result` to `passed`, add `verification.verifiedAtUtc`, and run the verifier again before committing the record.

## Read-only post-deployment verification

From `packages/contracts`, with the same reviewed repository available:

```bash
ROBINHOOD_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com/ \
  ./scripts/verify-consent-testnet-deployment.sh \
  ./deployments/<dated-record>.json
```

The verifier accepts no wallet material and sends no transaction. It checks the record schema, chain, exact operator and source commit evidence, both CREATE2 transaction inputs and receipts, deterministic addresses, all ten runtime hashes, topology, fixed supplies, governance policy, independently derived configuration and terms hashes, and both snapshot and current paused state.

Publish exact compiler/source records for all ten contracts on the testnet explorer. A bytecode-only explorer label is not source verification. Preserve the compiler version, optimizer, optimizer runs, `via_ir`, EVM version, constructor arguments, and reviewed source commit alongside the deployment record.

The source-verification script first reruns the full read-only deployment verifier, reads the exact constructor values from the ten live contracts, and then submits each exact FQN and encoded constructor payload to the testnet Blockscout legacy API with Solidity `0.8.26`, 200 optimizer runs, `viaIR`, Cancun, and `--watch`:

```bash
./scripts/verify-consent-testnet-sources.sh ./deployments/<dated-record>.json --dry-run
./scripts/verify-consent-testnet-sources.sh ./deployments/<dated-record>.json
```

The dry run compiles and validates all ten standard JSON inputs without publishing. The live command publishes Solidity source code, constructor arguments, and compiler metadata to the public testnet explorer; it sends no blockchain transaction and requires no wallet material. Run live mode only from the exact recorded source commit. After all explorer records are confirmed, update each JSON `sourceVerification` field to `verified`, set the release and verification fields to `verified-paused`/`passed`, and rerun both verifiers.

## Failure, quarantine, and abandonment rules

- If any preflight check differs, **do not broadcast**. Fix the cause in a new reviewed commit and restart the runbook.
- A wallet rejection before broadcast changes no chain state. Resume only after reconfirming the fixed operator, chain, destination, value, salt, initcode hash, and predicted address.
- If a receipt reverts, stop. Record the failed transaction separately and do not repeatedly resubmit it without a documented root cause and a newly reviewed release decision.
- If a predicted address already contains unexpected code, abandon that release identity and salts. Never attempt to use or overwrite the address.
- If transaction 1 succeeds but transaction 2 does not, classify the venue as an inert partial deployment. Record it, send it no assets, expose no UI for it, and do not call it a completed deployment.
- If transaction 2 succeeds but any address, runtime hash, binding, receipt, configuration hash, terms hash, or paused check fails, quarantine the entire ten-contract stack. Do not unpause, migrate, publish as usable, or redeploy around the mismatch.
- If current `paused()` ever becomes false before an independently approved activation process, treat it as an incident, remove all product references, preserve chain evidence, and follow `docs/INCIDENT_RESPONSE.md`.
- Source-verification failure does not authorize replacement bytecode or a new salt. Keep the stack paused and unpublished until the exact reviewed sources verify.
- Mainnet, official Sushi contracts, bridged assets, abandoned liquidity, third-party funds, and real-value tokens are outside this runbook. Any such deployment requires a separate design, legal review, independent security review, and explicit authorization.

An abandoned or quarantined deployment is immutable chain history. Never delete its evidence; mark the durable record with the reason, keep the addresses blocked in application configuration, and create a separate record for any later reviewed attempt.
