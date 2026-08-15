# RMT commodity evidence registry V0 implementation

**Status:** SYNTHETIC IMPLEMENTATION AND NON-BROADCAST RELEASE PREPARATION — NOT ARCHITECTURE AUTHORITY  
**Network boundary:** Robinhood Chain testnet only (`chainId 46630`)  
**Evidence boundary:** checked-in synthetic commodity fixtures only  
**Deployment status:** not deployed  
**Merge status:** not authorized  
**Pull request:** draft PR #372

## Purpose

This tranche implements the smallest adversarially testable proof for the RMT Physical Asset Evidence Protocol: a non-token registry that can bind separately signed issuer, custodian, and attestor claims to an exact synthetic physical lot, evidence version, quantity statement, validity window, chain, verifying contract, and document commitments.

It answers one narrow technical question:

> Can RMT publish an append-only, machine-inspectable record of what a physical-commodity evidence package claims without creating a token or pretending that the claim itself establishes a real commodity right?

The answer is implemented only for synthetic test data. This work does not establish physical existence, title, custody, reserve sufficiency, legal rights, redemption, regulatory compliance, organizational independence, producer participation, Robinhood endorsement, or market value.

## Explicit non-capabilities

`RMTCommodityEvidenceRegistryV0` has no:

- ERC-20, ERC-721, ERC-1155, ERC-3525, or ERC-3643 interface;
- mint, burn, transfer, approval, allowance, balance, or supply function;
- payment, treasury, fee, settlement, swap, AMM, auction, RFQ, oracle, or price function;
- commodity purchase, storage, delivery, redemption, or title-transfer function;
- upgrade, proxy, arbitrary-call, rescue, sweep, or delegatecall path;
- RMT-token entitlement, revenue right, backing claim, or economic-policy change;
- real-inventory admission path;
- production or mainnet admission;
- public RMT UI integration.

Direct native-value transfers and unknown fallback calls revert.

## Current implementation surface

### Registry contract

`packages/contracts/src/RMTCommodityEvidenceRegistryV0.sol` provides:

- permanent Robinhood Chain testnet binding;
- EIP-712 evidence envelopes bound to the exact chain and registry address;
- EOA and ERC-1271 signature verification;
- separate issuer, custodian, and attestor party identities and signing accounts;
- append-only evidence versions and monotonic nonces;
- replay prevention;
- local physical-lot collision prevention across batches and instruments;
- proposed, verified, stale, disputed, suspended, closed, and superseded states;
- automatic loss of effective verification when evidence expires or the required party quorum becomes inactive;
- immutable no-rights and non-transferable synthetic policy commitments.

### Focused test suites

- `packages/contracts/test/RMTCommodityEvidenceRegistryV0.t.sol`
  - valid publication and primary adversarial coverage;
  - chain and verifying-contract replay protection;
  - EOA/ERC-1271 signing;
  - unknown-encumbrance fail-closed behavior;
  - lot collision, status, freshness, and no-token probes.

- `packages/contracts/test/RMTCommodityEvidenceRegistryV0Hardening.t.sol`
  - suspended and closed batch heads cannot be bypassed with a new version;
  - superseded records cannot be relabeled closed;
  - disputed heads can be corrected while retaining the disputed history and replacement commitments.

- `packages/contracts/test/RMTCommodityEvidenceRegistryV0Create2Readiness.t.sol`
  - CREATE2 prediction, runtime, domain, constructor, wrong-chain, duplicate-deployment, and zero-administrator boundaries.

- `packages/contracts/test/RMTCommodityEvidenceRegistryV0DeploymentScripts.t.sol`
  - one authoritative CREATE2 preparation path;
  - one authoritative completed-record deployment verifier;
  - no private-key, mnemonic, remote-send, or broadcast surface;
  - no reintroduction of removed direct-CREATE or obsolete verifier paths;
  - false authorization flags in the undeployed release template.

- `packages/contracts/test/RMTCommodityEvidenceRegistryV0Postflight.t.sol`
  - exact synthetic post-deployment topology and rejection of wrong runtime, administrator, chain, or configuration.

