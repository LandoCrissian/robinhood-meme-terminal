import { isAbsolute } from "node:path";
import { createPublicClient, getAddress, http, isAddress, isHash, keccak256, parseAbi, zeroAddress, type Address, type Hash, type PublicClient } from "viem";
import { getAddresses } from "viem/actions";
import deploymentIdentities from "../../../../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json";
import type { NewLaunchDeployment } from "../launchpad/launch-record";
import { growthVaultDeployerAbi } from "../launchpad/growth-vault";
import { launchpadRouterPins } from "../launchpad/router-pins";
import { readLaunchpadPreviewAccess } from "./launchpad-preview-access";
import { launchSiteMode } from "./launchpad-site-mode";

const contractNames = ["factory", "poolManager", "positionManager", "universalRouter", "quoter", "permit2", "stateView"] as const;
type ContractName = typeof contractNames[number];
type ContractPin = { address: Address; runtimeHash: Hash };
type ContractPins = Record<ContractName, ContractPin>;

const bindingAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function permit2() view returns (address)",
  "function initializationGuard() view returns (address)",
  "function initializationGuardRuntimeHash() view returns (bytes32)",
  "function factory() view returns (address)",
]);

type Environment = Record<string, string | undefined>;
export type LaunchpadRuntime = {
  deployment: NewLaunchDeployment;
  contracts: ContractPins;
  guard?: ContractPin;
  growthVaultDeployer?: ContractPin;
  growthVaultTestFixture?: true;
  privateRpcUrl: string;
  startBlock: bigint;
  databasePath: string;
  confirmations: bigint;
  scope: string;
};

function required(env: Environment, name: string): string {
  const value = env[`RMT_LAUNCHPAD_${name}`]?.trim();
  if (!value) throw new Error(`Missing RMT_LAUNCHPAD_${name}`);
  return value;
}

function readPin(env: Environment, name: string): ContractPin {
  return validatedPin(required(env, `${name}_ADDRESS`), required(env, `${name}_RUNTIME_HASH`), name);
}

function validatedPin(address: string, runtimeHash: string, name: string): ContractPin {
  if (!isAddress(address) || getAddress(address) === zeroAddress || !isHash(runtimeHash) || /^0x0+$/i.test(runtimeHash)) {
    throw new Error(`Invalid ${name} deployment pin`);
  }
  return { address: getAddress(address), runtimeHash };
}

function optionalGrowthPin(env: Environment, corePins: readonly ContractPin[]): ContractPin | undefined {
  const address = env.RMT_LAUNCHPAD_GROWTH_VAULT_DEPLOYER_ADDRESS?.trim();
  const runtimeHash = env.RMT_LAUNCHPAD_GROWTH_VAULT_DEPLOYER_RUNTIME_HASH?.trim();
  if (!address || !runtimeHash) return;
  try {
    const pin = validatedPin(address, runtimeHash, "GROWTH_VAULT_DEPLOYER");
    if (!corePins.some(({ address: core }) => core === pin.address)) return pin;
  } catch { /* Growth configuration is optional and fails closed independently. */ }
}

function fixturePin(name: Exclude<ContractName, "factory">): ContractPin {
  const { address, runtimeHash } = deploymentIdentities.baseSepolia[name];
  return validatedPin(address, runtimeHash, name);
}

function parseLocalRpcUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.hash || url.pathname !== "/" || url.search) {
    throw new Error("Local RPC must be a loopback HTTP origin");
  }
  return url.toString();
}

