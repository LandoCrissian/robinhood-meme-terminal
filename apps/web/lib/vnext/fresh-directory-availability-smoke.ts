import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { directoryCountsObserved, boundedDirectoryFailureReasons, identityReadFailureReason } from "./directory-availability";

// Run the real root -> indexed reader -> identity reader and cold curated
// fallback. Replace only network/stock-registry/authority and React scheduling.
const require = createRequire(import.meta.url);
const Module = require("node:module");
const originalLoad = Module._load;
const realViem = require("viem");
const react = require("react");
const states: unknown[] = [];
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
let unavailable = true;
let durable = false;
let partial = false;
let singlePage = false;
let durableTailOnly = false;
let generation = 0;
let removed = false;
let identityCalls = 0;
const sources = ["sushiswap-v2", "sushiswap-v3", "uniswap-v2", "uniswap-v3", "uniswap-v4", "up-v2", "up-cl"];
const requests: string[] = [];
function inventory(url: string) {
  const cursor = new URL(url).searchParams.get("cursor");
  const page = cursor ? Number(cursor.split("_")[1]) : 0;
  if (cursor) assert.equal(cursor.split("_")[0], `g${generation}`);
  requests.push(cursor ?? "root");
  const rows = Array.from({ length: singlePage ? 50 : page < 2 ? 20 : 10 }, (_, i) => page * 40 + i * 2 + 1)
    .filter((n) => !removed || n !== 99);
  const pools = rows.map((n) => ({ sourceId: "uniswap-v3", protocol: "uniswap", version: 3,
    poolKey: address(1000 + n), poolAddress: address(1000 + n), token0: address(n), token1: address(n + 1),
    fee: 3000, tickSpacing: 60, stable: null, hooks: null,
    transactionHash: `0x${"1".repeat(64)}`, blockNumber: "100", blockHash: `0x${"2".repeat(64)}`,
    ...Object.fromEntries(["stateStatus", "liveFee", "feeDenominator", "gaugeAddress", "gaugeAlive", "gaugeWeight", "gaugeClaimable", "feesAddress", "bribeAddress", "stateError", "stateObservedBlock", "stateObservedBlockHash"].map((key) => [key, null])) }));
  return { chainId: 4663, mode: "shadow", authoritative: false, sourceManifestHash: `0x${"a".repeat(64)}`,
    coverage: { complete: true, finalizedHead: "200", sources: sources.map((sourceId) => ({ sourceId, status: "shadow-ready", indexedThrough: "200" })) },
    pools, nextCursor: !singlePage && page < 2 ? `g${generation}_${page + 1}` : null,
    ...(durable ? { browseIdentities: { source: "verified-token-identity-index", freshness: "last-known", identities: pools.flatMap((pool) => [pool.token0, pool.token1]).filter((a) => !durableTailOnly || Number(BigInt(a)) > 80).map((a) => ({ address: a, name: `Token ${Number(BigInt(a))}`, symbol: `T${Number(BigInt(a))}`, decimals: 18 })) } } : {}) };
}
Module._load = function(id: string, ...args: unknown[]) {
  if (id === "react") return { ...react, useState(initial: unknown) { const i = states.length; states.push(typeof initial === "function" ? initial() : initial); return [states[i], (next: unknown) => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(), useEffect() {} };
  if (id === "viem") return { ...realViem, createPublicClient: () => ({
    multicall: async ({ contracts }: { contracts: { address: string; functionName: string }[] }) => {
      identityCalls++;
      if (unavailable) throw Object.assign(new Error("sanitized fixture failure"), { name: "HttpRequestError" });
      return contracts.map(({ address: a, functionName }) => partial && Number(BigInt(a)) > 80
        ? { status: "failure", error: new Error("fixture missing identity") }
        : { status: "success", result: functionName === "name" ? `Token ${Number(BigInt(a))}` : functionName === "symbol" ? `T${Number(BigInt(a))}` : functionName === "decimals" ? 18 : 1000n });
    },
    getBytecode: async () => { throw new Error("cold pool RPC unavailable"); },
    readContract: async () => { throw new Error("cold pool RPC unavailable"); }
  }) };
  const loaded = originalLoad.call(this, id, ...args);
  if (id === "./vnext-market-indexer") return { ...loaded, readVNextCanonicalMarketInventory: (query: unknown) => loaded.readVNextCanonicalMarketInventory(query, {
    env: { RMT_MARKET_INDEXER_URL: "https://inventory.example", RMT_MARKET_INDEXER_READ_TOKEN: "fixture-read-credential-not-a-secret-00000" },
    fetch: async (url: string) => Response.json(inventory(String(url)))
  }) };
  if (id === "./robinhood-stock-token-registry") return { ...loaded, fetchRobinhoodStockRegistry: async () => ({ coverage: "complete", assetsByAddress: new Map() }) };
  if (id === "./project-identity-admission") return { ...loaded, applyProjectIdentityDirectoryAdmission: (rows: unknown[]) => loaded.applyProjectIdentityDirectoryAdmission(rows, { readAuthority: async () => ({ status: "ready", entries: [] }) }) };
  return loaded;
};
const { readVNextCanonicalMarketDirectoryPage } = require("../server/vnext-canonical-market-directory");
const { resetRmtCuratedMarketSnapshotForTests } = require("../server/rmt-curated-market-registry");
const { readVNextMarketDirectoryRequest } = require("../server/vnext-market-directory-route");
const { useVNextMarketDirectory } = require("../../app/vnext/use-vnext-market-directory");
Module._load = originalLoad;
const originalFetch = globalThis.fetch;
function createDirectory() {
  const offset = states.length;
  const hook = useVNextMarketDirectory();
  return { hook, count: () => (states[offset] as unknown[]).length, status: () => states[offset + 1], selected: () => states[offset + 4] };
}
async function main() {
  globalThis.fetch = (async (url: string) => {
    assert.match(String(url), /market-directory/);
    resetRmtCuratedMarketSnapshotForTests();
    const result = await readVNextMarketDirectoryRequest(new URL(url, "https://fixture.invalid").toString(), {}, {
      readCanonical: readVNextCanonicalMarketDirectoryPage, readLegacy: async () => { throw new Error("No enrichment repair"); }
    });
    return Response.json(result.body, { status: result.status, headers: result.headers });
  }) as typeof fetch;
  const d = createDirectory();
  await d.hook.refresh(); assert.equal(d.count(), 0); assert.equal(d.status(), "error");
  assert.equal(directoryCountsObserved(String(d.status()), d.count()), false);
  await d.hook.refresh(); assert.equal(d.count(), 0); assert.equal(d.status(), "error");
  unavailable = false;
  const start = performance.now();
  await d.hook.refresh(); const firstMs = Math.round(performance.now() - start);
  await d.hook.loadNextCanonicalPage(); await d.hook.loadNextCanonicalPage();
  assert.equal(d.count(), 100); assert.ok(firstMs <= 2000);
  d.hook.setSelectedAddress(address(90));
  for (const failure of [true, true, false]) { unavailable = failure; generation++; await d.hook.refresh(); assert.equal(d.count(), 100); assert.equal(d.selected(), address(90)); }
  partial = true; generation++; await d.hook.refresh(); assert.equal(d.count(), 100); assert.equal(d.status(), "stale");
  partial = false; generation++; await d.hook.refresh(); assert.equal(d.count(), 100);
  assert.equal(directoryCountsObserved(String(d.status()), d.count()), true);
  // Every request resets the curated cache. Durable identity transport is
  // parsed by the real inventory reader, not injected into the directory.
  unavailable = true; durable = true;
  const before = identityCalls;
  for (let cold = 0; cold < 3; cold++) {
    const fresh = createDirectory(); generation++;
    await fresh.hook.refresh(); await fresh.hook.loadNextCanonicalPage(); await fresh.hook.loadNextCanonicalPage();
    assert.equal(fresh.count(), 100); assert.equal(fresh.status(), "stale");
    assert.equal(directoryCountsObserved(String(fresh.status()), fresh.count()), true);
  }
  assert.equal(identityCalls, before, "complete durable browse metadata never requires live identity RPC");
  const parsed = await readVNextCanonicalMarketDirectoryPage("https://fixture.invalid");
  assert.equal(parsed.body.identityEvidence, "last-known");
  assert.equal(parsed.body.revalidationComplete, true);
  removed = true; generation++; await d.hook.refresh(); assert.equal(d.count(), 98, "removed pool and both token identities disappear, no indefinite union");
  assert.equal(d.selected(), address(90));
  const actualReader = require("../server/vnext-market-indexer").readVNextCanonicalMarketInventory;
  for (const mutate of [
    (body: any) => body.browseIdentities.identities.push(body.browseIdentities.identities[0]),
    (body: any) => { body.browseIdentities.identities[0].address = address(9999); },
    (body: any) => { body.browseIdentities.identities[0].decimals = 37; },
    (body: any) => { body.browseIdentities.source = "unverified-provider"; }
  ]) {
    const body = inventory("https://fixture.invalid"); mutate(body);
    const invalid = await actualReader({}, { env: { RMT_MARKET_INDEXER_URL: "https://inventory.example", RMT_MARKET_INDEXER_READ_TOKEN: "fixture-read-credential-not-a-secret-00000" }, fetch: async () => Response.json(body) });
    assert.equal(invalid.status, "invalid_upstream_response");
  }
  assert.equal(identityReadFailureReason({ name: "TimeoutError", message: "never publish provider details" }), "IDENTITY_RPC_TIMEOUT");
  assert.equal(identityReadFailureReason({ name: "HttpRequestError" }), "IDENTITY_RPC_UNAVAILABLE");
  assert.equal(identityReadFailureReason({ name: "ContractFunctionExecutionError" }), "IDENTITY_MULTICALL_FAILURE");
  assert.deepEqual(boundedDirectoryFailureReasons(["secret provider message", "IDENTITY_RPC_TIMEOUT", "IDENTITY_RPC_TIMEOUT"]), ["IDENTITY_RPC_TIMEOUT"]);
  singlePage = true; removed = false; durable = false; unavailable = false; partial = true;
  const partialCold = createDirectory(); await partialCold.hook.refresh();
  assert.equal(partialCold.count(), 80); assert.equal(partialCold.status(), "stale");
  const partialResponse = await readVNextCanonicalMarketDirectoryPage("https://fixture.invalid");
  assert.equal(partialResponse.status, 200); assert.equal(partialResponse.body.revalidationComplete, false);
  assert.equal(partialResponse.body.markets.length, 80);
  durable = true; durableTailOnly = true;
  const mixed = await readVNextCanonicalMarketDirectoryPage("https://fixture.invalid?identityEnrichment=1");
  assert.equal(mixed.body.markets.length, 100); assert.equal(mixed.body.identityEvidence, "mixed");
  assert.equal(mixed.body.revalidationComplete, true); assert.equal(mixed.body.stale, true);
  const { applyProjectIdentityDirectoryAdmission, knownPositiveProjectIdentityQuarantineAddresses } = require("../server/project-identity-admission");
  const quarantined = createDirectory(); await quarantined.hook.refresh();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(quarantined.count(), 100);
  const conflict = await applyProjectIdentityDirectoryAdmission([{ address: address(90), verifiedIdentity: { address: address(90), name: "Established Project", symbol: "EST" } }], {
    readAuthority: async () => ({ status: "ready", entries: [{ projectId: "est", name: "Established Project", symbol: "EST", contractAddress: address(9999), authority: "coingecko-robinhood-contract-registry" }] }),
    readIdentity: async () => ({ address: address(9999), name: "Established Project", symbol: "EST" })
  });
  assert.equal(conflict.quarantined.length, 1, "fixture establishes a positive identity conflict");
  assert.ok(knownPositiveProjectIdentityQuarantineAddresses().includes(address(90)));
  await quarantined.hook.refresh();
  assert.equal(quarantined.count(), 99, "durable metadata must not resurrect a positively quarantined identity");
  await quarantined.hook.refresh();
  assert.equal(quarantined.count(), 99, "repeated refresh retains the positive quarantine without duplicates");
  assert.ok(knownPositiveProjectIdentityQuarantineAddresses().includes(address(90)), "last-known metadata cannot clear positive conflict evidence");
  const quarantineResponse = await readVNextCanonicalMarketDirectoryPage("https://fixture.invalid");
  assert.equal(quarantineResponse.status, 200);
  assert.ok(quarantineResponse.body.quarantinedAddresses.includes(address(90)), "retained windows receive explicit quarantine removal evidence");
  console.log(JSON.stringify({ baselineFreshRows: 0, baselineStatus: "error", correctedUnknownCounts: "unavailable", recoveredRows: 100, durableColdRows: 100, firstMs, identityCalls, loadedWindowRetention: "PASS", sequence: "GOOD_503_503_GOOD_PARTIAL_GOOD" }));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; Module._load = originalLoad; });
