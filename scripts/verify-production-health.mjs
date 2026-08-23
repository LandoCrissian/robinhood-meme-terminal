import fs from "node:fs";
import path from "node:path";
import {
  hasSharedCachePolicy,
  INDEXER_FAILURE_AGE_MS,
  INDEXER_WARNING_AGE_MS,
  maximumExpectedCheckpointDriftBlocks,
  maximumExpectedIndexerLagBlocks
} from "./production-health-policy.mjs";

const artifactDirectory = process.argv[2] ?? "health-artifacts";
const read = (name) => fs.readFileSync(path.join(artifactDirectory, name), "utf8");
const protocol = JSON.parse(read("protocol.json"));
const protocolHeaders = read("protocol.headers");
const launches = JSON.parse(read("launches.json"));
const launchHeaders = read("launches.headers");
const indexer = JSON.parse(read("indexer.json"));
const now = Date.now();

const currentMarketControls = [
  ["stonkbroker", "0xe934e36a439c94017b64a3fece66af12099abf50"],
  ["pons", "0x39dbed3a2bd333467115de45665cc57f813c4571"],
  ["pipedog", "0x5cb6f181081301b44905f3ae15419112ecabd8a6"],
  ["cashcat", "0x020bfc650a365f8bb26819deaabf3e21291018b4"],
  ["lemon", "0xf0e17e54239cd945cd7bea471a3a2ca6a8c7f7a3"]
];

