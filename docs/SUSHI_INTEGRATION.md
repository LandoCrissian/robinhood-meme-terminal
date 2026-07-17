# Sushi integration

RMT integrates Sushi in stages so a new venue cannot weaken the verified V6 execution path.

## Current stage: indicative quote discovery

- `apps/web/lib/server/sushi-trade.ts` calls Sushi's official v7 Quote API for Robinhood Chain (`4663`).
- The same-origin `/api/trade/sushi-quote` route accepts only an origin-verified active V6 launch ID and matching token address.
- Responses are explicitly marked `executable: false`. RMT does not forward opaque aggregator calldata to a wallet.
- `NoWay`, partial fills, changed input amounts, invalid output amounts, excessive/invalid price impact values, upstream failures, and timeouts fail closed.
- The integration is off unless both `NEXT_PUBLIC_RMT_SUSHI_QUOTES_ENABLED=true` and `RMT_SUSHI_QUOTES_ENABLED=true` are intentionally deployed.

The current production Uniswap V4 graduation and execution path remains unchanged.

## Execution gate

Do not enable Sushi execution until Sushi confirms the canonical Robinhood Chain deployment addresses and recommended integration surface. Before execution can ship, RMT must:

1. Pin and verify the exact router/factory/quoter bytecode and deployment boundaries.
2. Decode and validate minimum output, recipient, token path, deadline, and native-token handling instead of trusting opaque calldata.
3. Use exact, expiring approvals where supported and never request an unlimited allowance by default.
4. Simulate buys and sells against a Robinhood Chain fork, including zero-liquidity, partial-fill, high-price-impact, taxed-token, and malformed-response cases.
5. Keep the canonical V6 Uniswap path available as a rollback and avoid splitting launch liquidity across venues by default.

Official references:

- Sushi Quote API: https://docs.sushi.com/api/examples/quote
- Sushi Swap API: https://docs.sushi.com/api/examples/swap
- Sushi Robinhood Chain pool interface: https://www.sushi.com/robinhood/pool
