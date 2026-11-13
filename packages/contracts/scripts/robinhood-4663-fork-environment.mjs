import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildLaunch4663Review } from "./build-launch-4663-review.mjs";

const requireWeb = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const { keccak256, toFunctionSelector } = requireWeb("viem");
const { robinhoodMainnet: published } = JSON.parse(readFileSync(
  new URL("../test/fixtures/rmt-v4-deployment-identities.json", import.meta.url), "utf8",
));

const network = {
  chainId: 4663,
  blockNumber: 113412054,
  blockHash: "0x17252a232b68a4e9fc494caf0660cff722ac2da966ee5c62b40e20dbcfd32ea2",
  provider: "https://robinhood.drpc.org",
  corroboratingProvider: published.rpcUrl,
  contracts: {
    poolManager: published.poolManager,
    positionManager: published.positionManager,
    permit2: published.permit2,
    quoter: published.quoter,
    stateView: published.stateView,
    universalRouter: {
      address: "0x204FAca1764B154221e35c0d20aBb3c525710498",
      runtimeHash: "0x76b92a5bba2dd32019a64eb421f1750e78c6ba044dbfa6840b722eb5ac63d296",
    },
  },
};
const anchor = "0x" + network.blockNumber.toString(16);
// Verified against both #583 compiler runs. The only omitted fields identify the platform binary.
const reviewDigest = "97cf74656e86ca3fce2ecc020478d4589394f08d03301667322ccdeaa7872793";
const routerDeployment = {
  transactionHash: "0xf669b9a4b8c322f5992788f737ee5fd2a1a73fd44f17546c5ac8b2211b6da339",
  blockHash: "0x34b52ae62932a3b93c9a1a053d30409909c805c98b730dae59279b39fd414001",
};
// Router 2.1.2 verified source immutable offsets from the provenance checklist.
const routerOffsets = {
  permit2: [3930, 11898, 14413],
  poolManager: [1654, 2189, 5163, 6847, 11440, 20357, 20476, 20726, 21062, 23462, 23823],
  positionManager: [2053, 5258],
};

const remoteMethods = new Set([
  "eth_blockNumber", "eth_chainId", "eth_gasPrice", "eth_getAccountInfo", "eth_getBalance",
  "eth_getBlockByHash", "eth_getBlockByNumber",
  "eth_getBlockReceipts", "eth_getCode", "eth_getLogs", "eth_getProof", "eth_getStorageAt",
  "eth_getTransactionByHash", "eth_getTransactionCount", "eth_getTransactionReceipt",
  "eth_getUncleByBlockHashAndIndex", "eth_getUncleByBlockNumberAndIndex", "net_version",
]);

const fixtures = Array.from({ length: 6 }, (_, index) =>
  "0x" + (0x46630000n + BigInt(index)).toString(16).padStart(40, "0"));
let requestId = 0;
let nextArchiveRead = 0;

async function readArchive(payload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = Date.now();
    const slot = Math.max(now, nextArchiveRead);
    nextArchiveRead = slot + 500;
    await delay(slot - now);
    const response = await fetch(network.provider, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 429 || attempt === 2) return response;
    await response.text();
    nextArchiveRead = Math.max(nextArchiveRead, Date.now() + 3_000);
  }
}

async function rpc(url, method, params = []) {
  const body = { jsonrpc: "2.0", id: ++requestId, method, params };
  const response = url === network.provider ? await readArchive(body) : await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(45_000),
  });
  assert.ok(response.ok, method + " returned HTTP " + response.status);
  const payload = await response.json();
  if (payload.error) throw new Error(method + ": " + JSON.stringify(payload.error));
  assert.ok("result" in payload, method + " response omitted result");
  return payload.result;
}

async function assertAnchor(url, chainId) {
  const actual = await rpc(url, "eth_chainId");
  assert.equal(BigInt(actual), BigInt(chainId), "unexpected chain ID");
  const block = await rpc(url, "eth_getBlockByNumber", [anchor, false]);
  assert.equal(block?.number, anchor, "fork anchor number");
  assert.equal(block?.hash, network.blockHash, "fork anchor hash");
  return block;
}

