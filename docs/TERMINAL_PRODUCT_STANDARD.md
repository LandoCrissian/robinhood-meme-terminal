# RMT Terminal Product Standard

RMT is not a marketing page with market cards attached. It is a Robinhood Chain decision and execution system.

The product loop is:

> Scan → verify → analyze → execute → protect → manage

Every interface decision should make that loop faster, clearer, or safer. Features that do not support it should not compete with the primary terminal surface.

## Product position

RMT should combine the strongest interaction patterns of modern onchain terminals without becoming a visual clone:

- lifecycle-based market discovery rather than one undifferentiated token list;
- immediate price, liquidity, activity, and wallet-position context;
- chart and execution controls in one workspace;
- visible route, quote, price-impact, and approval evidence before signing;
- named, editable protection strategies rather than vague “AI automation”;
- a durable order and execution record;
- mobile controls designed for a phone rather than a compressed desktop table.

RMT’s defensible advantage is evidence:

- Robinhood Chain-specific launcher and venue coverage;
- origin and creator provenance;
- route identity and execution verification;
- contract, liquidity-control, holder, and sell-simulation evidence;
- bounded automatic exits whose authority and revocation are visible.

## Required user journeys

### 1. Find a market

A user should be able to answer these questions without opening another site:

- What is new, moving, active, or established?
- Which launcher or source created it?
- Where is the real pool?
- Is liquidity sufficient for the intended order?
- Is buy or sell activity accelerating?
- Is the market already on my watchlist?

Desktop uses grouped market rows. Mobile uses purpose-built market cards. Neither surface should expose every available field at once.

### 2. Inspect the evidence

The market workspace must distinguish:

- identity evidence;
- market data;
- contract and liquidity evidence;
- route and quote evidence;
- wallet-specific position data.

“Verified” must always identify what was verified. Origin verification is not a safety endorsement. Pool verification is not token verification. A sell simulation is not a guarantee of future execution.

### 3. Execute a trade

The terminal must show, before wallet confirmation:

- side and exact input asset;
- expected output and minimum output;
- selected venue and verified router;
- price impact and configured limit;
- slippage and transaction deadline;
- approval amount and spender when approval is required;
- recipient wallet;
- all RMT and venue fees, including an explicit zero when none exist.

Loading, stale, view-only, route-unavailable, approval-required, ready, submitted, confirmed, failed, and unknown-result states must be visually distinct.

### 4. Protect a position

Local Position Guard and server-backed automatic exits are separate products and must remain visibly separate.

Local monitoring:

- evaluates stop loss, trailing floor, break-even, and profit ladder rules in the browser;
- projects relevant levels onto the chart;
- prepares a sell ticket;
- never claims to submit a transaction automatically.

Automatic exit:

- grants a bounded token allowance and constrained signer authority;
- displays the approved asset, amount boundary, evaluator authority, execution path, recipient, expiry, and revocation path;
- remains recoverable when local browser storage is missing;
- fails closed when state, evaluator health, policy, or deployment cannot be verified;
- preserves in-flight transaction reconciliation after future authority is removed.

### 5. Manage active authority

A production release requires a wallet-level protection center that lists:

- active and confirming orders;
- executing and submitted orders;
- completed, expired, cancelled, and review-required orders;
- token, wallet, executor, expiry, last evaluation, transaction hash, and cleanup status;
- direct routes to inspect, revoke, or reconcile each order.

An automatic order must never exist only as a local browser artifact.

## Visual hierarchy

The terminal uses four information tiers:

1. **Decision:** market, price, change, liquidity, trade side, protection status.
2. **Evidence:** origin, venue, route, contract, holder, and simulation state.
3. **Control:** search, lifecycle filters, range, amount, presets, slippage, protection rules.
4. **Disclosure:** source limitations, trust boundaries, and failure behavior.

Decision content is always the largest and highest-contrast. Disclosure content is quieter but remains readable. No visible user-facing text should require zooming on a normal phone.

## Interaction rules

- One primary action per region.
- Buy and sell controls use explicit labels, not color alone.
- Search is always immediately available on the discovery surface.
- Mobile primary controls have at least a 44-pixel target.
- Keyboard focus is visible.
- Reduced-motion preferences are respected.
- A stale feed never looks live.
- A disabled action explains why it is disabled.
- A transaction timeout never becomes an automatic retry.
- A successful wallet prompt is not treated as a confirmed transaction.

## Performance and reliability targets

Initial production targets:

- terminal shell usable within 2.5 seconds on a typical mobile connection;
- search and local filtering respond within 100 milliseconds after data is loaded;
- quote state visibly changes within 250 milliseconds of a user edit;
- market snapshots declare their refresh interval and last successful update;
- live-feed loss falls back visibly rather than silently;
- no horizontal overflow at supported phone and desktop widths;
- no layout shift that moves buy, sell, revoke, or sign controls during interaction;
- no automated order arms while the evaluator heartbeat is stale;
- no unknown transaction result is retried automatically.

These are acceptance targets, not marketing claims. Production telemetry must verify them before they are presented publicly.

## Release acceptance matrix

A terminal release is not invite-ready until all rows pass.

| Area | Required evidence |
| --- | --- |
| Discovery | New, moving, active, established, search, origin, venue, loading, stale, delayed-source, and empty states reviewed on desktop and mobile |
| Workspace | Identity, chart, evidence, activity, safety, holder, position, buy, sell, and unavailable states reviewed |
| Execution | Approval, quote, minimum output, impact, route, signature, submitted, confirmed, reverted, timeout, and unknown-result flows tested |
| Protection | Local floor/target math, chart projection, prepared exit, automatic authority review, expiry, revoke, partial cleanup, and in-flight reconciliation tested |
| Accessibility | Keyboard navigation, focus, touch targets, readable type, reduced motion, and contrast reviewed |
| Security | Dependency audit, contract tests, static analysis, independent review, policy inspection, fork rehearsal, deterministic deployment evidence, and bounded canary complete |
| Operations | Feed, quote, evaluator, transaction, review-required, and stale-order alerts connected to an incident response owner |

## Definition of invite-ready

RMT is invite-ready when a first-time Robinhood Chain user can:

1. identify a legitimate market and its source;
2. understand the key market and safety evidence;
3. prepare a trade without leaving RMT;
4. understand exactly what the wallet will authorize;
5. confirm the chain result;
6. protect or manage the resulting position;
7. recover and revoke every continuing permission from another session.

A polished screenshot is not enough. The complete state machine must feel intentional.
