import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createPublicClient, createTestClient, getAddress, http, isHash, keccak256, toHex, zeroAddress,
  type Address, type Hash, type Hex, type PublicClient,
} from "viem";
import { GET as normalPublicGet } from "../app/api/launchpad/public/[operation]/route";
import { POST as normalMcpPost } from "../app/mcp/route";
import { verifySwap as normalVerifySwap } from "../lib/launchpad/direct-v4";
import type { LaunchHealth, LaunchPoolKey, NewLaunchRecord } from "../lib/launchpad/launch-record";
import type { NativeSettlementProof } from "../lib/launchpad/native-settlement";
import { assertWalletBinding, readPendingRequest, replacePendingRequest, submitReviewedRequest, type LaunchRequest, type WalletProvider } from "../lib/launchpad/transactions";
import { readLaunchpadRuntime } from "../lib/server/new-launchpad-config";
import type { LaunchpadPublicOperation } from "../lib/server/new-launchpad-public-data";
import { sameHex } from "../lib/server/new-launchpad-receipt";

const baseline = "e9f8038b34a771c119ae94157bbe1e4af3beee63";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const restPath = "apps/web/app/api/launchpad/public/[operation]/route.ts";
const publicationPath = "apps/web/app/api/launchpad/launches/route.ts";
const mcpPath = "apps/web/app/mcp/route.ts";
const configPath = "apps/web/lib/server/new-launchpad-config.ts";
const directPath = "apps/web/lib/launchpad/direct-v4.ts";
const fixturePath = "packages/contracts/test/fixtures/rmt-v4-deployment-identities.json";
const sourcePaths = [
  restPath, publicationPath, mcpPath, configPath, directPath, fixturePath,
  "apps/web/lib/launchpad/curve-showcase.ts",
  "apps/web/lib/launchpad/launch-record.ts",
  "apps/web/lib/launchpad/router-pins.ts",
  "apps/web/lib/server/launchpad-preview-access.ts",
  "apps/web/lib/server/launchpad-site-mode.ts",
  "apps/web/lib/server/launchpad-sqlite-backup.ts",
  "apps/web/lib/server/media-request-guard.ts",
  "apps/web/lib/server/new-launchpad-growth-health.ts",
  "apps/web/lib/server/new-launchpad-health.ts",
  "apps/web/lib/server/new-launchpad-holders.ts",
  "apps/web/lib/server/new-launchpad-finality.ts",
  "apps/web/lib/server/new-launchpad-indexer.ts",
  "apps/web/lib/server/new-launchpad-mcp.ts",
  "apps/web/lib/server/new-launchpad-public-data.ts",
  "apps/web/lib/server/new-launchpad-receipt.ts",
  "apps/web/lib/server/new-launchpad-settlement-store.ts",
  "apps/web/lib/server/new-launchpad-store.ts",
  "apps/web/lib/launchpad/growth-vault.ts",
  "apps/web/lib/launchpad/native-settlement.ts",
  "apps/web/lib/launchpad/receipt-logs.ts",
  "apps/web/lib/vnext/normalized-native-trace.ts",
] as const;

type Pin = { address: Address; runtimeHash: Hash };
type Network = {
  chainId: number;
  blockNumber: number | string | bigint;
  blockHash: Hash;
  provider: string;
  contracts: Record<"poolManager" | "positionManager" | "permit2" | "quoter" | "stateView" | "universalRouter", Pin>;
};
type ForkReceipt = { hash: Hash; blockNumber: string | bigint; blockHash: Hash };
type ForkLaunch = { token: Address; poolId: Hash; poolKey: LaunchPoolKey; launch: ForkReceipt & { creator: Address; intentId: Hash } };
type ForkSwap = ForkReceipt & {
  account: Address;
  recipient: Address;
  amountIn: string | bigint;
  minimumOut: string | bigint;
  amountOut: string | bigint;
  deadline: number | bigint;
  calldata: Hex;
  value: string | bigint;
  reviewedBlockNumber?: string | bigint;
  reviewedBlockHash?: Hash;
};
type ForkLifecycle = ForkLaunch & {
  chainId: number;
  factory: Address;
  factoryRuntimeHash: Hash;
  guard: Address;
  guardRuntimeHash: Hash;
  deployment: ForkReceipt;
  buy: ForkSwap;
  sell: ForkSwap;
  feeCollection: {
    nativeAccrued: string | bigint;
    tokenAccrued: string | bigint;
    nativeRoundingDust: string | bigint;
    tokenRoundingDust: string | bigint;
  };
  withdrawals: { bucket: number; recipient: Address; nativeAmount: string | bigint; tokenAmount: string | bigint }[];
};
type ResponseBody = {
  status: string;
  evidence?: { l2Observation?: { status: string }; l1Finality?: { status: string } };
  launch?: NewLaunchRecord;
  indexing?: string;
  data?: {
    chainId?: number;
    launches?: NewLaunchRecord[];
    launch?: NewLaunchRecord;
    health?: LaunchHealth;
    evidence?: {
      chainId?: number;
      poolId?: Hash;
      poolManager?: Address;
      poolKey?: LaunchPoolKey;
      blockHash?: Hash;
      finality?: string;
      l2Observation?: { status: "observed" | "unavailable"; blockNumber: string | null; blockHash: Hash | null };
      l1Finality?: { status: "unverified"; reason: string };
      freshness?: string;
    };
    checks?: { id: string; status: string }[];
    activity?: { transactionHash: Hash; amount0: string; amount1: string }[];
    nextCursor?: string;
    positionOwner?: Address;
    positionLiquidity?: string;
  };
};

