import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { config as middlewareConfig, vnextRequestBoundary } from "../../middleware";
import { vnextShellAvailable } from "./vnext-shell-access";

const page = readFileSync(new URL("../../app/vnext/page.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../app/vnext/vnext-terminal-shell.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
const recoveryBanner = readFileSync(new URL("../../app/vnext/vnext-execution-recovery-banner.tsx", import.meta.url), "utf8");
const directory = readFileSync(new URL("../../app/vnext/use-vnext-market-directory.ts", import.meta.url), "utf8");
const spendBalance = readFileSync(new URL("../../app/vnext/spend-balance.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../app/vnext/vnext-terminal.css", import.meta.url), "utf8");
const chrome = readFileSync(new URL("../../app/public-chrome.tsx", import.meta.url), "utf8");

assert.match(page, /vnextShellAvailable\(process\.env\)/);
assert.match(page, /notFound\(\)/);
assert.match(page, /export const dynamic = "force-dynamic"/);
assert.match(chrome, /"\/vnext"/);

assert.equal(vnextShellAvailable({ NODE_ENV: "development" }), true);
assert.equal(vnextShellAvailable({ NODE_ENV: "production", VERCEL_ENV: "preview" }), true);
assert.equal(vnextShellAvailable({ NODE_ENV: "production", VERCEL_ENV: "production" }), false);
assert.equal(
  vnextShellAvailable({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_RMT_VNEXT_SHELL_ENABLED: "true",
  }),
  false,
);
assert.equal(vnextShellAvailable({ NODE_ENV: "production" }), false);
assert.equal(vnextShellAvailable({ NODE_ENV: "production", NEXT_PUBLIC_RMT_VNEXT_SHELL_ENABLED: "true" }), true);

const blockedResponse = vnextRequestBoundary({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  NEXT_PUBLIC_RMT_VNEXT_SHELL_ENABLED: "true",
});
assert.equal(blockedResponse.status, 404);
assert.equal(blockedResponse.headers.get("cache-control"), "private, no-store, max-age=0");
assert.equal(blockedResponse.headers.get("x-robots-tag"), "noindex, nofollow");
assert.notEqual(blockedResponse.body, null);

const blockedHeadResponse = vnextRequestBoundary({ NODE_ENV: "production", VERCEL_ENV: "production" }, "HEAD");
assert.equal(blockedHeadResponse.status, 404);
assert.equal(blockedHeadResponse.body, null);

const previewResponse = vnextRequestBoundary({ NODE_ENV: "production", VERCEL_ENV: "preview" });
assert.equal(previewResponse.status, 200);
assert.equal(previewResponse.headers.get("x-middleware-next"), "1");
assert.equal(middlewareConfig.matcher, "/vnext/:path*");

assert.equal((shell.match(/export function VNextTerminalShell/g) ?? []).length, 1);
assert.match(shell, /<SpendBalance markets=\{markets\} onAssetsChange=\{setWalletAssets\} executionRecord=\{executionRecovery\.record\} \/>/);
assert.match(shell, /<VNextExecutionRecoveryBanner/);
assert.match(shell, /useVNextExecutionRecovery/);
assert.match(spendBalance, /Available to trade/);
assert.match(spendBalance, /Pending/);
assert.match(shell, /Markets/);
assert.match(shell, /<TradeIntentComposer/);
assert.match(shell, /useVNextMarketDirectory/);
assert.match(shell, /marketAsset=\{selectedAsset\}/);
assert.match(shell, /executionRecord=\{executionRecovery\.record\}/);
assert.match(shell, /onContinueTrading=\{continueTrading\}/);
assert.match(shell, /marketSearch\.current\?\.focus/);
assert.match(shell, /Routes are not being checked/);
assert.match(shell, /No synthetic chart/);
assert.doesNotMatch(shell, /TrendChart|Illustrative preview|vnChartLine/);
assert.match(directory, /address: selected\.address/);
assert.match(composer, /Asset-to-asset intent/);
assert.match(composer, /One action handles routing, verification, simulation, and exact payload preparation/);
assert.match(composer, /Finding best execution/);
assert.match(composer, /className="vnRouteDetails"/);
assert.match(composer, /Connect & buy/);
assert.match(composer, /Sign in & buy/);
assert.match(composer, /!address/);
assert.match(composer, /!identity\.authenticated/);
assert.match(composer, /stage === "quote"[\s\S]*setVerificationState\(\{ state: "idle" \}\)[\s\S]*setAuthorizationState\(\{ state: "idle" \}\)/);
assert.match(composer, /stage === "verification"[\s\S]*setVerificationState\(\{ state: "error", message \}\)[\s\S]*setAuthorizationState\(\{ state: "idle" \}\)/);
assert.match(composer, /Purchase confirmed/);
assert.match(composer, /Sale confirmed/);
assert.match(composer, /Continue trading/);
assert.match(composer, /setSide\("buy"\)/);
assert.match(composer, /const DEFAULT_BUY_AMOUNT = "25"/);
assert.match(composer, /setAmount\(DEFAULT_BUY_AMOUNT\)/);
assert.match(composer, /setBuyInputKey\(assetKey\(ROBINHOOD_USDG\.id\)\)/);
assert.match(composer, /exceeds confirmed balance/);
assert.match(composer, /disabled=\{exceedsBalance\}/);
assert.match(composer, /reading confirmed receipt/);
assert.match(composer, /confirmedOutputDisplay/);
assert.doesNotMatch(composer, /balance refreshing/);
assert.match(recoveryBanner, /exact received amount are confirmed/);
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
assert.match(styles, /\.vnRouteDetails[\s\S]*height: clamp\(280px, 42svh, 390px\)/);
assert.match(styles, /scrollbar-gutter: stable/);
assert.match(styles, /\.vnReceiveField strong[\s\S]*min-height: 58px/);
assert.doesNotMatch(styles, /!important/);
assert.doesNotMatch(styles, /terminal-v(?:7|8|9|10|11|12)/i);

console.log("RMT VNext shell smoke checks passed.");
