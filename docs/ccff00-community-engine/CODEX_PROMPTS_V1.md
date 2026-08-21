# OpenAI Codex package prompts — CCFF00 Community Engine V1

**Status:** FUTURE COPY-READY HANDOFF PROMPTS — DO NOT RUN UNTIL EACH PACKAGE IS AUTHORIZED

These prompts are intentionally bounded. Before using any prompt, replace nothing unless the current repository/owner decision requires it. Codex itself must fetch latest `main` and verify current authority.

Passing one package does not authorize the next.

---

# Prompt A — read-only CCFF00 Community Census

```text
Work ONLY on CCFF00 Community Engine Package A: read-only current-owner Community Census.

Repository: LandoCrissian/robinhood-meme-terminal

Before editing:
1. fetch latest main;
2. read current AGENTS.md, docs/ARCHITECTURE_FREEZE.md, docs/ACTIVE_SYSTEM_MAP.md, docs/TERMINAL_COMPLETION_GATE.md;
3. verify the owner has explicitly opened Package A and current architecture permits it;
4. fetch/read origin/planning/ccff00-community-engine-v1/docs/ccff00-community-engine/CODEX_START_HERE_V1.md;
5. read DECISION_REGISTER_V1.md, SPEC_CONSISTENCY_V1.md, PACKAGE_A_B_IMPLEMENTATION_V1.md, DATA_MODEL_V1.md, REFERENCE_INTERFACES_V1.md, ACCEPTANCE_MATRIX_V1.md;
6. inspect current distribution-ccff00.ts, distribution-domain.ts and relevant tests;
7. inspect open/recent PR overlap;
8. create a fresh bounded branch from latest main.

Implement ONLY Package A.

Locked semantics:
- one current owner address holding >=1 admitted public CCFF00 = one V1 seat;
- multiple Squares in same current wallet remain one seat;
- public-mint CCFF00 range only; founder/project reserve IDs do not create V1 seats;
- reuse canonical CCFF00 snapshot/TBA logic; do not duplicate constants/ABIs unnecessarily;
- full artifact is pinned to one exact block + block hash and deterministically hash-bound.

Preferred shape if still consistent with current repo:
- apps/web/lib/vnext/ccff00-community-census.ts
- apps/web/lib/vnext/ccff00-community-census-smoke.ts
- apps/web/scripts/vnext-ccff00-community-census.ts

Hard boundaries:
- READ ONLY;
- no provenance/log-history work yet;
- no database/service/worker;
- do not modify apps/indexer;
- no provider/NFT discovery;
- no signer/private key;
- no transaction;
- no API/UI;
- no production env/deploy/merge.

Required live summary when RPC permits:
publicMinted, uniqueCurrentOwners, ownersWithExactly1/2/3/4/5Plus, maxSquaresPerOwner, activatedTbas, uniqueTbas, snapshotBlock/hash, censusHash.

Run focused census/CCFF00 tests and current required typecheck/release checks for touched code.

At completion report exact base/head, files, tests, live numbers/evidence, blockers. STOP. Do not begin Package B.
```

---

# Prompt B — original mint provenance

```text
Work ONLY on CCFF00 Community Engine Package B: read-only original mint provenance.

Start from latest main on a fresh bounded branch after Package A is accepted.

Read current repository authority, then CODEX_START_HERE_V1.md, DECISION_REGISTER_V1.md, SPEC_CONSISTENCY_V1.md, PACKAGE_A_B_IMPLEMENTATION_V1.md, DATA_MODEL_V1.md, ACCEPTANCE_MATRIX_V1.md.

Goal:
For every admitted public CCFF00 token ID, reconstruct exactly one initial ERC-721 Transfer(from=zeroAddress,to=initialRecipient,tokenId) using bounded canonical collection logs from an independently verified collection deployment/start boundary.

Locked semantics:
- initial recipient = Transfer event `to`, not blindly transaction.from;
- original multi-mint clustering is analytics only;
- current owner census remains entitlement authority;
- reserve/project IDs do not enter public provenance counts.

Preferred shape if consistent:
- apps/web/lib/vnext/ccff00-mint-provenance.ts
- apps/web/lib/vnext/ccff00-mint-provenance-smoke.ts
- apps/web/scripts/vnext-ccff00-mint-provenance.ts

Hard boundaries:
- read only;
- do not modify apps/indexer;
- no database/worker;
- no wallet heuristics to merge addresses;
- no NFT provider/discovery;
- no signer/tx/UI/deploy/merge.

Required output:
verified start block, through block/hash, rows for every public token, unique original recipients, original recipient exactly1/2/3/4/5Plus, maxOriginalRecipientCount, provenanceHash.

Fail closed on missing/duplicate public token provenance, wrong collection/boundary/block identity, malformed logs/hash.

Run focused tests/typecheck/current required checks. Report exact evidence and STOP before Package C.
```

