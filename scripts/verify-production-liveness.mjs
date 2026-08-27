import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasSharedCachePolicy } from "./production-health-policy.mjs";

const CHAIN_ID = 4_663;
const TERMINAL_CHECK_KEYS = new Set(["rpc", "curated-registry", "curated-markets"]);

function timestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} timestamp is invalid.`);
  return parsed;
}

export function verifyProductionLivenessArtifacts(
  artifactDirectory = "health-artifacts",
  now = Date.now()
) {
  const read = (name) => fs.readFileSync(path.join(artifactDirectory, name), "utf8");
  const health = JSON.parse(read("health.json"));
  const healthHeaders = read("health.headers");

  if (health.schemaVersion !== 2 || health.product !== "rmt-terminal") {
    throw new Error("Public health is not using the Terminal schema.");
  }
  if (health.ok !== true) throw new Error("Terminal health is degraded.");
  if (health.chainId !== CHAIN_ID) throw new Error(`Unexpected Terminal chain ID: ${health.chainId}`);
  if (!/^(?:0|[1-9][0-9]*)$/.test(health.latestBlock)) {
    throw new Error("Terminal health latest block is invalid.");
  }
  if (
    (health.blockAgeSeconds !== null && (
      !Number.isFinite(health.blockAgeSeconds) || health.blockAgeSeconds < 0
    ))
    || !Number.isFinite(health.latencyMs)
    || health.latencyMs < 0
  ) {
    throw new Error("Terminal health timing evidence is invalid.");
  }
  const healthAge = now - timestamp(health.checkedAt, "Terminal health");
  if (healthAge < 0 || healthAge > 60_000) throw new Error("Terminal health report is stale.");
  if (!hasSharedCachePolicy(healthHeaders, 15)) {
    throw new Error("Terminal health is missing its 15-second shared-cache policy.");
  }
  if (!Array.isArray(health.checks) || health.checks.length !== TERMINAL_CHECK_KEYS.size) {
    throw new Error("Terminal health checks are incomplete.");
  }
  const healthKeys = new Set(health.checks.map((item) => item?.key));
  if (
    healthKeys.size !== TERMINAL_CHECK_KEYS.size
    || [...healthKeys].some((key) => !TERMINAL_CHECK_KEYS.has(key))
    || health.checks.some((item) => item?.state !== "operational")
  ) {
    throw new Error("Terminal health contains degraded or non-Terminal checks.");
  }
  const evidence = health.terminalEvidence;
  if (
    !evidence
    || evidence.curatedRegistryReady !== true
    || evidence.curatedMarketsVerified !== true
    || !Number.isSafeInteger(evidence.curatedMarketCount)
    || evidence.curatedMarketCount < 1
    || evidence.historicalMarketIndexerRequired !== false
  ) {
    throw new Error("Terminal inventory health evidence is unavailable or inconsistent.");
  }

  return { latestBlock: health.latestBlock, curatedMarketCount: evidence.curatedMarketCount };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const result = verifyProductionLivenessArtifacts(process.argv[2] ?? "health-artifacts");
  console.info(`Terminal liveness healthy at block ${result.latestBlock}; ${result.curatedMarketCount} curated markets verified.`);
}
