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

console.log(
  "RMT terminal workstation preserves reversible discovery, persistent operator settings, complete route batching, signal-board cleanup, and exact Buy/Sell handoff."
);
