# CCFF00 Community Engine quality calibration V1

**Status:** PLANNING ONLY — OBSERVER CALIBRATION DESIGN  
**Autonomous quality threshold:** deliberately not fixed until real Robinhood candidates are observed.

This document converts “don’t mint random garbage” into an auditable curation process without pretending RMT can predict NFT prices.

## 1. Quality admission purpose

Quality policy answers only:

> Is this project sufficiently attributable, relevant, functional and non-spammy to justify spending community gas on its zero-price mint?

It does **not** answer:

- Will the NFT increase in price?
- Is it a good investment?
- Is the creator guaranteed honest?
- Is one token ID rarer/better than another?

Those financial questions are explicitly outside Community Engine allocation.

## 2. Three-stage quality decision

```text
Stage 1: hard curation rejects
  ↓ pass
Stage 2: provenance/relevance route qualification
  ↓ route satisfied
Stage 3: calibrated soft evidence checks
  ↓
ADMITTABLE or OBSERVER_ONLY
```

Transaction safety remains a separate independent gate after/beside this process.

## 3. Stage 1 — hard curation rejects

Automatic quality admission is impossible if any proven condition applies:

```text
KNOWN_MALICIOUS_IDENTITY
UNRESOLVED_COLLECTION_IDENTITY
PROVEN_NONTRANSFERABLE
INCOMPATIBLE_TRANSFER_RESTRICTION
AUTOMATION_EXPLICITLY_PROHIBITED
REQUIRES_VALUABLE_UNRELATED_ASSET
REQUIRES_LIMIT_BYPASS
PROVEN_IMPERSONATION
MALICIOUS_METADATA_DESTINATION
EXPLICIT_POLICY_DENYLIST
```

A missing signal is not automatically one of these hard rejects. Use insufficient evidence when appropriate.

## 4. Stage 2 — qualifying provenance routes

Instead of one opaque score, V1 observer calibration should classify a candidate into one or more routes.

### Route Q1 — verified CCFF00/community allocation

Strongest community-specific route.

Require all:

- independently verified project identity;
- exact collection/mint contract bound to that project;
- independently verified statement/config that CCFF00 community/collector has an allocation or special zero-price stage;
- exact stage/quantity/proof semantics resolvable;
- no hard curation reject.

This route is strong provenance/relevance but still does not bypass transaction safety/transferability.

### Route Q2 — established Robinhood-native project

Require evidence such as:

- exact official project sources link to the Robinhood collection;
- existing Robinhood onchain project/collection history;
- nontrivial independent holders/minters/transfer activity;
- metadata/project identity consistent over time;
- no hard curation reject.

Exact activity thresholds are calibrated later.

### Route Q3 — independently corroborated emerging Robinhood project

For newer projects without a long history.

Require stronger corroboration, for example:

- at least two independent attributable identity/provenance sources;
- exact contract confirmation;
- Robinhood chain relevance clearly established;
- metadata/media available and bounded-safe;
- early onchain activity not completely concentrated in creator/test wallets;
- no hard curation reject.

Exact source/activity thresholds calibrated later.

### Route Q4 — operator WATCH with strong source evidence

WATCH alone is not sufficient.

It can qualify only when the operator-supplied source is independently resolvable to an attributable project/contract and remaining required evidence passes.

A pasted URL with no corroboration remains observer-only.

## 5. Evidence strength levels

Each evidence item should record a strength class rather than an unstructured narrative.

```text
PRIMARY_ONCHAIN
PRIMARY_PROJECT_SIGNED_OR_OFFICIAL
INDEPENDENT_ECOSYSTEM_SOURCE
MARKETPLACE_PROVIDER
SOCIAL_SELF_ASSERTION
HEURISTIC
UNKNOWN
```

Examples:

### PRIMARY_ONCHAIN

- contract owner/admin state;
- mint configuration;
- collection address/runtime;
- actual transfers/holders;
- signed allowlist data when verified cryptographically.

### PRIMARY_PROJECT_SIGNED_OR_OFFICIAL

- official domain/social directly publishing exact contract;
- signed project message;
- project-controlled GitHub/docs with contract identity.

### INDEPENDENT_ECOSYSTEM_SOURCE

- independently verified CCFF00/HoodStreet/community reference;
- trusted Robinhood ecosystem directory/reference whose identity is independently established.

