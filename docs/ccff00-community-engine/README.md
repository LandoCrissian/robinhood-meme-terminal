# CCFF00 Community Engine — planning specification

**Status:** PLANNING ONLY — NOT AUTHORIZED FOR RUNTIME EXECUTION  
**Planning branch:** `planning/ccff00-community-engine-v1`  
**Runtime rule:** future implementation starts from **latest `main` on a fresh bounded branch**, never from this planning branch.

This directory is the design/handoff library for an automated CCFF00 community utility that can discover and safely acquire zero-price Robinhood Chain NFT mints, distribute them fairly to current CCFF00 holders through canonical ERC-6551 accounts, accept voluntary ETH for collector gas without buying allocation advantage, and later support RMT burn-to-use utility without programmatic RMT selling.

It does **not** override current repository authority. Before implementation, always read latest:

```text
AGENTS.md
docs/ARCHITECTURE_FREEZE.md
docs/ACTIVE_SYSTEM_MAP.md
docs/TERMINAL_COMPLETION_GATE.md
```

If community/NFT work is still paused or the owner has not explicitly opened the specific package, stop.

## Future Codex front door

Start here:

1. [`HANDOFF_INDEX_V1.md`](HANDOFF_INDEX_V1.md) — one-page handoff/index.
2. [`CODEX_START_HERE_V1.md`](CODEX_START_HERE_V1.md) — low-context package-specific read order.
3. [`CODEX_PACKAGE_MANIFEST_V1.json`](CODEX_PACKAGE_MANIFEST_V1.json) — machine-readable A–K dependencies/authorization boundaries.
4. [`CODEX_PROMPTS_V1.md`](CODEX_PROMPTS_V1.md) — copy-ready bounded prompts; use **one package prompt at a time**.
5. [`CODEX_HANDOFF_FINAL_V1.md`](CODEX_HANDOFF_FINAL_V1.md) — detailed final handoff/background.

Do not send Codex a single “build the whole Community Engine” task.

## Specification precedence

If wording appears to conflict:

1. current repository authority from latest `main`;
2. explicit later owner decision;
3. [`DECISION_REGISTER_V1.md`](DECISION_REGISTER_V1.md);
4. [`SPEC_CONSISTENCY_V1.md`](SPEC_CONSISTENCY_V1.md);
5. specialized V1 domain spec for the exact topic;
6. broad [`ARCHITECTURE_V1.md`](ARCHITECTURE_V1.md) overview;
7. examples/non-normative commentary.

For fairness, [`FAIRNESS_RANDOMNESS_V1.md`](FAIRNESS_RANDOMNESS_V1.md), [`FAIRNESS_VECTORS_V1.md`](FAIRNESS_VECTORS_V1.md), and [`DELIVERY_REPAIR_V1.md`](DELIVERY_REPAIR_V1.md) govern.

## Locked product rules

The detailed authority is [`DECISION_REGISTER_V1.md`](DECISION_REGISTER_V1.md). Core rules include:

```text
one current owner address = one V1 seat
V1 is address-fair, not one-human-one-seat
multiple Squares do not multiply allocation odds
current ownership beats original mint history
no inferred same-human wallet clustering
public CCFF00 mint range only in V1
ETH contributions create zero allocation weight
least-served-first fairness
one mint run stays inside one fairness-floor cohort
acquisition block anchors the allocation census
future randomness round is mechanically derived from fixed policy
NFT price/rarity/hype never affects recipient/token assignment
mint into isolated collector first
commit exact acquired inventory before winner/token-ID pairing
no post-acquisition cherry-picking
known positive mint adapters only
automatic mint transaction native value must equal 0
one isolated collector; no burner-wallet limit evasion
operator controls are START / STOP / WATCH PROJECT
delivery repair is deterministic; operator cannot pick replacement winner
RMT Pay utility sends RMT to 0x000000000000000000000000000000000000dEaD
no automatic RMT→ETH sale
collector gas and RMT Pay sponsorship are separate accounting rails
no RMT redeployment merely for missing burn()/permit()
no fairness reset because a database was lost
```

## Existing RMT primitives to reuse

Do not build parallel frameworks for existing capabilities:

- `apps/web/lib/vnext/distribution-ccff00.ts` — canonical CCFF00 public supply, current owners, ERC-6551 registry/implementation/salt/TBAs/runtime evidence.
- `apps/web/lib/vnext/distribution-ccff00-owner-withdrawal-proof.ts` — current owner control of exact TBA and RMT movement proof conventions.
- `apps/web/lib/vnext/distribution-domain.ts` — canonical JSON/hash/distribution evidence patterns.
- `packages/contracts/src/RMTDistributionEngineV1.sol` — NFT transfer-security reference only; **do not inherit its current RMT-per-recipient economics** for Community Engine distribution.
- `scripts/metamask-agent-wallet-preflight.mjs` — current read-only signer capability evidence; do not weaken it as a shortcut.
- `packages/contracts/src/ProtocolPurposeVault.sol` — future gas-vault architecture reference only.

Do not put CCFF00/community data into `apps/indexer` without a new architecture decision; current authority reserves it for V6 compatibility/history. Do not hide execution in `apps/market-indexer`.

## A–K implementation sequence

```text
A  Read-only current-owner CCFF00 census
B  Read-only original mint provenance
C  Observer free-mint discovery + curation calibration
D  Known ERC-721 mint adapter + unsigned safety plans
E  Deterministic Fair Allocation / verified randomness
F  Exact CCFF00 TBA external-NFT custody proof
G  Isolated collector one-mint canary
H  Limited autonomous Community Engine runtime
I  Community ETH gas vault only if measured need justifies it
J  RMT Pay compatibility preflight
K  RMT Pay admitted burn-to-use utility
```

Passing a package never auto-authorizes the next.

## Implementation packets

- A/B: [`PACKAGE_A_B_IMPLEMENTATION_V1.md`](PACKAGE_A_B_IMPLEMENTATION_V1.md)
- C/D: [`PACKAGE_C_D_IMPLEMENTATION_V1.md`](PACKAGE_C_D_IMPLEMENTATION_V1.md)
- E/F: [`PACKAGE_E_F_IMPLEMENTATION_V1.md`](PACKAGE_E_F_IMPLEMENTATION_V1.md)
- G/H: [`PACKAGE_G_H_IMPLEMENTATION_V1.md`](PACKAGE_G_H_IMPLEMENTATION_V1.md)
- I/J/K: [`PACKAGE_I_J_K_IMPLEMENTATION_V1.md`](PACKAGE_I_J_K_IMPLEMENTATION_V1.md)

## Architecture/data/interfaces/recovery

- [`ARCHITECTURE_V1.md`](ARCHITECTURE_V1.md) — broad system lifecycle/boundaries.
- [`DATA_MODEL_V1.md`](DATA_MODEL_V1.md) — deterministic evidence and durable-state schemas.
- [`REFERENCE_INTERFACES_V1.md`](REFERENCE_INTERFACES_V1.md) — implementation-shaped TypeScript/function boundaries.
- [`INTEGRATION_MAP_V1.md`](INTEGRATION_MAP_V1.md) — where future code should extend current RMT and explicit non-target services.
- [`STATE_RECONSTRUCTION_V1.md`](STATE_RECONSTRUCTION_V1.md) — rebuild fairness/inventory/history from receipts + hash-bound evidence; database loss cannot reset community fairness.
- [`ERROR_CODES_V1.md`](ERROR_CODES_V1.md) — stable machine-classifiable failure/status taxonomy.

## Discovery/mint/quality/acquisition

- [`DISCOVERY_SOURCES_V1.md`](DISCOVERY_SOURCES_V1.md) — OpenSea, HoodMint, WATCH, Blockscout/onchain source map.
- [`UPSTREAM_REUSE_V1.md`](UPSTREAM_REUSE_V1.md) — reuse/reference/reject ledger for external tech.
- [`MINT_ADAPTERS_V1.md`](MINT_ADAPTERS_V1.md) — positive-allowlist mint-family semantics/postconditions.
- [`QUALITY_POLICY_V1.md`](QUALITY_POLICY_V1.md) — quality vs hard-safety separation.
- [`QUALITY_CALIBRATION_V1.md`](QUALITY_CALIBRATION_V1.md) — deterministic evidence routes/calibration before autonomous curation.
- [`ACQUISITION_INVENTORY_V1.md`](ACQUISITION_INVENTORY_V1.md) — transient isolated-collector custody; exact inventory is receipt-derived and committed before allocation.

V1 normally does **not** mint directly to a winning TBA even if a protocol supports a separate recipient. The extra transfer preserves a cleaner proof boundary:

```text
acquire exact token IDs
→ commit inventory
→ verified randomness
→ assign
→ deliver
```

## Fairness/randomness/identity/repair

- [`FAIRNESS_RANDOMNESS_V1.md`](FAIRNESS_RANDOMNESS_V1.md) — normative one-run/one-floor allocation and acquisition-block/drand design.
- [`FAIRNESS_VECTORS_V1.md`](FAIRNESS_VECTORS_V1.md) — deterministic examples/property-test expectations.
- [`IDENTITY_SYBIL_V1.md`](IDENTITY_SYBIL_V1.md) — address-seat truth boundary, contract-owner cases and residual Sybil risk; no funding/IP/device heuristics.
- [`DELIVERY_REPAIR_V1.md`](DELIVERY_REPAIR_V1.md) — deterministic Square fallback, original-cohort standby order, then mechanically anchored public repair allocation if necessary.

Key rule:

```text
inventory acquired in one mint run <= eligible current fairness-floor cohort
```

No mint run spills into a second service level.

## Operations/security/proofs

- [`THREAT_MODEL_V1.md`](THREAT_MODEL_V1.md) — attacker classes/invariants/incident posture.
- [`OPERATIONS_FAILURES_V1.md`](OPERATIONS_FAILURES_V1.md) — START/STOP, uncertain transactions, reorg/retry/recovery.
- [`ACCEPTANCE_MATRIX_V1.md`](ACCEPTANCE_MATRIX_V1.md) — package pass/fail gates.
- [`PUBLIC_PROOFS_V1.md`](PUBLIC_PROOFS_V1.md) — public reproducibility/transparency evidence.

An RPC timeout after possible send is `TX_UNCERTAIN`, not proof of failure. Blind duplicate mint/delivery retries are forbidden.

## Gas funding/economics

- [`GAS_COST_MODEL_V1.md`](GAS_COST_MODEL_V1.md) — measured native-gas accounting/caps/runway; reserve delivery/activation budget before acquisition.
- [`GAS_FUNDING_V1.md`](GAS_FUNDING_V1.md) — voluntary ETH funding and future vault boundary.

Community contribution amount never enters the allocation function.

## RMT Pay

- [`RMT_PAY_V1.md`](RMT_PAY_V1.md) — dead-address burn-to-use economics and truthful supply accounting.
- [`RMT_PAY_COMPATIBILITY_V1.md`](RMT_PAY_COMPATIBILITY_V1.md) — wallet/TBA/AA/sponsorship compatibility matrix and atomicity gate.

Locked V1 economics:

```text
RMT protocol utility → 0x000000000000000000000000000000000000dEaD
native network gas → separate sponsor budget
NO automatic RMT→ETH swap/sale
```

A Package J result of `RMT_PAY_NOT_CURRENTLY_SAFE` is valid and does not reopen the current-token redeployment decision.

## Planning state

- [`PLANNING_STATUS_V1.md`](PLANNING_STATUS_V1.md) records branch isolation, remaining empirical decisions and implementation-readiness status.

This planning branch intentionally contains documentation/specification only. It is allowed to fall behind active `main` while current Codex work continues.

## External technology posture

Current planning findings, all subject to implementation-time revalidation:

```text
viem/current RMT CCFF00 primitives   REUSE
OpenSea Drops                         observer/tx-builder adapter candidate
HoodMint NFT drops                    Robinhood-native observer/mint-family candidate
SeaDrop                               open-source mint-family reference; exact Robinhood runtime must be proven
drand Quicknet                        first verified randomness candidate
Robinhood Blockscout                  enrichment/public proof, not signer authority
Alchemy                               AA/gas-sponsorship candidate, not RMT burn-settlement authority
Reservoir hosted NFT API              not a Robinhood V1 dependency today
thirdweb Engine Core                  future runtime prior art only
browser/MetaMask mint automation      REJECT
new universal indexer for A/B         REJECT
```

## Hard boundary until implementation is explicitly opened

```text
NO production code changes
NO scheduled Community Engine worker
NO private key/signer authorization
NO mainnet/testnet mint
NO new contract deployment
NO terminal revenue-policy change
NO public Community Engine route
NO merge of this planning branch merely because the specs are comprehensive
```

Future working rhythm:

```text
one package → one fresh branch → one reviewable PR → exact evidence → STOP → owner/review decision
```
