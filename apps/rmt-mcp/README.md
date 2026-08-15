# RMT MCP — Read-Only Foundation

Status: source-only foundation. No MCP SDK dependency, network listener, API key, wallet, signer, transaction submission, paper mutation, or live execution exists in this slice.

## Purpose

`apps/rmt-mcp` is the external AI boundary for RMT. The admitted capability is intentionally narrow: expose sanitized Arena intelligence without exposing Agent Engine internals.

The composed read registry contains exactly:

```text
rmt_arena_seasons
rmt_arena_matchup
rmt_arena_leaderboard
rmt_arena_participant
rmt_arena_career
rmt_arena_season_result
```

All six tools are read-only. They consume sanitized public Arena models, never raw Agent Engine records.

## Data boundary

The MCP read path may expose:

- public season identity and status;
- Human / Agent roster counts;
- matchup status and winner when finalizable;
- sanitized ranked/provisional leaderboard entries;
- sanitized participant and cross-season career profiles;
- immutable finalized-season results;
- exact net performance display fields;
- drawdown / fill-count display fields;
- public proof hashes.

It must not expose:

- engine snapshots;
- paper-account balances;
- strategy specs or prompts;
- model identity or reasoning summaries;
- quote evidence or calldata;
- owner addresses through Agent internals;
- private keys, signers, wallet state, or transaction authority.

Human Arena participant IDs may be public canonical wallet identities because they are the competition identity itself; that does not authorize or reveal wallet credentials.

## Security model

Unknown tool names fail closed. Tool inputs reject unsupported fields. Reader results are validated against their requested season or participant identity and their canonical public hashes. No write-capable tool is admitted merely because a caller knows a name.

Future tools such as agent creation or paper-order mutation require separate architecture admission and authorization contracts. Live execution is explicitly out of scope.

## Transport

This slice intentionally does not choose or start an MCP transport. A later runtime can bind this contract to Streamable HTTP only after authentication, authorization, rate limiting, request limits, audit logging, deployment, and operational policy are specified.
