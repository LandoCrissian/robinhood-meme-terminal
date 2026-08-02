# RMT Position Guard

Position Guard is a non-custodial position-monitoring and exit-preparation layer for external Robinhood Chain markets inside RMT.

## First release

- One-tap 20% initial and trailing protection.
- Custom initial stop, trailing distance and break-even activation.
- A high-water mark that can only increase while a rule is armed.
- An optional 2× prompt that calculates the percentage required to recover the recorded original investment.
- An optional staged Profit Lock: recover the recorded basis at 2×, prepare a 25% partial exit at 3×, and prepare a 20% partial exit at 5×.
- Confirmed large-sell and five-minute net-sell-pressure signals from the exact displayed pool.
- Browser notifications when permission is granted and RMT remains open.
- Exact partial or full token amounts handed to the existing Sushi/Uniswap sell ticket. The handoff calculates from raw onchain integer units rather than the rounded balance shown on screen, labels why the order was prepared, and clears that context after a confirmed swap or any manual amount change.

After a sell receipt is confirmed, RMT marks only that prepared partial-profit milestone as handled. A confirmed full protected-floor exit retires the old guard. Rejected, failed, or merely quoted exits never mutate the guard.

The one-tap **Protect my win** preset combines the 20% trailing floor, break-even protection, principal recovery and staged Profit Lock. Every milestone is a prompt, not an automatic sale. Traders may prepare the exact partial-sell ticket, dismiss a milestone, or keep holding.

New guards track the token's per-unit entry reference and price high-water mark, not only the wallet's total position value. A completed partial sale therefore reduces the balance without being misread as a market-price collapse or incorrectly tripping the trailing floor.

After a confirmed in-RMT buy, Uniswap and Sushi tickets now reconcile the wallet's before/after token balance and offer **Protect my win** directly in the success state. For a new position, RMT records the confirmed ETH input using the same ETH/USD estimate shown during preflight. If the wallet already held the token, RMT labels the current full-position value as a new reference rather than inventing historical cost basis. An existing guard is never overwritten.

Traders may also opt into **Protect my win after confirmation** before submitting a buy. The compact control offers Tight (10%), Balanced (20%), Wide (30%), and Custom protection. Custom mode exposes the initial stop, trailing distance, break-even activation, principal-recovery prompt, and staged-profit prompts without turning the trade ticket into a tutorial.

The exact rules visible when the trader submits the order are frozen with that pending order. Changing the device preference while a transaction is pending cannot silently change its protection. The preference follows the device across automatic Sushi/Uniswap route changes, but no guard is created for a rejected, pending, or failed transaction. RMT waits for the confirmed receipt and reconciled token balance first.

Rules are scoped to chain, wallet and token and stored on the current device. The original investment is user-supplied; RMT does not claim complete cross-wallet cost-basis history.

Watchlist rules are separate from Position Guard. They can follow a signed-in Privy-bound RMT account and monitor price, liquidity, runner pace, and exact-pool sell pressure while RMT is open. They still cannot execute a transaction. Position Guard remains isolated by the exact selected wallet because balances, recorded peaks, and exit sizes must not move between linked wallets.

The market workspace now exposes both layers through a Protection Desk. A trader can arm large-sell, five-minute net-sell-flow, liquidity-drop, or qualified runner-pace presets without leaving the token page. Arming a preset also saves the exact token to the watchlist. The exact-pool trade tape supplies sell evidence to those user-created rules; RMT no longer emits an unsolicited large-sell notification merely because browser notifications were previously granted.

When an armed market rule changes to triggered while RMT is open, the latest 100 transitions are retained in a device-local Protection Inbox. Each entry preserves the token, rule, observed market value, and trigger time so a dismissed notification does not erase the user's context.

## Execution boundary

A trigger does not broadcast a transaction. It opens the existing sell workflow, which obtains a fresh quote, checks the exact route and token, enforces the user's price-impact rule and requires the wallet to approve and sign.

Unattended execution is intentionally excluded until RMT has a separately audited, revocable permission contract with strict token, router, quantity, minimum-output, expiration and recipient limits.

## Monitoring limitations

- Position value is based on the indexed market price and current onchain wallet balance.
- A thin or rapidly moving pool can produce a materially different executable value.
- The first release monitors while the market page is open; it does not promise background delivery when every RMT session is closed.
- Large-sell thresholds are evidence, not predictions: `watch` begins at a single sell equal to 1% of displayed liquidity or five-minute net sells equal to 3%; `urgent` begins at 3% or 7%, respectively.
- Notifications and prepared orders do not guarantee execution, profit or loss prevention.
- Protection Inbox history stays on the current device and is not an execution record, fill receipt, or proof of investment performance.
