# RMT Human Paper Accounts

Status: foundation support for canonical Human Arena identity and starting capital. Human paper order execution is intentionally **not** enabled by this slice.

## Purpose

RMT Arena needs Humans and Agents to enter the same competition under the same account and valuation primitives without representing a Human as a fake Agent.

The core participant contract is now:

```text
ParticipantType = AGENT | HUMAN

AGENT participantId = existing stable agent ID
HUMAN participantId = lowercase 20-byte EVM wallet address
```

Both types use the same `PaperAccountRecord` and the same season/account snapshot collection.

## Human account path

`DurableAgentEngine.openHumanPaperAccount()` now:

1. validates and lowercases the Human wallet address;
2. requires an existing Arena season;
3. validates atomic starting balances;
4. prevents a second HUMAN account for the same wallet and season;
5. persists the account through the same durable state/revision/idempotency machinery as Agent accounts;
6. survives `AgentEngine.fromSnapshot()` restore;
7. can enter `PaperArenaEntryService` using the same quote-only starting-capital rule.

## Persistence

The PostgreSQL `paper_accounts` projection now accepts:

```text
participant_type IN ('AGENT','HUMAN')
```

Season identity is unique by:

```text
(stream_id, season_id, participant_type, participant_id)
```

The legacy projection-level foreign key from every `participant_id` to `agents.agent_id` is removed because it is not valid for Human wallet identities. The **canonical AgentEngine snapshot validator remains authoritative**:

- AGENT accounts must resolve to a registered Agent;
- HUMAN accounts must carry a canonical lowercase EVM wallet participant ID.

The schema string also contains the development migration needed to relax an already-created AGENT-only `paper_accounts` table.

## Security boundary

Human account support does **not** make the existing agent order model participant-neutral yet.

The following remain Agent-only:

- `PaperOrderIntent.agentId`;
- `strategyVersion` ownership;
- `submitPaperOrder()`;
- `PaperFillRecord.agentId`;
- Agent risk events and score snapshots.

`AgentEngine.submitPaperOrder()` explicitly rejects a HUMAN account even when a valid Agent ID and strategy are supplied alongside that account ID.

This means a Human can currently establish canonical Arena identity/start state and be valued from that state, but cannot yet place a manual paper trade through the Agent order/fill path.

## Next migration

The next execution migration should introduce a shared paper-order participant identity rather than a second Human engine. The target is one order/fill accounting path with two upstream authorities:

```text
HUMAN manual intent ─┐
                    ├─> participant-neutral paper order/fill engine
AGENT admitted intent ┘
```

Agent strategy/risk admission must remain mandatory for Agent-originated orders, while Human manual intent gets its own explicit manual-admission policy. Both should converge only **after** authorization/admission, then share quote evidence, fill costs, balances, position accounting, liquidation NAV, Arena performance, and leaderboard rules.

No live wallet, signer, custody, or transaction authority is added here.