---

# Prompt C — Observer Mode free-mint discovery

```text
Work ONLY on CCFF00 Community Engine Package C: Observer Mode NFT discovery. NO transaction capability.

Start from latest main fresh branch after A/B accepted.

Read current repository authority, then CODEX_START_HERE_V1.md, DECISION_REGISTER_V1.md, SPEC_CONSISTENCY_V1.md, PACKAGE_C_D_IMPLEMENTATION_V1.md, MINT_ADAPTERS_V1.md, QUALITY_POLICY_V1.md, QUALITY_CALIBRATION_V1.md, OPERATIONS_FAILURES_V1.md, UPSTREAM_REUSE_V1.md, ERROR_CODES_V1.md.

Implement provider-neutral candidate normalization plus bounded read-only adapters.

Sources:
1. live-probe current OpenSea Drops API Robinhood capability;
2. operator WATCH PROJECT normalization (URL/address + optional whitelist/stage evidence);
3. bounded explorer/onchain enrichment only where useful.

WATCH PROJECT is priority/provenance only; it cannot force approval or bypass safety/quality.

Output deterministic observer statuses/reasons such as WOULD_INSPECT, NOT_FREE, NOT_ACTIVE, UNKNOWN_ADAPTER, PROVIDER_UNAVAILABLE.

Run structured quality evidence in observer/calibration mode only. Do not authorize spending based on an unapproved score.

Hard boundaries:
NO PRIVATE KEY
NO SIGNER
NO WALLET SUBMISSION
NO MINT
NO GAS SPEND
NO UI unless separately requested
NO arbitrary webpage wallet automation
NO deploy/env/merge

Capture real Robinhood examples, provider capability evidence, calibration cases and tests. STOP before Package D.
```

---

# Prompt D — mint adapter and unsigned safety plan

```text
Work ONLY on CCFF00 Community Engine Package D: known ERC-721 mint adapter(s) + unsigned safety/admission plan. Still NO signer.

Start latest-main fresh branch after Package C review.

Read current authority, then CODEX_START_HERE_V1.md, DECISION_REGISTER_V1.md, SPEC_CONSISTENCY_V1.md, PACKAGE_C_D_IMPLEMENTATION_V1.md, MINT_ADAPTERS_V1.md, QUALITY_POLICY_V1.md, QUALITY_CALIBRATION_V1.md, THREAT_MODEL_V1.md, DATA_MODEL_V1.md, REFERENCE_INTERFACES_V1.md, ERROR_CODES_V1.md.

Use real Package C observations to choose the smallest independently provable mint family. SeaDrop is a candidate reference only; do not assume a Robinhood deployment/address—discover and runtime-verify exact target/collection.

Required final plan checks:
- chainId 4663;
- known positive-allowlisted adapter/selector;
- exact collection/target/proxy/implementation runtime evidence;
- exact decode of payer/minter/recipient/quantity;
- exact transaction native value == 0;
- decoded mint price == 0;
- stage active;
- creator wallet/supply limit respected;
- collector eligibility/proof semantics exact;
- transferability sufficient before acquisition;
- quality policy passes its approved observer/release state;
- fairness quantity preflight caps quantity to uncovered current fairness-floor cohort;
- exact simulation succeeds;
- gas within policy;
- expected receipt/postconditions defined;
- hash-bound expiry/policy/evidence.

If forced quantity exceeds fairness cohort, reject/observe. Never spill one mint run into another service level.

Produce only WOULD_MINT unsigned plans/rejections. No signing/broadcast/private key/deploy/merge. Run adversarial mutations. STOP before Package E.
```

