# RMT Human Paper Risk Capacity

Status: enforced on the supported Human manual paper-order submission path. PAPER ONLY.

## Objective

Human-vs-Agent Arena results are not comparable if Humans can manually take materially different exposure or continue trading through risk limits that would block an Agent.

`HumanPaperRiskCapacityPlanner` therefore applies the same capacity categories and integer arithmetic used by the Agent paper risk planner.

## Human risk policy

A Human Arena policy explicitly pins:

- `maximumPositionBps`
- `maximumPortfolioExposureBps`
- `maximumOpenPositions`
- `maximumDailyLossBps`
- `maximumDrawdownBps`
- `maximumTradesPerDay`
- `maximumSlippageBps`
- `maximumPriceImpactBps`

Every configured Human limit must be inside the RMT global `AgentSafetyEnvelope`. A looser Human policy cannot exceed that envelope.

For a truly matched Arena season, the Human policy values should be configured equal to the comparable Agent strategy risk/execution limits.

## Capacity math

All monetary calculations use `BigInt`.

```text
positionLimit  = floor(markNAV × maximumPositionBps / 10,000)
portfolioLimit = floor(markNAV × maximumPortfolioExposureBps / 10,000)

positionHeadroom  = max(positionLimit - currentPositionExposure, 0)
portfolioHeadroom = max(portfolioLimit - currentPortfolioExposure, 0)

structuralCapacity = min(
  currentInputBalance,
  positionHeadroom,
  portfolioHeadroom
)
```

The structural capacity becomes zero when a hard risk gate is active.

## Hard gates

The Human planner uses the same reason categories as the Agent planner:

- `DAILY_LOSS_LIMIT_REACHED`
- `DRAWDOWN_LIMIT_REACHED`
- `TRADE_LIMIT_REACHED`
- `OPEN_POSITION_LIMIT_REACHED`
- `NO_AVAILABLE_BALANCE`
- `POSITION_LIMIT_REACHED`
- `PORTFOLIO_LIMIT_REACHED`
- `REQUEST_EXCEEDS_CAPACITY`

A request above capacity is `BLOCKED`. It is never silently resized.

## Evidence requirements

A Human capacity plan binds:

- canonical Human account snapshot;
- Human wallet participant ID;
- RMT safety envelope;
- exact Human risk policy;
- risk snapshot;
- market observation;
- requested input amount;
- requested slippage;
- derived maximum amount/capacity components;
- admit/block status and reasons;
- planning timestamp;
- risk-snapshot freshness policy;
- canonical plan hash.

`assertHumanPaperRiskCapacityPlan()` re-derives the complete payload from those inputs. A caller cannot change the status, headroom, reasons or capacity and make the record valid merely by recomputing the outer hash.

## Submission enforcement

The Human order admission and state gate remain separate evidence boundaries. The final supported submitter is stricter:

```text
Human manual admission
        +
exact state/revision gate
        +
ADMITTED Human risk-capacity plan
        ↓
HumanPaperOrderSubmissionService
        ↓
PENDING Human paper order
```

`HumanPaperOrderSubmissionService` is configured with:

- the exact allowed RMT safety envelope;
- the exact allowed Human risk policy;
- maximum age of the risk plan when admission occurs.

It rejects:

- blocked risk plans;
- risk plans for a different participant/account;
- different asset/amount/slippage;
- stale risk plans;
- plans created after admission;
- plans produced under a different risk policy;
- plans produced under a different safety envelope.

The risk-plan hash is also included in the durable mutation request hash. Reusing the same manual admission/idempotency key with a different risk plan therefore conflicts in the durable idempotency journal.

## Differential parity smoke

`human-paper-risk-capacity-smoke.ts` constructs equivalent Agent and Human inputs under equivalent risk limits and requires:

- same maximum input amount;
- same headroom components;
- same reasons;
- same `ADMITTED` / `BLOCKED` result.

It also verifies matching hard-gate behavior such as daily-loss blocking.

This does not mean an Agent and Human will necessarily make the same decisions. It means that when they request equivalent exposure under equivalent risk state, the capacity rules can be configured to constrain them equivalently.

## Remaining production dependency

The planner is deterministic, but the **production Human risk snapshot source is not wired yet**. Before Arena is public, current exposure, open-position count, trades today, daily loss and drawdown must be derived from canonical paper state / canonical Arena valuation rather than supplied by an arbitrary caller.

That source-wiring is the next fairness hardening boundary.

No live wallet, signer, custody or real transaction authority is introduced by this planner.