const expected = {
  chainId: 4663,
  registry: "0x27c0269e16209eee149e2738d0819a2633f44246",
  factory: "0x8e75c57079a01ce2094bc4187b78710887547651",
  factoryStartBlock: "10248855",
  policyRegistry: "0x70177a46a38c981480fee9586ccbe281ee70dfcf",
  governance: "0x52c43239df8965eb27f26e115cc5ead11b35d5c3"
};
const lower = (value) => typeof value === "string" ? value.toLowerCase() : "";
const timestamp = (value, label) => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} timestamp is invalid: ${value}`);
  return parsed;
};

if (!protocol.ok) throw new Error("Protocol health is degraded.");
const protocolAge = now - timestamp(protocol.checkedAt, "Protocol health");
if (protocolAge < 0 || protocolAge > 60_000) {
  throw new Error(`Protocol health report is stale: ${protocol.checkedAt}`);
}
if (!hasSharedCachePolicy(protocolHeaders, 15)) {
  throw new Error("Protocol health is missing its 15-second shared-cache policy.");
}
if (protocol.chainId !== expected.chainId) {
  throw new Error(`Unexpected protocol chain ID: ${protocol.chainId}`);
}
if (!Array.isArray(protocol.checks) || protocol.checks.some((check) => check.state !== "operational")) {
  throw new Error("One or more protocol checks are degraded.");
}
const evidence = protocol.releaseEvidence;
if (
  !evidence
  || evidence.mode !== "v6-cutover"
  || lower(evidence.registryAddress) !== expected.registry
  || lower(evidence.factoryAddress) !== expected.factory
  || evidence.factoryStartBlock !== expected.factoryStartBlock
  || !evidence.registryConfiguredExplicitly
  || !evidence.registryConfigurationValid
  || !evidence.factoryStartBlockConfiguredExplicitly
  || !evidence.factoryStartBlockConfigurationValid
) {
  throw new Error("Public application is not pinned to the exact live V6 release.");
}

if (!Array.isArray(launches.launches) || !launches.syncedAt) {
  throw new Error("Launch feed response is invalid.");
}
if (launches.stale === true) {
  throw new Error("Public launch feed is serving a stale fallback snapshot.");
}
const launchSyncedAt = timestamp(launches.syncedAt, "Launch feed");
const launchFeedAge = now - launchSyncedAt;
if (launchFeedAge < 0 || launchFeedAge > 5 * 60_000) {
  throw new Error(`Public launch feed timestamp is stale: ${launches.syncedAt}`);
}
if (
  launches.chainId !== expected.chainId
  || launches.protocolVersion !== 6
  || lower(launches.factory) !== expected.factory
  || launches.factoryStartBlock !== expected.factoryStartBlock
) {
  throw new Error("Public launch feed is not bound to the exact live V6 index.");
}
if (launches.creatorSafeguardsReady !== true) {
  throw new Error("Creator concentration or creator-wallet flow enrichment is unavailable.");
}
if (launches.source !== "indexer" || !launchHeaders.toLowerCase().includes("x-rmt-data-source: indexer")) {
  throw new Error("Public launch feed is not serving the confirmed production indexer.");
}
if (!hasSharedCachePolicy(launchHeaders, 15)) {
  throw new Error("Public launch feed is missing its 15-second shared-cache policy.");
}

if (!indexer.ok || !indexer.initialSyncComplete) {
  throw new Error(`Production indexer is not ready: ${indexer.error || "unknown error"}`);
}
if (indexer.chainId !== expected.chainId || indexer.protocolVersion !== 6) {
  throw new Error("Production indexer is bound to the wrong chain or protocol version.");
}
for (const key of ["factory", "policyRegistry", "governance"]) {
  if (lower(indexer[key]) !== expected[key]) {
    throw new Error(`Production indexer ${key} mismatch: ${indexer[key]}`);
  }
}
if (
  lower(indexer.creatorPayoutAuthority) !== expected.governance
  || lower(indexer.protocolTreasury) !== expected.governance
) {
  throw new Error("Production indexer governance bindings are invalid.");
}

const lagBlocks = BigInt(indexer.lagBlocks);
const confirmationDepth = BigInt(indexer.confirmationDepth);
if (confirmationDepth !== 20n) {
  throw new Error(`Production indexer confirmation depth is ${confirmationDepth}; expected 20.`);
}
const indexerSyncedAt = timestamp(indexer.lastSyncAt, "Production indexer");
const lastSyncAge = now - indexerSyncedAt;
if (lastSyncAge < 0 || lastSyncAge > INDEXER_FAILURE_AGE_MS) {
  throw new Error(`Production indexer last sync is stale: ${indexer.lastSyncAt}`);
}
if (lastSyncAge > INDEXER_WARNING_AGE_MS) {
  console.warn(`Production indexer has not completed a sync for ${Math.round(lastSyncAge / 1_000)} seconds.`);
}
const maximumLagBlocks = maximumExpectedIndexerLagBlocks({ confirmationDepth, lastSyncAgeMs: lastSyncAge });
if (lagBlocks > maximumLagBlocks) {
  throw new Error(
    `Production indexer lag is ${lagBlocks} blocks; the time-adjusted limit is ${maximumLagBlocks}.`
  );
}

const launchCheckpoint = BigInt(launches.indexedThrough);
const indexerCheckpoint = BigInt(indexer.indexedThrough);
if (launchCheckpoint > indexerCheckpoint) {
  throw new Error(`Public launch checkpoint ${launchCheckpoint} is ahead of indexer ${indexerCheckpoint}.`);
}
const checkpointDrift = indexerCheckpoint - launchCheckpoint;
const maximumCheckpointDrift = maximumExpectedCheckpointDriftBlocks({
  confirmationDepth,
  newerSyncedAtMs: indexerSyncedAt,
  olderSyncedAtMs: launchSyncedAt
});
if (checkpointDrift > maximumCheckpointDrift) {
  throw new Error(
    `Public launch checkpoint trails the indexer by ${checkpointDrift} blocks; `
      + `the timestamp-adjusted limit is ${maximumCheckpointDrift}.`
  );
}

for (const [name, address] of currentMarketControls) {
  const result = JSON.parse(read(`search-${name}.json`));
  if (
    result.status !== "found"
    || result.queryKind !== "token-or-pool-address"
    || !Array.isArray(result.results)
    || !result.results.some((market) => lower(market.address) === address)
  ) {
    throw new Error(`Current ${name} exact-search control is invalid.`);
  }
}
const stonkbrokerText = JSON.parse(read("search-stonkbroker-text.json"));
if (
  stonkbrokerText.status !== "found"
  || stonkbrokerText.queryKind !== "text"
  || !Array.isArray(stonkbrokerText.results)
  || !stonkbrokerText.results.some((market) => lower(market.address) === currentMarketControls[0][1])
) {
  throw new Error("Current STONKBROKER text-search control is invalid.");
}

console.info(
  `Healthy at block ${protocol.latestBlock}; ${launches.launches.length} launches; `
    + `indexer lag ${lagBlocks}/${maximumLagBlocks} blocks; `
    + `launch drift ${checkpointDrift}/${maximumCheckpointDrift} blocks; `
    + `${currentMarketControls.length} current exact-search controls and STONKBROKER text search passed.`
);
