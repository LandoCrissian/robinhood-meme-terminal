import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  encodeFunctionData, erc20Abi, keccak256, parseAbi, parseEther, toHex, zeroAddress,
  type Address, type Hex, type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { factoryAbi, longevityFactoryAbi, prepareSwap } from "../launchpad/direct-v4";
import { launchPoolId, type NewLaunchRecord } from "../launchpad/launch-record";
import type { BoundWallet } from "../launchpad/transactions";
import { readLaunchpadPreviewAccess } from "./launchpad-preview-access";
import { createLaunchpadPreviewGateway, localPreviewBackend, previewLanAccess, previewListenHost } from "./launchpad-preview-gateway";
import { permittedPreviewRpc, type PreviewRpcPolicy } from "./launchpad-preview-rpc";
import { readLaunchpadRuntime } from "./new-launchpad-config";

const account = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const factory = toHex(0xf0, { size: 20 });
const token = toHex(0xa1, { size: 20 });
const hash = keccak256("0x01");
const host = "preview.rmt.test:3198";
const origin = `https://${host}`;
const intentId = keccak256("0x12");
const now = Date.now();
const previewEnv = {
  RMT_LAUNCHPAD_ENABLED: "true",
  RMT_LAUNCHPAD_TRADING_ENABLED: "true",
  RMT_LAUNCHPAD_CHAIN_ID: "31337",
  RMT_LAUNCHPAD_FACTORY_ADDRESS: factory,
  RMT_LAUNCHPAD_FACTORY_RUNTIME_HASH: keccak256("0x1234"),
  RMT_LAUNCHPAD_FACTORY_START_BLOCK: "10",
  RMT_LAUNCHPAD_DATABASE_PATH: join(tmpdir(), "unused-preview-gateway.sqlite"),
  RMT_LAUNCHPAD_RPC_URL: "http://127.0.0.1:8545",
  RMT_LAUNCHPAD_PREVIEW_ORIGIN: origin,
  RMT_LAUNCHPAD_PREVIEW_ACCESS_CODE: randomBytes(32).toString("hex"),
  RMT_LAUNCHPAD_PREVIEW_RPC_CODE: randomBytes(32).toString("hex"),
  RMT_LAUNCHPAD_PREVIEW_WALLET: account.address,
  RMT_LAUNCHPAD_PREVIEW_EXPIRES_AT: String(Math.floor(now / 1_000) + 3_600),
};
const access = readLaunchpadPreviewAccess(previewEnv)!;
const runtime = readLaunchpadRuntime(previewEnv)!;
const { deployment } = runtime;
const poolKey = { currency0: zeroAddress, currency1: token, hooks: zeroAddress, fee: 3000, tickSpacing: 60 };
const launch: NewLaunchRecord = {
  chainId: 31337, factory, creator: account.address, token, poolManager: deployment.poolManager,
  poolId: launchPoolId(poolKey), poolKey, intentId, positionTokenId: "1",
  sqrtPriceX96: String(2n ** 96n), tickLower: -887220, tickUpper: 887220, liquidity: "1000",
  amount0: "1000", amount1: "1000", totalSupply: "1000", name: "Preview Fixture", symbol: "PF",
  projectURI: "", transactionHash: hash, blockNumber: "12", blockHash: hash, logIndex: 0, indexing: "indexed",
};
const previewDeadline = () => BigInt(Math.floor(Date.now() / 1_000) + 300);

function launchTransactionData(value: bigint) {
  return encodeFunctionData({
    abi: factoryAbi, functionName: "launch", args: [{
      name: launch.name, symbol: launch.symbol, projectURI: "", intentId,
      supplyPreset: 0, poolAllocationBps: 5000, nativeAmount: value, deadline: previewDeadline(),
    }],
  });
}

