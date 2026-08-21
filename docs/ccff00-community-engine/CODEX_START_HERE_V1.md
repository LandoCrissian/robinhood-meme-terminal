# OpenAI Codex — CCFF00 Community Engine start here

**Status:** FUTURE IMPLEMENTATION ENTRYPOINT — RUNTIME NOT YET AUTHORIZED  
**Planning branch:** `planning/ccff00-community-engine-v1`

This file exists to minimize Codex context/usage while preserving the decisions already worked out. Do not make Codex rediscover the system from scratch.

## 1. Before any Community Engine code

Codex must first inspect **current** repository authority from latest `main`:

```text
AGENTS.md
docs/ARCHITECTURE_FREEZE.md
docs/ACTIVE_SYSTEM_MAP.md
docs/TERMINAL_COMPLETION_GATE.md
```

If those files still say community/NFT work is paused or the owner has not explicitly opened this project, stop without runtime edits.

The planning branch is reference material only. Do not use it as the runtime base.

Implementation branch rule:

```text
latest main
  ↓
fresh bounded Codex branch
  ↓
one package only
```

## 2. Specification precedence

If two planning documents appear to disagree:

1. current repository authority;
2. explicit later owner decision;
3. `DECISION_REGISTER_V1.md`;
4. specialized V1 domain spec;
5. `ARCHITECTURE_V1.md` broad overview;
6. examples/non-normative discussion.

Known normalization already resolved:

> V1 never lets one mint run spill into a second service level. Mint quantity is bounded to the currently eligible fairness-floor cohort. `FAIRNESS_RANDOMNESS_V1.md` is normative for allocation semantics.

## 3. Global context every package should read

Keep this set small:

```text
README.md
DECISION_REGISTER_V1.md
INTEGRATION_MAP_V1.md
THREAT_MODEL_V1.md
ACCEPTANCE_MATRIX_V1.md
CODEX_HANDOFF.md section for the assigned package
```

`ARCHITECTURE_V1.md` is useful broad context, but package-specific specs below contain the normative details.

## 4. Package-specific reading map

### Package A — current Community Census

Read additionally:

```text
DATA_MODEL_V1.md
existing distribution-ccff00.ts
existing distribution-domain.ts
```

Do not read mint/provider/payment docs unless needed to understand a referenced type.

### Package B — original mint provenance

Read additionally:

```text
DATA_MODEL_V1.md
OPERATIONS_FAILURES_V1.md relevant chain/reorg sections
```

Do not modify `apps/indexer`.

### Package C — observer discovery

Read additionally:

```text
MINT_ADAPTERS_V1.md
QUALITY_POLICY_V1.md
OPERATIONS_FAILURES_V1.md provider-failure sections
```

No signer.

### Package D — mint admission/safety plan

Read additionally:

```text
MINT_ADAPTERS_V1.md
QUALITY_POLICY_V1.md
THREAT_MODEL_V1.md mint threats
DATA_MODEL_V1.md mint-plan/evidence schemas
```

No signer.

### Package E — Fair Allocation V1

Read additionally:

```text
FAIRNESS_RANDOMNESS_V1.md
FAIRNESS_VECTORS_V1.md
DATA_MODEL_V1.md fairness/allocation schemas
```

This package should be mostly pure deterministic domain code/tests. No live NFT movement.

### Package F — CCFF00 NFT custody canary harness

Read additionally:

```text
DATA_MODEL_V1.md
THREAT_MODEL_V1.md delivery/TBA threats
OPERATIONS_FAILURES_V1.md reconciliation sections
existing distribution-ccff00-owner-withdrawal-proof.ts
```

Build harness/tests before any separately authorized live canary.

### Package G — isolated collector canary

Read additionally:

```text
MINT_ADAPTERS_V1.md
OPERATIONS_FAILURES_V1.md
THREAT_MODEL_V1.md
GAS_FUNDING_V1.md collector/gas boundary
```

Requires explicit owner authorization and exact tiny gas budget.

### Package H — limited runtime

Read additionally:

```text
DATA_MODEL_V1.md
OPERATIONS_FAILURES_V1.md
THREAT_MODEL_V1.md
FAIRNESS_RANDOMNESS_V1.md
MINT_ADAPTERS_V1.md
QUALITY_POLICY_V1.md
```

