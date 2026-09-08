import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Exercise the production hook, including its real canonical response parser.
// Only React scheduling and HTTP are replaced; no copy of the pagination algorithm.
const require = createRequire(import.meta.url);
const Module = require("node:module");
const originalLoad = Module._load;
const react = require("react");
const states: unknown[] = [];
Module._load = function (id: string, ...args: unknown[]) {
  if (id === "react") return { ...react,
    useState(initial: unknown) {
      const index = states.length;
      states.push(typeof initial === "function" ? initial() : initial);
      return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
    useRef: (current: unknown) => ({ current }),
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useEffect() {}
  };
  return originalLoad.call(this, id, ...args);
};
const { useVNextMarketDirectory } = require("../../app/vnext/use-vnext-market-directory");
Module._load = originalLoad;
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
function market(n: number) {
  return { address: address(n), name: `Token ${n}`, symbol: `T${n}`,
    ...Object.fromEntries(["priceUsd", "liquidityUsd", "marketCapUsd", "fdvUsd", "volume5m", "volume1h", "volume24h", "priceChange5m", "priceChange1h", "priceChange24h", "buys5m", "sells5m", "buys1h", "sells1h", "buys24h", "sells24h", "pairCreatedAt", "ageMinutes", "momentumScore", "buyPressureBps", "riskFlags", "signal"].map((key) => [key, null])),
    canonicalMarkets: [{ sourceId: "uniswap-v3", protocol: "uniswap", version: 3,
      poolKey: address(n + 1000), poolAddress: address(n + 1000), token0: address(n), token1: address(999),
      stable: null, fee: 3000, tickSpacing: 60, hooks: null,
      transactionHash: `0x${"1".repeat(64)}`, blockNumber: "100", blockHash: `0x${"2".repeat(64)}`,
      ...Object.fromEntries(["stateStatus", "liveFee", "feeDenominator", "gaugeAddress", "gaugeAlive", "gaugeWeight", "gaugeClaimable", "feesAddress", "bribeAddress", "stateObservedBlock", "stateObservedBlockHash"].map((key) => [key, null])) }]
  };
}
let generation = "old";
let failPage = -1;
let removed = false;
const requests: string[] = [];
let held: { page: number; resolve?: () => void } | undefined;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input), "https://fixture.invalid");
  assert.equal(url.pathname, "/api/vnext/market-directory", "enrichment must never restore later pages");
  const cursor = url.searchParams.get("cursor");
  requests.push(cursor ?? "root");
  const page = cursor ? Number(cursor.split("_")[1]) : 0;
  const responseGeneration = generation;
  if (cursor) assert.equal(cursor.split("_")[0], generation, "a fresh refresh follows its own cursor chain");
  if (held?.page === page) await new Promise<void>((resolve) => { held!.resolve = resolve; });
  if (page === failPage) return new Response("{}", { status: 503 });
  const rows = Array.from({ length: 10 }, (_, index) => page * 10 + index + 1).filter((n) => !removed || n !== 25);
  return Response.json({ canonical: true, coverage: "complete", updatedAt: new Date().toISOString(),
    markets: rows.map(market), nextCursor: page < 3 ? `${responseGeneration}_${page + 1}` : null });
}) as typeof fetch;
async function main() {
try {
  const directory = useVNextMarketDirectory();
  const count = () => (states[0] as unknown[]).length;
  await directory.refresh();
  assert.equal(count(), 10);
  await directory.loadNextCanonicalPage();
  await directory.loadNextCanonicalPage();
  assert.equal(count(), 30);
  generation = "fresh";
  await directory.refresh();
  assert.equal(count(), 30, "normal refresh must retain all three loaded canonical pages");
  assert.deepEqual(requests.slice(-3), ["root", "fresh_1", "fresh_2"]);
  generation = "partial"; failPage = 2;
  await directory.refresh();
  assert.equal(count(), 30, "partial failed refresh keeps the entire last-good window");
  failPage = -1; generation = "removed"; removed = true;
  await directory.refresh();
  assert.equal(count(), 29, "complete revalidation honors legitimate removals, not an indefinite union");
  held = { page: 3 };
  const obsolete = directory.loadNextCanonicalPage();
  for (let n = 0; !held.resolve && n < 30; n++) await Promise.resolve();
  assert.ok(held.resolve);
  const release = held.resolve;
  held = undefined;
  generation = "latest";
  await directory.refresh();
  release();
  assert.equal(await obsolete, false, "obsolete page cannot append into the refreshed generation");
  assert.equal(count(), 29);
  await directory.loadNextCanonicalPage();
  assert.equal(count(), 39);
  assert.equal(requests.at(-1), "latest_3", "pagination resumes at the refreshed next cursor");
  assert.equal(new Set((states[0] as { address: string }[]).map((row) => row.address)).size, 39);
  console.log("Production canonical hook: three-page refresh, failed refresh, removals, stale response and cursor continuation PASS.");
} finally { globalThis.fetch = originalFetch; }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
