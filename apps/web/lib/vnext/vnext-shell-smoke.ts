import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { config as middlewareConfig, vnextRequestBoundary } from "../../middleware";
import { vnextShellAvailable, vnextShellMode } from "./vnext-shell-access";

const page = readFileSync(new URL("../../app/vnext/page.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../app/vnext/vnext-terminal-shell.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
const recoveryBanner = readFileSync(new URL("../../app/vnext/vnext-execution-recovery-banner.tsx", import.meta.url), "utf8");
const directory = readFileSync(new URL("../../app/vnext/use-vnext-market-directory.ts", import.meta.url), "utf8");
const spendBalance = readFileSync(new URL("../../app/vnext/spend-balance.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../app/vnext/vnext-terminal.css", import.meta.url), "utf8");
const chrome = readFileSync(new URL("../../app/public-chrome.tsx", import.meta.url), "utf8");

assert.match(page, /readVNextReleaseReadiness\(process\.env\)/);
assert.match(page, /!readiness\.shellEnabled \|\| !readiness\.configurationConsistent/);
assert.match(page, /notFound\(\)/);
assert.match(page, /export const dynamic = "force-dynamic"/);
assert.match(page, /index: false/);
assert.match(page, /follow: false/);
assert.match(chrome, /"\/vnext"/);

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

assert.equal((shell.match(/export function VNextTerminalShell/g) ?? []).length, 1);
assert.match(shell, /<WalletButton target="mainnet" returnTo="\/vnext" \/>/);
assert.doesNotMatch(shell, /showFunding=\{false\}/);
assert.match(shell, /<SpendBalance[\s\S]*onAssetsChange=\{setWalletAssets\}[\s\S]*onNativeBalanceChange=\{setNativeBalance\}/);
assert.match(shell, /<VNextExecutionRecoveryBanner/);
assert.match(shell, /useVNextExecutionRecovery/);
assert.match(spendBalance, /Available to trade/);
assert.match(spendBalance, /Pending/);
assert.match(spendBalance, /aria-expanded=\{holdingsExpanded\}/);
assert.match(spendBalance, /View assets/);
assert.match(shell, /Markets/);
assert.match(shell, /<TradeIntentComposer/);
assert.match(shell, /useVNextMarketDirectory/);
assert.match(shell, /marketAsset=\{selectedAsset\}/);
assert.match(shell, /nativeBalance=\{nativeBalance\}/);
assert.match(shell, /executionRecord=\{executionRecovery\.record\}/);
assert.match(shell, /onContinueTrading=\{continueTrading\}/);
assert.match(shell, /marketSearch\.current\?\.focus/);
assert.match(shell, /Routes are not being checked/);
assert.match(shell, /className="vnDiscoveryWorkspace"/);
assert.match(shell, /Live price history and trades/);
assert.match(shell, /href: "#vnext-workspace"/);
assert.match(shell, /href: "#vn-markets-heading"/);
assert.match(shell, /href: "\/portfolio"/);
assert.doesNotMatch(shell, /Open notifications|vnMarketTabs|vnFilterButton|vnStarButton/);
assert.doesNotMatch(shell, /\/launch|launchpad|create token/i);
assert.doesNotMatch(shell, /TrendChart|Illustrative preview|vnChartLine/);
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
assert.match(styles, /@media \(max-width: 760px\)/);
assert.match(styles, /@media \(max-width: 1280px\)/);
assert.match(styles, /prefers-reduced-motion/);
assert.match(styles, /\.vnWorkspaceGrid[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(400px, 440px\)/);
assert.match(styles, /\.vnDiscoveryWorkspace[\s\S]*grid-template-columns: minmax\(300px, 0\.78fr\) minmax\(0, 1\.22fr\)/);
assert.match(styles, /\.vnMobileDock[\s\S]*grid-template-columns: repeat\(3, 1fr\)/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.vnTopbarTitle \{[\s\S]*display: none[\s\S]*\.vnTradePanel \{[\s\S]*order: 1[\s\S]*\.vnDiscoveryWorkspace \{[\s\S]*order: 2/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.vnDetectedAssetsToggle \{[\s\S]*display: inline-flex/);
assert.match(styles, /\.vnDetectedAssets:not\(\.isExpanded\) \.vnDetectedAssetsRefresh/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.vnDetectedAssetsBody \{[\s\S]*display: none[\s\S]*\.vnDetectedAssets\.isExpanded \.vnDetectedAssetsBody \{[\s\S]*display: block/);
assert.match(styles, /\.vnRouteDetails[\s\S]*height: clamp\(280px, 42svh, 390px\)/);
assert.match(styles, /scrollbar-gutter: stable/);
assert.match(styles, /\.vnReceiveField > div:not\(\.vnOutputProtection\) > strong[\s\S]*min-height: 58px/);
assert.match(styles, /\.vnOutputProtection[\s\S]*min-height: 38px/);
assert.match(shell, /getElementById\("vnext-trade-ticket"\)\?\.scrollIntoView/);
assert.doesNotMatch(styles, /!important/);
assert.doesNotMatch(styles, /terminal-v(?:7|8|9|10|11|12)/i);

console.log("RMT VNext shell smoke checks passed.");
