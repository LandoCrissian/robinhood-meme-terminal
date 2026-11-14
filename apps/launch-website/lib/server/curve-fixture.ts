import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createPublicClient, getAddress, http, keccak256, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { isTransactionHash, testCreationFeeWei, testCreationSignature } from "../test-creation";

export const fixtureChainId = 31337;
export const fixtureCreationFee = testCreationFeeWei;
export const factoryAbi = parseAbi([
  testCreationSignature,
  "function engineVersion() view returns (uint32)",
  "function projectRegistry() view returns (address)",
  "function creationFeeWei() view returns (uint256)",
  "function operatingRecipient() view returns (address)",
  "function tokenForIntent(address creator,bytes32 intentId) view returns (address)",
  "function originCurveForToken(address token) view returns (address)",
]);

export type CurveFixture = {
  origin: string;
  rpcUrl: string;
  indexerUrl: string;
  factory: Address;
  factoryRuntimeHash: Hex;
  registry: Address;
  registryRuntimeHash: Hex;
  deploymentBlock: bigint;
  deploymentBlockHash: Hex;
  feeRecipient: Address;
  graduation?: { engine: Address; engineRuntimeHash: Hex; guard: Address; guardRuntimeHash: Hex };
};

export function fixtureAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) && value.toLowerCase() !== zeroAddress;
}

export const fixtureHash = isTransactionHash;

function loopback(value: string | undefined) {
  if (!value || !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/?$/.test(value)) return null;
  try {
    const url = new URL(value);
    return Number(url.port) >= 1024 ? url.origin : null;
  } catch {
    return null;
  }
}

export function parseCurveFixture(env: Record<string, string | undefined>, manifest: unknown): CurveFixture | null {
  if (env.RMT_CURVE_FIXTURE !== "task036-local-only" || env.NETLIFY || env.VERCEL || env.DEPLOY_ID || env.CONTEXT || env.RAILWAY_ENVIRONMENT_ID
      || !env.RMT_CURVE_FIXTURE_READ_KEY || !/^[0-9a-f]{64}$/.test(env.RMT_CURVE_FIXTURE_READ_KEY) || /^0+$/.test(env.RMT_CURVE_FIXTURE_READ_KEY)) return null;
  const origin = loopback(env.RMT_CURVE_FIXTURE_SITE_ORIGIN);
  const rpcUrl = loopback(env.RMT_CURVE_FIXTURE_RPC);
  const indexerUrl = loopback(env.RMT_CURVE_FIXTURE_INDEXER);
  if (!origin || !rpcUrl || !indexerUrl || new Set([origin, rpcUrl, indexerUrl]).size !== 3
      || !manifest || typeof manifest !== "object") return null;
  const data = manifest as Record<string, unknown>;
  const block = typeof data.deployBlock === "number" && Number.isSafeInteger(data.deployBlock)
    ? String(data.deployBlock) : data.deployBlock;
  if (data.chainId !== fixtureChainId || !fixtureAddress(data.factory) || !fixtureHash(data.factoryRuntimeHash)
      || !fixtureAddress(data.projectRegistry) || !fixtureHash(data.registryRuntimeHash) || !fixtureHash(data.deploymentBlockHash)
      || typeof block !== "string" || !/^[1-9][0-9]{0,15}$/.test(block)
      || data.creationFeeWei !== fixtureCreationFee.toString() || !fixtureAddress(data.creationFeeRecipient)
      || new Set([data.factory.toLowerCase(), data.projectRegistry.toLowerCase(), data.creationFeeRecipient.toLowerCase()]).size !== 3) return null;
  const hasGraduation = ["graduationEngine", "graduationRuntimeHash", "guard", "guardRuntimeHash"].some((key) => Object.hasOwn(data, key));
  let graduation: CurveFixture["graduation"];
  if (hasGraduation) {
    if (!fixtureAddress(data.graduationEngine) || !fixtureHash(data.graduationRuntimeHash)
        || !fixtureAddress(data.guard) || !fixtureHash(data.guardRuntimeHash) || (BigInt(data.guard) & 0x3fffn) !== 0x2000n
        || new Set([data.factory, data.projectRegistry, data.graduationEngine, data.guard].map((entry) => entry.toLowerCase())).size !== 4) return null;
    graduation = { engine: getAddress(data.graduationEngine.toLowerCase()), engineRuntimeHash: data.graduationRuntimeHash,
      guard: getAddress(data.guard.toLowerCase()), guardRuntimeHash: data.guardRuntimeHash };
  }
  return { origin, rpcUrl, indexerUrl, factory: getAddress(data.factory.toLowerCase()), factoryRuntimeHash: data.factoryRuntimeHash,
    registry: getAddress(data.projectRegistry.toLowerCase()), registryRuntimeHash: data.registryRuntimeHash,
    deploymentBlock: BigInt(block), deploymentBlockHash: data.deploymentBlockHash,
    feeRecipient: getAddress(data.creationFeeRecipient.toLowerCase()), ...(graduation && { graduation }) };
}

