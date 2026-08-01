# RMT Position Guard

Position Guard is a non-custodial position-monitoring and exit-preparation layer for external Robinhood Chain markets inside RMT.

## First release

- One-tap 20% initial and trailing protection.
- Custom initial stop, trailing distance and break-even activation.
- A high-water mark that can only increase while a rule is armed.
- An optional 2× prompt that calculates the percentage required to recover the recorded original investment.
- Confirmed large-sell and five-minute net-sell-pressure signals from the exact displayed pool.
- Browser notifications when permission is granted and RMT remains open.
- Exact partial or full token amounts handed to the existing Sushi/Uniswap sell ticket.

Rules are scoped to chain, wallet and token and stored on the current device. The original investment is user-supplied; RMT does not claim complete cross-wallet cost-basis history.

## Execution boundary

A trigger does not broadcast a transaction. It opens the existing sell workflow, which obtains a fresh quote, checks the exact route and token, enforces the user's price-impact rule and requires the wallet to approve and sign.

Unattended execution is intentionally excluded until RMT has a separately audited, revocable permission contract with strict token, router, quantity, minimum-output, expiration and recipient limits.

## Monitoring limitations

- Position value is based on the indexed market price and current onchain wallet balance.
- A thin or rapidly moving pool can produce a materially different executable value.
- The first release monitors while the market page is open; it does not promise background delivery when every RMT session is closed.
- Large-sell thresholds are evidence, not predictions: `watch` begins at a single sell equal to 1% of displayed liquidity or five-minute net sells equal to 3%; `urgent` begins at 3% or 7%, respectively.
- Notifications and prepared orders do not guarantee execution, profit or loss prevention.
