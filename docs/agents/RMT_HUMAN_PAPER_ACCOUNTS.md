# RMT Human Paper Accounts and Manual Paper Execution

Status: canonical Human Arena accounts now support **manual paper trading** through the same durable paper state, quote evidence, fill costs, balance mutation, position accounting, liquidation NAV and Arena valuation used by Agent paper trading. This remains PAPER ONLY.

## Participant identity

```text
ParticipantType = AGENT | HUMAN

AGENT participantId = existing stable agent ID
HUMAN participantId = lowercase 20-byte EVM wallet address
```

Both participant types use the same `PaperAccountRecord`, season collection and canonical engine snapshot.

`DurableAgentEngine.openHumanPaperAccount()`:

1. validates and canonicalizes the Human wallet address;
2. requires an existing Arena season;
3. validates atomic starting balances;
4. prevents duplicate Human account identity within a season;
5. persists through the same revision/idempotency state store as Agent accounts;
6. survives `AgentEngine.fromSnapshot()` restore;
7. can enter `PaperArenaEntryService` under the same quote-only starting-capital requirement.

## Separate upstream authorities, shared downstream execution

Agent and Human orders do **not** share upstream authorization.

```text
AGENT
  strategy version
  + model proposal
  + deterministic risk capacity
  + Agent order admission
          │
          ├──────────────┐
          │              │
HUMAN    manual intent   │
  + Human manual policy  │
  + current-state admission
  + stale-state gate     │
          │              │
          └──────┬───────┘
                 ↓
        canonical PENDING paper order
                 ↓
        verified RMT quote evidence
                 ↓
        explicit paper fill costs
                 ↓
        shared fill/balance mutation
                 ↓
        positions / liquidation NAV
                 ↓
        Arena performance
```

The divergence is intentional: Agent-originated orders retain strategy/risk provenance; Human-originated orders retain canonical wallet identity and `manualPolicyVersion` provenance.

## Human manual admission

`HumanPaperOrderAdmissionService` is read-only. It binds one exact persisted state revision/hash to:

- Human account and season;
- input/output assets;
- exact atomic input amount;
- slippage;
- manual policy version;
- admission timestamp.

The current manual policy caps:

- maximum slippage;
- maximum order input as basis points of the **current input-asset balance**.

The amount is rejected when above policy; it is never silently clamped.

## Stale-state gate

`HumanPaperOrderSubmissionGateService` requires the current durable state to remain exactly the state used for admission:

- same revision;
- same state hash;
- same account snapshot;
- same season snapshot.

Any intervening mutation invalidates the old admission. Previous Human trades do **not** block a new trade: after a fill, the Human creates a fresh admission from the new canonical state, then a fresh gate.

## Durable Human order submission

`HumanPaperOrderSubmissionService` requires the complete admission + matching gate. It derives its own idempotency key and calls:

```text
DurableAgentEngine.submitHumanPaperOrder(intent, key, expectedRevision)
```

The durable engine checks the required revision before applying the mutation, and the state store independently performs the optimistic revision check during commit. A race after gate evaluation therefore fails instead of committing a stale order.

The resulting order is `PENDING` and must exactly match the admitted Human intent.

## Shared fill mechanics

The canonical `AgentEngine` now stores participant-neutral order/fill history internally. Agent and Human wrappers converge on one `applyPaperFill()` balance mutation.

Both paths enforce:

- PENDING order state;
- exact quote/order asset and amount identity;
- canonical quote-evidence hash;
- paper fill delay;
- quote expiry;
- season window;
- policy price-impact ceiling;
- exact fee/gas accounting;
- sufficient paper balances;
- atomic debit/credit mutation.

Agent fill additionally applies its strategy price-impact ceiling. Human fill applies the global paper safety ceiling.

`HumanPaperFillOrchestrationService` uses the same `RmtPaperQuoteResult` and `PaperFillCostPlan` contract as the Agent fill orchestrator. It refuses unresolved network-gas cost plans and validates the returned Human fill against the admitted order, protected quote output and exact costs.

## Persistence

`paper_accounts` accepts `AGENT | HUMAN`.

`paper_orders` and `paper_fills` are now participant-aware shared projections. Origin constraints require:

- AGENT order: Agent ID + strategy version, no manual policy;
- HUMAN order: Human participant ID + manual policy, no Agent strategy identity;
- AGENT fill: Agent identity present;
- HUMAN fill: Agent identity absent.

Legacy Agent rows are backfilled into the participant fields by the development migration contained in the schema string.

## Shared accounting and Arena

`buildPaperPositionBook()` consumes `ParticipantPaperFillRecord[]`, so Human and Agent fills use identical:

- cost-basis accounting;
- realized P&L;
- external-cost event tracking;
- liquidation valuation;
- canonical-state valuation;
- Arena performance math;
- net-performance accounting;
- Human / Agent / Overall leaderboard views.

## Remaining fairness gap

Execution mechanics and accounting are shared, but **manual Human risk admission is not yet risk-identical to Agent admission**.

Agents currently have deterministic gates for position exposure, portfolio exposure, open-position count, daily loss, drawdown and trades-per-day. Human manual admission currently enforces current-balance sizing + slippage, while fill-time price impact uses the global safety envelope.

Before calling Human-vs-Agent risk conditions identical, Human manual admission should be connected to a participant-neutral risk-capacity policy using the same position/portfolio/drawdown/trade-frequency evidence.

## Explicitly absent

None of this adds:

- a signer or private key;
- wallet transaction submission;
- live capital;
- production exchange authorization;
- custody;
- autonomous live trading;
- contract deployment.

Human execution in this system means **manual paper intent and simulated fill only**.