---

# Prompt E — deterministic Fair Allocation V1

```text
Work ONLY on CCFF00 Community Engine Package E: deterministic fairness/randomness simulator and proof. NO NFT movement.

Start latest-main fresh branch after D accepted.

Read current authority, then CODEX_START_HERE_V1.md, DECISION_REGISTER_V1.md, SPEC_CONSISTENCY_V1.md, PACKAGE_E_F_IMPLEMENTATION_V1.md, FAIRNESS_RANDOMNESS_V1.md, FAIRNESS_VECTORS_V1.md, DATA_MODEL_V1.md, REFERENCE_INTERFACES_V1.md, THREAT_MODEL_V1.md.

Normative rules:
- one current owner address = one seat weight 1;
- Square count and ETH contribution do not affect seat odds;
- one mint run = one batch and inventoryCount <= eligible current-floor cohort;
- acquisition transaction block/hash anchors historical CCFF00 allocation census;
- same collection default coverage excludes current-floor seats that already received that collection;
- NFT value/rarity/floor/hype absent from allocation inputs;
- future randomness round derived mechanically from acquisition block timestamp + explicit versioned leadSeconds;
- drand Quicknet first production candidate, revalidate/pin current chain identity;
- cryptographically verify beacon;
- domain-separated keccak streams;
- unbiased Fisher-Yates using rejection sampling;
- independent seat/inventory shuffle;
- selected owner's least-served Squares form deterministic preference order;
- service levels mutate only after confirmed delivery later.

Implement all FAIRNESS_VECTORS_V1.md cases plus large property tests. Keep drand HTTP/verification adapter separate from pure allocator; allocator consumes VerifiedRandomnessRecord only.

Resolve/report CE-D06 production randomnessLeadSeconds only if evidence/review justifies it; test fixture values are fine otherwise.

No signer, no NFT transfer, no database worker, no deploy/merge. Report vectors/property counts/sample proof hash and STOP before F.
```

---

# Prompt F — CCFF00 third-party ERC-721 custody harness

```text
Work ONLY on CCFF00 Community Engine Package F: prove exact CCFF00 TBA can receive/hold/release a third-party ERC-721. Build harness/fork evidence first; no live mainnet tx unless separately and explicitly authorized.

Start latest-main fresh branch after E accepted.

Read current authority, then CODEX_START_HERE_V1.md, PACKAGE_E_F_IMPLEMENTATION_V1.md, DATA_MODEL_V1.md, THREAT_MODEL_V1.md, OPERATIONS_FAILURES_V1.md, existing distribution-ccff00.ts and distribution-ccff00-owner-withdrawal-proof.ts.

Reuse canonical CCFF00 collection/registry/implementation/salt/TBA evidence.

Test exact deployed TBA behavior with a standard transferable external ERC-721 fixture/fork:
1. canonical TBA identity/runtime;
2. activate if needed;
3. test safeTransferFrom to TBA;
4. if safe receiver hook specifically unsupported, separately test exact transferFrom fallback;
5. prove ownerOf external NFT == TBA;
6. prove current Square owner controls TBA;
7. transfer NFT back out under owner control;
8. prove CCFF00 and RMT balances unchanged unexpectedly.

Resolve CE-D08 safeTransferFrom vs transferFrom only from evidence.

Current canary IDs 470/471/472 are planning inputs; revalidate before any live use.

Negative tests for wrong owner/TBA/runtime/NFT/postconditions/balance drift/replay. No mass distribution. Report exact custody proof and STOP before G.
```

---

# Prompt G — isolated collector one-mint canary

