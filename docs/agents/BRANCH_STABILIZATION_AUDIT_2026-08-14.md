# Agent Engine / Arena branch stabilization audit

**Scope:** `codex/agent-engine-foundation`
**Status:** branch-only engineering evidence; no production activation
**Date:** 2026-08-14

This audit records the quality findings discovered while reconciling the long-lived Agent/Arena branch with current `main` and repairing the source-only MCP read boundary. It does not authorize deployment, live Agent execution, signing, fees, custody, pooled capital, or contract work.

## Reconciliation state

Current `main` through `ec1763f9ddadf3a6661fda7e6a1496ed6c545b1c` was integrated with a normal two-parent merge. The current `apps/web` subtree and search/legacy-retirement work were retained. The Agent Engine, Agent Core, Arena, and MCP source trees were retained. The only manual content conflict resolutions were:

- `docs/ARCHITECTURE_FREEZE.md`;
- `docs/ACTIVE_SYSTEM_MAP.md`.

Those resolutions preserve the paper-only Agent/Arena boundaries while adopting the current VNext root and retired legacy-frontend truth.

## MCP stabilization findings

The six-tool registry was ahead of its underlying service contract. `read-registry.ts` expected season catalog and participant reads, but `tool-contract.ts` implemented only matchup, leaderboard, and finalized-season reads. JavaScript construction accepted the extra reader properties and silently ignored them after TypeScript erasure, so registry construction failed closed because `rmt_arena_seasons` was missing.

The repaired read surface now consists of:

```text
rmt_arena_seasons
rmt_arena_matchup
rmt_arena_leaderboard
rmt_arena_participant
rmt_arena_career
rmt_arena_season_result
```

The Arena service owns five tools and the career service owns the sixth. Unknown or write-looking names remain non-admitted. Season and participant reader outputs are bound back to the requested identity. Outer result hashes and nested sanitized public-model hashes are both validated.

`apps/rmt-mcp/src/index.ts` previously exported only `tool-contract.ts`, leaving the career and composed registry contracts outside the stated public source surface. The stabilization change exports all three read-only contracts.

## Compatibility and package-surface findings

The following files are compatibility/re-export barrels rather than independent implementations:

- `apps/agent-engine/src/canonical-human.ts`;
- `apps/agent-engine/src/authoritative-human.ts`;
- `apps/agent-engine/src/authoritative-human-v2.ts`;
- `apps/agent-engine/src/career.ts`.

They are preserved to avoid breaking unknown source consumers. They should be consolidated or formally versioned only after workspace packaging establishes an owned public API.

The following source roots do not yet have package manifests:

- `packages/agent-core`;
- `apps/agent-engine`;
- `apps/rmt-mcp`.

Consequently, the workspace lockfile has no importer entries for those domains, and no package-scoped TypeScript project currently proves their public export surfaces. `apps/agent-engine/src/index.ts` also does not yet expose every later scheduler, Human-authoritative, public-Arena, and career module. Direct source imports are still in use. Treating every non-exported module as dead code would therefore be unsafe before the packaging phase.

The current Git tree contains no zero-byte Agent Core, Agent Engine, or MCP TypeScript source file. A checked-in quality audit now enforces that invariant and reports compatibility barrels, missing package ownership, and smoke files without a direct workflow or runner reference.

## CI ownership

Existing focused workflows remain in place. `.github/workflows/agent-arena-stabilization.yml` adds a single reproducible branch gate covering:

- Agent Core;
- Agent Foundation V1 and V2;
- Human authoritative paper execution and reduction;
- Agent authoritative open-position execution and reduction;
- canonical valuation scheduling;
- gross/net Arena performance and external-cost conversion;
- leaderboards, rosters, Human-vs-Agent matchups, public models, and immutable season finalization;
- career reputation and public career profiles;
- all six MCP read contracts;
- frozen pnpm installation;
- terminal release verification;
- package-permitted TypeScript checking;
- production web build;
- whitespace and tracked-source cleanliness.

The gate also rejects common private-key, wallet-client, transaction-signing, contract-write, transaction-submission, raw-broadcast, or MCP network-listener primitives in non-smoke Agent/MCP source. This is a static defense in depth check; it does not replace architectural review.

## Deferred, not silently accepted

The next engineering layer remains:

1. package manifests and explicit exports for Agent Core, Agent Engine, and RMT MCP, with an atomic lockfile update;
2. package-scoped TypeScript projects and dependency direction enforcement;
3. an actual temporary PostgreSQL integration lane for schema creation, locks, idempotency, restart recovery, immutable finalization, and tamper rejection;
4. only then, an internal read runtime over sanitized public models;
5. MCP transport design only after authentication, authorization, rate limits, audit logging, versioning, and deployment gates are documented.

No live execution method, signer, wallet authority, private key, blockchain submission, fee activation, deployment, or contract action is admitted by this audit.
