import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Real production hook, canonical parser, root fallback and route cache. Only
// React scheduling, inventory/curated dependencies and HTTP are replaced.
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
    useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(), useEffect() {}
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
let mode = "indexed";
let failPage = -1;
let removed = false;
let held: { page: number; resolve?: () => void } | undefined;
const requests: string[] = [];
const readCurated = async () => ({ status: "ready", stale: false, verifiedAt: new Date().toISOString(), markets: Array.from({ length: 8 }, (_, i) => market(i + 1)) });
const readIndexed = async (requestUrl: string) => {
  const cursor = new URL(requestUrl).searchParams.get("cursor");
  const page = cursor ? Number(cursor.split("_")[1]) : 0;
  const responseGeneration = generation;
  requests.push(cursor ?? "root");
  if (cursor) assert.equal(cursor.split("_")[0], generation, "fresh cursor chain required");
  if (held?.page === page) await new Promise<void>((resolve) => { held!.resolve = resolve; });
  if (mode === "fallback" || page === failPage) return { status: 503, body: { canonical: true, error: "Indexed inventory unavailable" } };
  const pages = [[1, 18], [19, 36], [37, 52], [53, 62]];
  const [start, end] = pages[page];
  const rows = Array.from({ length: end - start + 1 }, (_, i) => start + i).filter((n) => !removed || n !== 51);
  return { status: 200, body: { canonical: true, inventorySource: "indexed", revalidationComplete: mode !== "incomplete",
    coverage: mode === "partial" ? "partial" : "complete", updatedAt: new Date().toISOString(),
    ...(mode === "body-stale" || (mode === "later-stale" && page === 2) ? { stale: true } : {}),
    markets: (mode === "small-indexed" ? rows.slice(0, 8) : rows).map(market), nextCursor: mode === "small-indexed" ? null : page < 3 ? `${responseGeneration}_${page + 1}` : null } };
};
Module._load = function (id: string, ...args: unknown[]) {
  if (id === "./rmt-curated-market-registry") return { readRmtCuratedMarketSnapshot: readCurated };
  if (id === "./vnext-indexed-market-directory") return { readVNextIndexedMarketDirectoryPage: readIndexed };
  return originalLoad.call(this, id, ...args);
};
const { readVNextCanonicalMarketDirectoryPage } = require("../server/vnext-canonical-market-directory");
Module._load = originalLoad;
const { readVNextMarketDirectoryRequest } = require("../server/vnext-market-directory-route");
const { applyProjectIdentityDirectoryAdmission } = require("../server/project-identity-admission");
const { parseVNextCanonicalDirectoryResponse } = require("./market-directory");
const dependencies = { readCanonical: readVNextCanonicalMarketDirectoryPage, readLegacy: async () => { throw new Error("No enrichment/legacy recovery"); } };
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input), "https://fixture.invalid");
  assert.equal(url.pathname, "/api/vnext/market-directory");
  if (mode === "http-failure") return new Response("{}", { status: 503 });
  const result = await readVNextMarketDirectoryRequest(url.toString(), {}, dependencies);
  return Response.json(result.body, { status: result.status, headers: { ...result.headers,
    ...(mode === "cache-stale" ? { "X-RMT-Directory-Cache": "STALE" } : {}),
    ...(mode === "header-stale" ? { "X-RMT-Directory-Freshness": "last-known" } : {}) } });
}) as typeof fetch;
function createDirectory() {
  const offset = states.length;
  const hook = useVNextMarketDirectory();
  return { hook, count: () => (states[offset] as unknown[]).length, status: () => states[offset + 1],
    rows: () => states[offset] as { address: string }[], selected: () => states[offset + 4] };
}
async function main() {
  try {
    const d = createDirectory();
    await d.hook.refresh(); await d.hook.loadNextCanonicalPage(); await d.hook.loadNextCanonicalPage();
    assert.equal(d.count(), 52); d.hook.setSelectedAddress(address(40));
    generation = "normal"; await d.hook.refresh(); assert.equal(d.count(), 52); assert.equal(d.status(), "ready");
    mode = "http-failure"; await d.hook.refresh(); assert.equal(d.count(), 52); assert.equal(d.status(), "stale");
    mode = "fallback";
    await d.hook.refresh();
    assert.equal(d.count(), 52, "HTTP 200 curated fallback must retain the loaded indexed window");
    assert.equal(d.status(), "stale"); assert.equal(d.selected(), address(40));
    await d.hook.refresh(); assert.equal(d.count(), 52); assert.equal(d.status(), "stale");
    assert.equal(new Set(d.rows().map((row) => row.address)).size, 52);
    mode = "indexed"; generation = "recovered"; await d.hook.refresh();
    assert.deepEqual(requests.slice(-3), ["root", "recovered_1", "recovered_2"]);
    assert.equal(d.count(), 52); assert.equal(d.status(), "ready");
    for (const staleMode of ["body-stale", "cache-stale", "header-stale", "later-stale"]) {
      mode = staleMode; await d.hook.refresh(); assert.equal(d.count(), 52); assert.equal(d.status(), "stale", staleMode);
    }
    mode = "partial"; await d.hook.refresh(); assert.equal(d.count(), 52); assert.equal(d.status(), "ready", "partial source coverage is not fallback");
    mode = "incomplete"; await d.hook.refresh(); assert.equal(d.count(), 52); assert.equal(d.status(), "stale");
    mode = "indexed"; failPage = 2; generation = "failedlater";
    await d.hook.refresh(); assert.equal(d.count(), 52); assert.equal(d.status(), "stale");
    failPage = -1; generation = "removed"; removed = true;
    await d.hook.refresh(); assert.equal(d.count(), 51, "complete indexed revalidation honors legitimate removal"); assert.equal(d.status(), "ready");
    held = { page: 3 }; const obsolete = d.hook.loadNextCanonicalPage();
    for (let n = 0; !held.resolve && n < 100; n++) await Promise.resolve();
    assert.ok(held.resolve); const release = held.resolve; held = undefined;
    generation = "latest"; await d.hook.refresh(); release();
    assert.equal(await obsolete, false); assert.equal(d.count(), 51);
    assert.equal(await d.hook.loadNextCanonicalPage(), true); assert.equal(d.count(), 61); assert.equal(requests.at(-1), "latest_3");
    assert.equal(new Set(d.rows().map((row) => row.address)).size, 61);
    mode = "fallback"; const cold = createDirectory(); await cold.hook.refresh();
    assert.equal(cold.count(), 8); assert.equal(cold.status(), "fallback");
    const fallback = await readVNextCanonicalMarketDirectoryPage("https://fixture.invalid");
    assert.equal(fallback.status, 200); assert.equal(fallback.body.inventorySource, "curated-fallback");
    assert.equal(parseVNextCanonicalDirectoryResponse(fallback.body).inventorySource, "curated-fallback");
    assert.equal(parseVNextCanonicalDirectoryResponse({ ...fallback.body, inventorySource: "guessed" }), null);
    assert.equal(parseVNextCanonicalDirectoryResponse({ ...fallback.body, revalidationComplete: true }), null);
    assert.equal(parseVNextCanonicalDirectoryResponse({ ...fallback.body, revalidationComplete: undefined }), null);
    mode = "small-indexed"; const small = createDirectory(); await small.hook.refresh();
    assert.equal(small.count(), 8); assert.equal(small.status(), "ready", "eight rows and no cursor do not imply fallback");
    mode = "indexed"; removed = false;
    let now = 0;
    const cachedDependencies = { ...dependencies, presentationCache: true, now: () => now };
    const initial = await readVNextMarketDirectoryRequest("https://fixture.invalid", {}, cachedDependencies);
    assert.equal(initial.body.inventorySource, "indexed");
    const hit = await readVNextMarketDirectoryRequest("https://fixture.invalid", {}, cachedDependencies);
    assert.equal(hit.headers["X-RMT-Directory-Cache"], "HIT"); assert.equal(hit.body.inventorySource, "indexed");
    now = 15001;
    const stale = await readVNextMarketDirectoryRequest("https://fixture.invalid", {}, cachedDependencies);
    assert.equal(stale.headers["X-RMT-Directory-Freshness"], "last-known"); assert.equal(stale.body.stale, true);
    mode = "body-stale";
    const staleDependencies = { ...dependencies, presentationCache: true };
    await readVNextMarketDirectoryRequest("https://fixture.invalid", {}, staleDependencies);
    const staleHit = await readVNextMarketDirectoryRequest("https://fixture.invalid", {}, staleDependencies);
    assert.equal(staleHit.headers["X-RMT-Directory-Cache"], "HIT");
    assert.equal(staleHit.headers["X-RMT-Directory-Freshness"], "last-known");
    mode = "indexed";
    const quarantine = createDirectory(); await quarantine.hook.refresh(); await quarantine.hook.loadNextCanonicalPage(); await quarantine.hook.loadNextCanonicalPage();
    const conflict = await applyProjectIdentityDirectoryAdmission([{ address: address(45), verifiedIdentity: { address: address(45), name: "Established Project", symbol: "EST" } }], {
      readAuthority: async () => ({ status: "ready", entries: [{ projectId: "est", name: "Established Project", symbol: "EST", contractAddress: address(9999), authority: "coingecko-robinhood-contract-registry" }] }),
      readIdentity: async () => ({ address: address(9999), name: "Established Project", symbol: "EST" })
    });
    assert.equal(conflict.quarantined.length, 1);
    mode = "fallback"; await quarantine.hook.refresh();
    assert.equal(quarantine.count(), 51); assert.equal(quarantine.rows().some((row) => row.address.toLowerCase() === address(45)), false, "fallback retention cannot resurrect a known positive quarantine");
    await quarantine.hook.refresh(); assert.equal(quarantine.count(), 51);
    console.log("PASS: 52 indexed rows retained through repeated real HTTP 200 fallback; cold fallback, stale cache/body/later pages, partial indexed coverage, complete removal, obsolete response, recovery cursor and quarantine.");
  } finally { globalThis.fetch = originalFetch; }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