- `packages/contracts/test/RMTCommodityEvidenceRegistryV0Rehearsal.t.sol`
  - complete simulation-only deployment/configuration rehearsal and wrong-chain rejection.

### Synthetic fixtures and utilities

- `packages/contracts/test/fixtures/commodity-evidence/synthetic-helium-public-manifest-v0.json`
- `packages/contracts/test/fixtures/commodity-evidence/synthetic-helium-full-manifest-v0.json`
- `packages/contracts/script/BuildSyntheticCommodityEvidenceV0.s.sol`
- `packages/contracts/script/RehearseSyntheticCommodityEvidenceRegistryV0.s.sol`
- `packages/contracts/script/VerifySyntheticCommodityEvidenceRegistryV0.s.sol`

The signing utility uses public synthetic fixture keys only. The rehearsal and postflight utilities contain no broadcast or remote transaction-submission interface.

### Release preparation and verification

- `packages/contracts/scripts/prepare-rmt-commodity-evidence-registry-v0.py`
- `packages/contracts/scripts/_prepare-rmt-commodity-evidence-registry-v0-impl.py`
- `packages/contracts/scripts/verify-rmt-commodity-evidence-registry-v0-deployment.sh`
- `packages/contracts/scripts/verify-rmt-commodity-evidence-registry-v0-sources.sh`
- `packages/contracts/deployments/rmt-commodity-evidence-registry-v0.template.json`

The only supported future deployment preparation is a source-bound transaction packet for the pinned canonical singleton CREATE2 deployer. The former pending-nonce direct-CREATE preparation and the older lightweight deployment verifier were removed. No signing or broadcast command is provided.

### Architecture analysis

`docs/RMT_PHYSICAL_ASSET_EVIDENCE_SCHEMA_ARCHITECTURE_V0.md` records the current generalization decision:

- retain the working single-registry V0 security boundary;
- treat the current envelope as the commodity-neutral evidence core;
- place helium-specific requirements in immutable commodity schemas;
- place real-world sufficiency rules in versioned admission policies;
- keep legal/economic instruments independent from evidence records;
- do not split V0 into multiple contracts merely for architectural symmetry.

## Core invariants

### No rights are created

Every accepted envelope must use the fixed synthetic no-rights and non-transferable policy hashes:

```text
rightsVersionHash = keccak256("RMT_SYNTHETIC_NO_RIGHTS_V0")
transferPolicyHash = keccak256("RMT_SYNTHETIC_NON_TRANSFERABLE_V0")
```

The registry is not a document of title and is not evidence that a real commodity exists.

### Exact domain binding

Each evidence digest is bound through EIP-712 to:

- `chainId 46630`;
- the exact registry contract address;
- the registry name and version;
- the full structured evidence envelope.

A signature produced for another chain or another registry instance must fail.

### Role separation and its limit

The configured issuer, custodian, and attestor use distinct registered party IDs and distinct registered signing accounts. Each signature carries an explicit role and party ID.

This is protocol-surface role separation only. Distinct addresses do not prove distinct legal organizations, beneficial owners, personnel, independent judgment, or independent key custody. A real pilot requires offchain identity, authority, conflict, credential, and control-group verification.

### Append-only history

For each instrument/batch key:

- evidence versions begin at 1 and increase by exactly one;
- nonces increase monotonically;
- every historical version remains readable;
- replacement supersedes rather than deletes the prior record;
- a closed, suspended, or already superseded head cannot be silently reactivated;
- a disputed head may be replaced by newly signed corrective evidence while the dispute remains inspectable.

### Local physical-lot collision prevention

A nonzero `physicalLotKey` is associated with its first instrument/batch key. A second instrument or renamed batch cannot claim the same key inside this registry.

This is a local collision control. It does not establish a globally unique real-world lot identity or prevent another registry, chain, issuer-derived key, lien, pledge, sale, or offchain instrument from referencing the same physical asset.

### Verification fails closed

Only the explicit synthetic `NotApplicableSynthetic` encumbrance state can receive V0's stored `Verified` status. Unknown or real-world classifications remain `Proposed` rather than becoming verified by implication.

