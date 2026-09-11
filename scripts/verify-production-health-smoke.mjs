import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function page(count = 9) {
  return {
    canonical: true, inventorySource: "indexed", coverage: "partial", nextCursor: "cursor_page_2",
    revalidationComplete: false, identityEvidence: "last-known", stale: true,
    updatedAt: new Date(now).toISOString(), failureReasons: ["INDEXED_IDENTITY_SNAPSHOT_UNAVAILABLE"],
    quarantinedAddresses: [],
    markets: Array.from({ length: count }, (_, i) => {
      const address = "0x" + (i + 1).toString(16).padStart(40, "0");
      return { address, assetId: "eip155:4663/contract:" + address, name: "Fixture " + i, symbol: "F" + i,
        verifiedIdentity: { address, name: "Fixture " + i, symbol: "F" + i, decimals: 18 } };
    })
  };
}
function writeHealthy() {
  writeJson("health.json", health());
  writeHeaders("health.headers", "application/json", 15);
  writeJson("directory.json", page());
  writeJson("directory-next-request.json", { cursor: "cursor_page_2" });
  writeJson("directory-next.json", { ...page(12), nextCursor: null });
  fs.writeFileSync(path.join(directory, "directory-next.headers"), "HTTP/2 200\r\nx-rmt-directory-cache: MISS\r\ncache-control: private, no-store, max-age=0\r\n");
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
}

try {
  writeHealthy();
  const healthy = run();
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.match(healthy.stdout, /9 indexed first-page markets/);
  rejects(() => writeJson("health.json", { ...health(), chainId: 1 }), /Unexpected Terminal chain ID/);
  rejects(() => { const value = health(); value.checks[2] = { key: "market-indexer", state: "operational" }; writeJson("health.json", value); }, /non-Terminal checks/);
  rejects(() => { const value = health(); value.terminalEvidence.historicalMarketIndexerRequired = true; writeJson("health.json", value); }, /inventory health evidence/);
  const mutatePage = (change, name = "directory.json") => {
    const value = name === "directory-next.json" ? { ...page(12), nextCursor: null } : page();
    change(value); writeJson(name, value);
  };
  // Both fully identified terminal pages and partially enriched paginated pages are valid.
  writeHealthy(); writeJson("directory.json", { ...page(76), coverage: "complete", nextCursor: null, revalidationComplete: true });
  assert.equal(run().status, 0);
  writeHealthy(); writeJson("directory.json", { ...page(), revalidationComplete: true });
  assert.equal(run().status, 0); // Complete page identities do not imply complete inventory.
  rejects(() => mutatePage(p => p.markets = []), /empty/);
  rejects(() => mutatePage(p => p.inventorySource = "curated-fallback"), /not curated fallback/);
  rejects(() => mutatePage(p => p.canonical = false), /canonical indexed/);
  rejects(() => mutatePage(p => p.coverage = "complete"), /contradictory coverage/);
  rejects(() => mutatePage(p => p.stale = false), /contradictory coverage/);
  rejects(() => mutatePage(p => p.nextCursor = "bad cursor!"), /invalid cursor/);
  rejects(() => mutatePage(p => p.nextCursor = "a".repeat(1025)), /invalid cursor/);
  rejects(() => mutatePage(p => delete p.nextCursor), /invalid cursor/);
  rejects(() => mutatePage(p => p.failureReasons = ["INDEXED_INVENTORY_UNAVAILABLE"]), /unavailable indexed/);
  rejects(() => mutatePage(p => p.failureReasons = ["invented"]), /invalid failure/);
  rejects(() => mutatePage(p => p.markets.push(p.markets[0])), /duplicate identity/);
  rejects(() => mutatePage(p => p.markets[0].address = "0x123"), /malformed/);
  rejects(() => mutatePage(p => p.markets[0].verifiedIdentity.address = controls[0][1]), /mismatched/);
  rejects(() => mutatePage(p => p.markets[0].assetId = "eip155:1/contract:" + p.markets[0].address), /mismatched/);
  rejects(() => mutatePage(p => p.markets[0].verifiedIdentity.decimals = 256), /malformed/);
  rejects(() => mutatePage(p => p.markets[0].symbol = "wrong"), /mismatched/);
  rejects(() => mutatePage(p => p.quarantinedAddresses = [p.markets[0].address]), /quarantined/);
  rejects(() => writeJson("directory.json", page(201)), /page bound/);
  rejects(() => writeJson("directory-next-request.json", { cursor: "other" }), /not bound/);
  rejects(() => mutatePage(p => p.nextCursor = "cursor_page_2", "directory-next.json"), /did not advance/);
  rejects(() => mutatePage(p => p.inventorySource = "curated-fallback", "directory-next.json"), /not curated fallback/);
  rejects(() => fs.writeFileSync(path.join(directory, "directory-next.headers"), "x-rmt-directory-cache: HIT\ncache-control: no-store\n"), /bypass presentation/);
  rejects(() => fs.writeFileSync(path.join(directory, "directory-next.headers"), "x-rmt-directory-cache: MISS\ncache-control: public\n"), /bypass presentation/);
  rejects(() => { const h = health(); h.checkedAt = new Date(now - 120000).toISOString(); writeJson("health.json", h); }, /fresh|stale|old/i);
  rejects(() => writeJson("search-peep.json", { queryKind: "token-or-pool-address", status: "not_found", results: [] }), /peep exact-search control/);
  rejects(() => writeJson("search-hopium-text.json", { queryKind: "text", status: "found", results: [{ address: controls[0][1] }] }), /hopium text-search control/);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.info("Terminal indexed production-health verifier smoke test passed.");
