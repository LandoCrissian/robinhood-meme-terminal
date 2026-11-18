import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fullPoolIdentity, routePins, validateRound, fetchFeedCatalog, probeTreasuryRoutes, routeSourceUrls } from "./routes.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { encodeAbiParameters, parseAbiParameters, toFunctionSelector, zeroAddress } = require("viem");
const proxyAddress = "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9";
const contractAddress = "0x6091E64eb7138EEF066a80FD3A0d7427B91f2721";
const fixtureFeed = { name: "ETH / USD", proxyAddress, contractAddress, decimals: 8, heartbeat: 86400 };
const block = { number: "0x100", hash: `0x${"01".repeat(32)}`, parentHash: `0x${"02".repeat(32)}`, timestamp: "0x3e8" };
const json = (id, result) => Response.json({ jsonrpc: "2.0", id, result });
const encode = (types, values) => encodeAbiParameters(parseAbiParameters(types), values);

test("PoolId retains chain, manager and every PoolKey member; never a pair address", () => {
  const result = fullPoolIdentity("0x1111111111111111111111111111111111111111");
  assert.equal(result.chainId, 4663);
  assert.equal(result.poolManager, routePins.poolManager.address);
  assert.deepEqual(result.poolKey, { currency0: zeroAddress, currency1: "0x1111111111111111111111111111111111111111", fee: 3000, tickSpacing: 60, hooks: routePins.guard.address });
  assert.match(result.poolId, /^0x[0-9a-f]{64}$/);
  assert.notEqual(result.poolId, fullPoolIdentity("0x2222222222222222222222222222222222222222").poolId);
});

test("unassigned token or altered hook permission cannot invent a production pool", () => {
  assert.throws(() => fullPoolIdentity(zeroAddress), /nonzero/);
  assert.throws(() => fullPoolIdentity("RMT"), /nonzero/);
  assert.throws(() => fullPoolIdentity("0x1111111111111111111111111111111111111111", { ...routePins, guard: { address: "0x1111111111111111111111111111111111111111" } }), /permissions/);
});

test("a valid ETH/USD round is only base-asset evidence and cannot authorize a project purchase", () => {
  const result = validateRound([12n, 300000000000n, 900n, 950n, 12n], 1000n);
  assert.equal(result.status, "OBSERVED_BASE_ASSET_ONLY");
  assert.equal(result.ageSeconds, "50");
  assert.equal(result.pricesProjectToken, false);
  assert.equal(result.independentlyAdmittedProjectReference, false);
});

test("reference boundary rejects stale, future, invalid and incomplete round data", () => {
  assert.equal(validateRound([12n, 300n, 1n, 2n, 12n], 86403n).status, "STALE");
  assert.equal(validateRound([12n, 300n, 900n, 1001n, 12n], 1000n).status, "FUTURE_OBSERVATION");
  for (const round of [[0n, 3n, 1n, 2n, 12n], [12n, 0n, 1n, 2n, 12n], [12n, -1n, 1n, 2n, 12n],
    [12n, 3n, 0n, 2n, 12n], [12n, 3n, 5n, 2n, 12n], [12n, 3n, 1n, 2n, 11n]]) {
    assert.equal(validateRound(round, 1000n).status, "INVALID_ROUND");
  }
  assert.throws(() => validateRound([1n], 1n), /Malformed/);
  assert.throws(() => validateRound([1n, 1n, 1n, 1n, 1n], 1n, { decimals: 18 }), /Unreviewed/);
});

test("catalog identities are public, bounded, address-qualified and not oracle admission", async () => {
  const result = await fetchFeedCatalog(async (url, options) => {
    assert.equal(url, routeSourceUrls.chainlinkCatalog); assert.equal(options.redirect, "error");
    return Response.json([fixtureFeed]);
  });
  assert.equal(result.status, "OBSERVED_PUBLIC_CATALOG");
  assert.equal(result.count, 1); assert.equal(result.ethUsd.proxy, proxyAddress);
  assert.match(result.sha256, /^[0-9a-f]{64}$/); assert.equal(result.automaticAdmission, false);
});

test("catalog duplicate addresses, malformed schemas, HTTP errors and excessive bodies stay unavailable", async () => {
  const fixtures = [Response.json([fixtureFeed, fixtureFeed]), Response.json({}), Response.json([{ ...fixtureFeed, proxyAddress: "ETH" }]),
    new Response("blocked", { status: 403 }), new Response("x".repeat(524289))];
  for (const value of fixtures) assert.equal((await fetchFeedCatalog(async () => value)).status, "UNAVAILABLE");
});

