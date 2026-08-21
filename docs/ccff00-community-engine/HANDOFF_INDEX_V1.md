# CCFF00 Community Engine V1 — handoff index

**Status:** FUTURE OPENAI CODEX FRONT DOOR — PLANNING ONLY  
**Planning branch:** `planning/ccff00-community-engine-v1`

Use this file when the owner eventually says the current terminal-completion work is finished and opens the Community Engine project.

The planning branch is a specification library. It is not the implementation base.

## 1. Future Codex start sequence

```text
1. fetch latest main
2. read current repository authority
3. confirm owner opened exactly one package
4. read this HANDOFF_INDEX_V1.md
5. read CODEX_START_HERE_V1.md
6. read DECISION_REGISTER_V1.md + SPEC_CONSISTENCY_V1.md
7. inspect CODEX_PACKAGE_MANIFEST_V1.json for package dependencies/authorization
8. use exactly one copy-ready package prompt from CODEX_PROMPTS_V1.md
9. read that package's implementation packet + specialized specs
10. create fresh bounded branch from latest main
11. implement/prove one package
12. report and STOP
```

## 2. Current repository authority always wins first

Read from latest `main`:

```text
AGENTS.md
docs/ARCHITECTURE_FREEZE.md
docs/ACTIVE_SYSTEM_MAP.md
docs/TERMINAL_COMPLETION_GATE.md
```

If Community Engine work is still paused, stop.

## 3. Owner decisions / conflict resolution

Read:

```text
DECISION_REGISTER_V1.md
SPEC_CONSISTENCY_V1.md
```

These contain the rules Codex should not redesign for implementation convenience.

Most important:

```text
one current owner address = one seat
Square count = no extra odds
ETH donations = no extra odds
current ownership beats original mint history
no inferred cross-wallet human identity
one mint run stays inside one fairness-floor cohort
acquisition block anchors allocation census
randomness round is mechanically derived
no NFT financial-value weighting
known mint adapters only
exact native mint value = 0
operator cannot pick winners or reroll
RMT Pay → 0x...dEaD
no RMT→ETH automatic sale
no RMT redeployment required
```

## 4. Machine-readable package authority

```text
CODEX_PACKAGE_MANIFEST_V1.json
```

Use it for:

- dependencies;
- required specs;
- whether live tx/deploy is allowed;
- expected package outcome;
- mandatory stop condition.

## 5. Copy-ready prompts

```text
CODEX_PROMPTS_V1.md
```

Send only the current package prompt to Codex.

Do not send A–K at once.

## 6. Implementation packets

```text
A/B → PACKAGE_A_B_IMPLEMENTATION_V1.md
C/D → PACKAGE_C_D_IMPLEMENTATION_V1.md
E/F → PACKAGE_E_F_IMPLEMENTATION_V1.md
G/H → PACKAGE_G_H_IMPLEMENTATION_V1.md
I/J/K → PACKAGE_I_J_K_IMPLEMENTATION_V1.md
```

These contain likely files/functions/tests/CLI/reconciliation details.

## 7. Package sequence

```text
A current owner census
↓
B original mint provenance
↓
C observer free-mint discovery
↓
D known ERC-721 mint safety plans
↓
E deterministic fairness/randomness proof
↓
F exact CCFF00 TBA third-party NFT custody proof
↓
G isolated collector one-mint canary
↓
H limited autonomous runtime
↓
I community ETH gas vault only if evidence justifies it
↓
J RMT Pay compatibility proof
↓
K RMT Pay admitted utility
```

## 8. Package A quick context

Read:

```text
PACKAGE_A_B_IMPLEMENTATION_V1.md
DATA_MODEL_V1.md
REFERENCE_INTERFACES_V1.md
ACCEPTANCE_MATRIX_V1.md
ERROR_CODES_V1.md
```

Reuse:

```text
apps/web/lib/vnext/distribution-ccff00.ts
apps/web/lib/vnext/distribution-domain.ts
```

Output:

```text
pinned-block current public CCFF00 census
unique current owner seats
1/2/3/4/5+ Square distribution
canonical TBAs
census hash
```

No provenance, provider, signer, DB, UI or transaction.

## 9. Package B quick context

Read:

```text
PACKAGE_A_B_IMPLEMENTATION_V1.md
DATA_MODEL_V1.md
```

Output:

```text
verified collection-start boundary
zero-address Transfer provenance
unique original recipients
original 1/2/3/4/5+ distribution
provenance hash
```

Original recipient analytics never override current-seat census.

## 10. Package C quick context

Read:

```text
PACKAGE_C_D_IMPLEMENTATION_V1.md
MINT_ADAPTERS_V1.md
QUALITY_POLICY_V1.md
QUALITY_CALIBRATION_V1.md
UPSTREAM_REUSE_V1.md
```

Output:

```text
read-only normalized candidates
WATCH records
provider capability evidence
quality calibration cases
```

No signer.

## 11. Package D quick context

Read:

```text
PACKAGE_C_D_IMPLEMENTATION_V1.md
MINT_ADAPTERS_V1.md
THREAT_MODEL_V1.md
GAS_COST_MODEL_V1.md
```

