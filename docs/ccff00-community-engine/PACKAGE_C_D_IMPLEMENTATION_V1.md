# CCFF00 Community Engine Packages C/D implementation packet V1

**Status:** PLANNING ONLY — FUTURE OPENAI CODEX IMPLEMENTATION PACKET  
**Packages:** C = observer discovery; D = mint adapter/admission plan  
**Signer:** explicitly absent in both packages.

Packages C/D transform external NFT-drop information into a locally verified, unsigned RMT execution plan. They do not mint anything.

## 1. Preconditions

Before Package C:

- Packages A/B accepted;
- latest current-owner/provenance evidence exists;
- project explicitly opened for Package C;
- fresh branch from latest `main`;
- read current repository authority plus:

```text
DECISION_REGISTER_V1.md
SPEC_CONSISTENCY_V1.md
MINT_ADAPTERS_V1.md
QUALITY_POLICY_V1.md
THREAT_MODEL_V1.md
DATA_MODEL_V1.md
ERROR_CODES_V1.md
ACCEPTANCE_MATRIX_V1.md
UPSTREAM_REUSE_V1.md
this packet
```

Package D starts only after C observer output is reviewed on real Robinhood examples.

# Package C — Observer Mode

## 2. Package C objective

Build a read-only candidate pipeline that can answer:

> What Robinhood NFT mint opportunities are currently observable, which appear to have a zero-price stage, and what evidence do we have about them?

It must not answer:

> What transaction should we sign?

That belongs to Package D after local verification.

## 3. Provider-neutral candidate core

Preferred pure domain file:

```text
apps/web/lib/vnext/community-engine-candidate.ts
```

Responsibilities:

- normalized candidate schema;
- deterministic `candidateId`/hash;
- lifecycle/status/reason codes;
- provider-agnostic canonicalization;
- no network calls;
- no signer/wallet code.

Suggested server adapters:

```text
apps/web/lib/server/vnext-community-engine-opensea.ts
apps/web/lib/server/vnext-community-engine-watch.ts
apps/web/lib/server/vnext-community-engine-evidence.ts
```

Names may adapt to latest repo conventions.

## 4. OpenSea adapter boundary

Package C should live-probe the current Drops API rather than assuming planning-time support.

Probe should establish:

- API endpoint reachable/auth works;
- whether Robinhood chain can be filtered or results identify chain 4663;
- stage timing fields;
- price/value metadata;
- max-per-wallet/remaining supply availability;
- transaction-build endpoint availability for a known candidate if safe to call in read-only mode.

A provider API call that returns transaction calldata is still read-only if it does not submit/sign.

### Provider response handling

- bounded timeout;
- bounded response bytes;
- schema validation;
- no raw `any` use beyond adapter boundary;
- no API key in logs/artifacts;
- stable provider failure mapping;
- stale response timestamp recorded.

If OpenSea cannot provide useful Robinhood discovery at implementation time:

```text
PROVIDER_UNAVAILABLE / unsupported
```

and continue with WATCH/project/onchain observation rather than scraping browser UI.

## 5. WATCH PROJECT input

Package C should support a normalized operator input path without exposing execution authority.

Accepted classes:

```text
OpenSea/drop URL
project mint URL
collection address
mint-target address
optional expected stage window
optional expected collector allowlist status
optional collector proof data/reference
bounded operator note
```

### Critical absence

No fields/functions equivalent to:

```text
forceApprove
forceMint
skipSimulation
skipQuality
skipSafety
recipientOverride
quantityOverrideBeyondPolicy
```

A watch entry only changes observation priority/evidence context.

## 6. URL/input security

If server fetches a user-supplied mint URL:

- do not blindly server-fetch arbitrary internal/private-network URLs;
- apply explicit `https`/admitted origin policy or avoid fetching arbitrary pages entirely in V1;
- normalize addresses independently from page contents;
- bound redirects/response size/time;
- do not execute page JavaScript;
- never run wallet automation against the page.

Preferred V1 WATCH behavior is to treat URL as a reference and use known provider/onchain identities rather than general web scraping.

## 7. Candidate identity

Conceptual identity inputs:

```text
source family
chainId
collection
mint target
stage identity
```

Do not include volatile fields such as current mint count in `candidateId`; those belong in observations/evidence.

Duplicate OpenSea + WATCH observations should normalize into one candidate identity with multiple evidence sources where identities match.

## 8. Candidate state snapshots

Do not mutate history invisibly.

Conceptual evidence:

```text
candidate
observations[]:
  provider/source
  observedAt
  stage fields
  providerEvidenceHash
```

Current normalized state can select latest valid observation but retain evidence history if persistent observer storage is later introduced.

For Package C, deterministic CLI/test artifacts are enough; no database is required unless current repo architecture already has an explicitly appropriate read-only mechanism.

