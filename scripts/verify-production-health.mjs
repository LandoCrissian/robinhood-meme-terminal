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

export const MAX_DIRECTORY_MONITOR_PAGES = 8;
const FAILURE_REASONS = new Set([
  "IDENTITY_RPC_TIMEOUT", "IDENTITY_RPC_UNAVAILABLE", "IDENTITY_MULTICALL_FAILURE",
  "IDENTITY_RESPONSE_INVALID", "STOCK_CLASSIFICATION_UNAVAILABLE",
  "PROJECT_IDENTITY_AUTHORITY_UNAVAILABLE", "INDEXED_INVENTORY_UNAVAILABLE",
  "INDEXED_IDENTITY_SNAPSHOT_UNAVAILABLE", "CURATED_POOL_VERIFICATION_UNAVAILABLE",
  "OTHER_BOUNDED_REASON"
]);
const addressValid = value => typeof value === "string" && ADDRESS_PATTERN.test(value) && lower(value) !== ZERO_ADDRESS;
const bytes32 = value => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const integer = value => typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value) && value.length <= 78;
const textValid = (value, max) => typeof value === "string" && value.trim().length > 0
  && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

// Read, never synthesize/rewrite, the current unfiltered v2 cursor contract.
// Source: market-indexer server.ts decodeCursor and descending (block, log) SQL.
export function directoryCursorPosition(cursor) {
  if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(cursor)) throw new Error("Invalid directory cursor.");
  let value;
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) throw new Error();
    value = JSON.parse(bytes.toString("utf8"));
  } catch { throw new Error("Invalid directory cursor encoding."); }
  if (!value || Object.keys(value).sort().join(",") !== "blockNumber,chainId,logIndex,poolKey,source,token,v"
    || value.v !== 2 || value.chainId !== CHAIN_ID || value.source !== null || value.token !== null || value.poolKey !== null
    || !integer(value.blockNumber) || !Number.isSafeInteger(value.logIndex) || value.logIndex < 0) {
    throw new Error("Invalid directory cursor contract or query binding.");
  }
  return value;
}

export function validateDirectoryPage(page, label) {
  if (page?.canonical !== true || page.inventorySource !== "indexed") throw new Error(`${label} must be canonical indexed inventory, not curated fallback.`);
  if (!["partial", "complete"].includes(page.coverage) || typeof page.revalidationComplete !== "boolean"
    || !["live", "last-known", "mixed"].includes(page.identityEvidence)
    || (page.stale !== undefined && typeof page.stale !== "boolean")) throw new Error(`${label} has invalid coverage metadata.`);
  timestamp(page.updatedAt, `${label} updatedAt`);
  if (!Array.isArray(page.failureReasons) || page.failureReasons.some(reason => !FAILURE_REASONS.has(reason))
    || new Set(page.failureReasons).size !== page.failureReasons.length) throw new Error(`${label} has invalid failure reasons.`);
  if (page.error !== undefined || page.failureReasons.some(reason => ["INDEXED_INVENTORY_UNAVAILABLE", "STOCK_CLASSIFICATION_UNAVAILABLE", "OTHER_BOUNDED_REASON"].includes(reason))) {
    throw new Error(`${label} reports an inventory/classification failure, not healthy partial coverage.`);
  }
  if (page.nextCursor !== null) directoryCursorPosition(page.nextCursor);
  if ((page.coverage === "complete" && (!page.revalidationComplete || page.nextCursor !== null || page.failureReasons.length > 0))
    || (!page.revalidationComplete && (page.coverage !== "partial" || page.stale !== true))) throw new Error(`${label} has contradictory coverage.`);
  if (!Array.isArray(page.markets) || page.markets.length === 0 || page.markets.length > 200) throw new Error(`${label} is empty or exceeds the page bound.`);
  if (!Array.isArray(page.quarantinedAddresses) || page.quarantinedAddresses.some(value => !addressValid(value))
    || new Set(page.quarantinedAddresses.map(lower)).size !== page.quarantinedAddresses.length) throw new Error(`${label} has invalid quarantine metadata.`);
  const addresses = new Set();
  const pools = new Set();
  for (const market of page.markets) {
    const address = lower(market?.address);
    const identity = market?.verifiedIdentity;
    if (!addressValid(address) || !identity || lower(identity.address) !== address
      || lower(market.assetId) !== `eip155:${CHAIN_ID}/contract:${address}`
      || !textValid(identity.name, 80) || !textValid(identity.symbol, 16)
      || !Number.isSafeInteger(identity.decimals) || identity.decimals < 0 || identity.decimals > 255
      || market.name !== identity.name || market.symbol !== identity.symbol) throw new Error(`${label} contains malformed or mismatched verified identity.`);
    if (addresses.has(address)) throw new Error(`${label} contains duplicate identity.`);
    addresses.add(address);
    if (!Array.isArray(market.canonicalMarkets) || market.canonicalMarkets.length < 1 || market.canonicalMarkets.length > 100) throw new Error(`${label} has malformed canonical markets.`);
    const marketPools = new Set();
    for (const pool of market.canonicalMarkets) {
      if (!pool || !textValid(pool.sourceId, 64) || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(pool.sourceId)
        || !["sushiswap", "uniswap", "up"].includes(pool.protocol) || ![2, 3, 4].includes(pool.version)
        || !ADDRESS_PATTERN.test(pool.token0) || !addressValid(pool.token1) || lower(pool.token0) === lower(pool.token1)
        || ![lower(pool.token0), lower(pool.token1)].includes(address)
        || !bytes32(pool.transactionHash) || !bytes32(pool.blockHash) || !integer(pool.blockNumber)
        || (pool.version === 4 ? (!bytes32(pool.poolKey) || /^0x0+$/.test(pool.poolKey) || pool.poolAddress !== null || pool.protocol !== "uniswap")
          : (!addressValid(pool.poolKey) || lower(pool.poolAddress) !== lower(pool.poolKey)))
        || (lower(pool.token0) === ZERO_ADDRESS && !(pool.sourceId === "uniswap-v4" && pool.version === 4))) throw new Error(`${label} has malformed or unbound market evidence.`);
      const key = `${pool.sourceId}:${pool.poolKey}`.toLowerCase();
      if (marketPools.has(key)) throw new Error(`${label} contains duplicate market identity.`);
      marketPools.add(key); pools.add(key);
    }
  }
  return { addresses, pools };
}

