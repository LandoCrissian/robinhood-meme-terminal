import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectProductionDirectory } from "./collect-production-directory.mjs";
import { createDirectoryMonitor, MAX_DIRECTORY_MONITOR_PAGES } from "./verify-production-health.mjs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rmt-terminal-health-"));
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "verify-production-health.mjs");
const now = Date.now();
const controls = [
  ["stonkbroker", "0xe934e36a439c94017b64a3fece66af12099abf50"],
  ["pons", "0x39dbed3a2bd333467115de45665cc57f813c4571"],
  ["pipedog", "0x5cb6f181081301b44905f3ae15419112ecabd8a6"],
  ["cashcat", "0x020bfc650a365f8bb26819deaabf3e21291018b4"],
  ["lemon", "0xf0e17e54239cd945cd7bea471a3a2ca6a8c7f7a3"],
  ["peep", "0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f"],
  ["hopium", "0xb6ce51925c2e397ebf1a443b343d19267b3d4225"],
  ["cannacat", "0x1139d423c1706bdead91f03507f521635591ed92"]
];
const writeJson = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
const writeHeaders = (name, type, shared = null) => fs.writeFileSync(
  path.join(directory, name),
  `HTTP/2 200\r\ncontent-type: ${type}\r\n${shared === null ? "cache-control: public" : `cdn-cache-control: public, s-maxage=${shared}`}\r\n`
);

function health() {
  return {
    schemaVersion: 2, product: "rmt-terminal", ok: true, network: "Robinhood Chain", chainId: 4_663,
    latestBlock: "2000", blockAgeSeconds: 2, latencyMs: 45, checkedAt: new Date(now - 1_000).toISOString(),
    terminalEvidence: {
      curatedRegistryReady: true, curatedMarketsVerified: true,
      curatedMarketCount: controls.length, historicalMarketIndexerRequired: false
    },
    checks: [
      { key: "rpc", state: "operational" },
      { key: "curated-registry", state: "operational" },
      { key: "curated-markets", state: "operational" }
    ]
  };
}

const cursor = (block = 100, logIndex = 0, extra = {}) => Buffer.from(JSON.stringify({
  v: 2, chainId: 4663, source: null, token: null, poolKey: null,
  blockNumber: String(block), logIndex, ...extra
})).toString("base64url");
const address = value => "0x" + value.toString(16).padStart(40, "0");
const hash = "0x" + "1".repeat(64);
const jsonHeaders = "content-type: application/json\nx-rmt-directory-cache: MISS\ncache-control: private, no-store, max-age=0\n";
function page(start = 1, nextCursor = cursor(), count = 9) {
  return {
    canonical: true, inventorySource: "indexed", coverage: "partial", nextCursor,
    revalidationComplete: false, identityEvidence: "last-known", stale: true,
    updatedAt: new Date(now).toISOString(), failureReasons: ["INDEXED_IDENTITY_SNAPSHOT_UNAVAILABLE"], quarantinedAddresses: [],
    markets: Array.from({ length: count }, (_, i) => {
      const token = address(start + i);
      return { address: token, assetId: "eip155:4663/contract:" + token, name: "Fixture " + i, symbol: "F" + i,
        verifiedIdentity: { address: token, name: "Fixture " + i, symbol: "F" + i, decimals: 18 },
        canonicalMarkets: [{ sourceId: "uniswap-v2", protocol: "uniswap", version: 2,
          poolKey: address(start + i + 10000), poolAddress: address(start + i + 10000),
          token0: token, token1: address(99999), transactionHash: hash, blockHash: hash, blockNumber: "50" }]
      };
    })
  };
}
const observation = (value, requestCursor = null) => ({ requestCursor, status: 200, headers: jsonHeaders, page: value });
const healthyPages = () => [observation(page()), observation(page(101, cursor(90)), cursor()), observation(page(201, null), cursor(90))];
const writePages = pages => writeJson("directory-pages.json", pages);
let negativeCases = 0;
let collectorCases = 0;

function writeHealthy() {
  writeJson("health.json", health());
  writeHeaders("health.headers", "application/json", 15);
  writePages(healthyPages());
  writeHeaders("directory.headers", "application/json");
  for (const [name, address] of controls) {
    writeJson(`search-${name}.json`, { queryKind: "token-or-pool-address", status: "found", results: [{ address }] });
    writeJson(`search-${name}-text.json`, { queryKind: "text", status: "found", results: [{ address }] });
  }
  for (const page of ["home", "vnext"]) {
    fs.writeFileSync(path.join(directory, `${page}.html`), "<!doctype html><title>RMT Terminal</title><main>Markets</main>");
    writeHeaders(`${page}.headers`, "text/html; charset=utf-8");
  }
}
const run = () => spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
function rejects(mutate, pattern) {
  writeHealthy(); mutate(); const result = run();
  assert.notEqual(result.status, 0); assert.match(result.stderr, pattern);
  negativeCases++;
}

const rejectsPages = (change, pattern) => rejects(() => { const pages = healthyPages(); change(pages); writePages(pages); }, pattern);

