import { isAbsolute } from "node:path";
import { createPublicClient, getAddress, http, isAddress, isHash, keccak256, zeroAddress, type Address, type Hash } from "viem";
import identities from "../../../../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json";
import { curveFactoryAbi, curveGraduationAbi, sameCurveAddress } from "../launchpad/curve-v1";
import type { LaunchConfig } from "../launchpad/transactions";

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
const fixture = identities.baseSepolia;
type Environment = Record<string, string | undefined>;

export function curvePreviewSelected(env: Environment = process.env) {
  return env.RMT_CURVE_ENABLED === "true";
}

export function curveLoopbackRequest(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return url.protocol === "http:" && loopback.has(url.hostname)
    && (origin === null || origin === url.origin)
    && (fetchSite === null || fetchSite === "same-origin" || fetchSite === "none");
}

export function readCurveRuntime(env: Environment = process.env) {
  if (!curvePreviewSelected(env) || env.VERCEL === "1" || env.VERCEL_ENV) return null;
  const raw = (name: string) => env["RMT_CURVE_" + name]?.trim() || "";
  const rpcUrl = new URL(raw("RPC_URL"));
  if (rpcUrl.protocol !== "http:" || !loopback.has(rpcUrl.hostname) || !rpcUrl.port
    || rpcUrl.pathname !== "/" || rpcUrl.username || rpcUrl.password || rpcUrl.search || rpcUrl.hash) {
    throw new Error("Curve preview requires a direct loopback HTTP RPC.");
  }
  const factory = raw("FACTORY_ADDRESS");
  const factoryHash = raw("FACTORY_RUNTIME_HASH");
  const graduationHash = raw("GRADUATION_RUNTIME_HASH");
  const guardHash = raw("GUARD_RUNTIME_HASH");
  const registryHash = raw("REGISTRY_RUNTIME_HASH");
  const start = raw("START_BLOCK");
  const databasePath = raw("DATABASE_PATH");
  if (!isAddress(factory) || factory.toLowerCase() === zeroAddress || ![factoryHash, graduationHash, guardHash, registryHash]
    .every((hash) => isHash(hash) && !/^0x0+$/i.test(hash)) || !/^[1-9][0-9]{0,14}$/.test(start) || !isAbsolute(databasePath)) {
    throw new Error("Curve preview needs pinned deployment identities and an absolute database path.");
  }
  const scope = [31337, getAddress(factory), factoryHash, graduationHash, guardHash, registryHash, fixture.poolManager.address, start]
    .join(":").toLowerCase();
  return { rpcUrl: rpcUrl.href, factory: getAddress(factory), factoryHash: factoryHash as Hash,
    graduationHash: graduationHash as Hash, guardHash: guardHash as Hash, registryHash: registryHash as Hash,
    startBlock: BigInt(start), databasePath, scope };
}

type CurveRuntime = NonNullable<ReturnType<typeof readCurveRuntime>>;

export async function verifiedCurveRuntime(config: CurveRuntime) {
  const rpc = createPublicClient({ transport: http(config.rpcUrl, { timeout: 6_000, retryCount: 0, maxResponseBodySize: 1024 * 1024 }), cacheTime: 0 });
  if (await rpc.getChainId() !== 31337) throw new Error("Curve preview is locked to local chain 31337.");
  const block = await rpc.getBlock({ includeTransactions: false });
  if (!block.hash || block.number === null || block.number < config.startBlock) throw new Error("Curve deployment block unavailable.");
  const canonical = { blockHash: block.hash, requireCanonical: true } as const;
  const pin = async (address: Address, expectedHash: string) => {
    const code = await rpc.getCode({ address, ...canonical });
    if (!code || code === "0x" || keccak256(code) !== expectedHash.toLowerCase()) {
      throw new Error("The curve deployment runtime does not match its reviewed hash.");
    }
  };
  await pin(config.factory, config.factoryHash);
  const factory = { address: config.factory, abi: curveFactoryAbi, ...canonical } as const;
  const [graduationEngine, version, registry] = await Promise.all([
    rpc.readContract({ ...factory, functionName: "graduationEngine" }),
    rpc.readContract({ ...factory, functionName: "engineVersion" }),
    rpc.readContract({ ...factory, functionName: "projectRegistry" }),
  ]);
  if (version !== 1 || registry === zeroAddress) throw new Error("Unexpected curve engine or project registry.");
  await pin(graduationEngine, config.graduationHash);
  const engine = { address: graduationEngine, abi: curveGraduationAbi, ...canonical } as const;
  const [guard, manager, positions, permit, engineFactory] = await Promise.all([
    rpc.readContract({ ...engine, functionName: "initializationGuard" }),
    rpc.readContract({ ...engine, functionName: "poolManager" }),
    rpc.readContract({ ...engine, functionName: "positionManager" }),
    rpc.readContract({ ...engine, functionName: "permit2" }),
    rpc.readContract({ ...engine, functionName: "factory" }),
  ]);
  if (!sameCurveAddress(engineFactory, config.factory) || !sameCurveAddress(manager, fixture.poolManager.address)
    || !sameCurveAddress(positions, fixture.positionManager.address) || !sameCurveAddress(permit, fixture.permit2.address)
    || (BigInt(guard) & 0x3fffn) !== 0x2000n) throw new Error("Unexpected curve graduation bindings.");
  await Promise.all([
    pin(guard, config.guardHash),
    pin(registry, config.registryHash),
    ...[fixture.poolManager, fixture.positionManager, fixture.permit2, fixture.quoter, fixture.stateView, fixture.universalRouter212]
      .map(({ address, runtimeHash }) => pin(getAddress(address), runtimeHash)),
  ]);
  if ((await rpc.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error("Curve deployment observation changed.");
  const browser: Extract<LaunchConfig, { status: "ready" }> = {
    status: "ready",
    curve: { graduationEngine, projectRegistry: registry },
    deployment: { chainId: 31337, name: "Local curve review · Chain 31337", rpcUrl: config.rpcUrl, factory: config.factory,
      engineVersion: 2, initializationGuard: guard, poolManager: manager, positionManager: positions, permit2: permit,
      universalRouter: getAddress(fixture.universalRouter212.address), universalRouterVersion: "2.1.2",
      quoter: getAddress(fixture.quoter.address), stateView: getAddress(fixture.stateView.address), tradingEnabled: true },
  };
  return { rpc, browser };
}