```text
Work ONLY on CCFF00 Community Engine Package G. This is the first live-signer package and requires explicit owner authorization + exact tiny ETH budget before any broadcast.

Start latest-main fresh branch after F accepted.

Read current authority, owner authorization scope, CODEX_START_HERE_V1.md, PACKAGE_G_H_IMPLEMENTATION_V1.md, MINT_ADAPTERS_V1.md, QUALITY_POLICY_V1.md, OPERATIONS_FAILURES_V1.md, THREAT_MODEL_V1.md, GAS_COST_MODEL_V1.md, GAS_FUNDING_V1.md.

Select/admit a DEDICATED collector account. Reject reuse of admin, treasury/Safe, deployer, trading or CCFF00-holder wallet.

Preflight target posture:
RMT=0
CCFF00=0
no forbidden approvals/assets
small ETH <= approved cap
chain/policy/signer/nonce known

Use a previously admitted Package D zero-price plan, preferably quantity 1.

Before sign refresh runtime/proxy/stage/price/value=0/eligibility/quantity/gas/STOP/collector asset state. Persist SUBMISSION_STARTED before external send. Timeout after possible send => UNCERTAIN and NO RETRY until reconciled.

Reconcile finality, exact acquired NFT/event/owner, native value=0, gas and all balances. Optional one-delivery canary only if owner authorization explicitly includes it; otherwise stop with exact committed inventory.

Report authorization scope, collector identity/tech, funding tx/amount, mint plan/hash/tx, gas, inventory, post-balances and unresolved state. STOP before H.
```

---

# Prompt H — limited autonomous Community Engine runtime

```text
Work ONLY on CCFF00 Community Engine Package H after explicit owner authorization and successful G canary.

FIRST make/record the required current architecture decision for service ownership. Do not hide execution in apps/indexer or apps/market-indexer.

Read current authority, CODEX_START_HERE_V1.md, PACKAGE_G_H_IMPLEMENTATION_V1.md, DATA_MODEL_V1.md, OPERATIONS_FAILURES_V1.md, THREAT_MODEL_V1.md, FAIRNESS_RANDOMNESS_V1.md, MINT_ADAPTERS_V1.md, QUALITY_POLICY_V1.md, PUBLIC_PROOFS_V1.md, GAS_COST_MODEL_V1.md, ERROR_CODES_V1.md.

Implement the smallest dedicated runtime consistent with current repo:
- one authoritative signer writer or fenced leader lease;
- durable START/STOP state;
- deterministic candidate/mintRun/tx/inventory/commitment/randomness/assignment/delivery identities;
- read-only discovery can scale, signing serialized;
- STOP blocks new signing but reconciliation continues;
- TX_UNCERTAIN blocks blind retry;
- acquisition finality before inventory commitment;
- acquisition block historical census;
- deterministic drand wait/verification/allocation;
- pre-delivery current Square ownership refresh/precommitted fallback;
- fairness updates only from confirmed deliveries;
- explicit repair jobs, no manual recipient substitution;
- exact measured gas/quantity/day/pending-inventory caps;
- auto-pause on security/reorg/uncertainty/invariant/cap failures;
- no autonomous mint-adapter expansion;
- sanitized public proof/status surface.

Run crash/restart/duplicate queue/lease/STOP/RPC outage/drand outage/gas spike/ownership drift/reorg/storage failure tests before limited production.

Initial production deliberately low throughput/caps. Do not broaden automatically. Report architecture, storage, caps, recovery tests, canary history, gas and proof outputs. STOP before I.
```

---

# Prompt I — community ETH gas funding

```text
Work ONLY on CCFF00 Community Engine Package I after Package H has measured operational gas/funding evidence and explicit owner authorization to evaluate the funding rail.

Read current authority, CODEX_START_HERE_V1.md, PACKAGE_I_J_K_IMPLEMENTATION_V1.md, GAS_FUNDING_V1.md, GAS_COST_MODEL_V1.md, THREAT_MODEL_V1.md, OPERATIONS_FAILURES_V1.md.

FIRST determine whether a new onchain vault is actually justified versus continued explicit operational funding. A valid result is DEFER GAS VAULT.

If an immutable/bounded CCFF00CollectorGasVaultV1 is justified, design/test only:
- native ETH contributions from anyone;
- fixed/admitted collector destination;
- no arbitrary recipient/call/delegatecall;
- bounded per-refill and epoch/window release;
- public accounting;
- explicit pause/governance model;
- contributor receives zero allocation rights;
- no ERC20/NFT/RMT/DEX behavior;
- no current terminal revenue policy change.

Resolve collector rotation/refill model from measured risk, not convenience. Run Foundry/fuzz/Slither/current security gates.

Do not deploy without separate exact deployment authorization. Report DEFER or deployment-ready evidence and STOP before J.
```

---