export function readLaunchpadRuntime(env: Environment = process.env): LaunchpadRuntime | null {
  if (launchSiteMode(env) !== "historical") return null;
  if (required(env, "CHAIN_ID") !== "31337") throw new Error("Only the local launchpad factory is enabled");
  const chainId = 31337;
  const engineVersion = env.RMT_LAUNCHPAD_ENGINE_VERSION?.trim() || "1";
  if (engineVersion !== "1" && engineVersion !== "2") throw new Error("Invalid RMT_LAUNCHPAD_ENGINE_VERSION");
  const routerVersion = env.RMT_LAUNCHPAD_ROUTER_VERSION?.trim() || "2.0";
  if (routerVersion !== "2.0" && routerVersion !== "2.1.2") throw new Error("Invalid RMT_LAUNCHPAD_ROUTER_VERSION");
  if (routerVersion === "2.1.2" && (engineVersion !== "2" || env.RMT_LAUNCHPAD_PREVIEW_ORIGIN)) {
    throw new Error("Universal Router 2.1.2 requires the direct loopback V2 runtime");
  }
  const guard = engineVersion === "2" ? readPin(env, "GUARD") : undefined;
  if (!guard && (env.RMT_LAUNCHPAD_GUARD_ADDRESS?.trim() || env.RMT_LAUNCHPAD_GUARD_RUNTIME_HASH?.trim())) {
    throw new Error("Guard pins require launchpad engine version 2");
  }
  if (guard && (BigInt(guard.address) & 0x3fffn) !== 0x2000n) {
    throw new Error("The guard must carry only the before-initialize permission");
  }
  const contracts: ContractPins = {
    factory: readPin(env, "FACTORY"),
    poolManager: fixturePin("poolManager"),
    positionManager: fixturePin("positionManager"),
    universalRouter: launchpadRouterPins[routerVersion],
    quoter: fixturePin("quoter"),
    permit2: fixturePin("permit2"),
    stateView: fixturePin("stateView"),
  };
  const pins = [...Object.values(contracts), ...(guard ? [guard] : [])];
  if (new Set(pins.map(({ address }) => address.toLowerCase())).size !== pins.length) {
    throw new Error("Launchpad contract addresses must be distinct");
  }
  const factoryStartBlock = required(env, "FACTORY_START_BLOCK");
  const databasePath = required(env, "DATABASE_PATH");
  if (!/^[1-9]\d{0,14}$/.test(factoryStartBlock) || !isAbsolute(databasePath)) throw new Error("Invalid launchpad block or database path");
  const startBlock = BigInt(factoryStartBlock);
  const rpcUrl = parseLocalRpcUrl(required(env, "RPC_URL"));
  const preview = readLaunchpadPreviewAccess(env);
  const growthVaultDeployer = guard && !preview ? optionalGrowthPin(env, pins) : undefined;
  const baseDeployment = {
    chainId,
    name: preview ? "Private preview · Chain 31337" : "Local Anvil · Base Sepolia fork",
    rpcUrl: preview ? new URL(preview.rpcPath, preview.origin).href : rpcUrl,
    factory: contracts.factory.address,
    poolManager: contracts.poolManager.address,
    positionManager: contracts.positionManager.address,
    universalRouter: contracts.universalRouter.address,
    universalRouterVersion: routerVersion,
    quoter: contracts.quoter.address,
    permit2: contracts.permit2.address,
    stateView: contracts.stateView.address,
    tradingEnabled: env.RMT_LAUNCHPAD_TRADING_ENABLED === "true",
  } as const;
  return {
    deployment: guard ? {
      ...baseDeployment, engineVersion: 2, initializationGuard: guard.address,
    } : baseDeployment,
    contracts,
    guard,
    growthVaultDeployer,
    ...(growthVaultDeployer && env.RMT_LAUNCHPAD_GROWTH_VAULT_TEST_FIXTURE === "true"
      ? { growthVaultTestFixture: true } : {}),
    privateRpcUrl: rpcUrl,
    startBlock,
    databasePath,
    confirmations: 0n,
    // Keep the existing index scope across a router switch so settled launches and checkpoints remain readable.
    scope: [chainId, startBlock, ...contractNames.flatMap((name) => {
      const { address, runtimeHash } = name === "universalRouter" ? launchpadRouterPins["2.0"] : contracts[name];
      return [address, runtimeHash];
    }), ...(guard ? [guard.address, guard.runtimeHash] : []),
      ...(guard ? ["v2"] : [])].join(":").toLowerCase(),
  };
}

export function launchpadRpc(config: LaunchpadRuntime): PublicClient {
  return createPublicClient({ transport: http(config.privateRpcUrl, { timeout: 5_000, retryCount: 1 }), cacheTime: 0 });
}

function assertRuntimeCode(code: `0x${string}` | undefined, pin: ContractPin) {
  if (!code || code === "0x" || keccak256(code).toLowerCase() !== pin.runtimeHash.toLowerCase()) {
    throw new Error("Launchpad runtime bytecode does not match its pinned hash");
  }
}