const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");

function replaceOnce(source: string, before: string, after: string) {
  assert.equal(source.split(before).length, 2, "Expected one exact review substitution: " + before);
  return source.replace(before, after);
}

async function createReviewCopy(scratch: string, network: Network) {
  const replacements = [
    { path: configPath, before: 'required(env, "CHAIN_ID") !== "31337"', after: 'required(env, "CHAIN_ID") !== "4663"' },
    { path: configPath, before: "const chainId = 31337;", after: "const chainId = 4663;" },
    { path: configPath, before: '"Local Anvil · Base Sepolia fork"', after: '"Local review Anvil · Robinhood 4663 fork"' },
    { path: directPath, before: "deployment.chainId !== 31337", after: "deployment.chainId !== 4663" },
  ];
  const candidateHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const sourceManifest = [];
  for (const path of sourcePaths) {
    const source = (await readFile(join(repo, path), "utf8")).replace(/\r\n/g, "\n");
    let contents = source;
    for (const { before, after } of replacements.filter((replacement) => replacement.path === path)) {
      contents = replaceOnce(contents, before, after);
    }
    if (path === fixturePath) {
      const fixture = JSON.parse(source);
      const { universalRouter, ...dependencies } = network.contracts;
      fixture.baseSepolia = {
        chainId: network.chainId, rpcUrl: "http://127.0.0.1/", block: Number(network.blockNumber), blockHash: network.blockHash,
        ...dependencies,
        // The production store scope incorporates the older router pin. It is never called in this fork test.
        universalRouter: fixture.robinhoodMainnet.universalRouter,
        universalRouter212: universalRouter,
      };
      contents = JSON.stringify(fixture, null, 2) + "\n";
    }
    const destination = join(scratch, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents, "utf8");
    const headPath = candidateHead + ":" + path;
    const tracked = execFileSync("git", ["ls-tree", candidateHead, "--", path], { cwd: repo, encoding: "utf8" }).length > 0;
    const committedSha256 = tracked
      ? sha256(execFileSync("git", ["show", headPath], { cwd: repo, encoding: "utf8" }).replace(/\r\n/g, "\n"))
      : null;
    sourceManifest.push({ path, committedSha256, candidateSha256: sha256(source), reviewSha256: sha256(contents) });
  }
  const allSourcesMatchHead = sourceManifest.every(({ committedSha256, candidateSha256 }) => committedSha256 === candidateSha256);
  if (process.env.GITHUB_ACTIONS === "true") assert.ok(allSourcesMatchHead, "Review sources must match the exact CI candidate commit");
  return { baseline, candidateHead, allSourcesMatchHead, replacements, fixtureReplacement: "Rebind only the baseSepolia fixture entry to the approved 4663 fork anchor and dependencies. The historical Robinhood Router 2.0 pin is retained solely for the original store scope formula.", sourceManifest };
}

function requiredBlock(number: bigint | null, hash: Hash | null) {
  assert.ok(number !== null && hash && isHash(hash), "Required canonical block unavailable");
  return { number, hash };
}

function rpcWith(rpc: PublicClient, override: Partial<Pick<PublicClient, "getBlock" | "getBlockNumber" | "getLogs" | "request">>): PublicClient {
  return new Proxy(rpc, {
    get(target, property, receiver) {
      if (property === "getBlock" && override.getBlock) return override.getBlock;
      if (property === "getBlockNumber" && override.getBlockNumber) return override.getBlockNumber;
      if (property === "getLogs" && override.getLogs) return override.getLogs;
      if (property === "request" && override.request) return override.request;
      return Reflect.get(target, property, receiver);
    },
  });
}

function traceFault(rpc: PublicClient, trace: () => unknown): PublicClient {
  return rpcWith(rpc, {
    request: (async (args: { method: string; params?: readonly unknown[] }) =>
      args.method === "debug_traceTransaction" ? trace() : rpc.request(args as never)) as PublicClient["request"],
  });
}

function pendingReason(reason: string) {
  return (error: unknown) => error instanceof Error && "reason" in error && error.reason === reason;
}

