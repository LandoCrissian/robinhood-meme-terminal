# RMT commodity evidence registry V0 implementation

**Status:** IMPLEMENTATION AND NON-BROADCAST REHEARSAL PROOF — NOT ARCHITECTURE AUTHORITY  
**Network boundary:** Robinhood Chain testnet only (`chainId 46630`)  
**Evidence boundary:** checked-in synthetic helium fixtures only  
**Deployment status:** not deployed  
**Merge status:** not authorized

## Purpose

This tranche implements the smallest testable proof from the helium RWA research: a non-token registry that can bind separately signed issuer, custodian, and attestor claims to an exact synthetic physical lot, evidence version, chain, verifying contract, validity window, and set of document commitments.

It is designed to answer one narrow technical question:

> Can RMT publish an append-only, adversarially testable record of what a physical-commodity evidence package claims without creating a token or pretending the claim is a real commodity right?

The answer is implemented only for synthetic test data. This work does not establish title, custody, reserves, legal rights, redemption, regulatory compliance, producer participation, Robinhood endorsement, organizational independence, or market value.

## Explicit non-capabilities

`RMTCommodityEvidenceRegistryV0` has no:

- ERC-20, ERC-721, ERC-1155, ERC-3525, or ERC-3643 interface;
- mint, burn, transfer, approval, allowance, balance, or supply function;
- payment, treasury, fee, settlement, swap, AMM, auction, RFQ, oracle, or price function;
- commodity purchase, storage, delivery, redemption, or title-transfer function;
- upgrade, proxy, arbitrary-call, rescue, sweep, or delegatecall path;
- RMT token entitlement, revenue right, backing claim, or economic-policy change;
- production or mainnet admission;
- public RMT UI integration.

Direct native-value transfers and unknown fallback calls revert.

## Files

- `packages/contracts/src/RMTCommodityEvidenceRegistryV0.sol`
  - testnet-chain-bound registry;
  - EIP-712 evidence digest;
  - EOA and ERC-1271 signature verification;
  - separate issuer, custodian, and attestor role identities;
  - append-only versions and nonce monotonicity;
  - physical-lot collision prevention;
  - proposed, verified, stale, disputed, suspended, closed, and superseded states;
  - evidence and party liveness read methods.

- `packages/contracts/test/RMTCommodityEvidenceRegistryV0.t.sol`
  - primary valid-path and adversarial coverage.

- `packages/contracts/test/RMTCommodityEvidenceRegistryV0Hardening.t.sol`
  - proves a suspended batch head cannot be bypassed with a new evidence version;
  - proves a superseded record cannot be relabeled closed;
  - proves a disputed head can still be corrected by a newly signed evidence version.

- `packages/contracts/test/fixtures/commodity-evidence/synthetic-helium-public-manifest-v0.json`
  - public synthetic fixture with an explicit no-rights disclaimer.

- `packages/contracts/test/fixtures/commodity-evidence/synthetic-helium-full-manifest-v0.json`
  - expanded synthetic fixture used only to prove separate public/full document commitments.

- `packages/contracts/script/BuildSyntheticCommodityEvidenceV0.s.sol`
  - read-only Foundry signing utility;
  - uses public synthetic fixture keys;
  - reads the checked-in fixtures, builds the envelope, computes the registry-specific digest, and produces three role signatures;
  - contains no broadcast, deployment, publication, environment-secret, or transaction-submission call.

- `packages/contracts/script/RehearseSyntheticCommodityEvidenceRegistryV0.s.sol`
  - deterministic simulation-only deployment and configuration rehearsal;
  - deploys a registry inside the Foundry simulation, registers the three public synthetic signing addresses, configures the synthetic instrument, and verifies the resulting state;
  - has no `startBroadcast`, `broadcast`, environment-secret, wallet, or transaction-submission interface.

- `packages/contracts/test/RMTCommodityEvidenceRegistryV0Rehearsal.t.sol`
  - verifies the complete synthetic rehearsal configuration;
  - verifies the rehearsal refuses every chain other than `46630`.

- `packages/contracts/deployments/rmt-commodity-evidence-registry-v0.template.json`
  - deliberately undeployed manifest template;
  - all addresses, transaction hashes, block numbers, and runtime hashes remain unset;
  - every deployment, broadcast, merge, real-inventory, and token authorization flag defaults to `false`.

## Core invariants

### No rights are created

Every accepted envelope must use the fixed synthetic no-rights and non-transferable policy hashes:

```text
rightsVersionHash = keccak256("RMT_SYNTHETIC_NO_RIGHTS_V0")
transferPolicyHash = keccak256("RMT_SYNTHETIC_NON_TRANSFERABLE_V0")
```

The contract is not a document of title and is not evidence that a real commodity exists.

### Exact domain binding

Each evidence digest is bound through EIP-712 to:

- `chainId 46630`;
- the exact registry contract address;
- the registry name and version;
- the full structured evidence envelope.

A signature created for another chain or another registry instance must fail.

### Role separation and its limit

The configured issuer, custodian, and attestor must use distinct registered party IDs and distinct registered signing addresses. Each signature carries an explicit role and party ID. EOA and ERC-1271 signing addresses are supported.