test("wrong chain stops before dependency reads; no fallback trading route is admitted", async () => {
  const methods = [];
  const result = await probeTreasuryRoutes({ fetcher: async (url, options) => {
    if (url === routeSourceUrls.chainlinkCatalog) return Response.json([fixtureFeed]);
    const request = JSON.parse(options.body); methods.push(request.method); return json(request.id, "0x1");
  }, clock: () => 1000000 });
  assert.deepEqual(methods, ["eth_chainId"]);
  assert.equal(result.purchaseReadiness.executable, false);
  assert.equal(result.purchaseReadiness.poolIdentity, null);
  assert.equal(result.coordinator.status, "unavailable");
});

test("missing RPC evidence and malformed results remain unavailable without signing or resubmission", async () => {
  const methods = [];
  const result = await probeTreasuryRoutes({ fetcher: async (url, options) => {
    if (url === routeSourceUrls.chainlinkCatalog) return Response.json([fixtureFeed]);
    const request = JSON.parse(options.body); methods.push(request.method);
    return json(request.id, request.method === "eth_chainId" ? "0x1237" : null);
  }, clock: () => 1000000 });
  assert.equal(result.anchor, null);
  assert.deepEqual(methods, ["eth_chainId", "eth_getBlockByNumber"]);
  assert.equal(result.purchaseReadiness.status, "NO_GO");
});

test("complete read probe never treats two RPCs or an ETH feed as independent project pricing", async () => {
  const requests = [];
  const result = await probeTreasuryRoutes({ fetcher: async (url, options) => {
    if (url === routeSourceUrls.chainlinkCatalog) return Response.json([fixtureFeed]);
    const request = JSON.parse(options.body); requests.push(request);
    const reply = request.method === "eth_chainId" ? "0x1237" : request.method === "eth_getBlockByNumber" ? block
      : request.method === "eth_getCode" ? "0x" : request.params[0].data.startsWith(toFunctionSelector("description()")) ? encode("string", ["ETH / USD"])
      : request.params[0].data.startsWith(toFunctionSelector("decimals()")) ? encode("uint8", [8])
      : request.params[0].data.startsWith(toFunctionSelector("aggregator()")) ? encode("address", [contractAddress])
      : request.params[0].data.startsWith(toFunctionSelector("latestRoundData()")) ? encode("uint80,int256,uint256,uint256,uint80", [1n, 300n, 900n, 950n, 1n])
      : request.params[0].data.startsWith(toFunctionSelector("factories(uint32)")) ? encode("address,bytes32", [zeroAddress, `0x${"00".repeat(32)}`])
      : request.params[0].data.startsWith(toFunctionSelector("pending()")) ? encode("bytes32,uint48,uint48", [`0x${"00".repeat(32)}`, 0, 0]) : encode("uint256", [0n]);
    return json(request.id, reply);
  }, clock: () => 1000000 });
  assert.equal(result.providers.official.ethUsd.assessment.status, "OBSERVED_BASE_ASSET_ONLY");
  assert.equal(result.providers.pocket.ethUsd.assessment.pricesProjectToken, false);
  assert.equal(result.corroboration.status, "UNVERIFIED"); // Empty code cannot match any admitted pin.
  assert.equal(result.corroboration.marketIndependence, false);
  assert.equal(result.purchaseReadiness.executable, false);
  assert.ok(requests.length < 110);
  assert.ok(requests.every((item) => ["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call"].includes(item.method)));
  assert.ok(requests.filter((item) => item.method === "eth_call").every((item) => item.params[1] === "0x100"));
});

test("provider anchor disagreement prevents dependency reads and remains an explicit conflict", async () => {
  let pocketCalls = 0;
  const result = await probeTreasuryRoutes({ fetcher: async (url, options) => {
    if (url === routeSourceUrls.chainlinkCatalog) return Response.json([fixtureFeed]);
    const request = JSON.parse(options.body);
    if (url.includes("pocket")) { ++pocketCalls; return json(request.id, request.method === "eth_chainId" ? "0x1237" : { ...block, hash: `0x${"03".repeat(32)}` }); }
    if (request.method === "eth_chainId") return json(request.id, "0x1237");
    if (request.method === "eth_getBlockByNumber") return json(request.id, block);
    return json(request.id, null);
  }, clock: () => 1000000 });
  assert.equal(pocketCalls, 2);
  assert.equal(result.providers.pocket.status, "ANCHOR_UNAVAILABLE_OR_CONFLICT");
  assert.equal(result.purchaseReadiness.executable, false);
});
