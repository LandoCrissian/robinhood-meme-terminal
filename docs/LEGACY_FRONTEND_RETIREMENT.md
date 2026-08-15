# Legacy frontend retirement

**Status: CURRENT — canonical presentation boundary**
**Baseline:** `main` at or after PR #367

## Outcome

Production `/` renders the VNext terminal directly. The former desktop/mobile feed pair, universal market workspace, legacy portfolio panel, `LegacyTerminalPage`, and the V7–V12 terminal override stack are retired rather than kept as an inactive second frontend.

Compatibility URLs preserve user intent without preserving the old interface:

- `/market/[address]?side=buy|sell` redirects to `/?market=[address]&side=buy|sell`;
- `/portfolio` redirects to `/?panel=portfolio`;
- `/vnext` continues to redirect to `/`.

The VNext shell consumes those query parameters, performs its existing exact-contract lookup, and opens the existing wallet-held portfolio or Buy/Sell presentation. Unknown addresses remain subject to the same fail-closed identity checks as terminal search.

## Reachability audit

Retired presentation ownership included:

- `LegacyTerminalPage` and `ResponsiveExternalMarketFeed`;
- independent `ExternalMarketFeed` and `ExternalMarketFeedV10` trees;
- `ExternalMarketWorkspace` and its legacy route-comparison/trade panels;
- the legacy portfolio presentation;
- route-specific terminal CSS generations and correction layers from V7 through V12.

Preserved boundaries include:

- VNext state, directory, asset workspace, Spend Balance, quote, verification, authorization, submission, reconciliation and recovery;
- shared market APIs, resolver/evidence infrastructure and on-demand provider transports;
- deployed V6 project/history compatibility;
- Protection Center and its separately gated automation infrastructure;
- profiles, community, creator and stored user data in their paused state;
- contracts, indexers, provider gates, fee gates and production configuration.

The public sitemap is static again. It no longer performs a server-side market-catalog fetch to publish URLs that immediately redirect into the canonical terminal.

## CSS ownership

VNext owns its two scoped stylesheets. The root layout retains only shared/public-route styles and no longer loads the retired terminal generations, workspace layers, automation overlays or post-hoc execution correction sheets.

## Acceptance and rollback

The retirement boundary is executable through `test:legacy-retirement`. Terminal high-end acceptance validates both direct root entry and compatibility-route restoration across desktop and mobile. A rollback is the normal PR revert; no data, environment, contract or transaction migration is involved.
