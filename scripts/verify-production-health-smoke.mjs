import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rmt-production-health-"));
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "verify-production-health.mjs");
const now = Date.now();
const writeJson = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
const writeHeaders = (name, sharedMaxAge, extra = "") => fs.writeFileSync(
  path.join(directory, name),
  `HTTP/2 200\r\ncache-control: public\r\ncdn-cache-control: public, s-maxage=${sharedMaxAge}\r\n${extra}`
);

try {
  writeJson("protocol.json", {
    ok: true,
    chainId: 4663,
    latestBlock: "2000",
    checkedAt: new Date(now - 1_000).toISOString(),
    releaseEvidence: {
      mode: "v6-cutover",
      registryAddress: "0x27c0269e16209eee149e2738d0819a2633f44246",
      factoryAddress: "0x8e75c57079a01ce2094bc4187b78710887547651",
      factoryStartBlock: "10248855",
      registryConfiguredExplicitly: true,
      registryConfigurationValid: true,
      factoryStartBlockConfiguredExplicitly: true,
      factoryStartBlockConfigurationValid: true
    },
    checks: [{ state: "operational" }]
  });
  writeHeaders("protocol.headers", 15);

  writeJson("launches.json", {
    chainId: 4663,
    protocolVersion: 6,
    factory: "0x8e75c57079a01ce2094bc4187b78710887547651",
    factoryStartBlock: "10248855",
    launches: [{}],
    syncedAt: new Date(now - 30_000).toISOString(),
    indexedThrough: "1000",
    creatorSafeguardsReady: true,
    source: "indexer"
  });
  writeHeaders("launches.headers", 15, "x-rmt-data-source: indexer\r\n");

  writeJson("indexer.json", {
    ok: true,
    initialSyncComplete: true,
    chainId: 4663,
    protocolVersion: 6,
    factory: "0x8e75c57079a01ce2094bc4187b78710887547651",
    policyRegistry: "0x70177a46a38c981480fee9586ccbe281ee70dfcf",
    governance: "0x52c43239df8965eb27f26e115cc5ead11b35d5c3",
    creatorPayoutAuthority: "0x52c43239df8965eb27f26e115cc5ead11b35d5c3",
    protocolTreasury: "0x52c43239df8965eb27f26e115cc5ead11b35d5c3",
    confirmationDepth: 20,
    indexedThrough: "1300",
    lagBlocks: "90",
    lastSyncAt: new Date(now - 5_000).toISOString()
  });

  writeJson("trades.json", {
    market: "0xb26fb775c0ac365d369bee9ac2e044c5d90ffbee",
    token: "0xdba33be56c89cc9fc014c4459028d7e5c7878671",
    trades: [{}],
    syncedAt: new Date(now - 5_000).toISOString()
  });
  writeHeaders("trades.headers", 5, "x-rmt-data-source: indexer\r\n");

  const healthy = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.match(healthy.stdout, /Healthy at block 2000/);

  fs.writeFileSync(path.join(directory, "protocol.headers"), "HTTP/2 200\r\ncache-control: public\r\n");
  const missingCachePolicy = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
  assert.notEqual(missingCachePolicy.status, 0);
  assert.match(missingCachePolicy.stderr, /missing its 15-second shared-cache policy/);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.info("Production health verifier smoke test passed");
