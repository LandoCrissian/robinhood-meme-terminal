# CCFF00 Community Engine integration map V1

**Status:** PLANNING ONLY — FUTURE CODEX FILE/BOUNDARY GUIDE  
**Goal:** show where future implementation belongs in the existing RMT repository and where it explicitly does not belong.

This map is intentionally conservative. Future Codex work must still inspect latest `main` before editing because repository ownership can change after this planning branch was created.

## 1. Canonical rule

Do not create a parallel framework when an existing RMT primitive already owns the lower-level concern.

The Community Engine should be assembled as a new domain over existing VNext CCFF00, distribution, chain, verification and wallet primitives.

## 2. Existing source that remains authoritative

### `apps/web/lib/vnext/distribution-ccff00.ts`

Authority for:

- canonical CCFF00 collection address;
- public/reserve supply boundaries;
- canonical ERC-6551 registry;
- canonical account implementation;
- canonical salt;
- pinned-block `ownerOf` reads;
- pinned-block TBA resolution;
- runtime evidence;
- activation status.

Future census code should **wrap/reuse** this domain rather than duplicate its constants/ABIs.

If an implementation needs currently private public-range constants, prefer a minimal reviewed export/refactor rather than copying literal values into another file.

### `apps/web/lib/vnext/distribution-ccff00-owner-withdrawal-proof.ts`

Authority/reference for:

- current owner control of canonical TBA;
- exact TBA `execute` semantics;
- exact RMT movement proof shape;
- runtime identity binding;
- receipt/log verification style.

Future NFT canary/RMT Pay preflight should reuse its proof conventions where applicable rather than inventing unrelated evidence formats.

### `apps/web/lib/vnext/distribution-domain.ts`

Authority/reference for:

- canonical JSON/hash conventions;
- chain ID constant;
- deterministic domain separation style;
- NFT identity representation;
- manifest/batch evidence patterns.

Community Engine schemas can define their own domain separators but should use the same serialization discipline.

### `packages/contracts/src/RMTDistributionEngineV1.sol`

Security reference only for:

- sender binding;
- replay protection;
- exact asset ownership checks;
- post-transfer verification;
- no arbitrary target/call surface;
- no custody/rescue/sweep design.

Do **not** inherit its existing per-recipient RMT retirement economics for Community Engine NFT distribution.

### `scripts/metamask-agent-wallet-preflight.mjs`

Current signer-capability evidence only.

Do not weaken its current transaction-disabled posture as a shortcut. Any future Community Engine collector signer gets its own explicit admission/preflight/release boundary.

### `packages/contracts/src/ProtocolPurposeVault.sol`

Architecture reference for purpose-bound ETH storage only.

It is not automatically the Community Engine gas vault and does not authorize any current revenue redirection.

### Existing RMT verification/fail-closed patterns

When adding provider/mint verification, prefer the existing style already used throughout VNext:

- exact runtime/codehash evidence;
- explicit provider capability levels;
- hash-bound plans;
- fresh pre-sign verification;
- exact receipt reconciliation;
- no implicit fallback.

## 3. Explicit non-targets

### `apps/indexer`

Do not add CCFF00/community/NFT provenance state here. Current repository authority defines it as deployed RMT V6 compatibility/history.

Use bounded read-only RPC/log evidence for Packages A/B first.

### `apps/market-indexer`

Do not hide Community Engine execution here. It is read-oriented external market intelligence.

A future execution worker is a separate architecture decision.

### `apps/external-origin-indexer`

Do not use project-origin attribution as NFT mint authorization. Origin evidence and mint safety are separate concerns.

### Paused creator/V7/NFT marketplace code

Do not revive historical creator/NFT marketplace architecture merely because this project involves NFTs. The Community Engine is not an NFT launch/creator platform.

### Current trading/execution fee path

Do not modify `RMT_EXECUTION_V1` or the active Uniswap V3 fee executor to fund/enable the Community Engine.

## 4. Package A suggested placement

Read-only CCFF00 Community Census.

Preferred shape, subject to latest-main inspection:

```text
apps/web/lib/vnext/ccff00-community-census.ts
apps/web/lib/vnext/ccff00-community-census-smoke.ts
apps/web/scripts/vnext-ccff00-community-census.ts
```

Responsibilities:

`ccff00-community-census.ts`

- accept/validate an existing full-public CCFF00 snapshot;
- group by current owner;
- canonicalize/hashing;
- expose deterministic summary;
- contain no RPC client creation if the existing snapshot reader can remain separate.

`ccff00-community-census-smoke.ts`

- pure deterministic/fail-closed fixtures;
- no live RPC dependency.

`vnext-ccff00-community-census.ts`