function addressWord(address) {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

async function verifyOfficialBindings(url) {
  const { contracts } = network;
  const block = await assertAnchor(url, network.chainId);
  const runtimes = new Map();
  await Promise.all(Object.entries(contracts).map(async ([name, pin]) => {
    const code = await rpc(url, "eth_getCode", [pin.address, anchor]);
    assert.notEqual(code, "0x", name + " runtime missing");
    assert.equal(keccak256(code), pin.runtimeHash, name + " runtime pin");
    runtimes.set(name, code);
  }));
  const bindings = Object.fromEntries(await Promise.all(
    ["positionManager", "quoter", "stateView", "universalRouter"].map(async (name) => {
      const result = await rpc(url, "eth_call", [
        { to: contracts[name].address, data: toFunctionSelector("poolManager()") }, anchor,
      ]);
      assert.equal(result, "0x" + addressWord(contracts.poolManager.address), name + " manager binding");
      return [name, contracts.poolManager.address];
    }),
  ));
  const permit2 = await rpc(url, "eth_call", [
    { to: contracts.positionManager.address, data: toFunctionSelector("permit2()") }, anchor,
  ]);
  assert.equal(permit2, "0x" + addressWord(contracts.permit2.address), "PositionManager Permit2 binding");

  const router = runtimes.get("universalRouter").slice(2);
  for (const [name, offsets] of Object.entries(routerOffsets)) {
    const expected = addressWord(contracts[name].address);
    for (const offset of offsets) {
      assert.equal(router.slice(offset * 2, offset * 2 + 64), expected, "Router immutable " + name);
    }
  }
  return { block, bindings, permit2: contracts.permit2.address };
}

async function verifyUpstream() {
  const [verified, corroborated, primaryFinalized, corroboratingFinalized, tx, receipt] = await Promise.all([
    verifyOfficialBindings(network.provider),
    assertAnchor(network.corroboratingProvider, network.chainId),
    rpc(network.provider, "eth_getBlockByNumber", ["finalized", false]),
    rpc(network.corroboratingProvider, "eth_getBlockByNumber", ["finalized", false]),
    rpc(network.provider, "eth_getTransactionByHash", [routerDeployment.transactionHash]),
    rpc(network.provider, "eth_getTransactionReceipt", [routerDeployment.transactionHash]),
  ]);
  for (const finalized of [primaryFinalized, corroboratingFinalized]) {
    assert.ok(BigInt(finalized?.number) >= BigInt(anchor), "upstream has not finalized the pinned block");
  }
  assert.equal(verified.block.timestamp, corroborated.timestamp, "provider timestamp agreement");
  assert.equal(tx?.blockHash, routerDeployment.blockHash, "Router deployment transaction block");
  assert.equal(receipt?.blockHash, routerDeployment.blockHash, "Router deployment receipt block");
  assert.equal(receipt?.status, "0x1", "Router deployment status");
  assert.equal(receipt?.contractAddress?.toLowerCase(), network.contracts.universalRouter.address.toLowerCase());
  const constructorWords = tx.input.slice(-640).match(/.{64}/g);
  assert.equal(constructorWords[0], addressWord(network.contracts.permit2.address));
  assert.equal(constructorWords[6], addressWord(network.contracts.poolManager.address));
  assert.equal(constructorWords[8], addressWord(network.contracts.positionManager.address));
  return {
    timestamp: new Date(Number(BigInt(verified.block.timestamp)) * 1000).toISOString(),
    finalized: {
      archive: { number: Number(primaryFinalized.number), hash: primaryFinalized.hash },
      corroborating: { number: Number(corroboratingFinalized.number), hash: corroboratingFinalized.hash },
    },
    bindings: {
      poolManagerGetters: verified.bindings,
      positionManagerPermit2: verified.permit2,
      routerImmutableOffsets: routerOffsets,
      routerDeployment,
    },
  };
}

async function readRequest(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    assert.ok(size <= 131_072, "oversized fork RPC request");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function openReadOnlyUpstream() {
  const methods = new Set();
  const blockedMethods = new Set();
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST", "fork transport only accepts POST");
      const payload = await readRequest(request);
      const requests = Array.isArray(payload) ? payload : [payload];
      assert.ok(requests.length > 0 && requests.length <= 50, "invalid fork RPC batch size");
      const blocked = requests.filter((call) => !remoteMethods.has(call?.method));
      if (blocked.length > 0) {
        for (const call of blocked) blockedMethods.add(call?.method);
        sendJson(response, 403, { error: "upstream method denied" });
        return;
      }
      for (const call of requests) methods.add(call.method);
      const upstream = await readArchive(payload);
      response.writeHead(upstream.status, { "content-type": "application/json" });
      response.end(await upstream.text());
    } catch {
      if (!response.headersSent) sendJson(response, 502, { error: "fork read transport failed" });
      else response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port;
  const check = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["0x"] }),
  });
  assert.equal(check.status, 403, "local archive write denial test");
  await check.text();
  return { server, url, methods, blockedMethods };
}

