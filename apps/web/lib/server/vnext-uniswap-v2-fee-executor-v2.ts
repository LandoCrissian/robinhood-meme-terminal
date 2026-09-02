import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { ROBINHOOD_WETH } from "../uniswap-v4";
import {
  assertRmtExecutionFeeV2Policy,
  configuredRmtExecutionFeeV2Policy,
  type RmtExecutionFeeV2Policy
} from "../vnext/execution-fee-policy-v2";
import {
  ROBINHOOD_UNISWAP_V2_FACTORY,
  ROBINHOOD_UNISWAP_V2_FACTORY_RUNTIME_HASH,
  ROBINHOOD_UNISWAP_V2_PAIR_RUNTIME_HASH,
  ROBINHOOD_UNISWAP_V2_ROUTER,
  ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH
} from "../vnext/uniswap-v2-authorization-codec";
import {
  RMT_UNISWAP_V2_V2_POLICY_ID_HASH,
  RMT_UNISWAP_V2_V2_PROVIDER_ID
} from "../vnext/uniswap-v2-fee-executor-v2";
import {
  ROBINHOOD_WETH_RUNTIME_HASH,
  assertVNextRobinhoodBlockContext,
  verifyCanonicalRobinhoodWethAuthority,
  type VNextRobinhoodWethAuthorityClient
} from "./vnext-robinhood-weth-authority";

const routerDependencyAbi = parseAbi([
  "function factory() view returns (address)",
  "function WETH() view returns (address)"
]);
const executorViewAbi = parseAbi([
  "function router() view returns (address)", "function factory() view returns (address)",
  "function weth() view returns (address)", "function treasury() view returns (address)",
  "function routerRuntimeHash() view returns (bytes32)", "function factoryRuntimeHash() view returns (bytes32)",
  "function pairRuntimeHash() view returns (bytes32)", "function wethRuntimeHash() view returns (bytes32)",
  "function policyHash() view returns (bytes32)", "function policyFromBlock() view returns (uint256)",
  "function policyBeforeBlock() view returns (uint256)", "function currentPolicyBlock() view returns (uint256)",
  "function CHAIN_ID() view returns (uint256)", "function FEE_BPS() view returns (uint16)",
  "function POLICY_ID_HASH() view returns (bytes32)", "function POLICY_VERSION() view returns (uint256)",
  "function PROVIDER_ID() view returns (bytes32)"
]);

type ReadContractInput = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  blockNumber: bigint;
};

export type VNextUniswapV2FeeAuthorityClient = VNextRobinhoodWethAuthorityClient & {
  readContract(input: ReadContractInput): Promise<unknown>;
};

export type VNextUniswapV2FeeExecutorV2Config = {
  executor: Address;
  executorRuntimeHash: Hex;
  policy: RmtExecutionFeeV2Policy;
};

export type VNextUniswapV2V2ReleaseScope = "DISABLED" | "PROOF_WALLET_ONLY" | "PUBLIC";
const HASH = /^0x[0-9a-fA-F]{64}$/;

export const RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR = getAddress("0xB4bF1d99a3BF9201f8197682dcD2bF97725D6230");
export const RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH = "0x3a0518035f7a47c752eba630e02db8a72b14c175977fbfcbf6d708ea1a36c647" as Hex;

function exactBoolean(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name];
  if (value === undefined || value === "false") return false;
  if (value !== "true") throw new Error(`${name} must be exact lowercase true or false.`);
  return true;
}

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`RMT Uniswap V2 V2 execution is configured incompletely (${name}).`);
  return value;
}

export function isVNextUniswapV2V2AuthorizationEnabled(env: NodeJS.ProcessEnv = process.env) {
  return exactBoolean(env, "RMT_VNEXT_UNISWAP_V2_V2_AUTHORIZATION_ENABLED");
}

export function isVNextUniswapV2V2PublicAuthorizationEnabled(env: NodeJS.ProcessEnv = process.env) {
  return exactBoolean(env, "RMT_VNEXT_UNISWAP_V2_V2_PUBLIC_AUTHORIZATION_ENABLED");
}