function sign(data: Hex, options: {
  signer?: typeof account;
  chainId?: number;
  to?: Address;
  value?: bigint;
  gas?: bigint;
} = {}) {
  return (options.signer ?? account).signTransaction({
    type: "eip1559", chainId: options.chainId ?? 31337, nonce: 0, gas: options.gas ?? 3_000_000n,
    maxFeePerGas: 100n, maxPriorityFeePerGas: 1n, to: options.to ?? factory,
    data, value: options.value ?? 0n,
  });
}

function policy(readTransaction?: PreviewRpcPolicy["readTransaction"]): PreviewRpcPolicy {
  return {
    runtime, wallet: account.address, readLaunch: (address) => address.toLowerCase() === token ? launch : undefined,
    readTransaction: readTransaction ?? (async () => { throw new Error("Transaction unavailable"); }),
  };
}

test("signed Longevity calls stay on the guarded engine and the committed recipient bucket", async () => {
  const guard = toHex(0x2000, { size: 20 });
  const guardedKey = { ...poolKey, hooks: guard };
  const feePolicy = { creator: account.address, treasury: stranger.address, reserve: zeroAddress,
    creatorBps: 7500, treasuryBps: 2500, reserveBps: 0 };
  const record: NewLaunchRecord = { ...launch, engineVersion: 2, poolKey: guardedKey,
    poolId: launchPoolId(guardedKey), feePolicy };
  const guardedRuntime: LaunchpadRuntime = { ...runtime, deployment: { ...deployment, engineVersion: 2, initializationGuard: guard } };
  const guardedPolicy = { ...policy(), runtime: guardedRuntime, readLaunch: () => record };
  const value = parseEther("0.1");
  const create = encodeFunctionData({ abi: longevityFactoryAbi, functionName: "launchWithLongevity", args: [{
    name: launch.name, symbol: launch.symbol, projectURI: "", intentId, supplyPreset: 0,
    poolAllocationBps: 5000, nativeAmount: value, deadline: previewDeadline(),
  }, feePolicy] });
  const signedCreate = await sign(create, { value });
  assert.equal(await permittedPreviewRpc(guardedPolicy, "eth_sendRawTransaction", [signedCreate]), true);
  assert.equal(await permittedPreviewRpc(policy(), "eth_sendRawTransaction", [signedCreate]), false);
  for (const bucket of [0, 1, 2, 3]) {
    const withdraw = encodeFunctionData({ abi: longevityFactoryAbi, functionName: "withdrawFees", args: [token, bucket] });
    assert.equal(await permittedPreviewRpc(guardedPolicy, "eth_sendRawTransaction", [await sign(withdraw)]), bucket === 0);
    assert.equal(await permittedPreviewRpc({ ...guardedPolicy, readLaunch: () => ({ ...record, poolKey }) },
      "eth_sendRawTransaction", [await sign(withdraw)]), false);
  }
});