# Prompt J — RMT Pay compatibility preflight

```text
Work ONLY on RMT Pay Package J compatibility. DO NOT redeploy RMT and DO NOT implement public RMT Pay yet.

Start latest-main fresh branch after explicit Package J authorization.

Read current authority, CODEX_START_HERE_V1.md, PACKAGE_I_J_K_IMPLEMENTATION_V1.md, RMT_PAY_V1.md, RMT_PAY_COMPATIBILITY_V1.md, REFERENCE_INTERFACES_V1.md, THREAT_MODEL_V1.md, ERROR_CODES_V1.md, current RMT token source/deployment evidence and exact CCFF00 TBA owner-control proof.

Goal:
prove whether current RMT held directly or inside canonical CCFF00 TBA can be sent to 0x000000000000000000000000000000000000dEaD atomically with an admitted utility while native gas is sponsored separately and the user's current external-wallet architecture is preserved.

Stages:
1. read-only exact deployed RMT/TBA/runtime identity;
2. local/fork atomic call composition;
3. live capability matrix for the actual RMT external-wallet connectors and candidate AA/sponsorship providers on Robinhood 4663;
4. separately authorized zero-native-ETH controlled test only if preceding evidence passes.

Do NOT assume Alchemy/MetaMask/Privy or any AA stack composes merely because each advertises features. Same-address owner semantics matter for TBA.execute.

Required proof for an admitted path:
- exact owner/controller preserved;
- TBA burn call authorized if source is TBA;
- burn + utility one atomic context;
- utility revert rolls back burn;
- exact source/dead RMT balance deltas;
- no DEX/RMT→ETH call;
- zero user-funded native ETH;
- sponsor policy constrained to admitted target/selector/gas;
- no token migration required.

Valid final outcomes:
RMT_PAY_COMPATIBLE_PATH_FOUND
or
RMT_PAY_NOT_CURRENTLY_SAFE

A negative result does not authorize token/wallet redesign. STOP before K.
```

---

# Prompt K — RMT Pay V1 admitted utility

```text
Work ONLY on RMT Pay Package K after Package J found a safe narrow path AND the owner separately approved exact utility/pricing/sponsored-gas economics/release scope.

Start latest-main fresh branch.

Read current authority, exact owner economics decision, CODEX_START_HERE_V1.md, PACKAGE_I_J_K_IMPLEMENTATION_V1.md, RMT_PAY_V1.md, RMT_PAY_COMPATIBILITY_V1.md, DATA_MODEL_V1.md, REFERENCE_INTERFACES_V1.md, PUBLIC_PROOFS_V1.md, THREAT_MODEL_V1.md.

Locked V1 economics:
protocol utility RMT -> 0x000000000000000000000000000000000000dEaD
native gas -> separate sponsor budget
NO automatic RMT -> ETH sale
NO treasury recycling
NO claim Solidity totalSupply decreased

Implement only exact owner-approved utility IDs and explicit versioned RMT price(s). Prefer fixed/explicit V1 price rather than a DEX-price/gas oracle unless owner explicitly approved another model.

Hash-bind RMT Pay policy: chain, RMT/runtime, dead address, utility target/selector, burn amount, max sponsored gas, validity and policy version.

Pre-sign: exact source/TBA owner, balance, burn destination/amount, utility target/selector, atomic batch, simulation, sponsor policy/gas cap and no DEX path.

Receipt: prove source decrease == burn amount, dead increase == burn amount, utility postcondition success, sponsored gas evidence, policy/receipt hashes. Only confirmed RMT Pay receipts count as protocol-attributed burns; arbitrary third-party dead-address transfers do not.

If sponsor budget unavailable, fail closed; do not sell RMT or silently switch to hidden user-paid ETH.

Run negative tests for wrong token/dead address/price/policy/owner/TBA/target/selector/DEX path/non-atomic utility/replay/gas cap/balance delta/uncertain tx.

Controlled canary then explicit release only. Report all policy/evidence/cost/burn metrics. Do not broaden utilities automatically. STOP.
```

## Final usage rule

Do not send Codex all A–K prompts at once. Use exactly one prompt for the package currently authorized. The point of this file is to preserve the sequence, not create an unbounded mega-task.
