# OpenAI Codex final handoff entrypoint — CCFF00 Community Engine V1

**Status:** FUTURE IMPLEMENTATION ENTRYPOINT — DO NOT START UNTIL OWNER EXPLICITLY OPENS PROJECT  
**Planning branch:** `planning/ccff00-community-engine-v1`

This is the authoritative entrypoint for future OpenAI Codex work. The planning branch is a specification source only; it is **not** a runtime implementation base.

## 1. Preconditions before Package A

Do not write Community Engine runtime code until all are true:

1. owner explicitly says the current terminal-completion lane is finished/cleared for this project;
2. owner explicitly authorizes Package A;
3. Codex fetches current `main` and current repository authority docs;
4. Codex checks open/recent branches/PRs for file overlap;
5. Codex creates a fresh bounded implementation branch from current `main`.

Required repository authority read first:

```text
AGENTS.md
docs/ARCHITECTURE_FREEZE.md
docs/ACTIVE_SYSTEM_MAP.md
docs/TERMINAL_COMPLETION_GATE.md
```

Then fetch the planning branch and read:

```text
docs/ccff00-community-engine/README.md
docs/ccff00-community-engine/DECISION_REGISTER_V1.md
```

The decision register contains locked owner choices. Codex may not reopen those choices simply because an implementation shortcut is easier.

## 2. Specification precedence

Use specialized specs for their domains:

```text
system boundaries             → ARCHITECTURE_V1.md
state/evidence schemas        → DATA_MODEL_V1.md
mint contract admission       → MINT_ADAPTERS_V1.md
quality/provenance            → QUALITY_POLICY_V1.md
fairness/randomness           → FAIRNESS_RANDOMNESS_V1.md
runtime/failure/recovery      → OPERATIONS_FAILURES_V1.md
community ETH gas funding     → GAS_FUNDING_V1.md
RMT burn-to-use economics     → RMT_PAY_V1.md
wallet/AA compatibility       → RMT_PAY_COMPATIBILITY_V1.md
```

`CODEX_HANDOFF.md` remains the original detailed package decomposition. If its generalized language is less precise than a specialized V1 spec listed above, the specialized spec governs.

No planning document authorizes deployment, signer use, production configuration or merge.

## 3. Package sequence

```text
A  read-only live CCFF00 census
B  read-only original-mint provenance
C  free-mint Observer Mode
D  ERC-721 mint adapter/safety plans
E  deterministic fairness/randomness simulator
F  CCFF00 external ERC-721 receive/withdraw harness
G  isolated collector + one-mint canary
H  limited autonomous Community Engine runtime
I  community ETH gas-vault design (only if operational evidence justifies it)
J  RMT Pay compatibility preflight
K  RMT Pay V1 utility (separate product/economics authorization)
```

Passing one package does not authorize the next.

## 4. Package-to-spec matrix

### Package A — Community Census

Must read:

```text
ARCHITECTURE_V1.md
DATA_MODEL_V1.md
DECISION_REGISTER_V1.md
```

Hard boundary:

```text
READ ONLY
NO DATABASE
NO WORKER
NO SIGNER
NO TRANSACTIONS
NO UI
```

Reuse the existing `distribution-ccff00.ts` canonical adapter.

### Package B — Mint provenance

Must read:

```text
DATA_MODEL_V1.md
DECISION_REGISTER_V1.md
```

Use bounded, exact collection logs from an independently proven deployment boundary. Do not extend `apps/indexer`.

### Package C — Observer Mode

Must read:

```text
MINT_ADAPTERS_V1.md
QUALITY_POLICY_V1.md
OPERATIONS_FAILURES_V1.md
DATA_MODEL_V1.md
```

No transaction capability. Probe live OpenSea/other provider support; WATCH PROJECT is observation only.

### Package D — Mint safety/adapters

Must read:

```text
MINT_ADAPTERS_V1.md
QUALITY_POLICY_V1.md
OPERATIONS_FAILURES_V1.md
DATA_MODEL_V1.md
```

Start with the smallest proven ERC-721 family. SeaDrop public mint is a candidate reference, not pre-admitted Robinhood infrastructure. Find/pin the exact Robinhood runtime first.

Require immediate/known-safe transferability evidence; do not mint a soulbound/restricted NFT into the collector and discover later that it cannot be distributed.

Still no signer.

### Package E — Fair Allocation V1

Must read:

```text
FAIRNESS_RANDOMNESS_V1.md
DATA_MODEL_V1.md
DECISION_REGISTER_V1.md
```

Normative V1 rules include:

```text
one mint run = one allocation batch
batch stays inside one current fairness-floor cohort
acquisition tx block = allocation census anchor
future randomness round derived from acquisition-block timestamp + fixed versioned lead
drand Quicknet is first candidate; revalidate/pin current identity
cryptographically verify beacon
unbiased Fisher-Yates with rejection sampling
no donor/Square-count weighting
```

Simulation only; no distribution signing.

### Package F — CCFF00 NFT custody canary harness

Must read:

```text
ARCHITECTURE_V1.md
DATA_MODEL_V1.md
OPERATIONS_FAILURES_V1.md
```

Prove exact CCFF00 TBA receive + current-owner withdrawal behavior using the admitted canary strategy. Determine safe vs ordinary ERC-721 transfer method empirically.

Harness/test first; no live transaction until separately authorized.

### Package G — Isolated collector canary

Must read:

```text
MINT_ADAPTERS_V1.md
QUALITY_POLICY_V1.md
OPERATIONS_FAILURES_V1.md
DATA_MODEL_V1.md
```

Requires explicit owner authorization and exact tiny ETH budget.

Never use admin, treasury, deployer, trading or CCFF00-holder wallet as collector.

One zero-price mint canary only. Stop and reconcile.

### Package H — Limited runtime

Must read:

```text
DATA_MODEL_V1.md
OPERATIONS_FAILURES_V1.md
FAIRNESS_RANDOMNESS_V1.md
MINT_ADAPTERS_V1.md
QUALITY_POLICY_V1.md
DECISION_REGISTER_V1.md
```

Before adding a worker/service, make the repository architecture decision for service ownership. Do not hide execution in `apps/indexer` or `apps/market-indexer`.

One writer/explicit leader semantics. START/STOP/WATCH PROJECT only. Hard measured gas/inventory caps. Automatic halt on uncertainty.

### Package I — Community ETH gas funding

Must read:

```text
GAS_FUNDING_V1.md
OPERATIONS_FAILURES_V1.md
DECISION_REGISTER_V1.md
```

Do not deploy a vault simply because planning contains a candidate design. First use measured collector canary/limited-runtime gas evidence.

No current terminal fee/revenue policy change.

### Package J — RMT Pay compatibility

Must read:

```text
RMT_PAY_V1.md
RMT_PAY_COMPATIBILITY_V1.md
DATA_MODEL_V1.md
DECISION_REGISTER_V1.md
```

Do not redeploy RMT.

Prove exact current wallet path, CCFF00 TBA owner semantics, atomic burn+utility and zero-native-ETH sponsorship. Do not assume Alchemy/MetaMask/Privy compose merely because each supports account-abstraction features independently.

A result of `NOT_CURRENTLY_SAFE` is acceptable and does not trigger a wallet/token redesign automatically.

### Package K — RMT Pay utility

Requires separate product/economics authorization after Package J.

Must preserve:

```text
protocol-utility RMT → 0x000000000000000000000000000000000000dEaD
native gas → separate sponsorship budget
NO automatic RMT → ETH sale
NO claim that Solidity totalSupply decreased
```

Implement exact admitted utilities/prices only.

## 5. Universal stop/report contract for Codex

At the end of every package, Codex must stop and report:

```text
PACKAGE
BRANCH
BASE_SHA
HEAD_SHA
FILES_CHANGED
TESTS_RUN
TEST_RESULTS
LIVE_EVIDENCE (if applicable)
SECURITY/FAIL-CLOSED EVIDENCE
PRODUCTION_MUTATED: YES/NO
SIGNER_USED: YES/NO
TRANSACTIONS_SENT: YES/NO
ETH_SPENT: exact or 0
UNRESOLVED_BLOCKERS
OVERLAP_WITH_CURRENT_MAIN/OPEN_PRS
RECOMMENDED_NEXT_PACKAGE
```

Do not automatically start the recommended next package.

## 6. Universal prohibited actions unless exact package/owner authorization says otherwise

```text
merge own PR
deploy contract
modify production env
activate provider/worker/signer/fee
spend mainnet ETH
move treasury/community funds
change RMT token
sell RMT for gas
sell acquired NFTs
create burner mint wallets
bypass creator limits
operator-select recipients/NFTs/randomness
add arbitrary-call executor
collect wallet/IP/device identity for Sybil guessing
```

## 7. Package A exact kickoff prompt

Use only after owner explicitly authorizes Package A:

```text
Implement Package A only: read-only CCFF00 Community Census V1.

Repository: LandoCrissian/robinhood-meme-terminal

Before editing:
1. fetch latest main;
2. read AGENTS.md, docs/ARCHITECTURE_FREEZE.md, docs/ACTIVE_SYSTEM_MAP.md, docs/TERMINAL_COMPLETION_GATE.md;
3. inspect open/recent PR/branch overlap;
4. fetch origin/planning/ccff00-community-engine-v1;
5. read docs/ccff00-community-engine/README.md, DECISION_REGISTER_V1.md, ARCHITECTURE_V1.md, DATA_MODEL_V1.md and CODEX_HANDOFF_FINAL_V1.md;
6. create a fresh bounded branch from latest main. Never implement from the planning branch.

Goal:
Derive the exact live V1 community-seat census directly from canonical CCFF00 public ownership at one pinned admitted Robinhood Chain block.

Reuse apps/web/lib/vnext/distribution-ccff00.ts. Do not create another CCFF00 resolver.

Implement deterministic Ccff00CommunityCensusV1 evidence as specified in DATA_MODEL_V1.md, including:
- publicMinted public-range rows only;
- exact current owner per token ID;
- exact canonical ERC-6551 TBA per token ID;
- activation/runtime evidence;
- owner grouping where one current owner address = one seat regardless of Square count;
- summary buckets exactly1/exactly2/exactly3/exactly4/5plus/max;
- deterministic canonical census hash;
- fail-closed validation for duplicates, wrong chain/block/runtime/registry/implementation/salt and reserve leakage.

Add a read-only CLI/report path consistent with current repo architecture.

Hard boundaries:
NO apps/indexer CCFF00 extension.
NO database.
NO worker.
NO API/public UI.
NO signer/private key.
NO transaction.
NO mint discovery.
NO NFT execution.
NO gas vault.
NO RMT Pay.
NO production env change.
NO deploy.
NO merge.

Run focused CCFF00/distribution tests, new adversarial tests, typecheck and only the additional repository/release checks actually required by current authority for this bounded change.

If live RPC permits, report exact current census numbers but do not persist them as hard-coded product constants.

At completion emit the universal stop/report contract from CODEX_HANDOFF_FINAL_V1.md and STOP. Do not start Package B.
```

## 8. Handoff philosophy

Commodity infrastructure is reused; RMT-specific engineering is concentrated in:

```text
policy
verification
fairness
reproducibility
failure handling
CCFF00 ownership/custody composition
RMT burn-to-use utility
```

The system becomes autonomous only after each primitive has independent evidence. Codex is expected to implement bounded proven pieces, not rediscover or rewrite the product architecture from scratch.