test("preview config retains the private loopback RPC and fails closed outside a short HTTPS chain-31337 lease", () => {
  assert.equal(runtime.privateRpcUrl, "http://127.0.0.1:8545/");
  assert.equal(deployment.rpcUrl, new URL(access.rpcPath, origin).href);
  assert.equal(access.wallet, account.address);
  assert.ok(!access.rpcPath.includes(access.accessCode));
  assert.equal(readLaunchpadRuntime({ ...previewEnv, VERCEL_ENV: "preview" }), null);
  assert.equal(readLaunchpadRuntime({ ...previewEnv, VERCEL: "1" }), null);
  assert.throws(() => readLaunchpadRuntime({ ...previewEnv, RMT_LAUNCHPAD_CHAIN_ID: "1" }));
  assert.throws(() => readLaunchpadRuntime({ ...previewEnv, RMT_LAUNCHPAD_RPC_URL: "https://example.com" }));
  for (const changes of [
    { RMT_LAUNCHPAD_PREVIEW_ORIGIN: "http://127.0.0.1:3198" },
    { RMT_LAUNCHPAD_PREVIEW_ORIGIN: "https://example.com/path" },
    { RMT_LAUNCHPAD_PREVIEW_ORIGIN: "https://www.rmtlaunch.fun" },
    { RMT_LAUNCHPAD_PREVIEW_ORIGIN: "https://user@example.com" },
    { RMT_LAUNCHPAD_PREVIEW_RPC_CODE: previewEnv.RMT_LAUNCHPAD_PREVIEW_ACCESS_CODE },
    { RMT_LAUNCHPAD_PREVIEW_WALLET: zeroAddress },
    { RMT_LAUNCHPAD_PREVIEW_EXPIRES_AT: String(Math.floor(now / 1_000) - 1) },
    { RMT_LAUNCHPAD_PREVIEW_EXPIRES_AT: String(Math.floor(now / 1_000) + 14_401) },
  ]) {
    assert.throws(() => readLaunchpadPreviewAccess({ ...previewEnv, ...changes }, now));
  }
  const baseline = readLaunchpadRuntime({ ...previewEnv, RMT_LAUNCHPAD_PREVIEW_ORIGIN: undefined })!;
  assert.equal(baseline.deployment.rpcUrl, baseline.privateRpcUrl);
  assert.equal(previewListenHost("127.0.0.1", false), "127.0.0.1");
  assert.equal(previewListenHost("192.168.1.4", true), "192.168.1.4");
  for (const value of ["0.0.0.0", "8.8.8.8", "192.168.2.999", "::"]) {
    assert.throws(() => previewListenHost(value, true));
  }
  assert.throws(() => previewListenHost("192.168.1.4", false));
  assert.equal(localPreviewBackend("http://127.0.0.1:3197").origin, "http://127.0.0.1:3197");
  assert.throws(() => localPreviewBackend("http://192.168.1.4:3197"));
});

test("preview process rejects invalid TLS and listener bindings before connecting to the fork", async () => {
  const command = promisify(execFile);
  const entry = fileURLToPath(new URL("../../scripts/launchpad-preview-gateway.ts", import.meta.url));
  const cwd = fileURLToPath(new URL("../../", import.meta.url));
  const options = { RMT_LAUNCHPAD_PREVIEW_PORT: "3198", RMT_LAUNCHPAD_PREVIEW_WEB_URL: "http://127.0.0.1:3197" };
  for (const [overrides, expected] of [
    [{ RMT_LAUNCHPAD_PREVIEW_TLS_CERT: "fixture.pem" }, /both preview TLS certificate and key/],
    [{ RMT_LAUNCHPAD_PREVIEW_BIND: "192.168.1.4" }, /TLS-protected private LAN address/],
    [{
      RMT_LAUNCHPAD_PREVIEW_BIND: "192.168.1.4",
      RMT_LAUNCHPAD_PREVIEW_TLS_CERT: "fixture.pem",
      RMT_LAUNCHPAD_PREVIEW_TLS_KEY: "fixture-key.pem",
    }, /TLS address must match/],
    [{
      RMT_LAUNCHPAD_PREVIEW_ORIGIN: "https://172.31.254.241:3198",
      RMT_LAUNCHPAD_PREVIEW_BIND: "172.31.254.241",
      RMT_LAUNCHPAD_PREVIEW_TLS_CERT: "fixture.pem",
      RMT_LAUNCHPAD_PREVIEW_TLS_KEY: "fixture-key.pem",
    }, /locally attached IPv4 subnet/],
    [{ RMT_LAUNCHPAD_PREVIEW_PORT: "3197" }, /distinct preview listener port/],
  ] as const) {
    // Explicitly use only the test environment instead of inheriting live preview settings.
    await assert.rejects(command(process.execPath, ["--import", "tsx", entry], {
      cwd,
      timeout: 10_000,
      env: { NODE_ENV: "test", PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...previewEnv, ...options, ...overrides },
    }), expected);
  }
});