try {
  writeHealthy();
  const healthy = run();
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.match(healthy.stdout, /9 indexed first-page markets; 3 pages/);
  assert.match(healthy.stdout, /observed coverage partial/);
  assert.match(healthy.stdout, /Not trading or universal-coverage authorization/);
  rejects(() => writeJson("health.json", { ...health(), chainId: 1 }), /Unexpected Terminal chain ID/);
  rejects(() => { const value = health(); value.checks[2] = { key: "market-indexer", state: "operational" }; writeJson("health.json", value); }, /non-Terminal checks/);
  rejects(() => { const value = health(); value.terminalEvidence.historicalMarketIndexerRequired = true; writeJson("health.json", value); }, /inventory health evidence/);
  rejectsPages(p => p[0].page.markets = [], /empty/);
  rejectsPages(p => p[1].page.markets = [], /empty/);
  rejectsPages(p => p[0].page.markets = page(1, null, 201).markets, /page bound/);
  rejectsPages(p => p[0].page.inventorySource = "curated-fallback", /not curated fallback/);
  rejectsPages(p => p[1].page.inventorySource = "curated-fallback", /not curated fallback/);
  rejectsPages(p => p[0].page.canonical = false, /canonical indexed/);
  rejectsPages(p => p[0].page.coverage = "complete", /contradictory coverage/);
  rejectsPages(p => p[0].page.coverage = "unknown", /coverage metadata/);
  rejectsPages(p => p[0].page.stale = false, /contradictory coverage/);
  rejectsPages(p => p[0].page.updatedAt = "bad", /timestamp/);
  rejectsPages(p => p[0].page.identityEvidence = "guessed", /coverage metadata/);
  for (const reason of ["INDEXED_INVENTORY_UNAVAILABLE", "STOCK_CLASSIFICATION_UNAVAILABLE", "OTHER_BOUNDED_REASON"]) {
    rejectsPages(p => p[1].page.failureReasons = [reason], /inventory\/classification failure/);
  }
  rejectsPages(p => p[1].page.error = "upstream failed", /inventory\/classification failure/);
  rejectsPages(p => p[0].page.failureReasons = ["invented"], /invalid failure reasons/);
  rejectsPages(p => p[0].page.failureReasons.push(p[0].page.failureReasons[0]), /invalid failure reasons/);
  rejectsPages(p => p[0].page.markets.push(p[0].page.markets[0]), /duplicate identity/);
  rejectsPages(p => p[0].page.markets[0].address = "0x123", /malformed/);
  rejectsPages(p => p[0].page.markets[0].address = address(0), /malformed/);
  rejectsPages(p => p[0].page.markets[0].verifiedIdentity.address = address(123), /mismatched/);
  rejectsPages(p => p[0].page.markets[0].assetId = "eip155:1/contract:" + address(1), /mismatched/);
  rejectsPages(p => p[0].page.markets[0].verifiedIdentity.decimals = 256, /malformed/);
  rejectsPages(p => p[0].page.markets[0].symbol = "wrong", /mismatched/);
  rejectsPages(p => delete p[0].page.markets[0].verifiedIdentity, /malformed/);
  rejectsPages(p => p[0].page.markets[0].canonicalMarkets = [], /malformed canonical markets/);
  rejectsPages(p => p[0].page.markets[0].canonicalMarkets[0].token0 = address(700), /unbound market/);
  rejectsPages(p => p[0].page.markets[0].canonicalMarkets.push(p[0].page.markets[0].canonicalMarkets[0]), /duplicate market/);
  rejectsPages(p => p[0].page.quarantinedAddresses = [address(1)], /quarantined identity/);
  rejectsPages(p => p[2].page.quarantinedAddresses = [address(1)], /quarantined identity/);
  rejectsPages(p => p[0].page.quarantinedAddresses = [address(201)], /quarantined identity/);
  rejectsPages(p => p[0].page.quarantinedAddresses = ["bad"], /quarantine metadata/);
  rejectsPages(p => p[1].requestCursor = cursor(99), /not bound/);
  rejectsPages(p => p[1].page.nextCursor = cursor(), /cursor loop/);
  rejectsPages(p => p[2].page.nextCursor = cursor(), /cursor loop/);
  rejectsPages(p => p[1].page.nextCursor = cursor(101), /forward progress/);
  rejectsPages(p => p[1].page.nextCursor = cursor(100, 1), /forward progress/);
  rejectsPages(p => p[1].page.nextCursor = cursor(90, 0, { v: 3 }), /cursor contract/);
  rejectsPages(p => p[1].page.nextCursor = cursor(90, 0, { chainId: 1 }), /cursor contract/);
  rejectsPages(p => p[1].page.nextCursor = cursor(90, 0, { token: address(1) }), /query binding/);
  rejectsPages(p => p[1].page.nextCursor = "bad cursor!", /Invalid directory cursor/);
  rejectsPages(p => delete p[1].page.nextCursor, /Invalid directory cursor/);
  rejectsPages(p => p[1].page.nextCursor = "a".repeat(1025), /Invalid directory cursor/);
  rejectsPages(p => p[1].page.markets[0] = structuredClone(p[0].page.markets[0]), /Cross-page duplicate address\/asset/);
  rejectsPages(p => {
    const original = p[0].page.markets[0].canonicalMarkets[0];
    const later = p[1].page.markets[0].canonicalMarkets[0];
    later.poolKey = original.poolKey; later.poolAddress = original.poolAddress;
  }, /Cross-page duplicate market/);
  rejectsPages(p => p[1].headers = jsonHeaders.replace("MISS", "HIT"), /bypass presentation cache/);
  rejectsPages(p => p[1].headers = jsonHeaders.replace("MISS", "STALE"), /bypass presentation cache/);
  rejectsPages(p => p[1].headers = jsonHeaders.replace("no-store", "public"), /bypass presentation cache/);
  rejectsPages(p => p[1].headers = "content-type: text/html", /HTTP\/JSON/);
  rejectsPages(p => p[1].status = 503, /HTTP\/JSON/);
  rejectsPages(p => p.pop(), /pagination incomplete/);
  rejectsPages(p => p[0].page.nextCursor = null, /after terminal pagination/);
  rejects(() => writeJson("health.json", { ...health(), checkedAt: new Date(now - 120000).toISOString() }), /stale/);
  rejects(() => writeJson("health.json", { ...health(), latestBlock: "invalid" }), /latest block/);
  rejects(() => writeJson("health.json", { ...health(), ok: false }), /degraded/);
  rejects(() => writeJson("search-peep.json", { queryKind: "token-or-pool-address", status: "not_found", results: [] }), /peep exact-search control/);
  rejects(() => writeJson("search-hopium-text.json", { queryKind: "text", status: "found", results: [{ address: controls[0][1] }] }), /hopium text-search control/);

  // Terminal pagination may remain partial. Complete identity revalidation alone
  // does not imply complete inventory; a later complete page cannot erase partial.
  for (const count of [1, 8, 21, 76, 200]) {
    writeHealthy(); writePages([observation(page(1, null, count))]);
    assert.equal(run().status, 0);
  }
  const complete = { ...page(1, null), coverage: "complete", revalidationComplete: true, identityEvidence: "live", failureReasons: [], stale: false };
  writeHealthy(); writePages([observation(complete)]); assert.equal(run().status, 0);
  writeHealthy(); const mixed = healthyPages();
  mixed[2].page = { ...mixed[2].page, coverage: "complete", revalidationComplete: true, failureReasons: [] };
  writePages(mixed); assert.match(run().stdout, /observed coverage partial/);
  const sameBlock = healthyPages();
  sameBlock[0].page.nextCursor = cursor(100, 2); sameBlock[1].requestCursor = cursor(100, 2);
  sameBlock[1].page.nextCursor = cursor(100, 1); sameBlock[2].requestCursor = cursor(100, 1);
  writePages(sameBlock); assert.equal(run().status, 0);

  // Exercise the actual collector, injecting only the external HTTP boundary.
  const collected = healthyPages();
  const calls = [];
  const result = await collectProductionDirectory({ first: collected[0], fetchPage: async value => {
    calls.push(value); return collected[calls.length];
  } });
  assert.deepEqual(calls, [cursor(), cursor(90)]);
  assert.equal(result.pages, 3); assert.equal(result.coverage, "partial");
  assert.equal(result.tradingAuthorization, false); collectorCases++;
  await collectProductionDirectory({ first: observation(complete), fetchPage: async () => assert.fail("Terminal page must not request continuation") });
  collectorCases++;
  for (const [response, pattern] of [
    [observation(page(101, cursor())), /cursor loop/],
    [observation(page(101, cursor(101))), /forward progress/],
    [observation(page(1, null)), /Cross-page duplicate/],
    [{ ...observation(page(101, null)), status: 500 }, /HTTP\/JSON/],
    [observation({ ...page(101, null), failureReasons: ["INDEXED_INVENTORY_UNAVAILABLE"] }), /inventory\/classification failure/]
  ]) {
    await assert.rejects(collectProductionDirectory({ first: collected[0], fetchPage: async () => response }), pattern);
    collectorCases++;
  }
  await assert.rejects(collectProductionDirectory({ first: collected[0], fetchPage: async () => { throw new Error("transport failure"); } }), /transport failure/);
  collectorCases++;
  let pageNumber = 0;
  await assert.rejects(collectProductionDirectory({ first: collected[0], fetchPage: async () => {
    pageNumber++; return observation(page(1 + pageNumber * 100, cursor(100 - pageNumber)));
  } }), /budget exhausted/);
  assert.equal(pageNumber, MAX_DIRECTORY_MONITOR_PAGES - 1); collectorCases++;
  let ticks = 0;
  await assert.rejects(collectProductionDirectory({ first: collected[0], now: () => ticks++ * 100000,
    fetchPage: async () => assert.fail("Expired budget must not fetch") }), /budget exhausted/);
  collectorCases++;
  const monitor = createDirectoryMonitor(); assert.throws(() => monitor.finish(), /incomplete/);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.info(`Indexed production-health verifier passed: ${negativeCases} rejection fixtures; ${collectorCases} awaited collector cases; positive terminal/partial/complete and cursor progression fixtures.`);