### MARKETPLACE_PROVIDER

- OpenSea collection/drop metadata.

Useful corroboration, but not enough alone for high-confidence identity.

### SOCIAL_SELF_ASSERTION

- new/unverified account saying “official contract is X.”

Low confidence alone.

### HEURISTIC

- name similarity;
- follower count;
- velocity;
- image similarity.

Never sufficient alone.

## 6. Structured evidence item

Reference:

```ts
type QualityEvidenceItemV1 = {
  evidenceId: Hex;
  category:
    | "PROJECT_IDENTITY"
    | "ROBINHOOD_RELEVANCE"
    | "COMMUNITY_ALLOCATION"
    | "ONCHAIN_ACTIVITY"
    | "METADATA_INTEGRITY"
    | "CONTROL_SURFACE"
    | "TRANSFERABILITY"
    | "IDENTITY_CONFLICT";
  strength:
    | "PRIMARY_ONCHAIN"
    | "PRIMARY_PROJECT_SIGNED_OR_OFFICIAL"
    | "INDEPENDENT_ECOSYSTEM_SOURCE"
    | "MARKETPLACE_PROVIDER"
    | "SOCIAL_SELF_ASSERTION"
    | "HEURISTIC"
    | "UNKNOWN";
  sourceId: string;
  sourceReference: string;
  observedAt: string;
  freshnessSeconds: UintString | null;
  evidenceHash: Hex;
};
```

Raw source content can remain off-artifact where copyright/secrets/size require; preserve bounded hashes/references.

## 7. Required facts independent of route

Before `ADMITTABLE`, quality policy should require at least:

```text
project/collection identity resolved
Robinhood relevance resolved
metadata/media safety status known enough for presentation
transferability evidence sufficient
control surface recorded
no unresolved high-confidence impersonation conflict
```

A project can still be `OBSERVER_ONLY` if hard transaction safety would pass but provenance remains weak.

## 8. Activity metrics — calibration only

Observer may collect:

```text
unique initial minters
unique current holders
minted supply
configured max supply
transfer count
unique transfer participants
holder concentration
creator/reserve concentration
age since first mint
```

Do not make an uncalibrated fixed rule like:

```text
100 holders = good
99 holders = garbage
```

Instead use the observer dataset to understand normal Robinhood collection shapes.

## 9. Concentration evidence

Useful indicators:

```text
top1 holder share
top5 share
top10 share
creator/project-reserve share
number of EOAs/contracts holding
```

High concentration is not automatically malicious—new mints/reserves can be concentrated. Record as context, not a financial prediction.

## 10. Metadata integrity categories

Normalize:

```text
CONTENT_ADDRESSED
HTTPS_MUTABLE
ONCHAIN
UNAVAILABLE
UNSAFE
UNKNOWN
```

Record separately:

- tokenURI source;
- collection/base URI mutability/admin control;
- response/content type;
- content hash where safely fetched;
- external clickable URL presence;
- unsafe URL indicators.

A mutable HTTPS URI may be admitted with disclosure if other evidence is strong. `UNSAFE` blocks auto admission.

## 11. Control surface categories

Record facts, not automatically moral judgments:

```text
proxy upgradeable yes/no/unknown
owner/admin address
pause capability
transfer lock capability
metadata mutation capability
mint/supply authority
burn authority
operator filtering/restriction capability
```

A normal admin role does not automatically reject, but unknown/highly unusual control can require observer review.

## 12. Identity-conflict pipeline

Automated heuristics may detect:

```text
near-identical name/symbol
lookalike domain
copied image hash/perceptual similarity
same metadata URI as unrelated project
conflicting official contract claims
```

Output:

```text
NO_CONFLICT_FOUND
LOW_CONFIDENCE_FLAG
REVIEW_REQUIRED
PROVEN_CONFLICT
```

Only `PROVEN_CONFLICT` becomes a hard curation reject without further review.

Do not publicly accuse based only on heuristic similarity.

## 13. Calibration dataset record

For each real observer candidate:

```ts
type QualityCalibrationCaseV1 = {
  caseId: Hex;
  candidateId: Hex;
  observedAt: string;
  routeCandidates: string[];
  evidenceHash: Hex;
  policyVersion: number;
  proposedDecision: "ADMITTABLE" | "OBSERVER_ONLY" | "REJECTED" | "INSUFFICIENT_EVIDENCE";
  proposedReasonCodes: string[];
  reviewerDecision: "WOULD_ADMIT" | "WOULD_REJECT" | "NEEDS_MORE_EVIDENCE";
  reviewerReasonCodes: string[];
  falsePositiveClass: string | null;
  falseNegativeClass: string | null;
};
```

The reviewer stage is pre-production calibration, not ongoing manual approval of every live mint.

## 14. Calibration target

Collect a broad enough sample to include:

- known worthwhile Robinhood community projects;
- known low-effort/spam collections;
- safe-but-irrelevant free mints;
- new/emerging real projects;
- mutable metadata projects;
- allowlist/community-specific projects;
- unknown custom contracts;
- projects with low/high concentration;
- impersonation/lookalike examples where evidence exists.

Do not cherry-pick only examples that make the policy look good.

## 15. Observer confusion matrix

For each proposed policy version summarize:

```text
reviewer WOULD_ADMIT + policy admits          true-positive-like
reviewer WOULD_REJECT + policy rejects        true-negative-like
reviewer WOULD_REJECT + policy admits         false positive (most dangerous)
reviewer WOULD_ADMIT + policy rejects         false negative
needs-more-evidence                            unresolved
```

The labels are curation-policy calibration, not ground-truth investment labels.

Prioritize reducing false positives that waste community gas/collect obvious garbage.

## 16. Autonomous policy version

After calibration, freeze a deterministic `MintQualityPolicyV1` containing:

```text
policyVersion
required evidence categories
acceptable evidence-strength combinations
qualifying route rules
freshness windows
activity thresholds if empirically justified
metadata requirements
control-surface blockers/review rules
hard reject reasons
quality decision algorithm
policyHash
validFrom
```

No hidden model weights.

## 17. LLM role if used

An LLM may help:

- summarize official project descriptions;
- classify a source into evidence category;
- extract contract address mentions;
- flag conflicting names/claims for deterministic verification.

An LLM must not directly:

```text
sign transaction
set final safety PASS
set final quality score from vibes
predict price
pick recipient
pick NFT
change policy threshold
```

Any extracted address/source claim is revalidated with deterministic parser/onchain evidence.

## 18. Autonomous production decision

Once policy is explicitly approved:

```text
qualityEvidence
→ deterministic policy evaluation
→ ADMITTABLE / OBSERVER_ONLY / REJECTED
```

No human must approve every mint for the engine to be autonomous.

Operator WATCH remains an input signal/priority, not a per-mint approval button.

## 19. Policy staleness

Quality evidence has category-specific freshness.

Examples:

- immutable contract/runtime evidence stable until code/proxy state changes;
- current stage/config must be fresh at execution;
- project official source may have longer freshness but contract conflict triggers refresh;
- social/account activity is soft evidence and should not be a permanent trust anchor.

If required evidence expired/unavailable:

```text
WAIT / OBSERVER_ONLY
```

rather than silently using stale evidence.

## 20. Public quality explanation

Expose concise reasons such as:

```text
Verified project-to-contract provenance
Robinhood-native project evidence
CCFF00 community allocation verified
Transferability verified
Metadata available/content-addressed
No high-confidence identity conflict
```

or:

```text
Not admitted: insufficient project provenance
```

Do not expose private operator notes or raw model prompts.

## 21. Package C/D calibration workflow

### Package C

- collect quality evidence;
- run proposed route/status without signing;
- persist/export calibration cases;
- manually review sample outside transaction path.

### Between C and D / before autonomous quality release

- compare false positives/negatives;
- create explicit policy version;
- owner reviews/authorizes autonomous quality policy.

### Package D+

- use frozen policy hash in mint plan;
- quality evidence refreshed as required;
- safety remains independent.

## 22. Success standard

The quality system is ready for autonomous use when:

1. every decision is explainable from structured evidence;
2. no LLM/soft signal can independently spend ETH;
3. known garbage/spam calibration cases are rejected/observer-only at an acceptable false-positive rate;
4. known good community cases are not systematically excluded;
5. policy is versioned/hash-bound;
6. quality changes require a new reviewed version;
7. recipient allocation remains completely independent from quality/value scoring after acquisition.