test("direct LAN TLS admits only the attached private subnet or one configured peer within it", () => {
  const network = {
    address: "10.0.0.22", cidr: "10.0.0.22/24", netmask: "255.255.255.0",
    family: "IPv4" as const, internal: false, mac: "00:00:00:00:00:00",
  };
  const attached = { WiFi: [network] };
  assert.equal(previewLanAccess("127.0.0.1", undefined, {}), null);
  assert.throws(() => previewLanAccess("127.0.0.1", "10.0.0.23", attached), /only for direct private TLS/);
  const attachedAccess = previewLanAccess(network.address, undefined, attached)!;
  const peerAccess = previewLanAccess(network.address, "10.0.0.23", attached)!;
  assert.equal(attachedAccess("10.0.0.23"), true);
  assert.equal(attachedAccess("10.0.0.24"), true);
  assert.equal(peerAccess("10.0.0.23"), true);
  assert.equal(peerAccess("10.0.0.24"), false);
  assert.equal(attachedAccess(undefined), false);
  assert.throws(() => previewLanAccess("10.0.1.22", "10.0.0.23", attached), /locally attached/);
  assert.throws(() => previewLanAccess(network.address, "10.0.0.23", { WiFi: [{ ...network, cidr: "10.0.0.22/1" }] }), /locally attached/);
  for (const peer of ["10.0.1.23", "8.8.8.8", "127.0.0.1", "::ffff:10.0.0.23"]) {
    assert.equal(attachedAccess(peer), false);
    assert.throws(() => previewLanAccess(network.address, peer, attached), /same LAN subnet/);
  }
});

test("preview RPC admits bounded wallet reads and rejects administrative methods, state overrides and open log searches", async () => {
  const authority = policy();
  const logs = { address: deployment.poolManager, fromBlock: "0xa", toBlock: "0x3f2", topics: [hash, launch.poolId] };
  for (const [method, params] of [
    ["eth_chainId", []],
    ["eth_getBalance", [account.address, "latest"]],
    ["eth_getBlockByNumber", ["latest", false]],
    ["eth_feeHistory", ["0x14", "latest", [25, 50, 75]]],
    ["eth_getLogs", [logs]],
    ["eth_call", [{ to: deployment.factory, from: account.address, data: "0x", gas: "0x7a1200" }, "latest"]],
    ["eth_estimateGas", [{ to: token, from: account.address, data: "0x" }]],
  ] as const) {
    assert.equal(await permittedPreviewRpc(authority, method, [...params]), true, method);
  }
  for (const [method, params] of [
    ["eth_accounts", []],
    ["eth_sendTransaction", [{ from: account.address, to: factory }]],
    ["anvil_setBalance", [account.address, "0x10000"]],
    ["anvil_impersonateAccount", [account.address]],
    ["evm_mine", []],
    ["debug_traceCall", []],
    ["eth_getBlockByNumber", ["latest", true]],
    ["eth_feeHistory", ["0x101", "latest"]],
    ["eth_getLogs", [{ ...logs, fromBlock: "0x9" }]],
    ["eth_getLogs", [{ ...logs, toBlock: "0x3f3" }]],
    ["eth_getLogs", [{ ...logs, topics: [hash] }]],
    ["eth_getLogs", [{ ...logs, address: stranger.address }]],
    ["eth_call", [{ to: factory, from: stranger.address }, "latest"]],
    ["eth_call", [{ to: factory, gas: "0x7a1201" }, "latest"]],
    ["eth_call", [{ to: stranger.address }, "latest"]],
    ["eth_call", [{ to: factory }, "latest", { [account.address]: { balance: "0x1" } }]],
  ] as const) {
    assert.equal(await permittedPreviewRpc(authority, method, [...params]), false, method);
  }
});

