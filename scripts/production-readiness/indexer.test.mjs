import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { netlifyOrigin, railwayOrigin, runIndexerProbe } from "./indexer.mjs";
import { ROBINHOOD_SOURCES } from "./rpc.mjs";

const site = new URL("../../apps/launch-website/", import.meta.url);
const { encodeAbiParameters, toEventSelector } = createRequire(new URL("package.json", site))("viem");
const snapshot = JSON.parse(readFileSync(new URL("data/historical-launches-4663.json", site)));
const previous = JSON.parse(readFileSync(new URL("../../docs/evidence/fixed-supply-release/l1-batches.json", import.meta.url))).l2.initialHostedCheckpoint;
const checkout = snapshot.launches.find(({ version, launchId }) => version === 6 && launchId === "0");
const v6Factory = checkout.factory;
const get = "/api/launchpad/launches";
const clock = Date.parse("2026-11-16T15:00:00.000Z");
const anchor = { blockNumber: "115840000", blockHash: "0x" + "11".repeat(32), timestamp: "2026-11-16T14:59:50.000Z" };
const observedAt = new Date(clock).toISOString();
const overriddenHash = "0x" + "22".repeat(32);
const quantity = (value) => "0x" + BigInt(value).toString(16);
const block = ({ blockNumber, blockHash: hash, timestamp }, transactions = []) => ({
  number: quantity(blockNumber), hash, timestamp: quantity(Math.floor(Date.parse(timestamp) / 1000)), transactions,
});
const topic = {
  4: toEventSelector("TokenLaunched(uint256,address,address,address,address,bytes32,string,string,string,uint16[5])"),
  6: toEventSelector("TokenLaunchedV6(uint256,address,address,address,address,bytes32,bytes32,uint32,uint16,uint16,uint16,uint16,bool,uint64,uint64,uint16,uint16,uint256,bool,string,string,string)"),
};
const word = (value) => "0x" + value.slice(2).padStart(64, "0");
const zeroWord = word("0x0");
const abiTypes = (...types) => types.map((type) => ({ type }));
function registrationData(row) {
  return row.version === 4 ? encodeAbiParameters(abiTypes("address", "address", "bytes32", "string", "string", "string", "uint16[5]"),
    [row.market, row.market, zeroWord, row.name, row.symbol, "", [1, 2, 3, 4, 5]])
    : encodeAbiParameters(abiTypes("address", "address", "bytes32", "bytes32", "uint32", "uint16", "uint16", "uint16", "uint16",
      "bool", "uint64", "uint64", "uint16", "uint16", "uint256", "bool", "string", "string", "string"),
    [row.market, row.market, zeroWord, zeroWord, 1, 0, 0, 0, 0, false, 0n, 0n, 0, 0, 0n, false, row.name, row.symbol, ""]);
}

function receipt(row) {
  const { transactionHash, blockHash, blockNumber, logIndex } = row.receipt;
  const identity = { blockHash, transactionHash, blockNumber: quantity(blockNumber), transactionIndex: "0x0" };
  return { ...identity, status: "0x1", to: row.factory,
    logs: [{ ...identity, address: row.factory, removed: false, logIndex: quantity(logIndex),
      topics: [topic[row.version], word(quantity(row.launchId)), word(row.token), word(row.creator)], data: registrationData(row) }] };
}

