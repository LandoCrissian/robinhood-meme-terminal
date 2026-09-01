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
import { ROBINHOOD_SWAP_ROUTER_02, ROBINHOOD_V3_FACTORY, ROBINHOOD_WETH } from "../uniswap-v4";
import {
  assertRmtExecutionFeeV2Policy,
  configuredRmtExecutionFeeV2Policy,
  type RmtExecutionFeeV2Policy
} from "../vnext/execution-fee-policy-v2";
import { RMT_UNISWAP_V3_V2_POLICY_ID_HASH } from "../vnext/uniswap-v3-fee-executor-v2";
export { RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID } from "../vnext/uniswap-v3-fee-executor-v2";
import {
  ROBINHOOD_UNISWAP_FACTORY_RUNTIME_HASH,
  ROBINHOOD_UNISWAP_ROUTER_RUNTIME_HASH,
  ROBINHOOD_WETH_IMPLEMENTATION,
  ROBINHOOD_WETH_IMPLEMENTATION_RUNTIME_HASH,
  ROBINHOOD_WETH_RUNTIME_HASH,
  verifyVNextUniswapFeeInfrastructure
} from "./vnext-uniswap-fee-executor";

const HASH = /^0x[0-9a-fA-F]{64}$/;
const executorViewAbi = parseAbi([
  "function router() view returns (address)", "function factory() view returns (address)",
  "function weth() view returns (address)", "function wethImplementation() view returns (address)",
  "function treasury() view returns (address)", "function routerRuntimeHash() view returns (bytes32)",
  "function factoryRuntimeHash() view returns (bytes32)", "function wethRuntimeHash() view returns (bytes32)",
  "function wethImplementationRuntimeHash() view returns (bytes32)", "function policyHash() view returns (bytes32)",
  "function policyFromBlock() view returns (uint256)", "function policyBeforeBlock() view returns (uint256)",
  "function currentPolicyBlock() view returns (uint256)", "function POLICY_ID_HASH() view returns (bytes32)",
  "function POLICY_VERSION() view returns (uint256)", "function FEE_BPS() view returns (uint16)"
]);

export type VNextUniswapFeeExecutorV2Config = {
  executor: Address;
  executorRuntimeHash: Hex;
  policy: RmtExecutionFeeV2Policy;
};

export function isVNextUniswapV3V2AuthorizationEnabled(
  env: NodeJS.ProcessEnv = process.env
) {
  const enabled = env.RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED;
  if (enabled === undefined || enabled === "false") return false;
  if (enabled !== "true") {
    throw new Error("RMT Uniswap V3 V2 authorization gate must be exact lowercase true or false.");
  }
  return true;
}

export function requireVNextUniswapV3V2AuthorizationEnabled(
  env: NodeJS.ProcessEnv = process.env
) {
  if (!isVNextUniswapV3V2AuthorizationEnabled(env)) {
    throw new Error("RMT Uniswap V3 V2 wallet authorization is disabled.");
  }
}

export const VNEXT_UNISWAP_V3_V2_RELEASE_SCOPE = "PROOF_WALLET_ONLY" as const;

export function configuredVNextUniswapV3V2ProofWallet(
  env: NodeJS.ProcessEnv = process.env
): Address | null {
  const value = env.RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET?.trim();
  if (!value) return null;
  if (!isAddress(value, { strict: false }) || getAddress(value) === zeroAddress) {
    throw new Error("RMT Uniswap V3 V2 proof wallet must be a valid nonzero EVM address.");
  }
  return getAddress(value);
}

export function isVNextUniswapV3V2ProofWalletRecipient(
  recipient: Address,
  env: NodeJS.ProcessEnv = process.env
) {
  const proofWallet = configuredVNextUniswapV3V2ProofWallet(env);
  return proofWallet !== null && getAddress(recipient) === proofWallet;
}

export function requireVNextUniswapV3V2ProofWalletRecipient(
  recipient: Address,
  env: NodeJS.ProcessEnv = process.env
) {
  if (!isVNextUniswapV3V2ProofWalletRecipient(recipient, env)) {
    throw new Error("RMT Uniswap V3 V2 controlled authorization is restricted to the configured proof wallet.");
  }
}

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`RMT Uniswap V3 V2 execution is configured incompletely (${name}).`);
  return value;
}

export function configuredVNextUniswapFeeExecutorV2(
  env: NodeJS.ProcessEnv = process.env
): VNextUniswapFeeExecutorV2Config | null {
  const enabled = env.RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ENABLED;
  if (enabled === undefined || enabled === "false") return null;
  if (enabled !== "true") throw new Error("RMT Uniswap V3 V2 executor gate must be exact lowercase true or false.");
  const policy = configuredRmtExecutionFeeV2Policy(env);
  if (!policy) throw new Error("RMT Uniswap V3 V2 execution requires an active RMT_EXECUTION_V2 policy.");
  const executorValue = required(env, "RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ADDRESS");
  const runtimeHash = required(env, "RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_RUNTIME_HASH");
  if (!isAddress(executorValue, { strict: false }) || getAddress(executorValue) === zeroAddress || !HASH.test(runtimeHash)) {
    throw new Error("RMT Uniswap V3 V2 execution has an invalid executor identity.");
  }
  return {
    executor: getAddress(executorValue),
    executorRuntimeHash: runtimeHash.toLowerCase() as Hex,
    policy
  };
}

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL
      ?? process.env.RMT_MAINNET_RPC_URL
      ?? process.env.ROBINHOOD_MAINNET_RPC_URL
      ?? process.env.NEXT_PUBLIC_RMT_RPC_URL
      ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 2, timeout: 8_000, batch: { batchSize: 20, wait: 0 } }
  )
});