test("preview RPC admits only the test wallet's chain-31337 launch, claim, exact-input swap and bounded approvals", async () => {
  const authority = policy();
  const amount = parseEther("0.1");
  const launchData = launchTransactionData(amount);
  const feeData = encodeFunctionData({ abi: factoryAbi, functionName: "collectFees", args: [token, previewDeadline()] });
  const approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [deployment.permit2, amount] });
  const permitAbi = parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)"]);
  const permitData = encodeFunctionData({
    abi: permitAbi, functionName: "approve", args: [token, deployment.universalRouter, amount, Number(previewDeadline())],
  });
  const fixtureClient = {
    getChainId: async () => 31337, getBlock: async () => ({ number: 12n, hash }),
    getBalance: async () => parseEther("10"), estimateGas: async () => 90_000n,
    getGasPrice: async () => 1n, call: async () => ({ data: "0x" }),
    readContract: async ({ functionName, address }: { functionName: string; address: Address }) =>
      functionName === "balanceOf" ? parseEther("10")
        : address.toLowerCase() === deployment.permit2.toLowerCase() ? [amount, Number(previewDeadline())] : amount,
    simulateContract: async () => ({ result: [amount, 90_000n] }),
  } as unknown as PublicClient;
  const wallet = { address: account.address, chainId: 31337 } as BoundWallet;
  const buy = await prepareSwap(fixtureClient, deployment, wallet, launch, "buy", amount, 100);
  const sell = await prepareSwap(fixtureClient, deployment, wallet, launch, "sell", amount, 100);
  const approved = await Promise.all([
    sign(launchData, { value: amount }), sign(feeData), sign(approveData, { to: token }),
    sign(permitData, { to: deployment.permit2 }), sign(buy.request.data, { to: deployment.universalRouter, value: amount }),
    sign(sell.request.data, { to: deployment.universalRouter }),
  ]);
  for (const transaction of approved) {
    assert.equal(await permittedPreviewRpc(authority, "eth_sendRawTransaction", [transaction]), true);
  }
  const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
  const arbitraryCommand = encodeFunctionData({
    abi: routerAbi, functionName: "execute", args: ["0x00", ["0x"], previewDeadline()],
  });
  const forbidden = await Promise.all([
    sign(launchData, { value: amount, signer: stranger }), sign(launchData, { value: amount, chainId: 1 }),
    sign(launchData, { value: amount - 1n }), sign(launchData, { value: amount, to: stranger.address }),
    sign(launchData, { value: amount, gas: 8_000_001n }), sign(feeData, { value: amount }),
    sign(arbitraryCommand, { to: deployment.universalRouter }), sign(approveData, { to: stranger.address }),
    sign(encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [stranger.address, amount] }), { to: token }),
    sign(encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [deployment.permit2, parseEther("1000000001")] }), { to: token }),
    sign(encodeFunctionData({ abi: permitAbi, functionName: "approve", args: [token, stranger.address, amount, Number(previewDeadline())] }), { to: deployment.permit2 }),
    sign(encodeFunctionData({ abi: factoryAbi, functionName: "collectFees", args: [token, 1n] })),
  ]);
  for (const transaction of [...forbidden, "0x", launchData]) {
    assert.equal(await permittedPreviewRpc(authority, "eth_sendRawTransaction", [transaction]), false);
  }
  const disabled = { ...authority, runtime: { ...runtime, deployment: { ...deployment, tradingEnabled: false } } };
  assert.equal(await permittedPreviewRpc(disabled, "eth_sendRawTransaction", [approved[0]]), true);
  for (const transaction of approved.slice(2)) {
    assert.equal(await permittedPreviewRpc(disabled, "eth_sendRawTransaction", [transaction]), false);
  }

  const traced = { from: account.address, to: deployment.universalRouter, blockNumber: 12n, input: buy.request.data };
  const traceParams = [hash, { tracer: "callTracer" }];
  assert.equal(await permittedPreviewRpc(policy(async () => traced), "debug_traceTransaction", traceParams), true);
  for (const tx of [{ ...traced, from: stranger.address }, { ...traced, blockNumber: 9n }, { ...traced, to: factory }]) {
    assert.equal(await permittedPreviewRpc(policy(async () => tx), "debug_traceTransaction", traceParams), false);
  }
  assert.equal(await permittedPreviewRpc(policy(async () => traced), "debug_traceTransaction", [hash, { tracer: "callTracer", timeout: "1h" }]), false);
});

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port.");
  return address.port;
}