A currently verified synthetic record becomes effectively:

- `Stale` after its evidence deadline;
- `Suspended` if a required party is no longer active;
- `Disputed`, `Suspended`, `Closed`, or `Superseded` when the corresponding state has been recorded.

## One authoritative deployment mechanism

The preparation path uses the pinned canonical singleton CREATE2 deployer and commits:

- administrator;
- exact source and compiler inputs;
- constructor arguments;
- salt;
- creation-code and initcode hashes;
- predicted registry address;
- expected runtime-code hash;
- chain ID;
- expected EIP-712 domain separator;
- locally rehearsed gas;
- exact unsigned deployment calldata;
- exact unsigned synthetic configuration calldata.

A pending-nonce direct-CREATE route would make the predicted address and address-bound EIP-712 domain depend on mutable wallet state. It is therefore not an alternative release path.

## CI and repository isolation

The branch adds one dedicated, read-only commodity-evidence workflow and narrowly scoped Foundry read permissions for checked-in fixtures, scripts, and deployment templates. The dedicated gate:

- validates Python, shell, and JSON release files;
- enforces one CREATE2 release mechanism and false authorization boundaries;
- rejects formatting drift after uploading an exact diagnostic patch;
- runs every `RMTCommodityEvidenceRegistryV0*.t.sol` suite.

Repository-wide CI, the complete Foundry suite, production build, static analysis, secret scanning, mainnet-readiness guards, and existing regression workflows remain required before any latest-head green claim.

The branch also carries current `main` terminal changes through normal merge commits, but the physical-asset diff itself does not modify VNext routes, wallets, execution, Agent Engine/Arena, indexers, fee behavior, token economics, production environment files, `ARCHITECTURE_FREEZE.md`, or `ACTIVE_SYSTEM_MAP.md`.

## Reproduction

From the repository root:

```bash
bash packages/contracts/scripts/install-v4-deps.sh
cd packages/contracts

forge fmt --check \
  src/RMTCommodityEvidenceRegistryV0.sol \
  test/RMTCommodityEvidenceRegistryV0.t.sol \
  test/RMTCommodityEvidenceRegistryV0Hardening.t.sol \
  test/RMTCommodityEvidenceRegistryV0Rehearsal.t.sol \
  test/RMTCommodityEvidenceRegistryV0Create2Readiness.t.sol \
  test/RMTCommodityEvidenceRegistryV0DeploymentScripts.t.sol \
  test/RMTCommodityEvidenceRegistryV0Postflight.t.sol \
  script/BuildSyntheticCommodityEvidenceV0.s.sol \
  script/RehearseSyntheticCommodityEvidenceRegistryV0.s.sol \
  script/VerifySyntheticCommodityEvidenceRegistryV0.s.sol

forge test --match-path 'test/RMTCommodityEvidenceRegistryV0*.t.sol' -vvv
forge test -vvv
forge build
```

Passing validation does not authorize deployment, configuration, evidence publication, source publication, merge, UI integration, or public release.

## Real-world gate

No part of V0 is admitted for real inventory. A future real pathway remains blocked on, at minimum:

- legally defined holder rights;
- title, custody, segregation, bailment, perfection, and insolvency analysis;
- commodity-specific measurement, reference-condition, calibration, quality, and uncertainty rules;
- encumbrance, offtake, prior-sale, assignment, and prior-tokenization evidence;
- qualified and independent party identity/credential requirements;
- insurance and loss allocation;
- admission-policy evaluation;
- transfer, eligibility, AML/KYC, redemption, delivery, tax, and jurisdictional design;
- cross-registry and offchain double-use controls.

The evidence layer must remain independent from any later token or other digital instrument.

## Authorization boundary

This implementation authorizes no:

- testnet or mainnet deployment;
- transaction signing or broadcast;
- party registration or instrument configuration;
- evidence or source publication;
- merge or auto-merge;
- real commodity record;
- token issuance or RMT-token rights change;
- production UI or environment change;
- producer, custodian, Robinhood, regulator, or partner outreach.

PR #372 must remain draft until the owner separately authorizes a later action.