Before implementation, propose service/storage/single-writer ownership and get architecture decision recorded. Do not place execution in `apps/indexer` or `apps/market-indexer`.

### Package I — gas vault

Read additionally:

```text
GAS_FUNDING_V1.md
THREAT_MODEL_V1.md gas-vault threats
existing ProtocolPurposeVault.sol only as architecture reference
```

No current terminal-revenue policy change is implied.

### Package J — RMT Pay compatibility

Read additionally:

```text
RMT_PAY_V1.md
RMT_PAY_COMPATIBILITY_V1.md
THREAT_MODEL_V1.md RMT Pay threats
existing FixedSupplyMemeToken.sol
existing CCFF00 owner-control proof
```

Do not redeploy RMT.

### Package K — RMT Pay utility

Read additionally:

```text
RMT_PAY_V1.md
RMT_PAY_COMPATIBILITY_V1.md
DATA_MODEL_V1.md payment policy/receipt schemas
THREAT_MODEL_V1.md
```

Requires separate product/economics authorization.

## 5. Locked product rules Codex should not reopen

```text
one current owner address = one seat
Square count does not multiply odds
current ownership beats original mint history
no cross-wallet human inference
public-mint CCFF00 range only in V1
donations create zero allocation advantage
least-served-first fairness
one mint run stays within one fairness-floor cohort
acquisition block anchors allocation census
future randomness round is deterministic from fixed policy
no NFT value/rarity/hype weighting
no post-acquisition cherry-picking
known mint adapters only
free means exact native mint value == 0
one collector identity; no burner evasion
operator controls: START / STOP / WATCH PROJECT
collector isolated from admin/treasury/deployer/users
RMT Pay utility -> 0x...dEaD
no automatic RMT -> ETH sale
collector gas funding and RMT Pay gas sponsorship are separate rails
no RMT redeployment for burn()/permit()
```

If an implementation would be easier by violating one of these, stop and report the conflict instead of changing the rule.

## 6. Deferred decisions Codex is allowed to resolve only in the designated package

Use `DECISION_REGISTER_V1.md` for full list. Key examples:

```text
live unique owner count -> Package A
original multi-mint counts -> Package B
OpenSea Robinhood compatibility -> Package C
exact SeaDrop/runtime admission -> Package C/D
quality threshold -> after observer evidence
randomness lead seconds -> Package E
safeTransferFrom vs transferFrom to TBA -> Package F
collector technology -> Package G
numeric gas/quantity/day caps -> measured canary evidence
runtime service/storage -> Package H architecture decision
gas vault/refill values -> Package I
RMT Pay sponsorship/account model -> Package J
RMT Pay price -> Package K owner economics decision
```

Do not resolve future-package decisions early just because they are visible.

## 7. The intended build sequence

```text
A Census
  ↓
B Mint provenance
  ↓
C Observer discovery
  ↓
D Mint safety plans
  ↓
E Fairness/randomness proof
  ↓
F CCFF00 NFT custody canary proof
  ↓
G isolated collector one-mint canary
  ↓
H limited autonomous runtime
  ↓
I community gas vault if evidence shows need
  ↓
J RMT Pay compatibility
  ↓
K RMT Pay admitted utility
```

Passing one package never auto-authorizes the next.

## 8. What “clean handoff” means

Codex should not spend time deciding:

- what fairness means;
- whether donors get extra odds;
- how many seats a whale gets;
- whether to use old minter or current owner;
- whether to use blockhash randomness;
- whether to sell RMT for gas;
- whether to redeploy RMT;
- whether to use arbitrary mint calldata;
- whether to merge Community Engine state into V6 indexer.

Those decisions are already made.

Codex's job is to implement one bounded primitive against current repository reality, prove it with evidence/tests, and stop.

## 9. First future Codex instruction

When the owner explicitly opens the project, use Package A from `CODEX_HANDOFF.md` only.

Do not start by building the NFT bot, signer, gas vault or RMT Pay.

The first concrete answer required from code is simply:

> At this exact pinned Robinhood block, how many admitted public CCFF00 Squares exist, how many unique current owner addresses hold them, and what are their canonical token-bound accounts?

Everything else builds on that evidence.