export async function verifyLaunchpadRuntime(config: LaunchpadRuntime, rpc: PublicClient): Promise<void> {
  const { deployment, contracts, guard, startBlock } = config;
  if ((deployment.engineVersion === 2) !== Boolean(guard)) throw new Error("Launchpad guard configuration mismatch");
  const [chainId, head] = await Promise.all([rpc.getChainId(), rpc.getBlockNumber()]);
  if (chainId !== deployment.chainId || head < startBlock) throw new Error("Launchpad RPC is on the wrong chain or below the deployment block");

  await Promise.all([
    ...contractNames.map(async (name) => assertRuntimeCode(
      await rpc.getCode({ address: contracts[name].address, blockNumber: head }), contracts[name]
    )),
    (async () => {
      const [priorCode, firstCode] = await Promise.all([
        rpc.getCode({ address: deployment.factory, blockNumber: startBlock - 1n }),
        rpc.getCode({ address: deployment.factory, blockNumber: startBlock }),
      ]);
      if (priorCode && priorCode !== "0x") throw new Error("Launchpad factory existed before the declared start block");
      assertRuntimeCode(firstCode, contracts.factory);
    })(),
    ...([
      [deployment.factory, "poolManager", deployment.poolManager],
      [deployment.factory, "positionManager", deployment.positionManager],
      [deployment.factory, "permit2", deployment.permit2],
      [deployment.positionManager, "poolManager", deployment.poolManager],
      [deployment.positionManager, "permit2", deployment.permit2],
      [deployment.universalRouter, "poolManager", deployment.poolManager],
      [deployment.quoter, "poolManager", deployment.poolManager],
      [contracts.stateView.address, "poolManager", deployment.poolManager],
    ] as const).map(async ([address, functionName, expected]) => {
      const value = await rpc.readContract({ address, abi: bindingAbi, functionName, blockNumber: head });
      if (getAddress(value) !== getAddress(expected)) throw new Error("Launchpad dependency binding mismatch");
    }),
    ...(guard ? [verifyGuard(deployment, guard, rpc, startBlock, head)] : []),
    ...(deployment.universalRouterVersion === "2.1.2" ? [verifyRouter212(deployment, rpc, startBlock)] : []),
  ]);
}

export async function verifiedGrowthVaultDeployer(
  config: LaunchpadRuntime, rpc: PublicClient, blockNumber: bigint,
): Promise<Address | undefined> {
  const pin = config.growthVaultDeployer;
  if (!pin || config.deployment.engineVersion !== 2 || blockNumber < config.startBlock) return;
  try {
    const [code, factory] = await Promise.all([
      rpc.getCode({ address: pin.address, blockNumber }),
      rpc.readContract({ address: pin.address, abi: growthVaultDeployerAbi, functionName: "factory", blockNumber }),
    ]);
    assertRuntimeCode(code, pin);
    if (getAddress(factory) === config.deployment.factory) return pin.address;
  } catch { /* An unverified vault must not affect core launch availability. */ }
}

// Public addresses for the two disposable Anvil test accounts used by the growth fixture.
const fixtureReviewers = [
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
] as const;

export async function readBrowserLaunchpadDeployment(config: LaunchpadRuntime, rpc: PublicClient): Promise<NewLaunchDeployment> {
  const { deployment, growthVaultTestFixture } = config;
  if (!growthVaultTestFixture || deployment.engineVersion !== 2) return deployment;
  try {
    const fork = deploymentIdentities.baseSepolia;
    const [chainId, head, anchor, accounts] = await Promise.all([
      rpc.getChainId(), rpc.getBlock({ includeTransactions: false }),
      rpc.getBlock({ blockNumber: BigInt(fork.block), includeTransactions: false }), getAddresses(rpc),
    ]);
    if (chainId !== 31337 || head.number === null || !head.hash
      || anchor.number !== BigInt(fork.block) || anchor.hash !== fork.blockHash
      || !fixtureReviewers.every((reviewer, index) => accounts[index + 1]?.toLowerCase() === reviewer)) return deployment;
    const deployer = await verifiedGrowthVaultDeployer(config, rpc, head.number);
    if (!deployer) return deployment;
    const call = { address: deployer, abi: growthVaultDeployerAbi, blockNumber: head.number };
    const [reviewerA, reviewerB, canonicalHead] = await Promise.all([
      rpc.readContract({ ...call, functionName: "reviewerA" }),
      rpc.readContract({ ...call, functionName: "reviewerB" }),
      rpc.getBlock({ blockNumber: head.number, includeTransactions: false }),
    ]);
    if (canonicalHead.hash === head.hash && reviewerA.toLowerCase() === fixtureReviewers[0]
      && reviewerB.toLowerCase() === fixtureReviewers[1]) return { ...deployment, growthVaultDeployer: deployer };
  } catch { /* Unsupported pricing and unavailable test reviewers leave ordinary launches available. */ }
  return deployment;
}

