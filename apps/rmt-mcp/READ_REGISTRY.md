# RMT MCP Read Registry

Status: source-only, read-only registry. No MCP network transport, SDK dependency, signer, wallet, paper mutation, or live execution is admitted here.

## Registry

`RmtMcpReadRegistry` composes two independently testable read contracts:

1. the Arena season/current-state contract;
2. the cross-season career-reputation extension.

The registry exposes exactly:

```text
rmt_arena_seasons
rmt_arena_matchup
rmt_arena_leaderboard
rmt_arena_participant
rmt_arena_career
rmt_arena_season_result
```

## Intended navigation

```text
rmt_arena_seasons
        ↓
current season
        ├─ rmt_arena_matchup
        ├─ rmt_arena_leaderboard
        └─ rmt_arena_participant

participant history
        └─ rmt_arena_career

completed season
        └─ rmt_arena_season_result
```

## Career semantics

`rmt_arena_career` is derived only from immutable finalized-season evidence.

It exposes transparent career facts such as:

- completed seasons;
- team wins/losses/ties;
- division and overall titles;
- podiums;
- best rank;
- win streaks;
- total fills;
- cumulative normalized return bps;
- worst season drawdown;
- per-season finalization/performance hashes.

Raw quote-asset returns remain grouped by quote asset and are never blindly summed across unlike assets.

There is no opaque career score in this version.

## Security boundary

Every registry descriptor is read-only and non-destructive.

The registry must not admit names or capabilities for:

```text
trade
swap
sign
execute
send_transaction
withdraw
private_key
arbitrary_call
```

A future Streamable HTTP MCP transport should bind to this registry only after authentication, rate limiting, deployment, and operational policy are specified.

Adding any write-capable MCP tool requires a separate architecture/security admission and cannot be implied by the existence of this registry.