export function configuredVNextUniswapV2V2ProofWallet(env: NodeJS.ProcessEnv = process.env): Address | null {
  const value = env.RMT_VNEXT_UNISWAP_V2_V2_PROOF_WALLET?.trim();
  if (!value) return null;
  if (!isAddress(value, { strict: false }) || getAddress(value) === zeroAddress) {
    throw new Error("RMT Uniswap V2 V2 proof wallet must be a valid nonzero EVM address.");
  }
  return getAddress(value);
}

export function configuredVNextUniswapV2V2ReleaseScope(env: NodeJS.ProcessEnv = process.env): VNextUniswapV2V2ReleaseScope {
  if (!isVNextUniswapV2V2AuthorizationEnabled(env)) return "DISABLED";
  return isVNextUniswapV2V2PublicAuthorizationEnabled(env) ? "PUBLIC" : "PROOF_WALLET_ONLY";
}

export function isVNextUniswapV2V2ReleaseRecipientEligible(recipient: Address, env: NodeJS.ProcessEnv = process.env) {
  const scope = configuredVNextUniswapV2V2ReleaseScope(env);
  if (scope === "DISABLED") return false;
  if (scope === "PUBLIC") return true;
  const proofWallet = configuredVNextUniswapV2V2ProofWallet(env);
  return proofWallet !== null && getAddress(recipient) === proofWallet;
}

export function requireVNextUniswapV2V2ReleaseRecipient(recipient: Address, env: NodeJS.ProcessEnv = process.env) {
  if (!isVNextUniswapV2V2ReleaseRecipientEligible(recipient, env)) {
    throw new Error("RMT Uniswap V2 V2 wallet authorization is unavailable for this recipient and release scope.");
  }
}

export function requireVNextUniswapV2V2AuthorizationEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (!isVNextUniswapV2V2AuthorizationEnabled(env)) {
    throw new Error("RMT Uniswap V2 V2 wallet authorization is disabled.");
  }
}

export function configuredVNextUniswapV2FeeExecutorV2(env: NodeJS.ProcessEnv = process.env): VNextUniswapV2FeeExecutorV2Config | null {
  if (!exactBoolean(env, "RMT_VNEXT_UNISWAP_V2_V2_EXECUTOR_ENABLED")) return null;
  const policy = configuredRmtExecutionFeeV2Policy(env);
  if (!policy) throw new Error("RMT Uniswap V2 V2 execution requires an active RMT_EXECUTION_V2 policy.");
  const executorValue = required(env, "RMT_VNEXT_UNISWAP_V2_V2_EXECUTOR_ADDRESS");
  const runtimeHash = required(env, "RMT_VNEXT_UNISWAP_V2_V2_EXECUTOR_RUNTIME_HASH");
  if (!isAddress(executorValue, { strict: false }) || getAddress(executorValue) === zeroAddress || !HASH.test(runtimeHash)) {
    throw new Error("RMT Uniswap V2 V2 execution has an invalid executor identity.");
  }
  if (getAddress(executorValue) !== RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR
    || runtimeHash.toLowerCase() !== RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH) {
    throw new Error("RMT Uniswap V2 V2 execution does not match the admitted deployment.");
  }
  return { executor: getAddress(executorValue), executorRuntimeHash: runtimeHash.toLowerCase() as Hex, policy };
}

export type VNextUniswapV2FeeExecutorV2LiveIdentity = {
  router: Address;
  factory: Address;
  weth: Address;
  treasury: Address;
  routerRuntimeHash: Hex;
  factoryRuntimeHash: Hex;
  pairRuntimeHash: Hex;
  wethRuntimeHash: Hex;
  policyHash: Hex;
  policyFromBlock: bigint;
  policyBeforeBlock: bigint;
  currentPolicyBlock: bigint;
  chainId: bigint;
  feeBps: number;
  policyIdHash: Hex;
  policyVersion: bigint;
  providerId: Hex;
};