export function configuredCurveFixture(headers: Headers): CurveFixture | null {
  const env = process.env;
  if (env.RMT_CURVE_FIXTURE !== "task036-local-only" || env.NETLIFY || env.VERCEL || env.DEPLOY_ID || env.CONTEXT || env.RAILWAY_ENVIRONMENT_ID) return null;
  const origin = loopback(env.RMT_CURVE_FIXTURE_SITE_ORIGIN);
  const manifest = env.RMT_CURVE_FIXTURE_DEPLOYMENT;
  if (!origin || headers.get("host") !== new URL(origin).host || !manifest || !isAbsolute(manifest)) return null;
  if (headers.get("x-forwarded-host") && headers.get("x-forwarded-host") !== new URL(origin).host) return null;
  if (headers.get("x-forwarded-proto") && headers.get("x-forwarded-proto") !== "http") return null;
  try {
    const data = readFileSync(manifest, "utf8");
    return data.length <= 65_536 ? parseCurveFixture(env, JSON.parse(data)) : null;
  } catch {
    return null;
  }
}

export function fixtureRpc(fixture: CurveFixture) {
  return createPublicClient({ transport: http(fixture.rpcUrl, {
    timeout: 2_500, retryCount: 0, fetchOptions: { redirect: "error", cache: "no-store" },
  }) });
}

export function sameHex(a: string | null | undefined, b: string) {
  return a?.toLowerCase() === b.toLowerCase();
}

export async function verifyCurveFixture(fixture: CurveFixture, rpc = fixtureRpc(fixture)) {
  if (await rpc.getChainId() !== fixtureChainId) throw new Error("Fixture chain mismatch");
  const read = { address: fixture.factory, abi: factoryAbi } as const;
  const [block, tip, factoryAtDeployment, factoryCode, registryCode, version, registry, fee, feeRecipient] = await Promise.all([
    rpc.getBlock({ blockNumber: fixture.deploymentBlock }), rpc.getBlock({ blockTag: "latest" }),
    rpc.getCode({ address: fixture.factory, blockNumber: fixture.deploymentBlock }),
    rpc.getCode({ address: fixture.factory }), rpc.getCode({ address: fixture.registry }),
    rpc.readContract({ ...read, functionName: "engineVersion" }), rpc.readContract({ ...read, functionName: "projectRegistry" }),
    rpc.readContract({ ...read, functionName: "creationFeeWei" }), rpc.readContract({ ...read, functionName: "operatingRecipient" }),
  ]);
  if (block.number !== fixture.deploymentBlock || !sameHex(block.hash, fixture.deploymentBlockHash)
      || tip.number < fixture.deploymentBlock || !factoryAtDeployment || !sameHex(keccak256(factoryAtDeployment), fixture.factoryRuntimeHash)
      || !factoryCode || !sameHex(keccak256(factoryCode), fixture.factoryRuntimeHash)
      || !registryCode || !sameHex(keccak256(registryCode), fixture.registryRuntimeHash)
      || version !== 1 || !sameHex(registry, fixture.registry) || fee !== fixtureCreationFee || !sameHex(feeRecipient, fixture.feeRecipient)) {
    throw new Error("Fixture deployment mismatch");
  }
  return tip;
}
