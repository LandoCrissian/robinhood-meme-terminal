import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyProductionLivenessArtifacts } from "./verify-production-liveness.mjs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rmt-terminal-liveness-"));
const now = Date.now();

function health(overrides = {}) {
  return {
    schemaVersion: 2,
    product: "rmt-terminal",
    ok: true,
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
    ],
    ...overrides
  };
}

function write(value) {
  fs.writeFileSync(path.join(directory, "health.json"), JSON.stringify(value));
  fs.writeFileSync(
    path.join(directory, "health.headers"),
    "HTTP/2 200\r\ncontent-type: application/json\r\ncdn-cache-control: public, s-maxage=15\r\n"
  );
}

try {
  write(health());
  assert.deepEqual(verifyProductionLivenessArtifacts(directory, now), {
    latestBlock: "2000",
    coverage: "partial"
  });

  write(health({ ok: false }));
  assert.throws(() => verifyProductionLivenessArtifacts(directory, now), /degraded/);

  write(health({ chainId: 1 }));
  assert.throws(() => verifyProductionLivenessArtifacts(directory, now), /chain ID/);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.info("Terminal production-liveness verifier smoke test passed.");
