# Retired launchpad launch 0

Owner classification: **historical dead launchpad token**.

- Historical contract identity: `0xdBa33be56C89CC9fc014c4459028d7e5c7878671`
- Historical market: `0xb26Fb775c0ac365d369BEe9ac2E044C5D90FfBee`
- Historical launch ID: `0`
- Current product status: none
- Current search requirement: none
- Current release requirement: none

The records remain in the repository wherever they are necessary to preserve truthful onchain history or a clearly labeled historical research fixture. They are not the current RMT token, an active RMT product market, a canonical Terminal requirement, or a vNext execution market. No runtime denylist, allowlist, search special case, indexer source, or backfill behavior is attached to them.

## Repository reference classification

The initial audit classified every exact-address reference and the related indirect special cases as follows.

### Historical evidence

- `docs/MAINNET_V6_DEPLOYMENT.md`
- `docs/V6_PROTOCOL_FOUNDATION.md`
- `docs/V6_MAINNET_RELEASE.md`
- `docs/MAINNET_RELEASE_CHECKLIST.md`
- `docs/PRODUCTION_INDEXER_DEPLOYMENT.md`
- `docs/EXTERNAL_AUDIT_HANDOFF.md`
- `docs/EXTERNAL_AUDIT_INQUIRY.md`
- `docs/RMT_DISTRIBUTION_ENGINE_V1.md`
- `apps/web/app/rmt/page.tsx`
- `apps/web/app/deploy-mainnet/page.tsx`
- `apps/web/app/deploy-mainnet/v6-release-console.tsx`
- `apps/web/app/launch-form.tsx`
- `packages/contracts/script/RehearseRMTDistributionDeploymentV1.s.sol`
- `packages/contracts/test/RMTDistributionEngineV1Fork.t.sol`
- `apps/web/lib/vnext/distribution-ccff00.ts`
- `apps/web/lib/vnext/distribution-deployment-readiness.ts`
- `apps/web/lib/vnext/fixtures/ccff00-public-audit-37451763.json`

The distribution references are explicitly historical, non-production fixtures. They remain deployment-ineligible and do not choose a current RMT token.

### Current-product configuration corrected

- `apps/web/app/api/markets/external/route.ts` no longer seeds launch 0 as RMT origin evidence.
- `apps/web/lib/project-page.ts` no longer grants launch 0 special official-project status.
- `apps/web/lib/public-project-discovery.ts` and `apps/web/lib/public-project-visibility.ts` no longer publish launch 0 as the current RMT project.
- `apps/web/app/approved-project-directory.tsx` no longer injects a launch-zero project card.
- `apps/web/lib/vnext/robinhood-assets.ts`, `wallet-assets.ts`, `market-directory.ts`, `server/vnext-legacy-market-directory.ts`, and `app/vnext/use-vnext-market-directory.ts` no longer treat launch 0 as a canonical seed, wallet asset, verified asset, or preferred selection.
- `apps/web/app/sitemap.ts` and `apps/web/scripts/indexnow-static-refresh.ts` no longer publish its project URL as a current static route.
- `apps/web/app/sushi/page.tsx` no longer presents the dead token or market as live product proof.

### Release-acceptance fixture corrected

- `.github/workflows/production-health.yml`
- `scripts/verify-production-health.mjs`
- `scripts/verify-production-health-smoke.mjs`

Release health now uses the current canonical controls STONKBROKER, PONS, PIPEDOG, CASHCAT, and LEMON, plus STONKBROKER text search. Launch 0 has no positive or negative release expectation.

### Current-product documentation corrected

- `apps/web/app/rmt/page.tsx`
- `apps/web/app/sushi/page.tsx`
- `docs/V6_PROTOCOL_FOUNDATION.md`
- `docs/V6_MAINNET_RELEASE.md`
- `docs/MAINNET_RELEASE_CHECKLIST.md`
- `docs/PRODUCTION_INDEXER_DEPLOYMENT.md`
- `docs/EXTERNAL_AUDIT_HANDOFF.md`
- `docs/EXTERNAL_AUDIT_INQUIRY.md`

These surfaces now distinguish the current Terminal product from retired launchpad evidence.

### Test fixture only

- `apps/external-origin-indexer/src/api-smoke.ts`
- `apps/web/lib/server/rmt-v4-trade-smoke.ts`
- `apps/web/lib/server/sushi-trade-smoke.ts`
- `apps/web/lib/vnext/intent-draft-smoke.ts`
- `apps/web/lib/vnext/market-directory-smoke.ts`
- `apps/web/lib/vnext/quote-observation-smoke.ts`
- `apps/web/lib/vnext/verified-cost-outcome-smoke.ts`
- `apps/web/lib/vnext/distribution-runtime-smoke.ts`
- `apps/web/lib/public-discovery-smoke.ts`
- `apps/web/lib/search-reach-smoke.ts`
- `apps/web/scripts/vnext-provider-benchmark.ts`

Generic fixtures were changed to neutral addresses or current canonical controls. Tests that retain launch-zero addresses do so only to verify that the historical record is labeled retired and is absent from current publication/release paths.