type ResponseFixture = { status: number | undefined; headers: IncomingHttpHeaders; body: string };
function send(port: number, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<ResponseFixture>((resolve, reject) => {
    const outbound = request({
      host: "127.0.0.1", port, path, method: options.method, headers: { Host: host, ...options.headers },
    }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("end", () => resolve({ status: incoming.statusCode, headers: incoming.headers, body: Buffer.concat(chunks).toString("utf8") }));
      incoming.once("error", reject);
    });
    outbound.once("error", reject);
    outbound.end(options.body);
  });
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("gateway protects app and MCP, forwards only valid RPC, and enforces a shared RPC rate ceiling", async (t) => {
  const clock = t.mock.method(Date, "now", () => now);
  const backendRequests: Array<{ url?: string; headers: IncomingHttpHeaders }> = [];
  const rpcCalls: unknown[] = [];
  const backend = createServer((incoming, response) => {
    backendRequests.push({ url: incoming.url, headers: incoming.headers });
    response.end("private backend response");
  });
  const backendPort = await listen(backend);
  const gateway = createServer(createLaunchpadPreviewGateway(
    access, runtime, localPreviewBackend(`http://127.0.0.1:${backendPort}`),
    async (input, init) => {
      assert.equal(input, runtime.privateRpcUrl);
      const call = JSON.parse(String(init?.body));
      rpcCalls.push(call);
      if (call.method === "eth_getCode") return new Response("x".repeat(384 * 1_024 + 1));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 100, result: "0x7a69" }));
    },
  ));
  const port = await listen(gateway);
  try {
    assert.equal((await send(port, "/", { headers: { Host: "bad.example" } })).status, 421);
    assert.equal((await send(port, "/", { headers: { Host: "bad.example", "X-Forwarded-Host": host } })).status, 421);
    assert.equal((await send(port, "/", { headers: { "Tailscale-Funnel-Request": "?1" } })).status, 403);
    assert.equal((await send(port, "/api/launchpad/config")).status, 401);
    assert.equal((await send(port, "/")).headers.location, "/preview-access");
    const form = await send(port, "/preview-access");
    assert.equal(form.status, 200);
    assert.ok(form.body.includes("Preview access code"));
    assert.equal(form.headers["referrer-policy"], "same-origin");
    assert.equal(form.headers["cache-control"], "no-store");
    assert.equal(backendRequests.length, 0);
    const unlockHeaders = { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" };
    assert.equal((await send(port, "/preview-access", { method: "POST", headers: unlockHeaders, body: "code=wrong" })).status, 403);
    const unlocked = await send(port, "/preview-access", {
      method: "POST", headers: unlockHeaders, body: new URLSearchParams({ code: access.accessCode }).toString(),
    });
    assert.equal(unlocked.status, 303);
    const cookie = unlocked.headers["set-cookie"]?.[0];
    assert.ok(cookie?.includes("Secure; HttpOnly; SameSite=Strict"));
    const app = await send(port, "/api/launchpad/config", {
      headers: { Cookie: cookie!.split(";")[0], "X-Forwarded-Host": "bad.example", "Tailscale-User-Login": "fixture@example.test" },
    });
    assert.equal(app.status, 200);
    assert.equal(app.body, "private backend response");
    assert.equal(backendRequests[0].headers.cookie, undefined);
    assert.equal(backendRequests[0].headers["x-forwarded-host"], undefined);
    assert.equal(backendRequests[0].headers["tailscale-user-login"], undefined);
    assert.equal(backendRequests[0].headers.host, `127.0.0.1:${backendPort}`);
    const mcp = await send(port, "/mcp", { method: "POST", headers: { Authorization: `Bearer ${access.accessCode}` }, body: "{}" });
    assert.equal(mcp.status, 200);
    assert.equal(backendRequests[1].headers.authorization, undefined);
    assert.equal((await send(port, "/mcp", {
      method: "POST", headers: { Authorization: `Bearer ${access.accessCode}`, Origin: "https://foreign.test" }, body: "{}",
    })).status, 403);
    assert.equal((await send(port, "/api/vnext/prepare", { headers: { Authorization: `Bearer ${access.accessCode}` } })).status, 404);
    const assetHeaders = { Cookie: cookie!.split(";")[0] };
    for (const chunk of [
      "/_next/static/chunks/app/(launchpad)/launches/[token]/page-0123.js",
      "/_next/static/chunks/d06ad_%40noble_hashes_esm_99dc452a._.js",
      "/_next/static/chunks/app/%28launchpad%29/launches/%5Btoken%5D/page-0123.js",
    ]) {
      assert.equal((await send(port, chunk, { headers: assetHeaders })).status, 200, chunk);
      assert.equal(backendRequests.at(-1)?.url, chunk);
    }
    for (const malformed of [
      "/_next/server/app/layout.js",
      "/_next/static/chunks/%2E%2E/%2E%2E/server/app/layout.js",
      "/_next/static/chunks/%255Btoken%255D/page.js",
      "/_next/static/chunks/%5Cserver/page.js",
    ]) {
      assert.equal((await send(port, malformed, { headers: assetHeaders })).status, 404, malformed);
    }

    const call = (method: string, params: unknown[] = [], path = access.rpcPath) => send(port, path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    assert.equal((await call("eth_chainId", [], "/preview-rpc/invalid")).status, 404);
    assert.equal((await call("anvil_setBalance", [account.address, "0x1"])).status, 403);
    assert.equal((await call("eth_sendTransaction", [])).status, 403);
    assert.equal((await call("eth_getCode", ["x".repeat(16_500)])).status, 413);
    assert.equal((await send(port, access.rpcPath, { method: "POST", headers: { Origin: "https://foreign.test", "Content-Type": "application/json" }, body: "{}" })).status, 403);
    assert.equal(rpcCalls.length, 0);
    const read = await call("eth_chainId");
    assert.equal(read.status, 200);
    assert.deepEqual(JSON.parse(read.body), { jsonrpc: "2.0", id: 1, result: "0x7a69" });
    assert.deepEqual(rpcCalls[0], { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
    const testValue = parseEther("0.1");
    const data = launchTransactionData(testValue);
    const unauthorized = await sign(data, { signer: stranger, value: testValue });
    assert.equal((await call("eth_sendRawTransaction", [unauthorized])).status, 403);
    assert.equal(rpcCalls.length, 1);
    const signed = await sign(data, { value: testValue });
    assert.equal((await call("eth_sendRawTransaction", [signed])).status, 200);
    assert.deepEqual(rpcCalls[1], { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signed] });
    const largeResponse = await call("eth_getCode", [factory, "latest"]);
    assert.equal(largeResponse.status, 502);
    assert.ok(largeResponse.body.length < 256);

    // A deterministic minute boundary allows precisely one shared bucket to be exercised.
    clock.mock.mockImplementation(() => now + 60_000);
    for (let i = 0; i < 360; i++) assert.equal((await call("eth_chainId")).status, 200);
    assert.equal((await call("eth_chainId")).status, 429);
    assert.equal(rpcCalls.length, 363);
    clock.mock.mockImplementation(() => access.expiresAt);
    assert.equal((await call("eth_chainId")).status, 410);
    assert.equal((await send(port, "/preview-access")).status, 410);
  } finally {
    await close(gateway);
    await close(backend);
  }
});