## 9. Candidate statuses

At minimum:

```text
WOULD_INSPECT
NOT_FREE
NOT_ACTIVE
EXPIRED
WRONG_CHAIN
UNKNOWN_ADAPTER
PROVIDER_UNAVAILABLE
MALFORMED
```

Package C must not emit `APPROVED_TO_SIGN`.

## 10. Zero-price observation

Provider-reported price is a **candidate signal**, not final safety proof.

Package C can label:

```text
observed price = 0
```

but Package D independently checks exact decoded mint price + exact tx `value == 0`.

Public/operator wording:

```text
Observed zero-price candidate
```

not:

```text
Guaranteed free mint
```

## 11. Quality observer

Package C runs `QUALITY_POLICY_V1` in observer mode.

Capture explainable evidence dimensions but do not auto-sign based on score.

Output should make separate fields/statuses for:

```text
hard transaction safety: not evaluated / later Package D
curation quality: pass/reject/pending
```

A technically safe mint can be curated out as spam/low confidence.

A quality pass cannot bypass hard safety.

## 12. Package C CLI

Suggested read-only script:

```text
apps/web/scripts/vnext-community-engine-observe.ts
```

Possible modes:

```text
--discover
--watch=<url-or-address>
--collection=<address>
--json=summary|full
```

No private key/env signer input.

Output examples:

```json
{
  "mode": "observer",
  "chainId": 4663,
  "candidates": 4,
  "wouldInspect": 1,
  "notFree": 1,
  "unknownAdapter": 1,
  "providerUnavailable": 1
}
```

## 13. Package C tests

- same candidate from OpenSea/WATCH dedupes;
- wrong chain rejects;
- nonzero observed price gets NOT_FREE;
- expired stage gets EXPIRED;
- future stage gets NOT_ACTIVE but remains watched;
- malformed provider response fails boundedly;
- provider timeout does not crash whole observer;
- malformed URL/address rejects;
- watch record cannot contain safety override;
- output/hash stable under observation ordering where semantics identical;
- provider secrets absent from artifact/log fixture;
- quality observer output separate from safety.

## 14. Package C completion report

Codex returns:

```text
provider capabilities observed
real Robinhood candidate examples
how many zero-price-looking candidates
how many unknown adapters
quality observer outcomes
files/tests
blockers
```

Then STOP.

---

# Package D — Mint Adapter / Safety Admission

## 15. Package D objective

Transform one normalized observed candidate into:

```text
WOULD_MINT unsigned plan
```

or a precise reject reason by independently verifying the exact mint contract semantics and transaction.

Still:

```text
NO SIGNER
NO BROADCAST
```

## 16. Positive adapter model

Preferred core files:

```text
apps/web/lib/vnext/community-engine-mint-domain.ts
apps/web/lib/vnext/community-engine-mint-adapters.ts
apps/web/lib/vnext/community-engine-mint-plan.ts
apps/web/lib/server/vnext-community-engine-mint-verifier.ts
```

Avoid generic target/calldata executor.

## 17. Initial adapter selection

Start with the smallest mint family encountered in real Package C evidence and whose semantics can be independently proven.

SeaDrop is a strong first reference **if** the actual Robinhood target/runtime/collection proves compatible.

Do not hard-code a SeaDrop deployment from Ethereum/Base docs as Robinhood authority.

Package D should report if no current observed safe family is suitable; it does not need to force an adapter just to complete work.

## 18. SeaDrop adapter semantics if selected

For public mint, verify/decode semantics equivalent to:

```text
mintPublic(
  nftContract,
  feeRecipient,
  minterIfNotPayer,
  quantity
)
```

Relevant V1 checks:

- `nftContract == admitted collection`;
- exact SeaDrop target/runtime is admitted;
- final minter/recipient semantics resolve to collector or intended supported flow;
- if collector is payer but recipient differs, target collection explicitly allows collector as payer;
- current public drop stage active;
- `mintPrice == 0`;
- transaction native value == 0;
- quantity within `maxTotalMintableByWallet`;
- collection stage/supply limits pass;
- fee recipient restriction semantics known;
- receipt events/postconditions known.

### SeaDrop allowlist

For allowlist adapter, verify exact leaf construction/proof semantics from admitted implementation. Proof must bind exact minter + mint params.

Do not accept a proof generated for a different holder address.

### SeaDrop signed mint

Treat separately from public/allowlist. Verify allowed signer/validation params/signature replay semantics. Do not collapse multiple SeaDrop selectors into one loose adapter.

## 19. Runtime/proxy evidence

Package D must classify:

```text
collection target
mint target
```

as direct/proxy/minimal proxy/known family.

For EIP-1967:

- read implementation slot at exact verification block;
- verify implementation code/hash;
- include both proxy and implementation identities in plan.

For minimal proxy:

- decode exact implementation from runtime pattern;
- verify implementation runtime.

Unknown delegation/proxy behavior remains observer-only.

## 20. Final pre-plan state reads

Read all adapter-required current state at one explicit block where practical:

```text
stage start/end
mint price
max per wallet
current minted-by-wallet if exposed/derivable
max stage supply
allowlist root / allowed payer status
collection transferability-relevant state when needed
```

Hash-bind evidence.

## 21. Transferability admission before mint

Collector V1 must not intentionally acquire an NFT it cannot distribute.

Package D needs a family-specific way to establish at least one of:

- collection follows standard transferable ERC-721 semantics with no known transfer lock;
- source/runtime family and state reads prove transfers are currently allowed;
- local fork/simulation proves representative transfer from collector to a test/compatible receiver under exact current state.

Unknown/soulbound/nontransferable behavior:

```text
DO NOT AUTO-MINT
```

This is separate from CCFF00 TBA receiver compatibility, which Package F proves.

## 22. Fairness quantity preflight

Mint admission is not only a creator limit.

Before unsigned plan:

1. read a fresh current census for planning/preflight;
2. load current confirmed service levels;
3. find current floor;
4. remove seats already covered by this collection under V1 policy;
5. compute eligible count;
6. compute admitted quantity as min of:
   - creator wallet limit remaining;
   - authoritative remaining supply if known;
   - local policy max;
   - eligible uncovered current-floor seats.

If zero:

```text
NO_ELIGIBLE_FAIRNESS_RECIPIENTS
```

If provider/contract requires a larger exact quantity than admitted:

```text
MINT_QUANTITY_EXCEEDS_FAIRNESS_COHORT
```

Do not mint surplus inventory.

The final allocation census later anchors to acquisition block; the preflight exists to prevent knowingly over-acquiring before signing.

## 23. Collector model for Package D

There is no live collector signer yet, but use a configured **model address** so calldata/eligibility/limits can be evaluated.

Do not use admin/treasury address as the model just because collector does not yet exist. Package D may use a deterministic fixture/test address for local plans, while Package G later binds the real isolated collector.

Live provider eligibility depending on a collector address may remain unresolved until Package G if no real collector has been admitted.

## 24. Exact simulation

Simulation should use the exact:

```text
from/model collector
to mint target
calldata
value=0
block/latest state
```

Capture:

- success/revert;
- estimated gas;
- returned data where relevant;
- state/log expectations available from fork simulation.

Do not use simulation success as the only admission signal.

## 25. Mint plan construction

Plan must bind at least fields defined in `REFERENCE_INTERFACES_V1.md`, especially:

```text
candidateId
adapter/version
collector
collection/runtime
target/runtime
proxy implementation if any
selector
calldataHash
nativeValue=0
quantity
stage evidence
eligibility evidence
fairness preflight
estimated gas
validity window
policy version
plan hash
```

Provider raw response is not the plan.

## 26. Plan validity/expiration

Use a short bounded expiry relative to stage/runtime/state evidence, not an indefinitely reusable plan.

Even before expiry, a future signer must refresh:

- chain;
- runtime/proxy identity;
- stage/price;
- eligibility;
- gas policy;
- engine START state;
- collector policy.

Package D should implement/define verification function now even though signing arrives later.

## 27. Package D adversarial fixture set

Mutate one field at a time from a valid fixture:

- wrong chain;
- target address;
- collection;
- selector;
- quantity;
- recipient/minter;
- payer;
- transaction native value 1 wei;
- decoded mint price nonzero;
- expired stage;
- future stage;
- max-per-wallet exceeded;
- proxy implementation changed;
- target runtime changed;
- allowlist proof address changed;
- signature replay/used digest when adapter supports it;
- fee recipient restriction violation;
- gas exceeds cap;
- simulated revert;
- transferability unknown;
- fairness cohort quantity smaller than requested;
- no eligible floor recipients;
- quality rejected.

Every case must reject deterministically with stable code.

## 28. Package D output statuses

```text
WOULD_MINT
REJECTED
UNKNOWN_ADAPTER
QUALITY_REJECTED
ELIGIBILITY_UNRESOLVED
```

`WOULD_MINT` means an unsigned plan passed evidence. It does not mean a transaction will be submitted.

## 29. Package D completion report

Codex reports:

```text
adapter(s) implemented
exact runtime/family evidence
real/synthetic candidates tested
valid WOULD_MINT plan hashes
all rejection fixtures/results
fairness preflight behavior
gas estimates
transferability evidence
remaining unknowns
```

Then STOP before signer work.

## 30. C/D non-negotiable boundary

At the end of Package D, RMT may know exactly **what it would sign**, but no component created in C/D can sign it.

That separation is intentional evidence that provider ingestion and private-key authority are not coupled.
