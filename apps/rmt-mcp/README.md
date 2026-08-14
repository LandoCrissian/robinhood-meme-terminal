# RMT MCP — Read-Only Foundation

Status: source-only foundation. No MCP SDK dependency, network listener, API key, wallet, signer, transaction submission, paper mutation, or live execution exists in this slice.

## Purpose

`apps/rmt-mcp` is the external AI boundary for RMT. The first admitted capability is intentionally narrow: expose sanitized Arena intelligence without exposing Agent Engine internals.

The current tool contract contains exactly:

```text
rmt_arena_matchup
rmt_arena_leaderboard
```

Both tools are read-only and consume `PaperArenaPublicReadModel`, not raw Agent Engine records.

## Data boundary

The MCP read path may expose:

- season identity;
- Human / Agent roster counts;
- matchup status and winner when finalizable;
- sanitized ranked/provisional leaderboard entries;
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

Unknown tool names fail closed. Tool inputs reject unsupported fields. No write-capable tool is admitted merely because a caller knows a name.

Future tools such as agent creation or paper-order mutation require separate architecture admission and authorization contracts. Live execution is explicitly out of scope.

## Transport

This slice intentionally does not choose or start an MCP transport. A later runtime can bind this contract to Streamable HTTP after authentication, rate limiting, deployment, and operational policy are specified.