async function verifyWalletJournal(rpc: PublicClient, request: LaunchRequest, hash: Hash, settle: () => Promise<void>) {
  const journalKey = ["rmt:launchpad:pending:v1", request.chainId, request.from.toLowerCase()].join(":");
  const storage = new Map<string, string>([[journalKey, JSON.stringify({ request })]]);
  const savedGlobals = new Map(["localStorage", "navigator"].map((name) =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true, value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { locks: { request: async (_key: string, _options: unknown, use: (lock: object) => unknown) => use({}) } },
  });
  const provider: WalletProvider = {
    on() {},
    removeListener() {},
    async request({ method, params }) {
      assert.ok(["eth_accounts", "eth_chainId", "eth_getBlockByNumber"].includes(method), "Wallet recovery adapter is read-only");
      // The Anvil fixture uses impersonation with zero imported keys. Model only the reviewed wallet selection.
      if (method === "eth_accounts") return [request.from];
      return rpc.request({ method, params } as never);
    },
  };
  const wallet = { address: request.from, chainId: 4663, generation: 1, provider, request: provider.request };
  try {
    const pending = readPendingRequest(4663, request.from);
    assert.ok(pending && !pending.hash);
    await assertWalletBinding(wallet, request);
    await assert.rejects(submitReviewedRequest(wallet, request, () => true), /Recover the existing wallet request/);
    assert.equal(await replacePendingRequest(pending, hash), true);
    assert.equal(await replacePendingRequest(pending), false);
    const recovered = readPendingRequest(4663, request.from);
    assert.deepEqual(recovered, { request, hash });
    await settle();
    assert.deepEqual(readPendingRequest(4663, request.from), recovered);
    assert.equal(await replacePendingRequest(recovered!), true);
    assert.equal(readPendingRequest(4663, request.from), undefined);
  } finally {
    for (const [name, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

export async function runPublicEvidence({
  rpcUrl, report, lifecycle, createAnotherLaunch,
}: {
  rpcUrl: string;
  report: { network: Network };
  lifecycle: ForkLifecycle;
  createAnotherLaunch: () => Promise<ForkLaunch>;
}) {
  const url = new URL(rpcUrl);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(url.port && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash);
  const network = report.network;
  assert.equal(network.chainId, 4663);
  assert.equal(lifecycle.chainId, 4663);
  assert.ok(BigInt(network.blockNumber) <= BigInt(lifecycle.deployment.blockNumber));
  assert.equal(BigInt(lifecycle.guard) & 0x3fffn, 0x2000n);
  const transport = () => http(url.href, { timeout: 12_000, retryCount: 0 });
  const rpc = createPublicClient({ transport: transport(), cacheTime: 0 });
  const anvil = createTestClient({ mode: "anvil", transport: transport() });
  const anchor = await rpc.getBlock({ blockNumber: BigInt(network.blockNumber) });
  assert.equal(anchor.hash, network.blockHash);
  assert.equal(await rpc.getChainId(), 4663);
  const nodeInfo = await rpc.request({ method: "web3_clientVersion" } as never);
  assert.match(String(nodeInfo), /^anvil/i);

  const endpoint = new URL("http://127.0.0.1:3000/mcp");
  const restUrl = (operation: LaunchpadPublicOperation, token?: Address, limit?: number, cursor?: string) => {
    const address = new URL("http://127.0.0.1:3000/api/launchpad/public/" + operation);
    address.searchParams.set("chainId", "4663");
    if (token) address.searchParams.set("token", token);
    if (limit) address.searchParams.set("limit", String(limit));
    if (cursor) address.searchParams.set("cursor", cursor);
    return address;
  };
  const normal = await normalPublicGet(new Request(restUrl("list_launches")), { params: Promise.resolve({ operation: "list_launches" }) });
  assert.equal(normal.status, 404);
  assert.equal((await normal.json()).status, "disabled");
  const normalMcp = await normalMcpPost(new Request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_launches", arguments: { chainId: 4663 } } }),
  }));
  assert.equal(normalMcp.status, 200);
  assert.equal((await normalMcp.json()).result.structuredContent.status, "disabled");
  assert.throws(() => readLaunchpadRuntime({ RMT_LAUNCHPAD_ENABLED: "true", RMT_LAUNCHPAD_CHAIN_ID: "4663" }), /Only the local launchpad factory/);

  const parent = join(repo, "apps/web/.launch-qa");
  await mkdir(parent, { recursive: true });
  const scratch = await mkdtemp(join(parent, "review-4663-"));
  const saved = new Map<string, string | undefined>();
  const setEnv = (key: string, value: string | undefined) => {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  try {
    const source = await createReviewCopy(scratch, network);
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("RMT_LAUNCHPAD_") || key === "VERCEL" || key === "VERCEL_ENV") setEnv(key, undefined);
    }
    const databasePath = join(scratch, "review.sqlite");
    for (const [key, value] of Object.entries({
      ENABLED: "true", CHAIN_ID: "4663", RPC_URL: url.href, DATABASE_PATH: databasePath,
      FACTORY_START_BLOCK: String(lifecycle.deployment.blockNumber), FACTORY_ADDRESS: lifecycle.factory,
      FACTORY_RUNTIME_HASH: lifecycle.factoryRuntimeHash, GUARD_ADDRESS: lifecycle.guard, GUARD_RUNTIME_HASH: lifecycle.guardRuntimeHash,
      ENGINE_VERSION: "2", ROUTER_VERSION: "2.1.2", TRADING_ENABLED: "true",
    })) setEnv("RMT_LAUNCHPAD_" + key, value);

    const load = (path: string) => import(pathToFileURL(join(scratch, path)).href);
    const rest: typeof import("../app/api/launchpad/public/[operation]/route") = await load(restPath);
    const publication: typeof import("../app/api/launchpad/launches/route") = await load(publicationPath);
    const mcp: typeof import("../app/mcp/route") = await load(mcpPath);
    const configModule: typeof import("../lib/server/new-launchpad-config") = await load(configPath);
    const direct: typeof import("../lib/launchpad/direct-v4") = await load(directPath);
    const indexer: typeof import("../lib/server/new-launchpad-indexer") = await load("apps/web/lib/server/new-launchpad-indexer.ts");
    const storeModule: typeof import("../lib/server/new-launchpad-store") = await load("apps/web/lib/server/new-launchpad-store.ts");
    const settlementModule: typeof import("../lib/server/new-launchpad-settlement-store") = await load("apps/web/lib/server/new-launchpad-settlement-store.ts");
    const publicData: typeof import("../lib/server/new-launchpad-public-data") = await load("apps/web/lib/server/new-launchpad-public-data.ts");
    const receiptVerifier: typeof import("../lib/server/new-launchpad-receipt") = await load("apps/web/lib/server/new-launchpad-receipt.ts");
    const config = configModule.readLaunchpadRuntime();
    assert.ok(config);
    assert.equal(config.deployment.chainId, 4663);
    assert.equal(config.growthVaultDeployer, undefined);
    assert.equal(config.growthVaultTestFixture, undefined);
    await configModule.verifyLaunchpadRuntime(config, rpc);
    await assert.rejects(configModule.verifyLaunchpadRuntime({
      ...config, deployment: { ...config.deployment, poolManager: zeroAddress },
    }, rpc), /binding mismatch/);

    const fetchRest = async (operation: LaunchpadPublicOperation, token?: Address, limit?: number, cursor?: string) => {
      const result = await rest.GET(new Request(restUrl(operation, token, limit, cursor)), { params: Promise.resolve({ operation }) });
      return { code: result.status, body: await result.json() as ResponseBody };
    };
    const publish = async (entry: ForkLaunch) => {
      const response = await publication.POST(new Request("http://127.0.0.1:3000/api/launchpad/launches", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionHash: entry.launch.hash, creator: entry.launch.creator, intentId: entry.launch.intentId }),
      }));
      return { code: response.status, body: await response.json() as ResponseBody };
    };
    const withStore = async <T>(use: (store: InstanceType<typeof storeModule.LaunchpadStore>) => Promise<T>) => {
      const store = new storeModule.LaunchpadStore(databasePath, config.scope);
      try { return await use(store); }
      finally { store.close(); }
    };

    const pending = await publish(lifecycle);
    assert.equal(pending.code, 200);
    assert.equal(pending.body.status, "confirmed");
    assert.equal(pending.body.indexing, "pending");
    const launch = pending.body.launch;
    assert.ok(launch);
    assert.equal(launch.chainId, 4663);
    assert.equal(launch.blockHash, lifecycle.launch.blockHash);
    assert.equal(launch.blockNumber, String(lifecycle.launch.blockNumber));
    assert.ok(sameHex(launch.token, lifecycle.token));
    assert.ok(sameHex(launch.poolId, lifecycle.poolId));
    assert.deepEqual(Object.values(launch.poolKey).map(String).map((part) => part.toLowerCase()),
      Object.values(lifecycle.poolKey).map(String).map((part) => part.toLowerCase()));
    assert.equal((await publish({ ...lifecycle, launch: { ...lifecycle.launch, intentId: keccak256("0x") } })).code, 422);
    const actualReceipt = await rpc.getTransactionReceipt({ hash: lifecycle.launch.hash });
    assert.throws(() => receiptVerifier.projectLaunchReceipt({
      ...config.deployment, poolManager: zeroAddress,
    }, actualReceipt, lifecycle.launch.hash), /missing the pool/);
    if (config.deployment.engineVersion !== 2) throw new Error("Guarded engine required");
    assert.throws(() => receiptVerifier.projectLaunchReceipt({
      ...config.deployment, engineVersion: 2, initializationGuard: zeroAddress,
    }, actualReceipt, lifecycle.launch.hash), /supported funded pool terms/);

    let deliveredDuplicates = 0;
    const duplicateLogs = rpcWith(rpc, {
      async getLogs(args) {
        const logs = await rpc.getLogs(args);
        deliveredDuplicates += logs.length;
        return [...logs, ...logs];
      },
    });
    const indexed = await withStore(async (store) => {
      const result = await indexer.syncNewLaunchpadRange(store, duplicateLogs, config);
      assert.ok(result.caughtUp);
      assert.equal(deliveredDuplicates, 1);
      assert.equal(store.read().length, 1);
      assert.equal(store.read()[0].indexing, "indexed");
      return store.checkpoint();
    });
    assert.ok(indexed);
    await withStore(async (store) => {
      assert.deepEqual(store.checkpoint(), indexed);
      assert.ok((await indexer.syncNewLaunchpadRange(store, rpc, config)).caughtUp);
      assert.equal(store.read().length, 1);
    });

    const readChecks = await fetchRest("get_launch_checks", lifecycle.token);
    assert.equal(readChecks.code, 200);
    const health = readChecks.body.data?.health;
    assert.ok(health);
    assert.equal(health.growth, undefined);
    assert.equal(health.liquidity.custody.status, "verified");
    assert.equal(health.liquidity.currentPositionLiquidity, launch.liquidity);
    assert.equal(health.fees.status, "verified");
    assert.deepEqual(health.fees.policy, launch.feePolicy);
    assert.ok(health.fees.totals && BigInt(health.fees.totals.nativeAccrued) > 0n && BigInt(health.fees.totals.tokenAccrued) > 0n);
    assert.equal(health.fees.buckets?.length, 3);
    assert.deepEqual(health.fees.totals, {
      nativeAccrued: String(lifecycle.feeCollection.nativeAccrued), tokenAccrued: String(lifecycle.feeCollection.tokenAccrued),
      nativeRoundingDust: String(lifecycle.feeCollection.nativeRoundingDust), tokenRoundingDust: String(lifecycle.feeCollection.tokenRoundingDust),
    });
    for (const bucket of health.fees.buckets) {
      const withdrawal = lifecycle.withdrawals.find((entry) => entry.bucket === bucket.bucket);
      assert.ok(withdrawal && sameHex(withdrawal.recipient, bucket.recipient));
      assert.equal(bucket.nativeClaimable, "0");
      assert.equal(bucket.tokenClaimable, "0");
      assert.equal(bucket.nativeDistributed, String(withdrawal.nativeAmount));
      assert.equal(bucket.tokenDistributed, String(withdrawal.tokenAmount));
    }
    assert.equal(readChecks.body.data?.checks?.find(({ id }) => id === "external_routing")?.status, "unknown");
    assert.ok(readChecks.body.data?.checks?.filter(({ id }) => id !== "external_routing").every(({ status }) => status === "verified"));

    const mcpClient = new Client({ name: "rmt-launch-4663-fork-review", version: "1.0.0" });
    const mcpTransport = new StreamableHTTPClientTransport(endpoint, {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        return request.method === "GET" ? mcp.GET(request) : mcp.POST(request);
      },
    });
    const publicReads: Record<string, unknown> = {};
    await mcpClient.connect(mcpTransport);
    try {
      const { tools } = await mcpClient.listTools();
      const operations = publicData.launchpadPublicOperations;
      assert.deepEqual(tools.map(({ name }) => name).sort(), [...operations].sort());
      assert.ok(tools.every(({ annotations }) => annotations?.readOnlyHint));
      for (const operation of operations) {
        const token = operation === "list_launches" ? undefined : lifecycle.token;
        const result = await fetchRest(operation, token);
        assert.equal(result.code, 200, operation);
        assert.equal(result.body.status, "ready", operation);
        const rpcResult = await mcpClient.callTool({ name: operation, arguments: { chainId: 4663, ...(token ? { token } : {}) } });
        assert.equal(rpcResult.isError, false, operation);
        assert.deepEqual(rpcResult.structuredContent, result.body, operation);
        const data = result.body.data;
        assert.ok(data, operation);
        assert.equal(data.evidence?.finality, "local_chain_observed");
        const observation = data.evidence?.l2Observation;
        assert.equal(observation?.status, "observed", operation);
        assert.ok(observation.blockNumber && observation.blockHash, operation);
        assert.equal((await rpc.getBlock({ blockNumber: BigInt(observation.blockNumber) })).hash, observation.blockHash, operation);
        assert.deepEqual(data.evidence?.l1Finality, {
          status: "unverified", reason: "independent_l1_verifier_unconfigured",
        }, operation);
        if (operation === "list_launches") {
          assert.equal(data.chainId, 4663);
          assert.equal(data.launches?.length, 1);
          assert.ok(sameHex(data.launches[0].token, lifecycle.token));
        } else {
          assert.equal(data.evidence?.chainId, 4663);
          assert.ok(sameHex(data.evidence.poolId, lifecycle.poolId));
          assert.ok(sameHex(data.evidence.poolManager, network.contracts.poolManager.address));
          assert.deepEqual(data.evidence.poolKey, launch.poolKey);
        }
        if (operation === "get_launch") assert.equal(data.launch?.transactionHash, lifecycle.launch.hash);
        if (operation === "get_pool_state") {
          assert.ok(sameHex(data.positionOwner, lifecycle.factory));
          assert.equal(data.positionLiquidity, launch.liquidity);
        }
        if (operation === "get_launch_activity") {
          assert.ok(data.activity?.some(({ transactionHash, amount0, amount1 }) =>
            transactionHash === lifecycle.buy.hash && BigInt(amount0) < 0n && BigInt(amount1) > 0n));
          assert.ok(data.activity?.some(({ transactionHash, amount0, amount1 }) =>
            transactionHash === lifecycle.sell.hash && BigInt(amount0) > 0n && BigInt(amount1) < 0n));
        }
        publicReads[operation] = { restHttpStatus: result.code, mcpMatched: true, data };
      }
    } finally {
      await mcpClient.close();
    }

    const activityFirstPage = await fetchRest("get_launch_activity", lifecycle.token, 1);
    assert.equal(activityFirstPage.code, 200);
    const activityCursor = activityFirstPage.body.data?.nextCursor;
    assert.ok(activityCursor);
    assert.deepEqual(activityFirstPage.body.data?.activity?.map(({ transactionHash }) => transactionHash), [lifecycle.sell.hash]);
    const activitySecondPage = await fetchRest("get_launch_activity", lifecycle.token, 1, activityCursor);
    assert.equal(activitySecondPage.code, 200);
    assert.deepEqual(activitySecondPage.body.data?.activity?.map(({ transactionHash }) => transactionHash), [lifecycle.buy.hash]);

    const swaps: Record<string, unknown> = {};
    const corroboratingRpc = createPublicClient({ transport: transport(), cacheTime: 0 });
    const proofs: NativeSettlementProof[] = [];
    const withSettlement = <T>(path: string, use: (store: InstanceType<typeof settlementModule.LaunchpadSettlementStore>) => T) => {
      const store = new settlementModule.LaunchpadSettlementStore(path, config.scope);
      try { return use(store); }
      finally { store.close(); }
    };
    for (const side of ["buy", "sell"] as const) {
      const trade = lifecycle[side];
      assert.ok(sameHex(trade.account, trade.recipient));
      const receipt = await rpc.getTransactionReceipt({ hash: trade.hash });
      const originalBlock = trade.reviewedBlockNumber !== undefined && trade.reviewedBlockHash
        ? requiredBlock(BigInt(trade.reviewedBlockNumber), trade.reviewedBlockHash)
        : (() => { throw new Error("Trade evidence needs a pre-submission reviewed block"); })();
      assert.equal(receipt.blockHash, trade.blockHash);
      assert.equal(receipt.blockNumber, BigInt(trade.blockNumber));
      const request: LaunchRequest = {
        kind: side, chainId: 4663, from: getAddress(trade.account), to: getAddress(network.contracts.universalRouter.address),
        token: getAddress(lifecycle.token), data: trade.calldata, value: toHex(BigInt(trade.value)), deadline: Number(trade.deadline),
        amountIn: String(trade.amountIn), minimumOut: String(trade.minimumOut),
        blockNumber: toHex(originalBlock.number), blockHash: originalBlock.hash,
      };
      const bound = await direct.boundReceipt(rpc, trade.hash, request);
      await assert.rejects(normalVerifySwap(rpc, bound, config.deployment, launch, request), /unavailable for this pool/);
      await assert.rejects(direct.boundReceipt(rpc, trade.hash, { ...request, from: zeroAddress }), /reviewed wallet request/);
      await assert.rejects(direct.boundReceipt(rpc, trade.hash, { ...request, chainId: 31337 }), /different network/);
      await assert.rejects(direct.boundReceipt(rpc, trade.hash, { ...request, data: "0x" }), /reviewed wallet request/);
      await assert.rejects(direct.boundReceipt(rpc, trade.hash, { ...request, blockHash: keccak256("0x") }), /reviewed network block changed/);
      await assert.rejects(direct.verifySwap(rpc, bound, config.deployment, {
        ...launch, poolKey: { ...launch.poolKey, hooks: zeroAddress },
      }, request), /unavailable for this pool/);
      await verifyWalletJournal(rpc, request, trade.hash, async () => {
        if (side === "sell") {
          const result: unknown = await rpc.request({ method: "debug_traceTransaction", params: [trade.hash, { tracer: "callTracer" }] } as never);
          assert.ok(result && typeof result === "object" && !Array.isArray(result));
          const trace = result as Record<string, unknown>;
          const corroboration = { mode: "simulation" as const, source: "fork-observer-b", client: corroboratingRpc };
          const options = { primarySource: "fork-observer-a", corroboration,
            saveProof: (proof: NativeSettlementProof) => {
              withSettlement(databasePath, (store) => store.save(proof));
              proofs.push(proof);
            },
          };
          const verify = (client: PublicClient = rpc, witness: PublicClient = corroboratingRpc) => direct.verifySwap(client, bound, config.deployment, launch, request, {
            ...options, corroboration: { ...corroboration, client: witness },
          });
          await assert.rejects(direct.verifySwap(rpc, bound, config.deployment, launch, request), pendingReason("unavailable"));
          await assert.rejects(verify(traceFault(rpc, () => { throw new Error("review fault: missing trace"); })), pendingReason("unavailable"));
          await assert.rejects(verify(traceFault(rpc, () => null)), pendingReason("payout_unproven"));
          await assert.rejects(verify(traceFault(rpc, () => ({ ...trace, calls: [null] }))), pendingReason("malformed"));
          await assert.rejects(verify(traceFault(rpc, () => { throw Object.assign(new Error("HTTP 429"), { status: 429 }); })), pendingReason("rate_limited"));
          await assert.rejects(verify(rpc, traceFault(corroboratingRpc, () => ({ ...trace, calls: [] }))), pendingReason("disagreement"));
          const stale = rpcWith(corroboratingRpc, {
            getBlock: async () => { throw new Error("review fault: archive state unavailable"); },
          });
          await assert.rejects(verify(rpc, stale), pendingReason("stale"));
          await assert.rejects(direct.verifySwap(rpc, bound, config.deployment, launch, request, {
            ...options, saveProof: () => { throw new Error("review fault: proof write interrupted"); },
          }), pendingReason("unavailable"));
          assert.equal(proofs.length, 0);
          assert.deepEqual(readPendingRequest(4663, request.from), { request, hash: trade.hash });
          assert.equal(await verify(), BigInt(trade.amountOut));
          assert.equal(proofs.length, 1);
          const [proof] = proofs;
          assert.equal(proof.mode, "simulated_agreement");
          assert.equal(proof.transactionHash, trade.hash);
          assert.equal(proof.blockHash, receipt.blockHash);
          assert.equal(proof.amountAtomic, String(trade.amountOut));
          assert.deepEqual(proof.poolKey, launch.poolKey);
        } else {
          assert.equal(await direct.verifySwap(rpc, bound, config.deployment, launch, request), BigInt(trade.amountOut));
        }
      });
      swaps[side] = {
        transactionHash: trade.hash, receiptBlockNumber: String(receipt.blockNumber), receiptBlockHash: receipt.blockHash,
        reviewedBlockNumber: String(originalBlock.number), reviewedBlockHash: originalBlock.hash,
        exactAmountOut: String(trade.amountOut), recovered: true, journalRecoveredWithoutRebroadcast: true, incorrectAccountChainCalldataAndReviewBlockRejected: true,
        incorrectFullPoolKeyRejected: true,
        ...(side === "sell" ? { nativeSettlementProof: proofs[0], pendingOn: ["missing", "no_payout", "malformed",
          "rate_limited", "disagreement", "stale_archive", "interrupted_proof_write"], journalRetainedWithoutTrace: true } : {}),
      };
    }

    const backupPath = join(scratch, "review-backup.sqlite");
    const restorePath = join(scratch, "review-restored.sqlite");
    const backup = await withStore((store) => store.backup(backupPath));
    assert.deepEqual(backup.checkpoint, indexed);
    const restored = await storeModule.LaunchpadStore.restore(backupPath, restorePath, config.scope, backup.sha256);
    assert.deepEqual(restored.checkpoint, indexed);
    const [proof] = proofs;
    assert.ok(proof);
    const proofKey = { transactionHash: proof.transactionHash, logIndex: proof.logIndex,
      blockHash: proof.blockHash, blockNumber: BigInt(proof.blockNumber) };
    assert.deepEqual(withSettlement(restorePath, (store) => store.read(proofKey)), proof);
    assert.equal(withSettlement(restorePath, (store) => store.read({ ...proofKey, blockHash: keccak256("0x") })), undefined);
    const withRestoredStore = async <T>(use: (store: InstanceType<typeof storeModule.LaunchpadStore>) => Promise<T>) => {
      const store = new storeModule.LaunchpadStore(restorePath, config.scope);
      try { return await use(store); }
      finally { store.close(); }
    };
    await withRestoredStore(async (store) => {
      assert.equal(store.status(), "delayed");
      assert.deepEqual(store.checkpoint(), indexed);
      assert.ok((await indexer.syncNewLaunchpadRange(store, rpc, config, corroboratingRpc)).caughtUp);
      assert.equal(store.status(), "ready");
      assert.equal(store.read().length, 1);
      assert.equal(store.read()[0].transactionHash, launch.transactionHash);
    });

    const beforeFork = await rpc.getBlock();
    const snapshot = await anvil.snapshot();
    let reverted = false;
    try {
      const orphan = await createAnotherLaunch();
      assert.ok(!sameHex(orphan.token, lifecycle.token));
      const interrupted = rpcWith(rpc, {
        getLogs: async () => { throw new Error("review fault: launch log provider interrupted"); },
      });
      const staleIndexWitness = rpcWith(corroboratingRpc, { getBlockNumber: async () => indexed.number - 1n });
      const disagreeingIndexWitness = rpcWith(corroboratingRpc, {
        getBlock: (async (parameters: Parameters<PublicClient["getBlock"]>[0]) => ({
          ...await corroboratingRpc.getBlock(parameters), hash: keccak256("0x"),
        })) as PublicClient["getBlock"],
      });
      for (const witness of [staleIndexWitness, disagreeingIndexWitness]) {
        await withStore(async (store) => {
          await assert.rejects(indexer.syncNewLaunchpadRange(store, rpc, config, witness), /behind|stale|disagree/i);
          assert.deepEqual(store.checkpoint(), indexed);
          assert.equal(store.read().length, 1);
          assert.equal(store.status(), "delayed");
        });
      }
      await withStore(async (store) => {
        await assert.rejects(indexer.syncNewLaunchpadRange(store, interrupted, config), /launch log provider interrupted/);
        assert.deepEqual(store.checkpoint(), indexed);
        assert.equal(store.read().length, 1);
        assert.equal(store.status(), "delayed");
      });
      await withStore(async (store) => {
        assert.ok((await indexer.syncNewLaunchpadRange(store, rpc, config)).caughtUp);
        assert.equal(store.read().length, 2);
        assert.ok(sameHex(store.read({ token: orphan.token })[0].transactionHash, orphan.launch.hash));
      });
      await withRestoredStore(async (store) => {
        assert.ok((await indexer.syncNewLaunchpadRange(store, rpc, config, corroboratingRpc)).caughtUp);
        assert.equal(store.read().length, 2);
        assert.equal(store.read({ token: orphan.token })[0].transactionHash, orphan.launch.hash);
      });
      assert.equal((await fetchRest("get_launch", orphan.token)).code, 200);
      await anvil.revert({ id: snapshot });
      reverted = true;
      await anvil.setNextBlockTimestamp({ timestamp: beforeFork.timestamp + 60n });
      const branchLength = BigInt(orphan.launch.blockNumber) - requiredBlock(beforeFork.number, beforeFork.hash).number;
      assert.ok(branchLength > 0n && branchLength <= 32n);
      await anvil.mine({ blocks: Number(branchLength) });
      const replacement = await rpc.getBlock({ blockNumber: BigInt(orphan.launch.blockNumber) });
      assert.notEqual(replacement.hash, orphan.launch.blockHash);
      const unavailable = await fetchRest("get_launch", orphan.token);
      assert.equal(unavailable.code, 503);
      assert.equal(unavailable.body.evidence?.l2Observation?.status, "unavailable");
      assert.equal(unavailable.body.evidence?.l1Finality?.status, "unverified");
      await assert.rejects(rpc.getTransactionReceipt({ hash: orphan.launch.hash }), /not be found|not found/i);
      await withStore(async (store) => {
        assert.ok((await indexer.syncNewLaunchpadRange(store, rpc, config)).caughtUp);
        assert.equal(store.read({ token: orphan.token }).length, 0);
        assert.equal(store.read().length, 1);
        assert.equal(store.checkpoint()?.hash, replacement.hash);
      });
      await withRestoredStore(async (store) => {
        assert.ok((await indexer.syncNewLaunchpadRange(store, rpc, config, corroboratingRpc)).caughtUp);
        assert.equal(store.read({ token: orphan.token }).length, 0);
        assert.equal(store.read().length, 1);
        assert.equal(store.checkpoint()?.hash, replacement.hash);
      });
      assert.equal((await fetchRest("get_launch", orphan.token)).code, 404);
      assert.equal((await fetchRest("get_launch", lifecycle.token)).code, 200);
      assert.deepEqual(withSettlement(restorePath, (store) => store.read(proofKey)), proof);
      return {
        source,
        normalRuntime: { configuration4663Rejected: true, rest4663Disabled: true, mcp4663Disabled: true, trading4663Rejected: true },
        handlerTransport: "Direct Web Request/Response handlers and official MCP StreamableHTTP client in isolated scratch copy",
        walletRecoveryTransport: "In-memory browser journal and reviewed fixture account, with actual loopback RPC chain, blocks, transactions and receipts. No wallet signer or rebroadcast.",
        receipt: { status: "confirmed", provisionalBeforeIndexer: true, wrongIntentRejected: true, wrongManagerRejected: true, wrongHookRejected: true },
        swaps,
        publicReads,
        activityPagination: { first: lifecycle.sell.hash, second: lifecycle.buy.hash, eachPageLimit: 1 },
        indexer: {
          realLogDuplicateCount: deliveredDuplicates, persistentRestart: true, providerInterruptionPreservedCheckpoint: true,
          staleAndDisagreeingWitnessPreservedCheckpoint: true,
          backup: { bytes: backup.bytes, sha256: backup.sha256, restoredBytes: restored.bytes, checkpoint: indexed,
            delayedUntilReconciled: true, replayedAfterRestore: true, rewoundRestoredDatabase: true, nativeProofRestored: true },
          orphanTransactionHash: orphan.launch.hash, orphanBlockHash: orphan.launch.blockHash,
          replacementBlockHash: replacement.hash, orphanUnavailableBeforeReconciliation: true,
          orphanRemovedAfterReplay: true, originalRetained: true,
        },
      };
    } finally {
      if (!reverted) await anvil.revert({ id: snapshot });
    }
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(dirname(await realpath(scratch)), await realpath(parent));
    await rm(scratch, { recursive: true, force: true });
  }
}
