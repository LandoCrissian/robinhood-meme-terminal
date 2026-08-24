import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasSharedCachePolicy } from "./production-health-policy.mjs";

const CHAIN_ID = 4_663;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TERMINAL_CHECK_KEYS = new Set(["rpc", "market-indexer", "canonical-inventory"]);
const CURRENT_MARKET_CONTROLS = [
  ["stonkbroker", "0xe934e36a439c94017b64a3fece66af12099abf50"],
  ["pons", "0x39dbed3a2bd333467115de45665cc57f813c4571"],
  ["pipedog", "0x5cb6f181081301b44905f3ae15419112ecabd8a6"],
  ["cashcat", "0x020bfc650a365f8bb26819deaabf3e21291018b4"],
  ["lemon", "0xf0e17e54239cd945cd7bea471a3a2ca6a8c7f7a3"]
];

function timestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} timestamp is invalid.`);
  return parsed;
}

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function requireHtml(read, name, label) {
  const headers = read(`${name}.headers`).toLowerCase();
  const html = read(`${name}.html`);
  if (!headers.includes("content-type: text/html") || html.trim().length === 0) {
    throw new Error(`${label} did not return a usable HTML document.`);
  }
}

function validateDirectoryPage(page, label, { requireCursor }) {
  if (page?.canonical !== true) throw new Error(`${label} is not canonical.`);
  if (page.coverage !== "partial" && page.coverage !== "complete") {
    throw new Error(`${label} coverage is invalid.`);
  }
  if (!Array.isArray(page.markets) || page.markets.length === 0) {
    throw new Error(`${label} is empty.`);
  }
  const addresses = page.markets.map((market) => lower(market?.address));
  if (addresses.some((address) => !ADDRESS_PATTERN.test(address) || address === ZERO_ADDRESS)) {
    throw new Error(`${label} contains an invalid or zero token address.`);
  }
  if (new Set(addresses).size !== addresses.length) {
    throw new Error(`${label} contains a duplicate token address.`);
  }
  if (requireCursor && (typeof page.nextCursor !== "string" || page.nextCursor.length === 0)) {
    throw new Error(`${label} is missing its opaque next cursor.`);
  }
  if (page.nextCursor !== null && typeof page.nextCursor !== "string") {
    throw new Error(`${label} next cursor is invalid.`);
  }
  return addresses;
}

export function verifyProductionHealthArtifacts(
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
  if (healthAge < 0 || healthAge > 60_000) {
    throw new Error("Terminal health report is stale.");
  }
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
    || evidence.canonicalBrowseEnabled !== true
    || evidence.marketIndexerConfigured !== true
    || !["ready", "partial"].includes(evidence.inventoryStatus)
    || !["complete", "partial"].includes(evidence.canonicalCoverage)
    || (evidence.canonicalCoverage === "partial" && evidence.inventoryStatus !== "partial")
    || (evidence.canonicalCoverage === "complete" && evidence.inventoryStatus !== "ready")
  ) {
    throw new Error("Terminal inventory health evidence is unavailable or inconsistent.");
  }

  const directory = JSON.parse(read("directory.json"));
  const directoryNext = JSON.parse(read("directory-next.json"));
  const firstAddresses = validateDirectoryPage(directory, "Canonical directory page one", { requireCursor: true });
  const nextAddresses = validateDirectoryPage(directoryNext, "Canonical directory page two", { requireCursor: false });
  if (JSON.stringify(firstAddresses) === JSON.stringify(nextAddresses)) {
    throw new Error("Canonical directory pagination repeated page one.");
  }
  if (directoryNext.nextCursor === directory.nextCursor) {
    throw new Error("Canonical directory cursor progression is stuck.");
  }

  for (const [name, address] of CURRENT_MARKET_CONTROLS) {
    const result = JSON.parse(read(`search-${name}.json`));
    if (
      result.status !== "found"
      || result.queryKind !== "token-or-pool-address"
      || !Array.isArray(result.results)
      || !result.results.some((market) => lower(market?.address) === address)
    ) {
      throw new Error(`Current ${name} exact-search control is invalid.`);
    }
  }
  const stonkbrokerText = JSON.parse(read("search-stonkbroker-text.json"));
  if (
    stonkbrokerText.status !== "found"
    || stonkbrokerText.queryKind !== "text"
    || !Array.isArray(stonkbrokerText.results)
    || !stonkbrokerText.results.some(
      (market) => lower(market?.address) === CURRENT_MARKET_CONTROLS[0][1]
    )
  ) {
    throw new Error("Current STONKBROKER text-search control is invalid.");
  }

  requireHtml(read, "home", "Terminal root");
  requireHtml(read, "vnext", "Terminal /vnext compatibility route");

  return {
    latestBlock: health.latestBlock,
    coverage: directory.coverage,
    firstPageMarkets: directory.markets.length,
    secondPageMarkets: directoryNext.markets.length,
    exactSearchControls: CURRENT_MARKET_CONTROLS.length
  };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const result = verifyProductionHealthArtifacts(process.argv[2] ?? "health-artifacts");
  console.info(
    `Terminal healthy at block ${result.latestBlock}; canonical coverage ${result.coverage}; `
      + `${result.firstPageMarkets} + ${result.secondPageMarkets} paginated markets; `
      + `${result.exactSearchControls} exact-search controls and STONKBROKER text search passed.`
  );
}
