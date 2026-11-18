import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeReadOnlyRpc, ROBINHOOD_SOURCES, agreedObservation } from "../production-readiness/rpc.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { decodeFunctionResult, encodeFunctionData, parseAbi, keccak256, encodeAbiParameters, parseAbiParameters, zeroAddress } = require("viem");
const readEvidence = (path) => JSON.parse(readFileSync(new URL(`../../docs/evidence/${path}`, import.meta.url)));
const profile = readEvidence("fixed-supply-security/4663-profile.json");
const deployed = readEvidence("mobile-signing/protocol-mainnet.json");
const identified = (contract) => [...deployed.constructors, ...deployed.bootstrapChildren].find((item) => item.contract === contract);
const admitted = { ...profile.externalRuntimePins,
  directory: identified("RMTLaunchCurveDirectoryV2"), registry: identified("RMTLaunchProjectRegistryV3"),
  factory: identified("RMTLaunchCurveFactoryV2"), graduation: identified("RMTV4CurveGraduationV1"), guard: identified("RMTV4CurveInitializationGuardV1"),
};
export const routePins = Object.freeze(Object.fromEntries(Object.entries(admitted).map(([name, pin]) =>
  [name, Object.freeze({ address: pin.address, runtimeHash: pin.runtimeHash })])));
export const routeSourceUrls = Object.freeze({
  network: "https://docs.robinhood.com/chain/connecting/",
  robinhoodOracles: "https://docs.robinhood.com/chain/oracles-and-price-feeds/",
  uniswap: "https://developers.uniswap.org/docs/protocols/v4/deployments",
  router212: "https://developers.uniswap.org/docs/trading/swapping-api/supported-chains",
  deploymentRecord: "https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/4663.md",
  oracleSemantics: "https://developers.uniswap.org/docs/protocols/v3/concepts/price-oracles",
  chainlinkCatalog: "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json",
  chainlinkFeeds: "https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood&page=1",
  chainlinkCatalogProvenance: "https://github.com/smartcontractkit/documentation/blob/805757ca9294eb1fa14bf9e4b6b3ae66bd03b5f9/src/features/data/chains.ts",
  sequencerFeeds: "https://docs.chain.link/data-feeds/l2-sequencer-feeds",
  pythContracts: "https://docs.pyth.network/pro/contract-addresses",
  pythFeedIdentities: "https://docs.pyth.network/pro/price-feed-ids",
});
const unadmittedReferenceCandidates = Object.freeze({
  pythPro: "0xACeA761c27A909d4D3895128EBe6370FDE2dF481", pythCore: "0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a",
});
const feedProxy = "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9";
const hash = /^0x[0-9a-f]{64}$/i, address = /^0x[0-9a-f]{40}$/i, quantity = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalize = (value) => Array.isArray(value) ? value.map(normalize) : typeof value === "bigint" ? value.toString() : value;
const abi = parseAbi([
  "function poolManager() view returns(address)", "function positionManager() view returns(address)", "function permit2() view returns(address)",
  "function factory() view returns(address)", "function graduationEngine() view returns(address)", "function initializationGuard() view returns(address)",
  "function projectRegistry() view returns(address)", "function directory() view returns(address)", "function tokenSupply() view returns(uint256)",
  "function creationFeeWei() view returns(uint256)", "function CHAIN_ID() view returns(uint256)", "function POOL_FEE() view returns(uint24)",
  "function TICK_SPACING() view returns(int24)", "function factories(uint32) view returns(address,bytes32)",
  "function suspended() view returns(bool)", "function latestVersion() view returns(uint32)", "function pending() view returns(bytes32,uint48,uint48)",
  "function description() view returns(string)", "function decimals() view returns(uint8)", "function aggregator() view returns(address)",
  "function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)",
]);
const views = [
  ["positionManager", "poolManager", "poolManager"], ["positionManager", "permit2", "permit2"],
  ["quoter", "poolManager", "poolManager"], ["stateView", "poolManager", "poolManager"],
  ["universalRouter", "poolManager", "poolManager"], ["factory", "graduationEngine", "graduation"],
  ["factory", "projectRegistry", "registry"], ["registry", "directory", "directory"],
  ["graduation", "factory", "factory"], ["graduation", "poolManager", "poolManager"],
  ["graduation", "positionManager", "positionManager"], ["graduation", "permit2", "permit2"],
  ["graduation", "initializationGuard", "guard"], ["guard", "poolManager", "poolManager"], ["guard", "graduationEngine", "graduation"],
];
const terms = [["factory", "tokenSupply", "1000000000000000000000000000"], ["factory", "creationFeeWei", "400000000000000"],
  ["graduation", "CHAIN_ID", "4663"], ["graduation", "POOL_FEE", "3000"], ["graduation", "TICK_SPACING", "60"]];
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const sourceFiles = ["RMTLaunchCurveFactoryV2.sol", "RMTLaunchCurveTokenV2.sol", "RMTLaunchCurveMathV1.sol",
  "RMTV4CurveGraduationV1.sol", "RMTV4CurveInitializationGuardV1.sol"];

