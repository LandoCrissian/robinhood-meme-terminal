import { isAbsolute } from "node:path";
import { createPublicClient, getAddress, http, isAddress, isHash, keccak256, parseAbi, zeroAddress, type Address, type Hash, type PublicClient } from "viem";
import deploymentIdentities from "../../../../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json";
import type { NewLaunchDeployment } from "../launchpad/launch-record";

const contractNames = ["factory", "poolManager", "positionManager", "universalRouter", "quoter", "permit2", "stateView"] as const;
type ContractName = typeof contractNames[number];
type ContractPin = { address: Address; runtimeHash: Hash };
type ContractPins = Record<ContractName, ContractPin>;

const bindingAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function permit2() view returns (address)",
]);

type Environment = Record<string, string | undefined>;
export type LaunchpadRuntime = {
  deployment: NewLaunchDeployment;
  contracts: ContractPins;
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
  if (env.RMT_LAUNCHPAD_ENABLED !== "true" || (env.VERCEL === "1" || Boolean(env.VERCEL_ENV))) return null;
  if (required(env, "CHAIN_ID") !== "31337") throw new Error("Only the local launchpad factory is enabled");
  const chainId = 31337;
  const contracts: ContractPins = {
    factory: readPin(env, "FACTORY"),
    poolManager: fixturePin("poolManager"),
    positionManager: fixturePin("positionManager"),
    universalRouter: fixturePin("universalRouter"),
    quoter: fixturePin("quoter"),
    permit2: fixturePin("permit2"),
    stateView: fixturePin("stateView"),
  };
  if (new Set(contractNames.map((name) => contracts[name].address.toLowerCase())).size !== contractNames.length) {
    throw new Error("Launchpad contract addresses must be distinct");
  }
  const factoryStartBlock = required(env, "FACTORY_START_BLOCK");
  const databasePath = required(env, "DATABASE_PATH");
  if (!/^[1-9]\d{0,14}$/.test(factoryStartBlock) || !isAbsolute(databasePath)) throw new Error("Invalid launchpad block or database path");
  const startBlock = BigInt(factoryStartBlock);
  const rpcUrl = parseLocalRpcUrl(required(env, "RPC_URL"));
  return {
    deployment: {
      chainId,
      name: "Local Anvil · Base Sepolia fork",
      rpcUrl,
      factory: contracts.factory.address,
      poolManager: contracts.poolManager.address,
      positionManager: contracts.positionManager.address,
      universalRouter: contracts.universalRouter.address,
      quoter: contracts.quoter.address,
      permit2: contracts.permit2.address,
      stateView: contracts.stateView.address,
      tradingEnabled: env.RMT_LAUNCHPAD_TRADING_ENABLED === "true",
    },
    contracts,
    privateRpcUrl: rpcUrl,
    startBlock,
    databasePath,
    confirmations: 0n,
    scope: [chainId, startBlock, ...contractNames.flatMap((name) => [contracts[name].address, contracts[name].runtimeHash])].join(":").toLowerCase(),
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
  const { deployment, contracts, startBlock } = config;
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
  ]);
}

let verified: { key: string; expiresAt: number; promise: Promise<PublicClient> } | undefined;

export function verifiedLaunchpadRpc(config: LaunchpadRuntime): Promise<PublicClient> {
  const key = `${config.scope}\n${config.privateRpcUrl}`;
  if (verified?.key === key && verified.expiresAt > Date.now()) return verified.promise;
  const rpc = launchpadRpc(config);
  const promise = verifyLaunchpadRuntime(config, rpc).then(() => rpc).catch((error: unknown) => {
    if (verified?.promise === promise) verified = undefined;
    throw error;
  });
  verified = { key, expiresAt: Date.now() + 30_000, promise };
  return promise;
}
