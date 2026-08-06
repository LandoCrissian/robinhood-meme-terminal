import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scannerSource = readFileSync(
  new URL("../app/external-market-feed-v10.tsx", import.meta.url),
  "utf8"
);
const workspaceSource = readFileSync(
  new URL("../app/external-market-workspace.tsx", import.meta.url),
  "utf8"
);
const minorFixesCss = readFileSync(
  new URL("../app/terminal-minor-fixes-v10.css", import.meta.url),
  "utf8"
);
const traderControlCss = readFileSync(
  new URL("../app/terminal-trader-control-v12.css", import.meta.url),
  "utf8"
);
const tradeConfidenceSource = readFileSync(
  new URL("../app/trade-confidence.tsx", import.meta.url),
  "utf8"
);
const tradeReadinessSource = readFileSync(
  new URL("./trade-readiness.ts", import.meta.url),
  "utf8"
);

type Availability = "checking" | "ready" | "view-only" | "unavailable";

function nextRouteBatch(
  candidates: string[],
  availability: Record<string, Availability>,
  batchSize: number
) {
  const unique = candidates.filter((address, index, list) => list.indexOf(address) === index);
  const checking = unique
    .filter((address) => availability[address] === "checking")
    .slice(0, batchSize);
  if (checking.length) return checking;
  return unique
    .filter((address) => availability[address] === undefined)
    .slice(0, batchSize);
}

