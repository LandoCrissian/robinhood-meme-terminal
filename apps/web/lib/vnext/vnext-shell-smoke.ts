import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { config as middlewareConfig, vnextRequestBoundary } from "../../middleware";
import { formatTerminalAge, formatTerminalCompactUsd, formatTerminalPercent, formatTerminalPrice } from "../../app/vnext/terminal-format";
import { vnextShellAvailable, vnextShellMode } from "./vnext-shell-access";

const page = readFileSync(new URL("../../app/vnext/page.tsx", import.meta.url), "utf8");
const rootPage = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
const nextConfig = readFileSync(new URL("../../next.config.mjs", import.meta.url), "utf8");
const shellController = readFileSync(new URL("../../app/vnext/vnext-terminal-shell.tsx", import.meta.url), "utf8");
const presentations = readFileSync(new URL("../../app/vnext/terminal-presentations.tsx", import.meta.url), "utf8");
const chainPulse = readFileSync(new URL("../../app/vnext/vnext-chain-pulse-card.tsx", import.meta.url), "utf8");
const chainPulseStyles = readFileSync(new URL("../../app/vnext/vnext-chain-pulse-card.module.css", import.meta.url), "utf8");
const presentationBoundary = readFileSync(new URL("../../app/vnext/use-terminal-presentation.ts", import.meta.url), "utf8");
const shell = `${shellController}\n${presentations}`;
const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../../app/vnext/vnext-asset-workspace.tsx", import.meta.url), "utf8");
const workspaceHook = readFileSync(new URL("../../app/vnext/use-vnext-asset-workspace.ts", import.meta.url), "utf8");
const workspaceRoute = readFileSync(new URL("../../app/api/vnext/asset-workspace/route.ts", import.meta.url), "utf8");
const chart = readFileSync(new URL("../../app/vnext/vnext-market-chart.tsx", import.meta.url), "utf8");
const recoveryBanner = readFileSync(new URL("../../app/vnext/vnext-execution-recovery-banner.tsx", import.meta.url), "utf8");
const directory = readFileSync(new URL("../../app/vnext/use-vnext-market-directory.ts", import.meta.url), "utf8");
const spendBalance = readFileSync(new URL("../../app/vnext/spend-balance.tsx", import.meta.url), "utf8");
const walletConnection = readFileSync(new URL("../../app/vnext/vnext-wallet-connection.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../app/vnext/vnext-terminal.css", import.meta.url), "utf8");
const chrome = readFileSync(new URL("../../app/public-chrome.tsx", import.meta.url), "utf8");

assert.equal(formatTerminalPrice(0), "$0");
assert.equal(formatTerminalPrice(0.00000001), "$0.00000001");
assert.equal(formatTerminalPrice(0.0001), "$0.0001");
assert.equal(formatTerminalPrice(0.01), "$0.01");
assert.equal(formatTerminalPrice(0.99), "$0.99");
assert.equal(formatTerminalPrice(1), "$1.00");
assert.equal(formatTerminalPrice(999), "$999.00");
assert.equal(formatTerminalCompactUsd(1_000), "$1K");
assert.equal(formatTerminalCompactUsd(10_000), "$10K");
assert.equal(formatTerminalCompactUsd(1_000_000), "$1M");
assert.equal(formatTerminalCompactUsd(1_000_000_000), "$1B");
assert.equal(formatTerminalPercent(-0), "0.0%");
assert.equal(formatTerminalAge(0), "1m");

assert.match(page, /readVNextReleaseReadiness\(process\.env\)/);
assert.match(page, /!readiness\.shellEnabled \|\| !readiness\.configurationConsistent/);
assert.match(page, /notFound\(\)/);
assert.match(page, /export const dynamic = "force-dynamic"/);
assert.match(page, /alternates: \{ canonical: "\/" \}/);
assert.match(page, /openGraph:[\s\S]*url: "\/"/);
assert.doesNotMatch(page, /index: false|follow: false/);
assert.match(rootPage, /export \{ metadata \} from "\.\/vnext\/page"/);
assert.match(rootPage, /<VNextTerminalShell \/>/);
assert.match(rootPage, /import "\.\/vnext\/vnext-terminal\.css"/);
assert.doesNotMatch(rootPage, /vnext-terminal-reconstruction\.css/);
assert.doesNotMatch(nextConfig, /source: "\/"[\s\S]*destination: "\/vnext"/);
assert.match(nextConfig, /source: "\/vnext"[\s\S]*destination: "\/"[\s\S]*permanent: true/);
assert.match(chrome, /"\/vnext"/);
assert.match(chrome, /pathname === "\/"/);