This is protocol-surface role separation only. It does **not** prove that the signing addresses have different beneficial owners, different organizations, different personnel, independent judgment, independent key custody, or independent devices. A real-world pilot would require offchain identity, authority, conflict, and key-control verification that this contract cannot perform.

### Append-only evidence history

For each instrument/batch key:

- evidence versions begin at 1 and increase by exactly one;
- nonces increase monotonically;
- the previous version remains readable;
- a new version marks the prior version superseded rather than deleting it;
- a closed, suspended, or already superseded head cannot be silently reactivated;
- a superseded historical record cannot later be relabeled closed;
- a disputed head may be corrected by a newly signed evidence version, preserving both the dispute and replacement history.

A stored suspension is intentionally fail-closed in V0. There is no resume function. A future revision would require an explicit, reviewed transition rather than allowing signers to bypass an administrator-recorded suspension by incrementing the version.

### Physical-lot collision prevention

A nonzero `physicalLotKey` is permanently associated with its first instrument/batch key. A second instrument or renamed batch cannot claim the same lot key.

This is a synthetic demonstration of collision detection, not proof that a real operator has supplied a globally unique lot identifier.

### Verification fails closed

Only the synthetic `NotApplicableSynthetic` encumbrance state can receive the V0 `Verified` stored status. Unknown, clear-within-scope, pledged, sold, tokenized, disputed, or offtake-related states remain `Proposed` in this synthetic contract rather than being upgraded by implication.

A currently verified record becomes effectively:

- `Stale` after its evidence deadline;
- `Suspended` if a required party is no longer active;
- `Disputed`, `Suspended`, `Closed`, or `Superseded` when the corresponding state has been recorded.

## Validation commands

From the repository root:

```bash
bash packages/contracts/scripts/install-v4-deps.sh
cd packages/contracts
forge fmt --check \
  src/RMTCommodityEvidenceRegistryV0.sol \
  test/RMTCommodityEvidenceRegistryV0.t.sol \
  test/RMTCommodityEvidenceRegistryV0Hardening.t.sol \
  test/RMTCommodityEvidenceRegistryV0Rehearsal.t.sol \
  script/BuildSyntheticCommodityEvidenceV0.s.sol \
  script/RehearseSyntheticCommodityEvidenceRegistryV0.s.sol
forge test --match-path test/RMTCommodityEvidenceRegistryV0.t.sol -vvv
forge test --match-path test/RMTCommodityEvidenceRegistryV0Hardening.t.sol -vvv
forge test --match-path test/RMTCommodityEvidenceRegistryV0Rehearsal.t.sol -vvv
forge test -vvv
forge build
```

The repository-wide CI, contract suite, static analysis, secret scan, and diff checks remain the authority for pull-request validation. No passing status should be claimed until the latest PR head is green.

## Non-broadcast rehearsal

A local Anvil rehearsal must use the target chain ID and must omit every broadcast flag:

Terminal one:

```bash
anvil --chain-id 46630
```

Terminal two:

```bash
cd packages/contracts
forge script script/RehearseSyntheticCommodityEvidenceRegistryV0.s.sol:RehearseSyntheticCommodityEvidenceRegistryV0 \
  --rpc-url http://127.0.0.1:8545 \
  --sig "run()" \
  -vvv
```

The rehearsal script has no broadcast function and reads no private environment value. It creates only simulated state. A command containing `--broadcast` is outside this tranche and is not authorized.

## Signing utility boundary

The signing utility deliberately contains short, public, synthetic-only private-key constants. They must never be funded or reused. The utility does not call `startBroadcast`, `broadcast`, `publishEvidence`, or any deployment function.

It may only be used against a separately authorized registry instance on Robinhood Chain testnet. This implementation tranche does not authorize that deployment.

## Future testnet deployment gate

A later testnet deployment requires a separate explicit owner authorization and, before any broadcast:

1. green latest-head CI and contract tests;
2. final source, state-machine, bytecode-size, and runtime review;
3. successful deterministic non-broadcast rehearsal evidence;
4. an explicitly approved administrator address and revocation procedure;
5. proof that only synthetic fixtures and public test keys are used;
6. a completed deployment manifest with expected creation/runtime hashes and expected address;
7. an explorer source-verification plan;
8. a funded testnet-only deployer whose key is never committed or shared;
9. no production environment, mainnet, token, or UI change.

A testnet deployment would still create no real commodity right and would not authorize a token.

## Real-world pilot gate

No part of this implementation is admitted for real inventory. A real pilot remains blocked on executed legal, custody, title, encumbrance, quantity, quality, insurance, transfer-policy, AML/KYC, redemption, and insolvency architecture, plus an independent owner decision.

## Codex coexistence

This branch was synchronized with current `main` before the hardening and rehearsal tranche. Its changes remain confined to the isolated registry contract, focused contract tests, synthetic fixtures, non-broadcast Foundry utilities, undeployed manifest template, and this implementation note.

It does not modify VNext, web routes, wallet behavior, providers, execution, fees, indexers, CI configuration, environment files, search distribution, production health, `ARCHITECTURE_FREEZE.md`, or `ACTIVE_SYSTEM_MAP.md`.

No merge, deployment, UI integration, public announcement, producer outreach, custodian outreach, Robinhood outreach, or token issuance is authorized by this document.