const json = (payload, status = 200, headers) => Response.json(payload, { status, headers });
function fixture(options = {}) {
  const auth = [];
  let rpcReads = 0;
  const witnesses = new Map(Object.entries(ROBINHOOD_SOURCES).map(([name, url]) => [new URL(url).origin, name]));
  const checkpoint = options.stale ? snapshot.verificationBlock : anchor;
  const directory = { coverage: options.stale ? "verified-snapshot" : "v6-indexed",
    status: options.stale && !options.mislabel ? "stale" : "ready",
    chainId: 4663, future: "prelaunch", finality: "l1-unverified", checkpoint, observedAt };
  function fetchImpl(endpoint, optionsForRequest) {
    const url = new URL(endpoint);
    if (url.origin === netlifyOrigin) {
      assert.equal(optionsForRequest.method, "GET");
      assert.equal(optionsForRequest.redirect, "error");
      assert.ok(optionsForRequest.signal instanceof AbortSignal);
      if (url.pathname === get) {
        const launches = options.unexpectedRegistration
          ? [...snapshot.launches, { ...checkout, token: "0x" + "81".repeat(20) }]
          : snapshot.launches;
        return options.directoryResponse?.() ?? json({ ...directory, launches });
      }
      if (url.pathname === get + "/" + checkout.token) {
        const valid = { ...checkout, receipt: { ...checkout.receipt } };
        if (options.wrongExactLog) valid.receipt.logIndex++;
        return json({ ...directory, launches: [valid] });
      }
      if (url.pathname === "/api/launchpad/config") return json({ status: options.executionEnabled ? "enabled" : "disabled" });
      if (url.pathname === "/api/launchpad/new-engine" && options.unexpectedRoute) return json({ records: [] });
      return json({}, 404);
    }
    if (url.origin === railwayOrigin) {
      assert.equal(optionsForRequest.method, "GET");
      if (url.pathname === "/historical-launches") {
        auth.push(optionsForRequest.headers.authorization ?? null);
        return json({ error: "denied extra detail stays private" }, options.brokenAuth ? 200 : 401, { "www-authenticate": "Bearer" });
      }
      if (options.malformedWorker) return json(null);
      return json({
        ok: true, chainId: 4663, protocolVersion: 6, factory: v6Factory, indexedThrough: anchor.blockNumber,
        latestBlock: (BigInt(anchor.blockNumber) + 20n).toString(),
        confirmationDepth: 20, initialSyncComplete: true, lastSyncAt: observedAt,
      });
    }
    const name = witnesses.get(url.origin);
    assert.ok(name, "Unexpected endpoint");
    const { id, method, params } = JSON.parse(optionsForRequest.body);
    assert.equal(optionsForRequest.method, "POST");
    const available = options.onlyOne ? name === "official" : true;
    rpcReads++;
    if (!available) return json({}, 503);
    if (method === "eth_chainId") return json({ id, jsonrpc: "2.0", result: "0x1237" });
    if (method === "eth_getBlockByNumber") {
      const [height] = params;
      let result;
      if (height === quantity(checkpoint.blockNumber)) {
        result = block(checkpoint);
        if (options.conflict && name === "pocket") result.hash = overriddenHash;
      } else if (height === quantity(previous.block)) {
        result = block({ blockNumber: previous.block, blockHash: previous.blockHash, timestamp: previous.observedAt });
      } else {
        const row = snapshot.launches.find(({ receipt }) => height === quantity(receipt.blockNumber));
        assert.ok(row);
        result = block(row.receipt, [row.receipt.transactionHash]);
      }
      return json({ id, jsonrpc: "2.0", result });
    }
    assert.equal(method, "eth_getTransactionReceipt");
    const row = snapshot.launches.find(({ receipt }) => receipt.transactionHash === params[0]);
    assert.ok(row);
    const result = receipt(row);
    if (options.corruptReceipt && name === "official" && row.token === checkout.token) result.logs[0].removed = true;
    if (options.corruptData && name === "official" && row.token === checkout.token) result.logs[0].data = word(row.market);
    return json({ id, jsonrpc: "2.0", result });
  }
  return { fetchImpl, auth, reads: () => rpcReads };
}

const run = (state) => runIndexerProbe({ fetchImpl: state.fetchImpl, now: () => clock });

test("corroborates the hosted checkpoint and exact historical registrations while protecting future routes", async () => {
  const state = fixture();
  const report = await run(state);
  assert.deepEqual(report.directory.counts, { total: 4, v4: 2, v6: 2, exactPinnedRegistrations: 4 });
  assert.equal(report.releases.v6ThroughNetlify, "FRESH_VERIFIED");
  assert.equal(report.releases.authorizedBackendRead, "OBSERVED_VIA_NETLIFY_PROXY");
  assert.equal(report.releases.directAuthorizedBackendRead, "UNVERIFIED_NO_PROBE_CREDENTIAL");
  assert.equal(report.releases.historicalCheckpointReplay, "PREVIOUS_AND_CURRENT_L2_HEADERS_MATCHED");
  assert.equal(report.releases.newEngineHostedIngestion, "DEPLOYMENT_DEPENDENT");
  assert.equal(report.releases.productionReorgRecovery, "UNVERIFIED_NO_MUTATION");
  assert.ok(Object.values(report.chainChecks).every(({ status, registrations }) => status === "matched" && registrations.length === 4));
  assert.deepEqual(state.auth, [null, "Bearer rmt-readiness-invalid-probe"]);
  assert.doesNotMatch(JSON.stringify(report), /rmt-readiness-invalid-probe|denied extra detail/);
});