assert.equal(vnextShellAvailable({ NODE_ENV: "development" }), true);
assert.equal(vnextShellAvailable({ NODE_ENV: "production", VERCEL_ENV: "preview" }), true);
assert.equal(vnextShellAvailable({ NODE_ENV: "production", VERCEL_ENV: "production" }), false);
assert.equal(
  vnextShellAvailable({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    RMT_VNEXT_SHELL_ENABLED: "true",
  }),
  true,
);
assert.equal(vnextShellAvailable({ NODE_ENV: "production" }), false);
assert.equal(vnextShellAvailable({ NODE_ENV: "production", RMT_VNEXT_SHELL_ENABLED: "true" }), true);
assert.equal(vnextShellMode({ NODE_ENV: "development" }), "development");
assert.equal(vnextShellMode({ NODE_ENV: "production", VERCEL_ENV: "preview" }), "preview");
assert.equal(vnextShellMode({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
}), "production-observe");
assert.equal(vnextShellMode({ NODE_ENV: "production", VERCEL_ENV: "production" }), "unavailable");

const productionObserveResponse = vnextRequestBoundary({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
});
assert.equal(productionObserveResponse.status, 200);
assert.equal(productionObserveResponse.headers.get("cache-control"), "private, no-store, max-age=0");
assert.equal(productionObserveResponse.headers.get("x-rmt-vnext-mode"), "production-observe");
assert.equal(productionObserveResponse.headers.get("x-rmt-vnext-release"), "observation");
assert.equal(productionObserveResponse.headers.get("x-robots-tag"), "noindex, nofollow");

const misconfiguredResponse = vnextRequestBoundary({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED: "true",
});
assert.equal(misconfiguredResponse.status, 404);
assert.equal(misconfiguredResponse.headers.get("x-robots-tag"), "noindex, nofollow");

const blockedHeadResponse = vnextRequestBoundary({ NODE_ENV: "production", VERCEL_ENV: "production" }, "HEAD");
assert.equal(blockedHeadResponse.status, 404);
assert.equal(blockedHeadResponse.body, null);

const previewResponse = vnextRequestBoundary({ NODE_ENV: "production", VERCEL_ENV: "preview" });
assert.equal(previewResponse.status, 200);
assert.equal(previewResponse.headers.get("x-middleware-next"), "1");
assert.equal(previewResponse.headers.get("x-rmt-vnext-mode"), "preview");
assert.equal(previewResponse.headers.get("x-rmt-vnext-release"), "observation");
assert.equal(previewResponse.headers.get("x-robots-tag"), "noindex, nofollow");
assert.equal(middlewareConfig.matcher, "/vnext/:path*");

