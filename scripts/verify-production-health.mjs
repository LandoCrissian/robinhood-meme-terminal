import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasSharedCachePolicy } from "./production-health-policy.mjs";

const CHAIN_ID = 4_663;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TERMINAL_CHECK_KEYS = new Set(["rpc", "curated-registry", "curated-markets"]);
const CURRENT_MARKET_CONTROLS = [
  ["stonkbroker", "0xe934e36a439c94017b64a3fece66af12099abf50"],
  ["pons", "0x39dbed3a2bd333467115de45665cc57f813c4571"],
  ["pipedog", "0x5cb6f181081301b44905f3ae15419112ecabd8a6"],
  ["cashcat", "0x020bfc650a365f8bb26819deaabf3e21291018b4"],
  ["lemon", "0xf0e17e54239cd945cd7bea471a3a2ca6a8c7f7a3"],
  ["peep", "0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f"],
  ["hopium", "0xb6ce51925c2e397ebf1a443b343d19267b3d4225"],
  ["cannacat", "0x1139d423c1706bdead91f03507f521635591ed92"]
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

export function validateDirectoryPage(page, label) {
  if (!page || page.canonical !== true || page.inventorySource !== "indexed") {
    throw new Error(label + " must be canonical indexed inventory, not curated fallback.");
  }
  if (!["partial", "complete"].includes(page.coverage)
    || typeof page.revalidationComplete !== "boolean"
    || !["live", "last-known", "mixed"].includes(page.identityEvidence)
    || (page.stale !== undefined && typeof page.stale !== "boolean")) {
    throw new Error(label + " has invalid coverage metadata.");
  }
  timestamp(page.updatedAt, label + " updatedAt");
  const reasons = new Set([
    "IDENTITY_RPC_TIMEOUT", "IDENTITY_RPC_UNAVAILABLE", "IDENTITY_MULTICALL_FAILURE",
    "IDENTITY_RESPONSE_INVALID", "STOCK_CLASSIFICATION_UNAVAILABLE",
    "PROJECT_IDENTITY_AUTHORITY_UNAVAILABLE", "INDEXED_INVENTORY_UNAVAILABLE",
    "INDEXED_IDENTITY_SNAPSHOT_UNAVAILABLE", "CURATED_POOL_VERIFICATION_UNAVAILABLE",
    "OTHER_BOUNDED_REASON"
  ]);
  if (!Array.isArray(page.failureReasons) || page.failureReasons.some(reason => !reasons.has(reason))
    || new Set(page.failureReasons).size !== page.failureReasons.length) {
    throw new Error(label + " has invalid failure reasons.");
  }
  if (page.error || page.failureReasons.includes("INDEXED_INVENTORY_UNAVAILABLE")
    || page.failureReasons.includes("STOCK_CLASSIFICATION_UNAVAILABLE")) {
    throw new Error(label + " reports unavailable indexed inventory or classification.");
  }
  if (page.nextCursor !== null && (typeof page.nextCursor !== "string"
    || !/^[A-Za-z0-9_-]{1,1024}$/.test(page.nextCursor))) {
    throw new Error(label + " has invalid cursor.");
  }
  if ((page.coverage === "complete" && (!page.revalidationComplete || page.nextCursor !== null))
    || (!page.revalidationComplete && (page.coverage !== "partial" || page.stale !== true))) {
    throw new Error(label + " has contradictory coverage.");
  }
  // A successful readiness observation needs useful inventory, not an authoritative false zero.
  // A legitimate empty terminal page can still be reported as not ready, never fabricated healthy.
  if (!Array.isArray(page.markets) || page.markets.length === 0 || page.markets.length > 200) {
    throw new Error(label + " is empty or exceeds the 100-pool/two-token page bound.");
  }
  const quarantine = page.quarantinedAddresses;
  if (!Array.isArray(quarantine) || quarantine.some(address => !ADDRESS_PATTERN.test(address) || lower(address) === ZERO_ADDRESS)
    || new Set(quarantine.map(lower)).size !== quarantine.length) {
    throw new Error(label + " has invalid quarantine metadata.");
  }
  const addresses = new Set();
  for (const market of page.markets) {
    const address = lower(market?.address);
    const identity = market?.verifiedIdentity;
    if (!ADDRESS_PATTERN.test(address) || address === ZERO_ADDRESS || !identity
      || lower(identity.address) !== address || lower(market.assetId) !== "eip155:4663/contract:" + address
      || !Number.isInteger(identity.decimals) || identity.decimals < 0 || identity.decimals > 255
      || typeof identity.name !== "string" || !identity.name.trim()
      || typeof identity.symbol !== "string" || !identity.symbol.trim()
      || market.name !== identity.name || market.symbol !== identity.symbol) {
      throw new Error(label + " contains malformed or mismatched verified identity.");
    }
    if (addresses.has(address)) throw new Error(label + " contains duplicate identity.");
    if (quarantine.map(lower).includes(address)) throw new Error(label + " publishes quarantined identity.");
    addresses.add(address);
  }
  return [...addresses];
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
    || evidence.curatedRegistryReady !== true
    || evidence.curatedMarketsVerified !== true
    || evidence.curatedMarketCount !== CURRENT_MARKET_CONTROLS.length
    || evidence.historicalMarketIndexerRequired !== false
  ) {
    throw new Error("Terminal inventory health evidence is unavailable or inconsistent.");
  }

  const directory = JSON.parse(read("directory.json"));
  validateDirectoryPage(directory, "Indexed directory");
  let continuationMarkets = null;
  if (directory.nextCursor !== null) {
    const request = JSON.parse(read("directory-next-request.json"));
    if (request.cursor !== directory.nextCursor) throw new Error("Continuation request is not bound to returned cursor.");
    const next = JSON.parse(read("directory-next.json"));
    validateDirectoryPage(next, "Indexed continuation");
    if (next.nextCursor === directory.nextCursor) throw new Error("Continuation cursor did not advance.");
    const headers = read("directory-next.headers");
    if (!/^x-rmt-directory-cache:\s*MISS\s*$/im.test(headers)
      || !/^cache-control:.*\bno-store\b/im.test(headers)) {
      throw new Error("Continuation must bypass presentation cache with no-store.");
    }
    continuationMarkets = next.markets.length;
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
  for (const [name, address] of CURRENT_MARKET_CONTROLS) {
    const textResult = JSON.parse(read(`search-${name}-text.json`));
    if (textResult.status !== "found" || textResult.queryKind !== "text" || !textResult.results.some((market) => lower(market?.address) === address)) {
      throw new Error(`Current ${name} text-search control is invalid.`);
    }
  }

  requireHtml(read, "home", "Terminal root");
  requireHtml(read, "vnext", "Terminal /vnext compatibility route");

  return {
    latestBlock: health.latestBlock,
    coverage: directory.coverage,
    firstPageMarkets: directory.markets.length,
    continuationMarkets,
    inventorySource: directory.inventorySource,
    exactSearchControls: CURRENT_MARKET_CONTROLS.length
  };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const result = verifyProductionHealthArtifacts(process.argv[2] ?? "health-artifacts");
  console.info(
    `Terminal healthy at block ${result.latestBlock}; canonical coverage ${result.coverage}; `
      + `${result.firstPageMarkets} indexed first-page markets; `
      + `${result.exactSearchControls} exact and text search controls passed.`
  );
}