- read-only CLI;
- creates current Robinhood public client;
- obtains full-public snapshot through existing CCFF00 reader;
- produces concise JSON by default;
- optional flag writes/prints full artifact;
- no database/UI/API route.

Potential package script after implementation:

```text
readiness:vnext-ccff00-community-census
```

Do not automatically add it to production `prebuild` merely because it exists. Decide release-lane integration only after the domain becomes active authority.

## 5. Package B suggested placement

Read-only original mint provenance.

Preferred shape:

```text
apps/web/lib/vnext/ccff00-mint-provenance.ts
apps/web/lib/vnext/ccff00-mint-provenance-smoke.ts
apps/web/scripts/vnext-ccff00-mint-provenance.ts
```

Responsibilities:

- verify exact collection/start boundary;
- chunk `Transfer` log reads;
- select only zero-address creation events;
- map public token IDs to initial recipients;
- canonicalize/hash artifact;
- support resume from an explicitly verified prior checkpoint artifact without an always-on database.

Do not couple provenance to current entitlement logic except through explicit read-only analytics/reporting.

## 6. Package C suggested placement

Observer-mode discovery is server-side external-provider work.

Preferred conceptual split:

```text
apps/web/lib/vnext/community-engine-candidate.ts
apps/web/lib/server/vnext-community-engine-opensea.ts
apps/web/lib/server/vnext-community-engine-watch.ts
apps/web/lib/server/vnext-community-engine-evidence.ts
```

Exact names can change to match latest repository conventions.

`community-engine-candidate.ts`

- provider-neutral normalized candidate schema;
- canonical candidate identity/hash;
- status/reason enums;
- no network access.

`vnext-community-engine-opensea.ts`

- provider adapter only;
- timeout/bounded response parsing;
- normalize to internal candidate;
- no signing.

`vnext-community-engine-watch.ts`

- normalize operator watch input;
- priority observation semantics;
- no force-approval bit.

`vnext-community-engine-evidence.ts`

- combine provider, onchain/runtime and explorer evidence;
- server-only secrets/API credentials;
- no client exposure.

Use the existing bounded-fetch/request-guard patterns for any operator/server endpoints later.

## 7. Package D suggested placement

Mint plan/admission should remain a VNext domain with server-side evidence adapters.

Conceptual split:

```text
apps/web/lib/vnext/community-engine-mint-domain.ts
apps/web/lib/vnext/community-engine-mint-adapters.ts
apps/web/lib/vnext/community-engine-mint-plan.ts
apps/web/lib/server/vnext-community-engine-mint-verifier.ts
```

Keep adapter definitions declarative/pure where possible.

The final unsigned plan should be client-safe only if it contains no secret proof material that should remain server-side. Merkle proofs/signature payloads require explicit disclosure classification.

No signer in Package D.

## 8. Package E suggested placement

Fair allocation should be pure deterministic domain logic.

Preferred shape:

```text
apps/web/lib/vnext/community-engine-fairness.ts
apps/web/lib/vnext/community-engine-randomness.ts
apps/web/lib/vnext/community-engine-fairness-smoke.ts
apps/web/lib/vnext/fixtures/community-engine-fairness-v1/*.json
```

Requirements:

- no network calls inside allocator;
- no funding ledger dependency;
- no marketplace/value dependency;
- randomness passed as verified record/interface;
- deterministic canonical output;
- property tests runnable without RPC.

Production drand adapter should be separate from allocation logic, likely server-side:

```text
apps/web/lib/server/vnext-community-engine-drand.ts
```

Do not let HTTP response parsing sit inside fairness algorithm.

## 9. Package F suggested placement

CCFF00 external ERC-721 receipt/withdrawal proof should live near existing CCFF00 proof domains.

Conceptual files:

```text
apps/web/lib/vnext/ccff00-nft-custody-proof.ts
apps/web/lib/vnext/ccff00-nft-custody-proof-smoke.ts
apps/web/scripts/vnext-ccff00-nft-custody-canary.ts
```

It should reuse canonical collection/TBA configuration and existing proof transaction/log types where sensible.

Do not modify the deployed CCFF00 contracts.

## 10. Package G suggested placement

Collector signer preflight should be separate from normal user trading-wallet code.

Possible shape:

```text
scripts/community-engine-collector-preflight.mjs
scripts/community-engine-collector-preflight.test.mjs
```

or a dedicated future worker package if latest architecture has already established one.

It must validate collector identity/balances/approvals/policy without sharing admin/treasury credentials.

Do not generalize `metamask-agent-wallet-preflight.mjs` into an all-purpose signer switch.

## 11. Package H future service ownership

Do not choose a service directory until Package H authorization.

Required architecture decision should answer:

- what process owns single-writer execution?;
- where durable state lives?;
- how leader election/lease works if more than one replica exists?;
- how provider/watch observations arrive?;
- how STOP is represented durably?;
- where signing credential is mounted?;
- how read-only UI/API obtains status without signer access?;
- how reconciliation runs while STOPPED?;
- how secrets are separated from public web runtime?

A likely future shape may be:

```text
apps/community-engine-worker/
```

but this planning track does **not** pre-authorize that directory/service.

## 12. Package I contract placement

If an immutable gas vault is eventually justified:

```text
packages/contracts/src/CCFF00CollectorGasVaultV1.sol
packages/contracts/test/CCFF00CollectorGasVaultV1.t.sol
packages/contracts/script/... only after deployment preparation is separately authorized
```

Reuse current Foundry/OpenZeppelin conventions.

No deployment artifact should be created before contract/economics/deployer decisions are explicit.

## 13. Package J RMT Pay preflight placement

Keep compatibility proof separate from production utility.

Possible shape:

```text
apps/web/lib/vnext/rmt-pay-domain.ts
apps/web/lib/vnext/rmt-pay-compatibility.ts
apps/web/lib/vnext/rmt-pay-compatibility-smoke.ts
apps/web/scripts/vnext-rmt-pay-compatibility.ts
```

Server/provider sponsorship probes can live under:

```text
apps/web/lib/server/vnext-rmt-pay-*.ts
```

The preflight should reuse the canonical RMT address/runtime evidence already present in CCFF00/distribution domains rather than duplicate token identity.

No RMT token redeployment or migration.

## 14. Package K RMT Pay utility placement

Only after compatibility/economics approval.

Keep three layers distinct:

```text
rmt-pay-domain
  → pure policy/receipt/accounting

rmt-pay-verifier
  → exact target/selector/burn/simulation evidence

rmt-pay-submission
  → wallet/account-abstraction submission only after all gates
```

Do not mix pricing policy, provider secrets and wallet submission into one route/module.

## 15. Suggested error-code ownership

Define error/status enums in pure domains and map provider-specific exceptions to them server-side.

Examples:

```text
CCFF00_CENSUS_*
CCFF00_PROVENANCE_*
COMMUNITY_CANDIDATE_*
COMMUNITY_MINT_*
COMMUNITY_RANDOMNESS_*
COMMUNITY_ALLOCATION_*
COMMUNITY_DELIVERY_*
COMMUNITY_COLLECTOR_*
COMMUNITY_GAS_*
RMT_PAY_*
```

Never leak raw provider/internal error payloads to public UI when they may contain credentials/implementation details.

## 16. Evidence/fixture organization

Small deterministic fixtures can live beside VNext tests.

Historical/live evidence artifacts that must be checked in should follow existing repository evidence conventions and remain sanitized.

Do not check in:

- API keys;
- private keys;
- signed production transactions unless explicitly part of sanitized public evidence;
- bearer tokens;
- complete provider responses containing secrets;
- user-specific private metadata.

## 17. Public UI placement later

No public UI is part of Packages A–G unless separately authorized.

When UI is eventually admitted, it belongs inside the single canonical VNext terminal experience, not a second terminal shell.

Possible surfaces:

- Community Engine status;
- gas fund/public accounting;
- watched/approved/rejected drops;
- public allocation proofs;
- CCFF00 collection inventory/history;
- RMT Pay burn metrics.

The UI must be read-oriented; operator signing controls should remain behind explicit authenticated operational boundaries rather than public client state.

## 18. Test-lane integration strategy

During planning/early packages:

- run focused package tests;
- run existing CCFF00/distribution tests affected by shared code;
- typecheck;
- run current required release lane if the touched source participates in it.

Do not add every new observer/planning test to `prebuild` by default. Once the Community Engine becomes an active production domain, establish one named aggregate test lane and then decide whether terminal-release should call it.

Possible future aggregate command:

```text
test:vnext-community-engine
```

This is a naming suggestion, not an active script decision.

## 19. Configuration ownership

Future configuration should be versioned and fail closed.

Separate:

- public/read-only feature state;
- provider observation credentials;
- signer authorization;
- gas caps;
- mint adapter allowlist;
- randomness source identity;
- RMT Pay utility policy;
- production activation.

No single boolean should enable all capabilities.

Observation, verification, signing and production activation remain independent gates, consistent with VNext provider philosophy.

## 20. Migration/handoff rule

The planning branch is reference material only.

When implementation begins:

1. latest `main` wins for repository structure;
2. Codex reads this branch's specs;
3. Codex creates a new branch from latest `main`;
4. Codex implements one package only;
5. if latest `main` conflicts with a suggested path, preserve the architectural boundary and adapt the filename/location;
6. do not rebase/merge this planning branch into runtime merely to copy the docs.

This prevents stale planning history from contaminating current implementation while preserving all decisions.