async function readExecutor<T>(address: Address, functionName: string) {
  return client.readContract({
    address,
    abi: executorViewAbi as never,
    functionName: functionName as never
  }) as Promise<T>;
}

export function assertVNextUniswapV3V2PolicyBlock(input: {
  currentBlock: bigint;
  fromBlock: bigint;
  beforeBlock: bigint;
  requireEffective?: boolean;
}) {
  if (input.beforeBlock !== 0n && input.currentBlock >= input.beforeBlock) {
    throw new Error("RMT Uniswap V3 V2 executor immutable policy or dependency identity changed.");
  }
  if (input.requireEffective !== false && input.currentBlock < input.fromBlock) {
    throw new Error(`RMT_EXECUTION_V2 policy is not effective until block ${input.fromBlock}.`);
  }
  return input.currentBlock >= input.fromBlock;
}

export async function verifyConfiguredVNextUniswapFeeExecutorV2(
  config: VNextUniswapFeeExecutorV2Config,
  options: { requirePolicyEffective?: boolean } = {}
) {
  assertRmtExecutionFeeV2Policy(config.policy);
  // The infrastructure verifier performs the fresh EIP-1967 slot read that
  // binds the WETH proxy to the expected implementation. The executor itself
  // pins both runtimes but cannot read another contract's storage.
  const [infrastructure, code] = await Promise.all([
    verifyVNextUniswapFeeInfrastructure(),
    client.getBytecode({ address: config.executor })
  ]);
  if (!code || keccak256(code).toLowerCase() !== config.executorRuntimeHash.toLowerCase()) {
    throw new Error("RMT Uniswap V3 V2 executor runtime bytecode is not approved.");
  }
  const [
    router, factory, weth, wethImplementation, treasury, routerHash, factoryHash, wethHash,
    wethImplementationHash, policyIdHash, policyVersion, policyHash, feeBps, policyFromBlock,
    policyBeforeBlock, currentPolicyBlock
  ] = await Promise.all([
    readExecutor<Address>(config.executor, "router"),
    readExecutor<Address>(config.executor, "factory"),
    readExecutor<Address>(config.executor, "weth"),
    readExecutor<Address>(config.executor, "wethImplementation"),
    readExecutor<Address>(config.executor, "treasury"),
    readExecutor<Hex>(config.executor, "routerRuntimeHash"),
    readExecutor<Hex>(config.executor, "factoryRuntimeHash"),
    readExecutor<Hex>(config.executor, "wethRuntimeHash"),
    readExecutor<Hex>(config.executor, "wethImplementationRuntimeHash"),
    readExecutor<Hex>(config.executor, "POLICY_ID_HASH"),
    readExecutor<bigint>(config.executor, "POLICY_VERSION"),
    readExecutor<Hex>(config.executor, "policyHash"),
    readExecutor<number>(config.executor, "FEE_BPS"),
    readExecutor<bigint>(config.executor, "policyFromBlock"),
    readExecutor<bigint>(config.executor, "policyBeforeBlock"),
    readExecutor<bigint>(config.executor, "currentPolicyBlock")
  ]);
  if (
    getAddress(router) !== ROBINHOOD_SWAP_ROUTER_02
    || getAddress(factory) !== ROBINHOOD_V3_FACTORY
    || getAddress(weth) !== ROBINHOOD_WETH
    || getAddress(wethImplementation) !== ROBINHOOD_WETH_IMPLEMENTATION
    || getAddress(treasury) !== config.policy.treasury
    || routerHash.toLowerCase() !== ROBINHOOD_UNISWAP_ROUTER_RUNTIME_HASH
    || factoryHash.toLowerCase() !== ROBINHOOD_UNISWAP_FACTORY_RUNTIME_HASH
    || wethHash.toLowerCase() !== ROBINHOOD_WETH_RUNTIME_HASH
    || wethImplementationHash.toLowerCase() !== ROBINHOOD_WETH_IMPLEMENTATION_RUNTIME_HASH
    || policyIdHash.toLowerCase() !== RMT_UNISWAP_V3_V2_POLICY_ID_HASH.toLowerCase()
    || policyVersion !== 2n
    || policyHash.toLowerCase() !== config.policy.policyHash.toLowerCase()
    || Number(feeBps) !== 25
    || policyFromBlock !== BigInt(config.policy.effectiveBoundary.fromBlock)
    || policyBeforeBlock !== BigInt(config.policy.effectiveBoundary.beforeBlock ?? "0")
  ) throw new Error("RMT Uniswap V3 V2 executor immutable policy or dependency identity changed.");
  const policyEffective = assertVNextUniswapV3V2PolicyBlock({
    currentBlock: currentPolicyBlock,
    fromBlock: policyFromBlock,
    beforeBlock: policyBeforeBlock,
    requireEffective: options.requirePolicyEffective
  });
  return {
    ...config,
    infrastructure,
    verifiedAtBlock: currentPolicyBlock.toString(),
    policyEffective
  };
}