assert.equal((shellController.match(/export function VNextTerminalShell/g) ?? []).length, 1);
assert.match(shellController, /desktop \? <DesktopTerminal \{\.\.\.props\} \/> : <MobileTerminal \{\.\.\.props\} \/>/);
assert.match(presentationBoundary, /useSyncExternalStore/);
assert.match(presentationBoundary, /\(min-width: 1024px\)/);
assert.match(presentations, /export function DesktopTerminal/);
assert.match(presentations, /export function MobileTerminal/);
assert.match(presentations, /className="rmtDesktopHeader"[\s\S]*<VNextWalletConnection \/>/);
assert.match(presentations, /className="rmtMobileHeader"[\s\S]*<VNextWalletConnection showFunding=\{false\} compact \/>/);
assert.match(walletConnection, /showFunding = true/);
assert.match(walletConnection, /<WalletButton target="mainnet" returnTo="\/" showFunding=\{showFunding\} compact=\{compact\} \/>/);
assert.match(shell, /href="\/" aria-label="RMT Markets"/);
assert.match(shell, /Robinhood Chain market intelligence/);
assert.doesNotMatch(shell, /Terminal preview/);
assert.match(spendBalance, /<FundWalletButton variant="inline" label="Add funds" target="mainnet" \/>/);
assert.match(spendBalance, /<FundWalletButton variant="inline" label="Receive" target="mainnet" directReceive \/>/);
assert.match(presentations, /<SpendBalance[\s\S]*onAssetsChange=\{props\.onAssetsChange\}[\s\S]*onNativeBalanceChange=\{props\.onNativeBalanceChange\}/);
assert.match(shell, /<VNextExecutionRecoveryBanner/);
assert.match(shell, /useVNextExecutionRecovery/);
assert.match(spendBalance, /Available to trade/);
assert.match(spendBalance, /Pending/);
assert.match(spendBalance, /aria-expanded=\{holdingsExpanded\}/);
assert.match(spendBalance, /View assets/);
assert.match(spendBalance, /id="vnext-portfolio"/);
assert.match(spendBalance, /portfolioRevealRequest > 0/);
assert.match(shell, /Markets/);
assert.match(shellController, /useState<TerminalContext>\("markets"\)/);
assert.match(shellController, /writeLocation\("portfolio"\)/);
assert.match(shellController, /url\.searchParams\.set\("market", market\)/);
assert.match(shellController, /window\.addEventListener\("popstate", synchronizeFromLocation\)/);
assert.match(shell, /<TradeIntentComposer/);
assert.match(shell, /useVNextMarketDirectory/);
assert.match(presentations, /marketAsset=\{props\.selectedAsset\}/);
assert.match(presentations, /nativeBalance=\{props\.nativeBalance\}/);
assert.match(presentations, /executionRecord=\{props\.executionRecord\}/);
assert.match(presentations, /onContinueTrading=\{props\.onContinueTrading\}/);
assert.match(shell, /marketSearch\.current\?\.focus/);
assert.match(shell, /without prechecking routes|routes checked on demand/);
assert.match(presentations, /className="rmtDesktopWorkstation"/);
assert.match(presentations, /aria-label="Market categories"/);
assert.match(presentations, /counts\[candidate\.id\]/);
assert.match(shellController, /selectVNextMarketDirectoryView/);
assert.match(shellController, /setQuery\(""\)/);
assert.match(shell, /<VNextAssetWorkspace/);
assert.match(shell, /sideRequest={props\.tradeSideRequest}/);
assert.match(presentations, /data-terminal-context=\{props\.context\}/);
assert.match(presentations, /className="rmtDesktopMarketsView"/);
assert.match(presentations, /className="rmtDesktopAssetView"/);
assert.match(presentations, /className="rmtPortfolioSurface"/);
assert.match(presentations, /className="rmtMobileMarketsView"/);
assert.match(presentations, /className="rmtMobileAssetView"/);
assert.match(presentations, /function DesktopMarkets[\s\S]*rmtScannerControls[\s\S]*<DesktopMarketTable[\s\S]*<VNextChainPulseCard/);
assert.match(presentations, /function MobileMarkets[\s\S]*<MarketCategoryNav[\s\S]*<MarketSearch[\s\S]*<MobileMarketList[\s\S]*<VNextChainPulseCard/);
assert.doesNotMatch(presentations, /MarketSummary|rmtMarketSummary/);
assert.match(chainPulse, /useState\(false\)/);
assert.match(chainPulse, /aria-expanded=\{expanded\}/);
assert.match(chainPulse, /aria-controls=\{detailsId\}/);
assert.match(chainPulse, /Expand"} Robinhood Chain Pulse details/);
assert.match(chainPulse, /Third-party market context · Non-authoritative/);
for (const metric of ["TVL", "DEX volume 24h", "DEX volume 7d", "DEX change 24h", "DEX change 7d", "Fees 24h", "Revenue 24h", "Protocol revenue 24h"]) {
  assert.match(chainPulse, new RegExp(metric));
}
assert.match(chainPulseStyles, /\.disclosure:focus-visible/);
assert.match(chainPulseStyles, /min-height: 60px/);
assert.match(presentations, /data-terminal-nav="rwa"[\s\S]*onClick=\{props\.onShowRwa\}>RWA<\/button>/);
assert.doesNotMatch(presentations, /<details className="rmtMobileDiscovery"/);
assert.doesNotMatch(presentations, /href="\/rwa"/);
assert.doesNotMatch(shell, /href: "\/portfolio"|href="\/portfolio"/);
assert.doesNotMatch(shell, /legacyAssetWorkspaceHref|\/market\//);
assert.doesNotMatch(shell, /Open notifications|vnMarketTabs|vnFilterButton|vnStarButton/);
assert.doesNotMatch(shell, /\/launch|launchpad|create token/i);
assert.doesNotMatch(shell, /TrendChart|Illustrative preview|vnChartLine/);
assert.match(workspace, /<VNextMarketChart/);
assert.match(workspace, /Market flow &amp; trade tape/);
assert.match(workspace, /Holders, liquidity &amp; risk/);
assert.match(workspace, /role="tab" aria-selected=\{tab === item\}/);
assert.match(workspace, /Known holders/);
assert.match(workspace, /Top 10 · no pool/);
assert.match(workspace, /Displayed pool liquidity/);
assert.match(workspace, /Liquidity control/);
assert.match(workspace, /Source published/);
assert.match(workspace, /Sell evidence/);
assert.match(workspace, /All verified markets/);
assert.match(workspace, /Displayed price source, project origin and selected execution venue remain independent/);
assert.match(workspace, /Stock-token classification/);
assert.match(workspace, /RMT does not infer RWA status from a name, symbol, or trading pair/);
assert.match(workspace, /Exact connected-wallet balance/);
assert.match(workspace, /Cost basis and P&amp;L remain hidden until complete wallet history can be proven/);
assert.match(workspace, /Creation evidence/);
assert.match(workspace, /source-listed|sourceName/);
assert.match(workspace, /useExternalMarketStream/);
assert.match(workspace, /useTokenRiskEvidence/);
assert.match(workspace, /useWalletConstellation/);
assert.match(workspace, /useAccount/);
assert.doesNotMatch(workspace, /mock|fixture|illustrative/i);
assert.match(workspaceHook, /Promise\.allSettled/);
assert.match(workspaceHook, /fetch\(`\/api\/markets\/external/);
assert.match(workspaceHook, /fetch\(`\/api\/vnext\/asset-workspace/);
assert.match(workspaceHook, /nextMarket && \(nextResolution \|\| nextMarket\.resolution\)[\s\S]*"ready"[\s\S]*"partial"/);
assert.match(workspaceHook, /stockAssetCoverage/);
assert.match(workspaceRoute, /resolveUniversalMarketAddress/);
assert.match(workspaceRoute, /fetchRobinhoodStockRegistry/);
assert.match(workspaceRoute, /resolution\.token\.address\.toLowerCase\(\) !== address\.toLowerCase\(\)/);
assert.doesNotMatch(workspaceRoute, /quote|router|reactor|calldata/i);
assert.match(chart, /EXTERNAL_CHART_RANGES/);
assert.match(chart, /GeckoTerminal OHLCV/);
assert.match(chart, /payloadSignature/);
assert.match(chart, /signature\.current \? "stale" : "unavailable"/);
assert.match(chart, /RMT will retry quietly/);
assert.doesNotMatch(chart, /Math\.random|mock|fixture/i);
assert.match(directory, /address: selected\.address/);
assert.match(composer, /`Trade \$\{marketSymbol\}`/);
assert.match(composer, /One tap checks the best route and opens the final wallet confirmation/);
assert.match(composer, /Finding best execution/);
assert.match(composer, /className="vnRouteDetails"/);
assert.match(composer, /Expected receive/);
assert.match(composer, /Protected minimum/);
assert.match(composer, /Quotes update quietly/);
assert.match(composer, /Connect & buy/);
assert.match(composer, /identity\.activeWalletKind !== "external"/);
assert.match(composer, /identity\.connectTradingWallet\(\)/);
assert.match(composer, /!address/);
assert.match(composer, /!identity\.authenticated/);
assert.doesNotMatch(composer, /const flowBusy = quoteState\.state === "loading"/);
assert.match(composer, /stage === "quote"[\s\S]*setVerificationState\(\{ state: "idle" \}\)[\s\S]*setAuthorizationState\(\{ state: "idle" \}\)/);
assert.match(composer, /stage === "verification"[\s\S]*setVerificationState\(\{ state: "error", message \}\)[\s\S]*setAuthorizationState\(\{ state: "idle" \}\)/);
assert.match(composer, /Purchase confirmed/);
assert.match(composer, /Sale confirmed/);
assert.match(composer, /Continue trading/);
assert.match(composer, /setSide\("buy"\)/);
assert.match(composer, /const DEFAULT_BUY_AMOUNT = "25"/);
assert.match(composer, /const DEFAULT_NATIVE_BUY_AMOUNT = "0\.0005"/);
assert.match(composer, /NATIVE_GAS_RESERVE_ATOMIC/);
assert.match(composer, /setAmount\(nextUsesUsdg \? defaultBuyAmount : nextUsesNative \? defaultNativeBuyAmount : ""\)/);
assert.match(composer, /affordableDefaultAmount/);
assert.match(composer, /autoFitBuyAmount\.current = false/);
assert.match(composer, /setBuyInputKey\(defaultBuyInput \? assetKey\(defaultBuyInput\.id\) : undefined\)/);
assert.match(composer, /ROBINHOOD_NATIVE_ASSET_ADDRESS/);
assert.match(composer, /backgroundQuoteImmediate\.current = true/);
assert.match(composer, /lastReadyVerification\.current = undefined/);
assert.match(composer, /exceeds confirmed balance/);
assert.match(composer, /disabled=\{exceedsBalance\}/);
assert.match(composer, /confirmed onchain/);
assert.match(composer, /confirmedOutputDisplay/);
assert.doesNotMatch(composer, /balance refreshing/);
assert.match(recoveryBanner, /exact received amount are confirmed/);
assert.match(recoveryBanner, /Open the transaction for exact receipt details/);
assert.doesNotMatch(recoveryBanner, /balances are refreshing/i);
assert.match(composer, /robinhoodchain\.blockscout\.com\/tx/);
assert.doesNotMatch(composer, /actual output|estimated received/i);
assert.doesNotMatch(composer, /Check live routes|Verify best route|Prepare wallet review|Continue with fresh verification/);
assert.doesNotMatch(shell, /\$428\.16|\$1,862\.34|\+\$102\.82/);
assert.doesNotMatch(shell, /Thinking Cat|Mog on Robinhood|Nova Protocol/);
assert.doesNotMatch(shell, /fetch\s*\(/);
assert.doesNotMatch(shell, /useSendTransaction|writeContract|signTypedData/);
assert.doesNotMatch(composer, /useSendTransaction|writeContract|signTypedData|fetch\s*\(/);
assert.doesNotMatch(spendBalance, /useSendTransaction|writeContract|signTypedData/);

assert.match(styles, /\.rmtVnext/);
assert.match(styles, /body:has\(\.rmtVnext\) \.publicHeader/);
assert.match(styles, /@media \(max-width: 760px\)/);
assert.match(styles, /@media \(max-width: 1023px\)/);
assert.match(styles, /@media \(min-width: 1024px\)/);
assert.match(styles, /prefers-reduced-motion/);
assert.match(styles, /\.vnChartFrame/);
assert.match(styles, /\.vnChartCandle\.isUp/);
assert.match(styles, /\.vnChartTooltip/);
assert.match(styles, /\.vnEvidenceTabs/);
assert.match(styles, /\.vnConcentrationTrack/);
assert.match(styles, /\.vnHolderList/);
assert.match(styles, /\.vnLiquidityHeadline/);
assert.match(styles, /\.rmtDesktopWorkstation[\s\S]*grid-template-columns: clamp\(200px, 18vw, 250px\) minmax\(0, 1fr\) clamp\(320px, 27vw, 370px\)/);
assert.match(styles, /\.rmtMobileTradeDock[\s\S]*grid-template-columns: 1fr 1fr/);
assert.match(presentations, /role="dialog" aria-modal="true"/);
assert.match(presentations, /rmtMobileSheetBackdrop/);
assert.match(presentations, /document\.body\.style\.overflow = "hidden"/);
assert.match(presentations, /event\.key === "Escape"/);
assert.match(presentations, /event\.key !== "Tab"/);
assert.doesNotMatch(presentations, /\.vnTradePanel[\s\S]*order:|vnDiscoveryWorkspace/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.vnDetectedAssetsToggle \{[\s\S]*display: inline-flex/);
assert.match(styles, /\.vnDetectedAssets:not\(\.isExpanded\) \.vnDetectedAssetsRefresh/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.vnDetectedAssetsBody \{[\s\S]*display: none[\s\S]*\.vnDetectedAssets\.isExpanded \.vnDetectedAssetsBody \{[\s\S]*display: block/);
assert.match(styles, /\.vnRouteDetails[\s\S]*height: clamp\(280px, 42svh, 390px\)/);
assert.match(styles, /scrollbar-gutter: stable/);
assert.match(styles, /\.vnReceiveField > div:not\(\.vnOutputProtection\) > strong[\s\S]*min-height: 58px/);
assert.match(styles, /\.vnOutputProtection[\s\S]*min-height: 38px/);
assert.match(presentations, /getElementById\("vnext-trade-ticket"\)\?\.scrollIntoView/);
assert.doesNotMatch(styles, /!important/);
assert.doesNotMatch(styles, /terminal-v(?:7|8|9|10|11|12)/i);
assert.doesNotMatch(styles, /\.vnSidebar\b|\.vnTopbar\b|\.vnDiscoveryWorkspace\b/);

console.log("RMT VNext shell smoke checks passed.");