export function createDirectoryMonitor() {
  const seenCursors = new Set();
  const addresses = new Set();
  const pools = new Set();
  const quarantines = new Set();
  const failureReasons = new Set();
  let expectedCursor = null;
  let pages = 0;
  let markets = 0;
  let partial = false;
  let firstPageMarkets = 0;
  return {
    accept({ requestCursor, status, headers, page }) {
      if (pages >= MAX_DIRECTORY_MONITOR_PAGES) throw new Error("Directory monitor page budget exceeded; pagination incomplete.");
      if (pages > 0 && expectedCursor === null) throw new Error("Unexpected page after terminal pagination.");
      if (requestCursor !== expectedCursor) throw new Error("Continuation request is not bound to returned cursor.");
      if (status !== 200 || typeof headers !== "string" || !/^content-type:\s*application\/json\b/im.test(headers)) throw new Error("Directory HTTP/JSON response is invalid.");
      if (pages > 0 && (!/^x-rmt-directory-cache:\s*MISS\s*$/im.test(headers)
        || !/^cache-control:.*\bno-store\b/im.test(headers))) throw new Error("Continuation must bypass presentation cache with no-store.");
      const identities = validateDirectoryPage(page, `Indexed page ${pages + 1}`);
      if (page.nextCursor !== null) {
        if (seenCursors.has(page.nextCursor)) throw new Error("Directory cursor loop detected.");
        const next = directoryCursorPosition(page.nextCursor);
        if (requestCursor !== null) {
          const previous = directoryCursorPosition(requestCursor);
          if (BigInt(next.blockNumber) > BigInt(previous.blockNumber)
            || (next.blockNumber === previous.blockNumber && next.logIndex >= previous.logIndex)) throw new Error("Directory cursor did not make forward progress.");
        }
        seenCursors.add(page.nextCursor);
      }
      for (const value of identities.addresses) {
        if (addresses.has(value)) throw new Error("Cross-page duplicate address/asset identity.");
        addresses.add(value);
      }
      for (const value of identities.pools) {
        if (pools.has(value)) throw new Error("Cross-page duplicate market identity.");
        pools.add(value);
      }
      for (const value of page.quarantinedAddresses) quarantines.add(lower(value));
      if ([...quarantines].some(value => addresses.has(value))) throw new Error("Directory publishes quarantined identity.");
      for (const reason of page.failureReasons) failureReasons.add(reason);
      if (pages === 0) firstPageMarkets = page.markets.length;
      pages++; markets += page.markets.length;
      partial ||= page.coverage === "partial";
      expectedCursor = page.nextCursor;
    },
    finish() {
      if (pages === 0 || expectedCursor !== null) throw new Error("Directory pagination incomplete; no terminal page observed.");
      return { coverage: partial ? "partial" : "complete", inventorySource: "indexed", pages,
        firstPageMarkets, observedMarkets: markets, failureReasons: [...failureReasons],
        paginationTerminal: true, tradingAuthorization: false };
    }
  };
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

  const observations = JSON.parse(read("directory-pages.json"));
  if (!Array.isArray(observations) || observations.length > MAX_DIRECTORY_MONITOR_PAGES) throw new Error("Invalid directory page observations.");
  const monitor = createDirectoryMonitor();
  for (const observation of observations) monitor.accept(observation);
  const directory = monitor.finish();

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
    ...directory,
    exactSearchControls: CURRENT_MARKET_CONTROLS.length
  };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const result = verifyProductionHealthArtifacts(process.argv[2] ?? "health-artifacts");
  console.info(
    `Monitor contract passed at block ${result.latestBlock}; observed coverage ${result.coverage}; `
      + `${result.firstPageMarkets} indexed first-page markets; ${result.pages} pages; `
      + `${result.exactSearchControls} exact and text search controls passed. Not trading or universal-coverage authorization.`
  );
}