test("requires two witnesses and quarantines any conflicting canonical header or receipt", async () => {
  for (const [options, expected] of [[{ onlyOne: true }, "UNVERIFIED"], [{ conflict: true }, "CONFLICT"],
    [{ corruptReceipt: true }, "CONFLICT"], [{ corruptData: true }, "CONFLICT"]]) {
    const report = await run(fixture(options));
    assert.equal(report.releases.historicalRegistrationWitnesses, expected);
    assert.equal(report.releases.v6ThroughNetlify, "UNVERIFIED");
  }
});

test("keeps stale snapshot evidence and deployment-dependent routes from claiming active ingestion", async () => {
  const good = await run(fixture({ stale: true }));
  assert.equal(good.directory.staleLabelConsistent, true);
  assert.equal(good.directory.independentlyFresh, false);
  assert.equal(good.releases.historicalRegistrationWitnesses, "VERIFIED_L2");
  assert.equal(good.releases.v6ThroughNetlify, "UNVERIFIED");
  const mislabeled = await run(fixture({ stale: true, mislabel: true, unexpectedRoute: true }));
  assert.equal(mislabeled.directory.staleLabelConsistent, false);
  assert.equal(mislabeled.releases.v6ThroughNetlify, "UNVERIFIED");
  assert.equal(mislabeled.releases.newEngineHostedIngestion, "UNEXPECTED_ROUTE_STATUS");
});

test("rejects wrong paths, unexpected execution, wrong registration log, and absent backend authorization", async () => {
  const report = await run(fixture({ wrongExactLog: true, brokenAuth: true, executionEnabled: true }));
  assert.equal(report.checks.exactLookup, false);
  assert.equal(report.checks.executionDisabled, false);
  assert.equal(report.checks.historyAuth, false);
  assert.equal(report.releases.v6ThroughNetlify, "UNVERIFIED");
});

test("limits hosted payloads before touching RPC and omits private bodies", async () => {
  const large = "x".repeat(64 * 1024 + 1);
  for (const directoryResponse of [
    () => new Response("too large", { headers: { "content-type": "application/json", "content-length": String(large.length) } }),
    () => new Response(large, { headers: { "content-type": "application/json" } }),
  ]) {
    const state = fixture({ directoryResponse });
    const report = await run(state);
    assert.equal(report.requests.directory.unavailable, "response-size");
    assert.equal(report.directory, null);
    assert.equal(state.reads(), 0);
    assert.doesNotMatch(JSON.stringify(report), /too large|xxxxxxxxxxxx/);
  }
});

test("unusable HTTP-200 worker payload stays unverified even with canonical history", async () => {
  const report = await run(fixture({ malformedWorker: true }));
  assert.equal(report.requests.health.httpStatus, 200);
  assert.equal(report.checks.workerHealthy, false);
  assert.equal(report.releases.v6ThroughNetlify, "UNVERIFIED");
  assert.equal(report.releases.historicalRegistrationWitnesses, "VERIFIED_L2");
});

test("an unexpected extra registration cannot inherit the pinned historical dataset's verification", async () => {
  const state = fixture({ unexpectedRegistration: true });
  const report = await run(state);
  assert.equal(report.directory.counts.exactPinnedRegistrations, 4);
  assert.equal(report.directory.counts.total, 5);
  assert.equal(report.releases.historicalRegistrationWitnesses, "UNVERIFIED");
  assert.equal(report.releases.v6ThroughNetlify, "UNVERIFIED");
  assert.equal(state.reads(), 0);
});