export function fullPoolIdentity(token, pins = routePins) {
  assert.ok(address.test(token) && !same(token, zeroAddress), "A real nonzero token address is required");
  assert.equal(BigInt(pins.guard.address) & 0x3fffn, 0x2000n, "Wrong hook permissions");
  const poolKey = { currency0: zeroAddress, currency1: token, fee: 3000, tickSpacing: 60, hooks: pins.guard.address };
  return { chainId: 4663, poolManager: pins.poolManager.address, poolKey,
    poolId: keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"), Object.values(poolKey))) };
}

export function validateRound(round, blockTimestamp, { maximumAge = 86400, decimals = 8 } = {}) {
  assert.ok(Array.isArray(round) && round.length === 5, "Malformed round");
  const [roundId, answer, startedAt, updatedAt, answeredInRound] = round.map(BigInt);
  assert.ok(Number.isSafeInteger(maximumAge) && maximumAge > 0 && maximumAge <= 86400 && decimals === 8, "Unreviewed feed policy");
  const now = BigInt(blockTimestamp);
  const reason = roundId <= 0n || answer <= 0n || startedAt <= 0n || updatedAt < startedAt || answeredInRound < roundId ? "INVALID_ROUND"
    : updatedAt > now ? "FUTURE_OBSERVATION" : now - updatedAt > BigInt(maximumAge) ? "STALE" : "OBSERVED_BASE_ASSET_ONLY";
  return { status: reason, roundId: roundId.toString(), answer: answer.toString(), decimals, startedAt: startedAt.toString(),
    updatedAt: updatedAt.toString(), answeredInRound: answeredInRound.toString(), ageSeconds: (now - updatedAt).toString(),
    pricesProjectToken: false, independentlyAdmittedProjectReference: false };
}

export async function fetchFeedCatalog(fetcher = fetch) {
  try {
    const response = await fetcher(routeSourceUrls.chainlinkCatalog, { redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.body) return { status: "UNAVAILABLE", reason: "HTTP_OR_BODY" };
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length;
      if (bytes > 524288) { await reader.cancel(); return { status: "UNAVAILABLE", reason: "BODY_LIMIT" }; } chunks.push(part.value); }
    const raw = Buffer.concat(chunks), rows = JSON.parse(raw.toString("utf8"));
    assert.ok(Array.isArray(rows) && rows.length > 0 && rows.length <= 256);
    const feeds = rows.map((item) => { assert.ok(typeof item.name === "string" && item.name.length <= 96 && address.test(item.proxyAddress) && address.test(item.contractAddress));
      return { name: item.name, proxy: item.proxyAddress, aggregator: item.contractAddress, decimals: item.decimals ?? item.decimalPlaces, heartbeat: item.heartbeat }; });
    assert.equal(new Set(feeds.map((item) => item.proxy.toLowerCase())).size, feeds.length);
    const ethUsd = feeds.find((item) => same(item.proxy, feedProxy));
    assert.ok(ethUsd && ethUsd.name === "ETH / USD" && ethUsd.decimals === 8 && ethUsd.heartbeat === 86400);
    return { status: "OBSERVED_PUBLIC_CATALOG", url: routeSourceUrls.chainlinkCatalog, bytes, sha256: sha256(raw), count: feeds.length, feeds,
      ethUsd, automaticAdmission: false, pricesUncreatedProjectToken: false };
  } catch { return { status: "UNAVAILABLE", reason: "FETCH_OR_SCHEMA" }; }
}

function header(block) {
  assert.ok(quantity.test(block.number) && hash.test(block.hash) && hash.test(block.parentHash) && quantity.test(block.timestamp));
  return { number: BigInt(block.number).toString(), hash: block.hash, parentHash: block.parentHash, timestamp: BigInt(block.timestamp).toString() };
}
function codeIdentity(code, pin) {
  assert.ok(/^0x(?:[0-9a-f]{2})*$/i.test(code));
  const runtimeHash = keccak256(code);
  return { address: pin.address, bytes: (code.length - 2) / 2, runtimeHash, matches: runtimeHash === pin.runtimeHash };
}

export async function probeTreasuryRoutes({ fetcher = fetch, clock = Date.now } = {}) {
  const observedAt = new Date(clock()).toISOString(), catalog = await fetchFeedCatalog(fetcher);
  const readers = Object.fromEntries(["official", "pocket"].map((name) => [name, makeReadOnlyRpc({ name, url: ROBINHOOD_SOURCES[name] }, { fetcher })]));
  const report = { schemaVersion: 1, scope: "READ_ONLY_4663_TREASURY_ROUTE_REFERENCE_OBSERVATION", observedAt,
    productionChanges: false, signingOrBroadcast: false, sourceUrls: routeSourceUrls, productionCompilerInputSha256: deployed.compiler.inputSha256,
    sourceBindings: sourceFiles.map((file) => ({ path: `packages/contracts/src/${file}`,
      sha256: sha256(readFileSync(new URL(`../../packages/contracts/src/${file}`, import.meta.url))) })),
    catalog, anchor: null, providers: {}, corroboration: null, directoryCorroboration: null, baseAssetCorroboration: null,
    purchaseReadiness: { status: "NO_GO", executable: false, token: null, poolIdentity: null, liquidity: "UNAVAILABLE_NO_ASSIGNED_PROJECT_TOKEN",
      projectReference: "UNAVAILABLE_NO_INDEPENDENT_PROJECT_MARKET_REFERENCE", hostedQuote: "UNOBSERVED", finality: "L1_UNVERIFIED",
      reasons: ["No real new-engine project token is assigned; do not query an invented PoolKey or substitute a historical token.",
        "ETH/USD prices ETH only, not the new project token; catalog presence does not admit an oracle.",
        "The approved initialization-only v4 hook has no oracle callbacks; v4 core has no built-in observation oracle.",
        "Same-pool spot/TWAP and multiple RPC copies are not independent project price evidence."] } };
  const firstChain = await readers.official("eth_chainId", [], (value) => { assert.equal(value, "0x1237"); return 4663; });
  if (firstChain.status !== "observed") { report.coordinator = firstChain; return report; }
  const anchor = await readers.official("eth_getBlockByNumber", ["latest", false], header);
  if (anchor.status !== "observed") { report.coordinator = anchor; return report; }
  report.anchor = { ...anchor.value, observedAgeSeconds: Math.floor(clock() / 1000) - Number(anchor.value.timestamp) };
  const tag = `0x${BigInt(anchor.value.number).toString(16)}`;
  for (const [name, read] of Object.entries(readers)) {
    const out = report.providers[name] = { chain: await read("eth_chainId", [], (value) => { assert.equal(value, "0x1237"); return 4663; }) };
    if (out.chain.status !== "observed") continue;
    out.anchor = await read("eth_getBlockByNumber", [tag, false], header);
    if (out.anchor.status !== "observed" || out.anchor.value.hash !== anchor.value.hash) { out.status = "ANCHOR_UNAVAILABLE_OR_CONFLICT"; continue; }
    out.runtimes = {};
    for (const [role, pin] of Object.entries(routePins)) out.runtimes[role] = await read("eth_getCode", [pin.address, tag], (code) => codeIdentity(code, pin));
    const call = (target, functionName, args = []) => read("eth_call", [{ to: target, data: encodeFunctionData({ abi, functionName, args }) }, tag],
      (data) => normalize(decodeFunctionResult({ abi, functionName, data })));
    out.bindings = {};
    for (const [role, functionName, expectedRole] of views) {
      const result = await call(routePins[role].address, functionName);
      out.bindings[`${role}.${functionName}`] = { ...result, ...(result.status === "observed" ? { matches: same(result.value, routePins[expectedRole].address) } : {}) };
    }
    for (const [role, functionName, expected] of terms) {
      const result = await call(routePins[role].address, functionName);
      out.bindings[`${role}.${functionName}`] = { ...result, ...(result.status === "observed" ? { matches: String(result.value) === expected } : {}) };
    }
    out.directory = {};
    for (const functionName of ["suspended", "latestVersion", "pending", "factories"]) out.directory[functionName] = await call(routePins.directory.address, functionName, functionName === "factories" ? [1] : []);
    out.ethUsd = { proxy: feedProxy, usage: "BASE_ASSET_OBSERVATION_ONLY_NOT_PROJECT_REFERENCE" };
    for (const functionName of ["description", "decimals", "aggregator", "latestRoundData"]) out.ethUsd[functionName] = await call(feedProxy, functionName);
    out.ethUsd.runtime = await read("eth_getCode", [feedProxy, tag], (code) => ({ bytes: (code.length - 2) / 2, runtimeHash: keccak256(code) }));
    const agg = out.ethUsd.aggregator;
    if (agg.status === "observed" && address.test(agg.value)) out.ethUsd.aggregatorRuntime = await read("eth_getCode", [agg.value, tag], (code) => ({ address: agg.value,
      bytes: (code.length - 2) / 2, runtimeHash: keccak256(code), catalogMatches: catalog.ethUsd ? same(agg.value, catalog.ethUsd.aggregator) : null }));
    if (out.ethUsd.latestRoundData.status === "observed" && out.ethUsd.decimals.value === 8) out.ethUsd.assessment = validateRound(out.ethUsd.latestRoundData.value, anchor.value.timestamp);
    out.unadmittedReferenceCandidates = {};
    for (const [candidate, target] of Object.entries(unadmittedReferenceCandidates)) out.unadmittedReferenceCandidates[candidate] =
      await read("eth_getCode", [target, tag], (code) => ({ address: target, bytes: (code.length - 2) / 2, runtimeHash: keccak256(code),
        source: routeSourceUrls.pythContracts, acceptedProjectFeedId: null, independentlyReviewed: false, authorizesPurchases: false }));
    out.recheckedAnchor = await read("eth_getBlockByNumber", [tag, false], header);
    out.status = out.recheckedAnchor.value?.hash === anchor.value.hash ? "ANCHORED_L2_OBSERVATION" : "REORG_OR_PROVIDER_FAILURE";
  }
  const records = Object.entries(report.providers).map(([name, item]) => ({ name, observation: item.status === "ANCHORED_L2_OBSERVATION"
    && Object.values(item.runtimes).every((entry) => entry.value?.matches === true) && Object.values(item.bindings).every((entry) => entry.matches === true)
    ? { status: "observed", value: { anchorHash: item.anchor.value.hash, runtimePins: Object.keys(item.runtimes).length, bindings: Object.keys(item.bindings).length } }
    : { status: "unavailable" } }));
  report.corroboration = agreedObservation(records, (value) => JSON.stringify(value));
  report.corroboration.marketIndependence = false;
  for (const [target, select] of [["directoryCorroboration", (item) => {
    assert.ok(Object.values(item.directory).every((entry) => entry.status === "observed"));
    return Object.fromEntries(Object.entries(item.directory).map(([key, entry]) => [key, entry.value]));
  }], ["baseAssetCorroboration", (item) => {
    assert.ok(item.ethUsd.description.status === "observed" && item.ethUsd.description.value === "ETH / USD"
      && item.ethUsd.runtime.status === "observed" && item.ethUsd.runtime.value.bytes > 0
      && item.ethUsd.aggregatorRuntime.status === "observed" && item.ethUsd.aggregatorRuntime.value.bytes > 0
      && item.ethUsd.assessment && item.ethUsd.decimals.value === 8);
    return { proxy: item.ethUsd.proxy, runtime: item.ethUsd.runtime.value, aggregatorRuntime: item.ethUsd.aggregatorRuntime.value,
      assessment: item.ethUsd.assessment };
  }]]) {
    report[target] = agreedObservation(Object.entries(report.providers).map(([name, item]) => {
      try { assert.equal(item.status, "ANCHORED_L2_OBSERVATION"); return { name, observation: { status: "observed", value: select(item) } }; }
      catch { return { name, observation: { status: "unavailable" } }; }
    }), (value) => JSON.stringify(value));
    report[target].marketIndependence = false;
  }
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert.equal(process.argv.length, 3, "Usage: node scripts/treasury-v2/routes.mjs /absolute/unused-report.json");
  assert.ok(isAbsolute(process.argv[2]), "Output must be an absolute fresh path");
  const report = await probeTreasuryRoutes();
  writeFileSync(process.argv[2], `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ output: process.argv[2], anchor: report.anchor, corroboration: report.corroboration, purchaseReadiness: report.purchaseReadiness }));
  if (report.corroboration?.status !== "CORROBORATED") process.exitCode = 1;
}