export type VNextUniswapV2FeeInfrastructureEvidence = {
  wethAuthority: Awaited<ReturnType<typeof verifyCanonicalRobinhoodWethAuthority>>;
  routerRuntimeHash: Hex | null;
  factoryRuntimeHash: Hex | null;
  routerFactory: Address;
  routerWeth: Address;
  recheckedBlockNumber: bigint;
  recheckedBlockHash: Hex | null;
};

function rpcUrl() {
  return process.env.RMT_VNEXT_UNISWAP_V2_RPC_URL?.trim()
    || process.env.RMT_MAINNET_RPC_URL?.trim()
    || process.env.ROBINHOOD_MAINNET_RPC_URL?.trim()
    || robinhoodChain.rpcUrls.default.http[0];
}

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(rpcUrl(), { retryCount: 2, timeout: 8_000, batch: { batchSize: 20, wait: 0 } })
});

const liveClient: VNextUniswapV2FeeAuthorityClient = {
  getChainId: () => client.getChainId(),
  getBlockNumber: () => client.getBlockNumber(),
  getBlock: (input) => client.getBlock(input),
  getBytecode: (input) => client.getBytecode(input),
  getStorageAt: (input) => client.getStorageAt(input),
  readContract: (input) => client.readContract(input as never) as Promise<unknown>
};