const addresses = Array.from(
  { length: 110 },
  (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`
);
const availability: Record<string, Availability> = {};
const first = nextRouteBatch(addresses, availability, 48);
assert.equal(first.length, 48);
assert.deepEqual(first, addresses.slice(0, 48));
for (const address of first) availability[address] = "ready";
const second = nextRouteBatch(addresses, availability, 48);
assert.equal(second.length, 48);
assert.deepEqual(second, addresses.slice(48, 96));
for (const address of second) availability[address] = "view-only";
const third = nextRouteBatch(addresses, availability, 48);
assert.equal(third.length, 14);
assert.deepEqual(third, addresses.slice(96));
availability[addresses[102]] = "checking";
assert.deepEqual(nextRouteBatch(addresses, availability, 48), [addresses[102]]);

assert.match(
  scannerSource,
  /const expanded = showAllMarkets \|\| normalizedQuery\.length > 0;/,
  "Directory expansion must remain an explicit reversible state."
);
assert.match(
  scannerSource,
  /else setShowAllMarkets\(\(current\) => !current\);/,
  "Browse all and Show top twelve must use a real state toggle."
);
assert.doesNotMatch(
  scannerSource,
  /const expanded =[^;]*(view === "explore"|tradeableOnly)/,
  "All and Tradeable views must not force the directory permanently open."
);
assert.match(
  scannerSource,
  /const checking = candidates[\s\S]*?slice\(0, MAX_ROUTE_BATCH\);[\s\S]*?if \(checking\.length\) return checking;[\s\S]*?filter\(\(address\) => executionAvailability\[address\] === undefined\)[\s\S]*?slice\(0, MAX_ROUTE_BATCH\);/,
  "Route verification must select each unresolved batch after prior batches settle."
);
assert.doesNotMatch(
  scannerSource,
  /\.slice\(0, MAX_ROUTE_BATCH\);\s*const unresolved = candidates/,
  "The market catalog must not be truncated before unresolved routes are selected."
);

assert.match(scannerSource, /const TERMINAL_PREFERENCES_KEY = "rmt:terminal-v10-preferences";/);
assert.match(scannerSource, /function readTerminalPreferences\(\)/);
assert.match(scannerSource, /window\.localStorage\.setItem\(TERMINAL_PREFERENCES_KEY/);
assert.match(scannerSource, /setView\(preferences\.view\)/);
assert.match(scannerSource, /setSourceFilter\(preferences\.sourceFilter\)/);
assert.match(scannerSource, /setVenueFilter\(preferences\.venueFilter\)/);
assert.match(scannerSource, /setTradeableOnly\(preferences\.tradeableOnly\)/);
assert.match(scannerSource, /setMarketSort\(preferences\.marketSort\)/);

assert.match(
  scannerSource,
  /function SignalCard\(\{ signal, onOpen \}/,
  "Signal cards must accept a close callback when rendered inside the modal board."
);
assert.match(
  scannerSource,
  /<SignalCard signal=\{signal\} onOpen=\{\(\) => setOpen\(false\)\}/,
  "Opening a market from the complete signal board must dismiss the dialog."
);

assert.match(scannerSource, /href=\{`\/market\/\$\{market\.address\}\?side=buy`\}/);
assert.match(scannerSource, /href=\{`\/market\/\$\{market\.address\}\?side=sell`\}/);
assert.match(
  workspaceSource,
  /const initialSide = searchParams\.get\("side"\) === "sell" \? "sell" : "buy";/,
  "Scanner Buy and Sell shortcuts must initialize the requested ticket side."
);
assert.match(
  workspaceSource,
  /setMobileTradeOpen\(true\)/,
  "Mobile Buy and Sell must explicitly open the execution sheet."
);
assert.match(
  workspaceSource,
  /className=\{`universalTradeRail \$\{side\} \$\{mobileTradeOpen \? "mobileOpen" : ""\}`\}/,
  "The execution rail must expose a deterministic mobile-open state."
);
assert.match(
  minorFixesCss,
  /\.externalIdentity \{[\s\S]*?padding: 9px 48px 9px 12px;/,
  "Desktop identity must reserve a fixed watch-control gutter."
);
assert.match(
  minorFixesCss,
  /\.runnerWatchButton \{[\s\S]*?position: absolute;[\s\S]*?right: 10px;/,
  "The desktop watch star must stay inside the identity cell instead of consuming the token-name column."
);
assert.match(
  minorFixesCss,
  /\.universalTradeRail \{[\s\S]*?display: flex !important;[\s\S]*?max-height: min\(94dvh, 900px\) !important;[\s\S]*?flex-direction: column !important;/,
  "Mobile execution must be a viewport-bound ordered sheet rather than the desktop rail squeezed onto a phone."
);
assert.match(
  minorFixesCss,
  /\.universalTradeRail\.mobileOpen \{[\s\S]*?opacity: 1 !important;[\s\S]*?transform: translate3d\(0, 0, 0\) !important;[\s\S]*?visibility: visible !important;/,
  "Mobile execution must render as a visible viewport-bound sheet when opened."
);
assert.match(
  minorFixesCss,
  /\.universalTradeSheetBackdrop\.visible \{[\s\S]*?pointer-events: auto !important;[\s\S]*?visibility: visible !important;/,
  "The mobile trade backdrop must participate in the same explicit open state."
);
assert.match(
  minorFixesCss,
  /> \.externalSushiQuote,[\s\S]*?> \.universalTradeUnavailable \{[\s\S]*?order: 3 !important;/,
  "The live order ticket must appear before route comparison and advanced execution controls on mobile."
);
assert.match(
  minorFixesCss,
  /> \.universalRouteDecision \{[\s\S]*?order: 4 !important;/,
  "The selected route summary must follow the primary order ticket on mobile."
);
assert.match(
  minorFixesCss,
  /> \.universalVenueSelector \{[\s\S]*?order: 5 !important;/,
  "Full venue comparison must remain available below the primary order ticket."
);
assert.match(
  minorFixesCss,
  /> \.tradeExecutionControls \{[\s\S]*?order: 6 !important;/,
  "Advanced execution rules must remain available without preceding the amount and quote controls."
);
assert.match(
  minorFixesCss,
  /\.externalUniswapSubmit \{[\s\S]*?position: sticky !important;[\s\S]*?bottom: max\(8px, env\(safe-area-inset-bottom\)\) !important;[\s\S]*?min-height: 54px !important;/,
  "An executable wallet action must remain reachable above the mobile safe area."
);

assert.doesNotMatch(
  tradeConfidenceSource,
  /Trade blocked: extreme price impact/,
  "Price impact must not be presented as an RMT transaction-integrity veto."
);
assert.match(
  tradeConfidenceSource,
  /Price impact above your \$\{impactLimitLabel\} alert/,
  "Price impact must be compared with the trader's selected alert."
);
assert.match(
  tradeConfidenceSource,
  /Price impact is market risk, not a transaction-integrity veto/,
  "The terminal must explain the boundary between market risk and execution integrity."
);
assert.match(
  tradeReadinessSource,
  /Review advised · you remain in control/,
  "Advisory evidence must not masquerade as a hard execution block."
);
assert.match(
  tradeReadinessSource,
  /Transaction integrity block · action required/,
  "Real execution-integrity failures must remain explicitly blocking."
);
assert.match(
  traderControlCss,
  /\.smartOrderGuard\.caution \{[\s\S]*?display: none;/,
  "The generic one-percent observation must not interrupt ordinary orders."
);
assert.match(
  traderControlCss,
  /\.smartOrderGuard button::after \{[\s\S]*?content: "Use safer size";/,
  "Safer sizing must be offered as an optional action instead of a fixed one-percent command."
);
assert.match(
  traderControlCss,
  /\.externalUniswapSubmit:disabled \{[\s\S]*?position: static !important;[\s\S]*?box-shadow: none !important;/,
  "A disabled mobile action must stay in document flow instead of covering the execution evidence."
);

console.log(
  "RMT preserves discovery and mobile execution while separating trader-controlled market risk from hard transaction-integrity blocks."
);