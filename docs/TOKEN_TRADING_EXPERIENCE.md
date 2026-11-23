# Token market experience

## Status

This is a website code candidate based on PR #689 commit `e497adc12e7d48a0d7b5257ff17bab1929bce4a8`. It does not deploy the website or enable trading. No contract, economics, production binding, database, wallet transaction or stored profile was changed.

The existing RMT token is `0xe7A2d4967B8e108927DAeEC6375fD0d015d5364C`, on Robinhood Chain 4663. Its recorded creation transaction is `0xae87f180a187a5121c8a124664c40deb9996fce60729f76a6100d0d6c6b4f5c1`. Continue with this token; do not create a replacement.

## Problem and resulting behavior

The token page put several screens of creation receipts, hashes and repeated operational data in the default view. The token image was separated from its title, the published description was absent, and an empty chart pushed the order controls down the phone screen. Website trading was also disabled in production configuration.

This candidate groups the artwork, name, ticker, creator and chain in one header. The contract address has a compact copy control and sharing uses the exact public token URL. The default content is market summary, chart, trade form, graduation progress and the registered description. Addresses and receipt records remain available under a closed **Contract details** disclosure. Chart methodology is also disclosed on demand. TradingView attribution remains visible.

Desktop places the chart and order form beside each other. Mobile uses a smaller empty chart and a trade shortcut that disappears when the order form is visible or being edited. The form has Buy/Sell, amount, balance when available, slippage, an estimate and the appropriate next action. Material quote and fee information remains visible at confirmation. Additional calldata and release details are collapsed. Copy failures offer a selectable value rather than silently failing.

The launch directory loses the duplicate introductory actions. Each token card becomes one coherent link. Footer links use the same restrained styling as the rest of the interface.

## Trading capability and temporary failures

The page and `/api/launchpad/config` now read the existing, validated financial configuration without performing a full live deployment verification. The response explicitly says `readiness: "check-on-prepare"`; an enabled capability is not a claim that a current quote or transaction is ready.

State, quotes, preparation, exact prior-request revalidation and wallet submission retain their current verification. Trusted host/origin, release hashes, approved scope, account, chain, nonce, exact allowances, wallet simulation, durable journal and duplicate-send controls remain in place. Removing full RPC work from the two capability lookups eliminates two redundant deployment-verification runs during confirmation.

Temporary failures preserve the amount and form and offer a retry. Existing transaction recovery continues using the original request. A transaction journal suppresses a fresh trade until the original request is reconciled. Unknown prices remain absent, and unknown fees are described as being shown in review.

## Verification performed

- Production Next.js build and type checks passed.
- 52 focused tests passed: financial configuration and boundaries, trading/recovery, discovery, market candles and metadata.
- Chromium component journeys passed at 320, 390 and 1440 px. They checked the actual saved description bytes against its registered digest, collapsed evidence, no horizontal overflow, input retention after a simulated 503, one connection action, contract copying, canonical sharing, market retry and the mobile shortcut hiding at the input.
- The existing production-adapter browser harness now uses the new accessible controls and actual panel styles. All five modes passed in Chromium mobile with each of the positive-poster and zero-poster fee policies: disabled, trading, EOA claims, delegated MetaMask claims and Safe claims. Its exact envelope, fees, refund, rejection, lost-hash recovery and no-resend assertions remain; stored-journal assertions also confirm original payer/nonce and indexed settlement. These are ten isolated synthetic journeys, with zero external requests and zero page errors.
- Chromium market polling passed feed loss, expiry, sellback, canonical absence, rejection of an unproved 404 and empty history. Its expected status labels were updated to the shorter product wording without weakening the data assertions.
- No transaction was signed or broadcast. Browser HTTP responses were intercepted local fixtures. Screenshots demonstrate candidate components, not a hosted release or physical MetaMask acceptance.
- WebKit was not run in this environment because required native libraries were absent. No new physical-device acceptance is claimed.
- A temporary local review route and middleware allowance were removed before the final build. Neither is part of this candidate.

Commands from `apps/launch-website` after installing the repository-pinned pnpm dependencies:

```sh
NEXT_TELEMETRY_DISABLED=1 node_modules/.bin/next build
TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx --test \
  lib/server/production-financial.test.ts \
  lib/server/production-trading-wallet.test.ts \
  lib/server/production-financial-boundary.test.ts \
  lib/server/production-discovery.test.ts \
  lib/server/token-market.test.ts \
  lib/server/rmt-metadata.test.ts
TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx ../../scripts/production-adapters/browser.ts \
  --browser chromium --viewport mobile --fee-mode positive --output /tmp/rmt-adapters-positive
TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx ../../scripts/production-adapters/browser.ts \
  --browser chromium --viewport mobile --fee-mode zero-poster --output /tmp/rmt-adapters-zero-poster
# From the repository root:
node scripts/economics/review-market-outage.mjs chromium
```

Screenshots: [390 px](evidence/token-trading-experience/mobile-390.png), [320 px](evidence/token-trading-experience/mobile-320.png), [desktop](evidence/token-trading-experience/desktop-1440.png). [Interaction results](evidence/token-trading-experience/visual-results.json).

Adapter execution records: [positive poster fees](evidence/token-trading-experience/chromium-adapters-positive.json), [zero poster fees](evidence/token-trading-experience/chromium-adapters-zero-poster.json). Their source digests identify the tested files; the harness reported parent commit `3cac9aa1` while its selector updates were uncommitted. The records include local harness screenshot filenames; the three candidate layout screenshots linked above are the screenshots retained in this review packet.

## Production continuation

Publish this website candidate through the existing release process. The production trading capability still requires its existing scoped release record and `RMT_CURVE_PRODUCTION_TRADING=owner-trading-approved` configuration. That value denotes owner-authorized website trading; it is **not an owner-wallet allowlist**. It enables the admitted registered-token trading flow publicly. Claims remain a separate scope and flag.

Use real release and adapter/device acceptance records for the financial manifest. Do not fill the manifest with arbitrary hashes or represent the local browser fixtures as physical-wallet acceptance. Resolve the exact remaining production configuration and hosted wallet review in the existing deployment workspace, carrying forward prior decisions that still apply. This change introduces no requirement to redeploy the token, repeat its creation, change economics or restart the completed infrastructure work.

After rollout, verify the live token page and capability response, then the current RMT quote and unsigned trade review. The wallet owner retains the final transaction confirmation. If an original request exists, reconcile it before another submission. The existing production rollback remains available for the website; it cannot undo an on-chain trade.
