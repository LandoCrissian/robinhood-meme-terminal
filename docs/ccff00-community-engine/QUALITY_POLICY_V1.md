# CCFF00 Community Engine quality and provenance policy V1

**Status:** PLANNING ONLY — AUTONOMOUS QUALITY THRESHOLD NOT YET APPROVED

The Community Engine must not equate “free” with “worth collecting.” Transaction safety and collection quality are separate gates.

## 1. Two independent gates

```text
candidate
  ↓
HARD TRANSACTION SAFETY
  ↓ PASS only
QUALITY / PROVENANCE EVIDENCE
  ↓ admitted policy
MINT ELIGIBLE
```

A high quality score can never override a hard safety failure.

A technically safe contract can still be spam, stolen art, low-effort farming, malicious metadata or an irrelevant collection. A reputable project can still deploy unsafe mint calldata. Both gates are required.

## 2. Hard safety is binary

Defined by `MINT_ADAPTERS_V1.md` and exact transaction evidence.

Possible result:

```text
PASS
FAIL
UNKNOWN
```

For automatic execution:

```text
UNKNOWN == FAIL CLOSED
```

## 3. Hard quality/provenance rejects

Independent of any numeric score, V1 should reject or remain observer-only when an admitted check proves one of these conditions:

- known malicious/phishing project identity;
- collection/mint source identity cannot be resolved enough to establish what is being minted;
- metadata/media points to a known malicious payload/domain;
- NFT is proven non-transferable/soulbound when Collector V1 requires post-mint distribution;
- transfer restrictions are incompatible with immediate/known-safe CCFF00 delivery;
- project explicitly prohibits bot/automated/community-collector participation and the engine would violate that rule;
- mint requires the collector to hold/deposit valuable unrelated tokens/NFTs;
- project terms/contract require bypassing a per-wallet/allowlist restriction;
- obvious impersonation/copycat identity is positively established;
- the collection is already automatically blocked by an explicit immutable/versioned denylist entry with evidence.

Absence of evidence is not automatically proof of maliciousness; it can produce `INSUFFICIENT_QUALITY_EVIDENCE`/observer-only instead.

## 4. Transferability is a quality + operational requirement

A free ERC-721 that cannot leave the collector is useless for this engine even if minting it is safe.

Before admitting a mint family/collection, obtain evidence that acquired NFTs can be transferred under expected post-mint state.

Possible evidence, strongest first:

1. fork rehearsal of exact mint followed by transfer to a test receiver under the candidate state;
2. exact source/runtime semantics proving normal ERC-721 transfer remains enabled after mint;
3. already-confirmed transfers from the same runtime/stage plus no state-dependent transfer lock, when independently verified.

For V1, if immediate transferability cannot be established with sufficient confidence:

```text
OBSERVE ONLY / REJECT AUTO-MINT
```

Do not acquire first and discover afterward that the NFT is soulbound.

## 5. Quality evidence dimensions

Observer Mode should collect versioned, attributable evidence rather than one opaque AI opinion.

Candidate dimensions:

### A. Project provenance

Examples:

- exact official project site/social account links to the collection/mint contract;
- collection contract links back to consistent metadata/project identity where meaningful;
- Hood/Robinhood ecosystem source references;
- operator `WATCH PROJECT` source evidence;
- established creator wallet/project history;
- signed/project-published allowlist information.

### B. Robinhood ecosystem relevance

Examples:

- explicitly launched on Robinhood Chain;
- project/community activity demonstrably focused on Robinhood Chain;
- CCFF00/HoodStreet/community-specific allocation;
- collaboration with an independently verified Robinhood project.

Chain presence alone is not enough.

### C. Collection activity

Bounded evidence can include:

- unique minters/holders;
- mint progress relative to supply;
- time since first mint;
- onchain transfer activity;
- concentration indicators.

Do not treat raw volume or mint velocity as proof of legitimacy; both can be manipulated.

### D. Metadata/media integrity

Evidence can include:

- URI availability;
- stable content addressing (IPFS/Arweave) versus mutable centralized URLs;
- bounded metadata schema validity;
- image/media resolvability through safe fetch policy;
- suspicious external URLs/scripts/content types;
- whether post-mint metadata can be arbitrarily changed by privileged roles.

Mutable metadata is not automatically bad, but it lowers certainty and must be disclosed/scored accordingly.

### E. Contract/project control surface

Even after mint transaction safety passes, quality evidence should record relevant control facts:

- proxy/upgradeability;
- owner/admin roles;
- pausing;
- metadata mutation;
- transfer restrictions;
- supply mutation where applicable;
- royalty/fee configuration as information, not necessarily a reject.