async function verifyRouter212(deployment: NewLaunchDeployment, rpc: PublicClient, startBlock: bigint) {
  const { block, blockHash } = deploymentIdentities.baseSepolia;
  const pin = launchpadRouterPins["2.1.2"];
  const blockNumber = BigInt(block);
  if (deployment.engineVersion !== 2 || getAddress(deployment.universalRouter) !== pin.address || startBlock <= blockNumber) {
    throw new Error("Universal Router 2.1.2 requires the guarded Base Sepolia fork");
  }
  const [anchor, code] = await Promise.all([
    rpc.getBlock({ blockNumber }), rpc.getCode({ address: pin.address, blockNumber }),
  ]);
  if (anchor.number !== blockNumber || anchor.hash?.toLowerCase() !== blockHash.toLowerCase()) {
    throw new Error("Universal Router 2.1.2 fork anchor mismatch");
  }
  assertRuntimeCode(code, pin);
}

async function verifyGuard(
  deployment: NewLaunchDeployment, guard: ContractPin, rpc: PublicClient, startBlock: bigint, head: bigint,
) {
  if (deployment.engineVersion !== 2 || getAddress(deployment.initializationGuard) !== getAddress(guard.address)) {
    throw new Error("Launchpad guard configuration mismatch");
  }
  const factory = { address: deployment.factory, abi: bindingAbi, blockNumber: head };
  const hook = { address: guard.address, abi: bindingAbi, blockNumber: head };
  const [prior, deployed, current, factoryGuard, factoryGuardHash, hookFactory, hookManager] = await Promise.all([
    rpc.getCode({ address: guard.address, blockNumber: startBlock - 1n }),
    rpc.getCode({ address: guard.address, blockNumber: startBlock }),
    rpc.getCode({ address: guard.address, blockNumber: head }),
    rpc.readContract({ ...factory, functionName: "initializationGuard" }),
    rpc.readContract({ ...factory, functionName: "initializationGuardRuntimeHash" }),
    rpc.readContract({ ...hook, functionName: "factory" }),
    rpc.readContract({ ...hook, functionName: "poolManager" }),
  ]);
  if (prior && prior !== "0x") throw new Error("The initialization guard existed before the factory's declared start block");
  assertRuntimeCode(deployed, guard);
  assertRuntimeCode(current, guard);
  if (getAddress(factoryGuard) !== guard.address || factoryGuardHash.toLowerCase() !== guard.runtimeHash.toLowerCase()
    || getAddress(hookFactory) !== getAddress(deployment.factory) || getAddress(hookManager) !== getAddress(deployment.poolManager)) {
    throw new Error("Launchpad guard dependency binding mismatch");
  }
}

let verified: { key: string; expiresAt: number; promise: Promise<PublicClient> } | undefined;

export function verifiedLaunchpadRpc(config: LaunchpadRuntime): Promise<PublicClient> {
  const key = [config.scope, config.privateRpcUrl, config.contracts.universalRouter.address,
    config.contracts.universalRouter.runtimeHash].join("\n");
  if (verified?.key === key && verified.expiresAt > Date.now()) return verified.promise;
  const rpc = launchpadRpc(config);
  const promise = verifyLaunchpadRuntime(config, rpc).then(() => rpc).catch((error: unknown) => {
    if (verified?.promise === promise) verified = undefined;
    throw error;
  });
  verified = { key, expiresAt: Date.now() + 30_000, promise };
  return promise;
}
