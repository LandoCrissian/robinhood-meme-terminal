import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rmt-terminal-health-"));
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "verify-production-health.mjs");
const now = Date.now();
const zeroAddress = `0x${"0".repeat(40)}`;
const controls = [
  ["stonkbroker", "0xe934e36a439c94017b64a3fece66af12099abf50"],
  ["pons", "0x39dbed3a2bd333467115de45665cc57f813c4571"],
  ["pipedog", "0x5cb6f181081301b44905f3ae15419112ecabd8a6"],
  ["cashcat", "0x020bfc650a365f8bb26819deaabf3e21291018b4"],
  ["lemon", "0xf0e17e54239cd945cd7bea471a3a2ca6a8c7f7a3"]
];

const writeJson = (name, value) => {
  fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
};
const writeHeaders = (name, contentType, sharedMaxAge = null) => {
  const cache = sharedMaxAge === null
    ? "cache-control: public"
    : `cache-control: public\r\ncdn-cache-control: public, s-maxage=${sharedMaxAge}`;
  fs.writeFileSync(
    path.join(directory, name),
    `HTTP/2 200\r\ncontent-type: ${contentType}\r\n${cache}\r\n`
  );
};

function healthyHealth() {
  return {
    schemaVersion: 2,
    product: "rmt-terminal",
    ok: true,
    network: "Robinhood Chain",
    chainId: 4_663,
    latestBlock: "2000",
    blockAgeSeconds: 2,
    latencyMs: 45,
    checkedAt: new Date(now - 1_000).toISOString(),
    terminalEvidence: {
      canonicalBrowseEnabled: true,
      marketIndexerConfigured: true,
      inventoryStatus: "partial",
      canonicalCoverage: "partial"
    },
    checks: [
      { key: "rpc", state: "operational" },
      { key: "market-indexer", state: "operational" },
      { key: "canonical-inventory", state: "operational" }
    ]
  };
}

function healthyDirectory(page) {
  return page === 1
    ? {
        canonical: true,
        coverage: "partial",
        nextCursor: "page-two-cursor",
        markets: [
          { address: controls[0][1] },
          { address: controls[1][1] }
        ]
      }
    : {
        canonical: true,
        coverage: "partial",
        nextCursor: "page-three-cursor",
        markets: [
          { address: controls[2][1] },
          { address: controls[3][1] }
        ]
      };
}

function writeHealthyArtifacts() {
  writeJson("health.json", healthyHealth());
  writeHeaders("health.headers", "application/json", 15);
  writeJson("directory.json", healthyDirectory(1));
  writeHeaders("directory.headers", "application/json");
  writeJson("directory-next.json", healthyDirectory(2));
  writeHeaders("directory-next.headers", "application/json");
  for (const [name, address] of controls) {
    writeJson(`search-${name}.json`, {
      queryKind: "token-or-pool-address",
      status: "found",
      results: [{ address }]
    });
  }
  writeJson("search-stonkbroker-text.json", {
    queryKind: "text",
    status: "found",
    results: [{ address: controls[0][1] }]
  });
  for (const page of ["home", "vnext"]) {
    fs.writeFileSync(path.join(directory, `${page}.html`), "<!doctype html><title>RMT Terminal</title><main>Markets</main>");
    writeHeaders(`${page}.headers`, "text/html; charset=utf-8");
  }
}

function run() {
  return spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
}

function rejects(label, mutate, pattern) {
  writeHealthyArtifacts();
  mutate();
  const result = run();
  assert.notEqual(result.status, 0, `${label} unexpectedly passed`);
  assert.match(result.stderr, pattern, `${label}: ${result.stderr}`);
}

try {
  writeHealthyArtifacts();
  const healthy = run();
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.match(healthy.stdout, /Terminal healthy at block 2000/);

  rejects("wrong chain", () => {
    writeJson("health.json", { ...healthyHealth(), chainId: 1 });
  }, /Unexpected Terminal chain ID/);

  rejects("stale timestamp", () => {
    writeJson("health.json", {
      ...healthyHealth(),
      checkedAt: new Date(now - 61_000).toISOString()
    });
  }, /health report is stale/);

  rejects("launchpad schema", () => {
    writeJson("health.json", {
      ...healthyHealth(),
      schemaVersion: 1,
      product: "launchpad",
      checks: [{ key: "factory", state: "operational" }]
    });
  }, /not using the Terminal schema/);

  rejects("launchpad check key", () => {
    const health = healthyHealth();
    health.checks[2] = { key: "factory", state: "operational" };
    writeJson("health.json", health);
  }, /non-Terminal checks/);

  rejects("market indexer unavailable", () => {
    const health = healthyHealth();
    health.ok = false;
    health.terminalEvidence.marketIndexerConfigured = false;
    health.terminalEvidence.inventoryStatus = "unavailable";
    health.terminalEvidence.canonicalCoverage = "unavailable";
    health.checks[1].state = "degraded";
    writeJson("health.json", health);
  }, /Terminal health is degraded/);

  rejects("canonical browse disabled", () => {
    const health = healthyHealth();
    health.terminalEvidence.canonicalBrowseEnabled = false;
    writeJson("health.json", health);
  }, /inventory health evidence is unavailable/);

  rejects("noncanonical directory", () => {
    writeJson("directory.json", { ...healthyDirectory(1), canonical: false });
  }, /page one is not canonical/);

  rejects("empty directory", () => {
    writeJson("directory.json", { ...healthyDirectory(1), markets: [] });
  }, /page one is empty/);

  rejects("zero address", () => {
    writeJson("directory.json", {
      ...healthyDirectory(1),
      markets: [{ address: zeroAddress }]
    });
  }, /invalid or zero token address/);

  rejects("duplicate address", () => {
    writeJson("directory.json", {
      ...healthyDirectory(1),
      markets: [{ address: controls[0][1] }, { address: controls[0][1].toUpperCase().replace("0X", "0x") }]
    });
  }, /duplicate token address/);

  rejects("missing next cursor", () => {
    const page = healthyDirectory(1);
    delete page.nextCursor;
    writeJson("directory.json", page);
  }, /missing its opaque next cursor/);

  rejects("repeated page", () => {
    writeJson("directory-next.json", {
      ...healthyDirectory(1),
      nextCursor: "page-three-cursor"
    });
  }, /repeated page one/);

  rejects("stuck cursor", () => {
    writeJson("directory-next.json", {
      ...healthyDirectory(2),
      nextCursor: healthyDirectory(1).nextCursor
    });
  }, /cursor progression is stuck/);

  rejects("malformed search", () => {
    writeJson("search-pons.json", { status: "found", results: "invalid" });
  }, /pons exact-search control is invalid/);

  rejects("missing exact contract", () => {
    writeJson("search-lemon.json", {
      queryKind: "token-or-pool-address",
      status: "found",
      results: [{ address: controls[0][1] }]
    });
  }, /lemon exact-search control is invalid/);

  rejects("text omits expected contract", () => {
    writeJson("search-stonkbroker-text.json", {
      queryKind: "text",
      status: "found",
      results: [{ address: controls[1][1] }]
    });
  }, /STONKBROKER text-search control is invalid/);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.info("Terminal production-health verifier smoke test passed");