### F. Originality/impersonation indicators

Automated similarity/reputation checks may flag:

- copied name/logo/art;
- lookalike URLs;
- project identity conflicts;
- duplicated metadata across suspicious collections.

A heuristic flag should not publicly accuse a project of theft without stronger evidence. Use reason codes such as `IDENTITY_CONFLICT_REVIEW`.

## 6. Do not use financial performance to decide who gets what

Quality admission may decide whether the **community should spend gas acquiring a collection at all**.

After acquisition, never use:

- floor price;
- token rarity;
- highest bid;
- projected price;
- PnL;
- social momentum;
- operator preference

for recipient assignment.

Quality admission and fair allocation are separate domains.

## 7. Suggested evidence record

A future `MintQualityEvidenceV1` can contain:

```text
schemaVersion
candidateId
evaluatedAt
policyVersion
projectProvenance[]
robinhoodRelevance[]
activityEvidence
metadataEvidence
controlSurfaceEvidence
transferabilityEvidence
identityConflictEvidence
watchProjectEvidence | null
hardRejectReasons[]
scoredSignals[]
qualityScore | null
decision
qualityEvidenceHash
```

Possible decisions:

```text
INSUFFICIENT_EVIDENCE
OBSERVER_ONLY
REJECTED
ADMITTABLE
```

`ADMITTABLE` still requires the independent transaction-safety plan to pass.

## 8. Scoring is versioned, not magic

If a numeric score is used, every component weight/threshold must be explicit and versioned.

Do not let an LLM output an unstructured “82/100” that directly spends ETH.

A model may help extract/categorize evidence, but the release decision must reduce to a deterministic policy over structured signals or another explicitly reviewed mechanism.

The raw evidence and reason codes should be auditable.

## 9. Observer calibration before autonomous admission

Before autonomous quality admission is enabled:

1. collect a meaningful sample of real Robinhood free/near-free mint candidates;
2. run the proposed structured policy without signing;
3. record `WOULD_ADMIT` / `WOULD_REJECT` and reasons;
4. review false positives: garbage/scams that would have passed;
5. review false negatives: worthwhile community mints that would have failed;
6. adjust as a new policy version, never silently mutate historical decisions;
7. only then explicitly authorize an autonomous threshold.

Until that review occurs, Observer Mode can rank/summarize but cannot independently authorize spending community gas based only on the quality model.

## 10. WATCH PROJECT effect

`WATCH PROJECT` is a provenance/priority signal, not a safety bypass.

It may:

- ensure a candidate is polled closely;
- attach community/project source evidence;
- raise confidence that this is the intended contract when the source is strong.

It may not:

- set transaction safety to PASS;
- force quality admission;
- override nonzero mint price;
- bypass per-wallet/allowlist rules;
- override transferability failure.

## 11. Community-specific whitelist signal

If an independently verified project explicitly allocates a free mint to the CCFF00 community/collector, that is strong relevance/provenance evidence.

Still verify:

- exact contract;
- exact stage;
- exact recipient/minter identity;
- exact zero price;
- exact quantity;
- exact proof/signature semantics;
- transferability;
- all hard transaction checks.

Community whitelist status is not a blanket endorsement of every contract published by that project.

## 12. Metadata request security

Reuse RMT's bounded request patterns and add SSRF protections appropriate to outbound metadata retrieval.

Future fetcher requirements include:

```text
strict URL schemes
private/link-local/loopback destination rejection
redirect revalidation
response size limit
timeout
content-type policy
no executable rendering in server evaluator
safe handling of SVG/HTML
bounded nested metadata/media fetches
```

IPFS content should be requested through explicitly admitted gateways/client paths with the same bounds.

Never let NFT metadata read local files, cloud instance metadata, internal services or secrets.

## 13. Quality policy failure mode

If the quality provider/source/social API is unavailable:

- do not invent missing evidence;
- do not reuse expired social/provenance evidence beyond its admitted freshness;
- watched mint may remain `WAITING_FOR_QUALITY_EVIDENCE`;
- hard onchain safety checks can continue independently;
- automatic minting fails closed if required quality evidence is incomplete.

## 14. No promise of value

Public product language must not describe `ADMITTABLE` as:

- guaranteed valuable;
- investment-grade;
- likely to appreciate;
- risk-free;
- endorsed by Robinhood unless Robinhood actually says so.

The engine is a curated community acquisition system. A quality pass means the candidate met the published evidence policy, not that its market value will rise.

## 15. V1 success criterion

The quality engine succeeds when it can explain, reproducibly:

```text
why community gas was or was not spent on this free mint
```

without becoming a hidden price-prediction engine and without weakening the transaction-safety gate.