function startAnvil(anvil, upstream, chainId) {
  return spawn(anvil, [
    "--host", "127.0.0.1", "--port", "0", "--accounts", "0",
    "--chain-id", String(chainId), "--fork-url", upstream, "--fork-block-number", String(network.blockNumber),
    "--hardfork", "cancun", "--no-storage-caching", "--timeout", "40000", "--retries", "3",
  ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}

function waitForLocalPort(child) {
  return new Promise((resolvePort, reject) => {
    let output = "";
    const startup = setTimeout(() => finish(new Error("Anvil startup timed out")), 40_000);
    const failed = (error) => finish(error);
    const exited = (code) => finish(new Error("Anvil exited before listening (" + code + "): " + output));
    const capture = (chunk) => {
      output = (output + chunk.toString()).slice(-8_192);
      const port = /Listening on 127\.0\.0\.1:(\d+)/.exec(output)?.[1];
      if (port) finish(null, "http://127.0.0.1:" + port);
    };
    function finish(error, url) {
      clearTimeout(startup);
      child.off("error", failed);
      child.off("exit", exited);
      child.stdout.off("data", capture);
      child.stderr.off("data", capture);
      child.stdout.resume();
      child.stderr.resume();
      if (error) reject(error);
      else resolvePort(url);
    }
    child.once("error", failed);
    child.once("exit", exited);
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
  });
}

async function stopAnvil(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const exited = once(child, "exit");
  child.kill();
  await Promise.race([exited, delay(3_000, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

export async function withAnvilFork({ anvil, chainId = network.chainId }, run) {
  assert.ok(chainId === 4663 || chainId === 31337, "unsupported review fork chain ID");
  const binary = anvil.includes("/") || anvil.includes("\\") ? resolve(anvil) : anvil;
  const version = execFileSync(binary, ["--version"], { encoding: "utf8", windowsHide: true });
  assert.match(version, /^anvil Version: 1\.7\.1\s/m, "unexpected Anvil version");
  const upstream = await verifyUpstream();
  const proxy = await openReadOnlyUpstream();
  let child;
  try {
    child = startAnvil(binary, proxy.url, chainId);
    const rpcUrl = await waitForLocalPort(child);
    assert.match(await rpc(rpcUrl, "web3_clientVersion"), /^anvil\//i);
    await assertAnchor(rpcUrl, chainId);
    // Compare all runtime bytes and actual getter/immutable bindings on the 4663 execution fork.
    if (chainId === network.chainId) await verifyOfficialBindings(rpcUrl);
    assert.deepEqual(await rpc(rpcUrl, "eth_accounts"), [], "Anvil must not load unlocked keys");
    for (const account of fixtures) {
      assert.equal(await rpc(rpcUrl, "eth_getCode", [account, "latest"]), "0x", "fixture account is not an EOA");
      assert.equal(await rpc(rpcUrl, "eth_getTransactionCount", [account, "latest"]), "0x0", "fixture nonce");
      assert.equal(await rpc(rpcUrl, "eth_getBalance", [account, "latest"]), "0x0", "fixture has upstream ETH");
      await rpc(rpcUrl, "anvil_setBalance", [account, "0x56bc75e2d63100000"]);
      await rpc(rpcUrl, "anvil_impersonateAccount", [account]);
    }
    const report = {
      network: { ...network, ...upstream },
      execution: { chainId, anvil: "1.7.1", hardfork: "cancun", host: "127.0.0.1", fixtureKeys: 0 },
      archiveBoundary: { methodAllowlist: [...remoteMethods].sort(), blockedWriteProbe: "HTTP 403" },
    };
    const result = await run({ rpcUrl, report, accounts: [...fixtures] });
    assert.deepEqual([...proxy.blockedMethods], ["eth_sendRawTransaction"], "unexpected archive RPC blocked");
    return result;
  } catch (error) {
    if (proxy.blockedMethods.size > 1) {
      throw new Error("Denied upstream methods: " + [...proxy.blockedMethods].join(", "), { cause: error });
    }
    throw error;
  } finally {
    try {
      await stopAnvil(child);
    } finally {
      const closed = once(proxy.server, "close");
      proxy.server.close();
      proxy.server.closeAllConnections();
      await closed;
    }
  }
}

export async function withRobinhood4663Fork({ anvil, solc, lib }, run) {
  const { manifest, templates } = buildLaunch4663Review({ solc, lib }, true);
  const { executablePlatform, executableSha256, ...portableCompiler } = manifest.compiler;
  const portable = { ...manifest, compiler: portableCompiler };
  const digest = createHash("sha256").update(JSON.stringify(portable)).digest("hex");
  assert.equal(digest, reviewDigest, "review build differs from independently reproduced #583 manifest");
  const fullManifestSha256 = createHash("sha256").update(JSON.stringify(manifest, null, 2) + "\n").digest("hex");
  return withAnvilFork({ anvil }, (context) => {
    context.report.build = { portableManifestSha256: digest, fullManifestSha256, manifest };
    return run({ ...context, manifest, artifacts: templates });
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: {
      anvil: { type: "string" }, solc: { type: "string" }, lib: { type: "string" },
    } });
    if (!values.anvil || !values.solc) {
      throw new Error("Provide --anvil and --solc executable paths, and optional --lib dependency path");
    }
    const report = await withRobinhood4663Fork(values, ({ report }) => report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