Output:

```text
positive-allowlisted adapter(s)
unsigned zero-value mint plans
fairness quantity preflight
simulation/runtime/postcondition evidence
```

No signer.

## 12. Package E quick context

Read:

```text
PACKAGE_E_F_IMPLEMENTATION_V1.md
FAIRNESS_RANDOMNESS_V1.md
FAIRNESS_VECTORS_V1.md
```

Output:

```text
pure deterministic allocator
verified randomness adapter
reproducibility vectors/property tests
allocation proof packets
```

No NFT movement.

## 13. Package F quick context

Read:

```text
PACKAGE_E_F_IMPLEMENTATION_V1.md
existing CCFF00 owner-control proof
THREAT_MODEL_V1.md
```

Output:

```text
exact TBA receive/hold/withdraw evidence
safeTransferFrom vs transferFrom decision
balance invariants
```

Harness/fork first; live canary separately authorized.

## 14. Package G quick context

Read:

```text
PACKAGE_G_H_IMPLEMENTATION_V1.md
GAS_COST_MODEL_V1.md
OPERATIONS_FAILURES_V1.md
```

Output only after exact authorization:

```text
dedicated isolated collector
one zero-price mint canary
exact tx/inventory/gas reconciliation
```

## 15. Package H quick context

Read:

```text
PACKAGE_G_H_IMPLEMENTATION_V1.md
DATA_MODEL_V1.md
OPERATIONS_FAILURES_V1.md
PUBLIC_PROOFS_V1.md
```

First record new service-ownership architecture decision.

Output:

```text
single-writer limited runtime
START/STOP/WATCH
uncertain-tx/reorg/restart recovery
low measured caps
public proofs
```

## 16. Package I quick context

Read:

```text
PACKAGE_I_J_K_IMPLEMENTATION_V1.md
GAS_FUNDING_V1.md
GAS_COST_MODEL_V1.md
```

Valid outcome:

```text
DEFER GAS VAULT
```

or a separately deployment-ready, purpose-bound native ETH vault design.

No terminal fee-policy mutation.

## 17. Package J quick context

Read:

```text
PACKAGE_I_J_K_IMPLEMENTATION_V1.md
RMT_PAY_V1.md
RMT_PAY_COMPATIBILITY_V1.md
```

Valid outcomes:

```text
RMT_PAY_COMPATIBLE_PATH_FOUND
RMT_PAY_NOT_CURRENTLY_SAFE
```

No RMT redeploy.

## 18. Package K quick context

Read:

```text
PACKAGE_I_J_K_IMPLEMENTATION_V1.md
RMT_PAY_V1.md
PUBLIC_PROOFS_V1.md
```

Requires owner-approved utility/pricing/gas economics.

Output:

```text
exact RMT burn-to-use utility
RMT → 0x...dEaD
native gas sponsored separately
no RMT sale
```

## 19. Cross-cutting specs

### Canonical types/data

```text
DATA_MODEL_V1.md
REFERENCE_INTERFACES_V1.md
```

### Security

```text
THREAT_MODEL_V1.md
ERROR_CODES_V1.md
```

### Acceptance

```text
ACCEPTANCE_MATRIX_V1.md
```

### Public transparency

```text
PUBLIC_PROOFS_V1.md
```

### Cost/funding

```text
GAS_COST_MODEL_V1.md
GAS_FUNDING_V1.md
```

### External technology reuse

```text
UPSTREAM_REUSE_V1.md
```

## 20. Planning state/isolation

```text
PLANNING_STATUS_V1.md
```

The planning track is intentionally docs-only and allowed to drift behind active `main`. Future runtime always starts from latest `main`.

## 21. Detailed original handoff docs

These remain useful background/reference:

```text
CODEX_HANDOFF_FINAL_V1.md
CODEX_HANDOFF.md
ARCHITECTURE_V1.md
```

Prefer `CODEX_START_HERE_V1.md` + the current package packet for low-context execution.

## 22. Do not make Codex rediscover these upstream decisions

From `UPSTREAM_REUSE_V1.md`:

```text
viem/current RMT primitives → reuse
OpenSea Drops → observation/transaction-builder adapter candidate
SeaDrop → open-source mint-family reference, exact Robinhood runtime must be proven
drand Quicknet → first verified randomness candidate
Blockscout → enrichment/public evidence, not signer authority
Alchemy → AA/sponsorship candidate, not RMT burn settlement authority
Reservoir hosted → not Robinhood V1 dependency today
Mint.fun bot → historical architecture prior art only
thirdweb Engine Core → future runtime prior art, not early dependency
browser mint automation → reject
new generic indexer for A/B → reject
```

## 23. Final handoff discipline

The future working rhythm should be:

```text
one package
→ one bounded branch
→ one reviewable PR
→ exact evidence
→ STOP
→ owner/review decision
→ next package
```

No giant “build the Community Engine” Codex request.

That is the primary mechanism for keeping usage low and preventing one implementation decision from cascading into unrelated RMT systems.