function requireIdentity(actual: string, expected: string, label: string) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} changed (expected ${expected}, received ${actual}).`);
  }
}

function runtimeHash(code: Hex | undefined, label: string) {
  if (!code || code === "0x") throw new Error(`${label} has no runtime bytecode.`);
  return keccak256(code).toLowerCase() as Hex;
}

async function read<T>(
  authorityClient: VNextUniswapV2FeeAuthorityClient,
  address: Address,
  abi: readonly unknown[],
  functionName: string,
  blockNumber: bigint
) {
  return authorityClient.readContract({ address, abi, functionName, blockNumber }) as Promise<T>;
}

export function assertVNextUniswapV2FeeInfrastructureEvidence(
  evidence: VNextUniswapV2FeeInfrastructureEvidence
) {
  if (!evidence.routerRuntimeHash) throw new Error("Uniswap V2 Router has no runtime bytecode.");
  if (!evidence.factoryRuntimeHash) throw new Error("Uniswap V2 factory has no runtime bytecode.");
  requireIdentity(evidence.routerRuntimeHash, ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH, "Uniswap V2 Router runtime");
  requireIdentity(evidence.factoryRuntimeHash, ROBINHOOD_UNISWAP_V2_FACTORY_RUNTIME_HASH, "Uniswap V2 factory runtime");
  requireIdentity(getAddress(evidence.routerFactory), ROBINHOOD_UNISWAP_V2_FACTORY, "Uniswap V2 Router factory dependency");
  requireIdentity(getAddress(evidence.routerWeth), evidence.wethAuthority.weth, "Uniswap V2 Router WETH dependency");
  if (
    evidence.recheckedBlockNumber !== BigInt(evidence.wethAuthority.verifiedAtBlock)
    || !evidence.recheckedBlockHash
    || evidence.recheckedBlockHash.toLowerCase() !== evidence.wethAuthority.verifiedAtBlockHash.toLowerCase()
  ) {
    throw new Error("Canonical Robinhood Chain verification block changed.");
  }
  return {
    ...evidence.wethAuthority,
    router: ROBINHOOD_UNISWAP_V2_ROUTER,
    routerRuntimeHash: ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH,
    factory: ROBINHOOD_UNISWAP_V2_FACTORY,
    factoryRuntimeHash: ROBINHOOD_UNISWAP_V2_FACTORY_RUNTIME_HASH,
    pairRuntimeHash: ROBINHOOD_UNISWAP_V2_PAIR_RUNTIME_HASH
  };
}

export async function verifyVNextUniswapV2FeeInfrastructure(
  authorityClient: VNextUniswapV2FeeAuthorityClient = liveClient,
  expectedBlock?: { blockNumber: bigint; blockHash: Hex }
) {
  const wethAuthority = await verifyCanonicalRobinhoodWethAuthority(authorityClient, expectedBlock);
  const blockNumber = BigInt(wethAuthority.verifiedAtBlock);
  const [routerCode, factoryCode, routerFactory, routerWeth] = await Promise.all([
    authorityClient.getBytecode({ address: ROBINHOOD_UNISWAP_V2_ROUTER, blockNumber }),
    authorityClient.getBytecode({ address: ROBINHOOD_UNISWAP_V2_FACTORY, blockNumber }),
    read<Address>(authorityClient, ROBINHOOD_UNISWAP_V2_ROUTER, routerDependencyAbi, "factory", blockNumber),
    read<Address>(authorityClient, ROBINHOOD_UNISWAP_V2_ROUTER, routerDependencyAbi, "WETH", blockNumber)
  ]);
  const recheckedBlock = await authorityClient.getBlock({ blockNumber });
  return assertVNextUniswapV2FeeInfrastructureEvidence({
    wethAuthority,
    routerRuntimeHash: routerCode && routerCode !== "0x" ? runtimeHash(routerCode, "Uniswap V2 Router") : null,
    factoryRuntimeHash: factoryCode && factoryCode !== "0x" ? runtimeHash(factoryCode, "Uniswap V2 factory") : null,
    routerFactory,
    routerWeth,
    recheckedBlockNumber: recheckedBlock.number,
    recheckedBlockHash: recheckedBlock.hash
  });
}

export function assertVNextUniswapV2FeeExecutorV2LiveIdentity(
  actual: VNextUniswapV2FeeExecutorV2LiveIdentity,
  config: VNextUniswapV2FeeExecutorV2Config
) {
  assertRmtExecutionFeeV2Policy(config.policy);
  if (
    getAddress(actual.router) !== ROBINHOOD_UNISWAP_V2_ROUTER
    || getAddress(actual.factory) !== ROBINHOOD_UNISWAP_V2_FACTORY
    || getAddress(actual.weth) !== getAddress(ROBINHOOD_WETH)
    || getAddress(actual.treasury) !== getAddress(config.policy.treasury)
    || actual.routerRuntimeHash.toLowerCase() !== ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH.toLowerCase()
    || actual.factoryRuntimeHash.toLowerCase() !== ROBINHOOD_UNISWAP_V2_FACTORY_RUNTIME_HASH.toLowerCase()
    || actual.pairRuntimeHash.toLowerCase() !== ROBINHOOD_UNISWAP_V2_PAIR_RUNTIME_HASH.toLowerCase()
    || actual.wethRuntimeHash.toLowerCase() !== ROBINHOOD_WETH_RUNTIME_HASH.toLowerCase()
    || actual.policyHash.toLowerCase() !== config.policy.policyHash.toLowerCase()
    || actual.policyFromBlock !== BigInt(config.policy.effectiveBoundary.fromBlock)
    || actual.policyBeforeBlock !== BigInt(config.policy.effectiveBoundary.beforeBlock ?? "0")
    || actual.currentPolicyBlock < actual.policyFromBlock
    || (actual.policyBeforeBlock !== 0n && actual.currentPolicyBlock >= actual.policyBeforeBlock)
    || actual.chainId !== 4_663n
    || actual.feeBps !== 25
    || actual.policyIdHash.toLowerCase() !== RMT_UNISWAP_V2_V2_POLICY_ID_HASH.toLowerCase()
    || actual.policyVersion !== 2n
    || actual.providerId.toLowerCase() !== RMT_UNISWAP_V2_V2_PROVIDER_ID.toLowerCase()
  ) {
    throw new Error("RMT Uniswap V2 V2 executor immutable policy or dependency identity changed.");
  }
  return true;
}

/**
 * Dormant future admission verifier. This function does not alter the
 * QUOTE_ONLY registry; a later deployment/admission must call it immediately
 * before producing either an executor approval or swap transaction.
 */
export async function verifyConfiguredVNextUniswapV2FeeExecutorV2(
  config: VNextUniswapV2FeeExecutorV2Config,
  authorityClient: VNextUniswapV2FeeAuthorityClient = liveClient,
  expectedBlock?: { blockNumber: bigint; blockHash: Hex }
) {
  assertRmtExecutionFeeV2Policy(config.policy);
  const infrastructure = await verifyVNextUniswapV2FeeInfrastructure(authorityClient, expectedBlock);
  const blockNumber = BigInt(infrastructure.verifiedAtBlock);
  const code = await authorityClient.getBytecode({ address: config.executor, blockNumber });
  requireIdentity(runtimeHash(code, "RMT Uniswap V2 V2 executor"), config.executorRuntimeHash, "RMT Uniswap V2 V2 executor runtime");

  const [
    router, factory, weth, treasury, routerRuntimeHash, factoryRuntimeHash, pairRuntimeHash,
    wethRuntimeHash, policyHash, policyFromBlock, policyBeforeBlock, currentPolicyBlock,
    chainId, feeBps, policyIdHash, policyVersion, providerId
  ] = await Promise.all([
    read<Address>(authorityClient, config.executor, executorViewAbi, "router", blockNumber),
    read<Address>(authorityClient, config.executor, executorViewAbi, "factory", blockNumber),
    read<Address>(authorityClient, config.executor, executorViewAbi, "weth", blockNumber),
    read<Address>(authorityClient, config.executor, executorViewAbi, "treasury", blockNumber),
    read<Hex>(authorityClient, config.executor, executorViewAbi, "routerRuntimeHash", blockNumber),
    read<Hex>(authorityClient, config.executor, executorViewAbi, "factoryRuntimeHash", blockNumber),
    read<Hex>(authorityClient, config.executor, executorViewAbi, "pairRuntimeHash", blockNumber),
    read<Hex>(authorityClient, config.executor, executorViewAbi, "wethRuntimeHash", blockNumber),
    read<Hex>(authorityClient, config.executor, executorViewAbi, "policyHash", blockNumber),
    read<bigint>(authorityClient, config.executor, executorViewAbi, "policyFromBlock", blockNumber),
    read<bigint>(authorityClient, config.executor, executorViewAbi, "policyBeforeBlock", blockNumber),
    read<bigint>(authorityClient, config.executor, executorViewAbi, "currentPolicyBlock", blockNumber),
    read<bigint>(authorityClient, config.executor, executorViewAbi, "CHAIN_ID", blockNumber),
    read<number>(authorityClient, config.executor, executorViewAbi, "FEE_BPS", blockNumber),
    read<Hex>(authorityClient, config.executor, executorViewAbi, "POLICY_ID_HASH", blockNumber),
    read<bigint>(authorityClient, config.executor, executorViewAbi, "POLICY_VERSION", blockNumber),
    read<Hex>(authorityClient, config.executor, executorViewAbi, "PROVIDER_ID", blockNumber)
  ]);
  assertVNextUniswapV2FeeExecutorV2LiveIdentity({
    router,
    factory,
    weth,
    treasury,
    routerRuntimeHash,
    factoryRuntimeHash,
    pairRuntimeHash,
    wethRuntimeHash,
    policyHash,
    policyFromBlock,
    policyBeforeBlock,
    currentPolicyBlock,
    chainId,
    feeBps: Number(feeBps),
    policyIdHash,
    policyVersion,
    providerId
  }, config);
  requireIdentity(weth, infrastructure.weth, "RMT Uniswap V2 V2 executor WETH dependency");
  await assertVNextRobinhoodBlockContext(authorityClient, blockNumber, infrastructure.verifiedAtBlockHash);
  return {
    ...config,
    infrastructure,
    verifiedAtBlock: infrastructure.verifiedAtBlock,
    verifiedAtBlockHash: infrastructure.verifiedAtBlockHash,
    policyEffective: true as const
  };
}
