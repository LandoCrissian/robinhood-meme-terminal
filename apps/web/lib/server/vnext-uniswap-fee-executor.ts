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
  assertRmtExecutionFeePolicy,
  createRmtExecutionV1Policy,
  type RmtExecutionFeePolicy
} from "../vnext/execution-fee-policy";
import { rmtUniswapV3PolicyIdHash } from "../vnext/uniswap-v3-fee-executor";

export const ROBINHOOD_UNISWAP_ROUTER_RUNTIME_HASH = "0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc" as Hex;
export const ROBINHOOD_UNISWAP_FACTORY_RUNTIME_HASH = "0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739" as Hex;
export const ROBINHOOD_WETH_RUNTIME_HASH = "0x57064d366873dbd9e75cd1606c458d6b81dd89a30849b34c07622d87e3053533" as Hex;

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ASSET_ID = /^eip155:4663\/(native|contract:(0x[0-9a-f]{40}))$/;
const executorViewAbi = parseAbi([
  "function router() view returns (address)", "function factory() view returns (address)",
  "function weth() view returns (address)", "function treasury() view returns (address)",
  "function routerRuntimeHash() view returns (bytes32)", "function factoryRuntimeHash() view returns (bytes32)",
  "function wethRuntimeHash() view returns (bytes32)", "function policyIdHash() view returns (bytes32)",
  "function policyHash() view returns (bytes32)", "function policyVersion() view returns (uint256)",
  "function policyFromBlock() view returns (uint256)", "function policyBeforeBlock() view returns (uint256)",
  "function policyFeeBps() view returns (uint16)", "function nativeFeeAssetEligible() view returns (bool)",
  "function feeAssetEligible(address feeAsset) view returns (bool)"
]);

export type VNextUniswapFeeExecutorConfig = {
  executor: Address;
  executorRuntimeHash: Hex;
  policy: RmtExecutionFeePolicy;
};

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`RMT fee execution is configured incompletely (${name}).`);
  return value;
}

function blockValue(value: string, label: string, allowZero = false) {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || (!allowZero && BigInt(value) === 0n)) {
    throw new Error(`RMT fee execution has an invalid ${label}.`);
  }
  return value;
}

export function configuredVNextUniswapFeeExecutor(
  env: NodeJS.ProcessEnv = process.env
): VNextUniswapFeeExecutorConfig | null {
  const policyEnabled = env.RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED === "true";
  const providerEnabled = env.RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED === "true";
  if (!policyEnabled && !providerEnabled) return null;
  if (!policyEnabled || !providerEnabled) {
    throw new Error("RMT fee execution requires both the policy and provider authorization gates.");
  }
  const executorValue = required(env, "RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_ADDRESS");
  const runtimeHash = required(env, "RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH");
  const treasury = required(env, "RMT_VNEXT_EXECUTION_FEE_TREASURY");
  const fromBlock = blockValue(required(env, "RMT_VNEXT_EXECUTION_FEE_POLICY_FROM_BLOCK"), "policy start block");
  const beforeRaw = env.RMT_VNEXT_EXECUTION_FEE_POLICY_BEFORE_BLOCK?.trim();
  const beforeBlock = beforeRaw ? blockValue(beforeRaw, "policy end block") : null;
  const assetIds = required(env, "RMT_VNEXT_EXECUTION_FEE_SETTLEMENT_ASSET_IDS")
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!isAddress(executorValue, { strict: false }) || getAddress(executorValue) === zeroAddress || !HASH.test(runtimeHash)) {
    throw new Error("RMT fee execution has an invalid executor identity.");
  }
  if (assetIds.length === 0 || assetIds.some((assetId) => !ASSET_ID.test(assetId))) {
    throw new Error("RMT fee execution has an invalid chain-qualified settlement-asset registry.");
  }
  const policy = createRmtExecutionV1Policy({
    treasury,
    chainId: 4_663,
    fromBlock,
    beforeBlock,
    eligibleSettlementAssetIds: assetIds
  });
  assertRmtExecutionFeePolicy(policy);
  return {
    executor: getAddress(executorValue),
    executorRuntimeHash: runtimeHash.toLowerCase() as Hex,
    policy
  };
}

function contractAddressFromAssetId(assetId: string) {
  const match = ASSET_ID.exec(assetId);
  if (!match) throw new Error("RMT fee policy contains an invalid asset identity.");
  return match[1] === "native" ? null : getAddress(match[2]);
}

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_MAINNET_RPC_URL
      ?? process.env.ROBINHOOD_MAINNET_RPC_URL
      ?? process.env.NEXT_PUBLIC_RMT_RPC_URL
      ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 2, timeout: 8_000, batch: { batchSize: 20, wait: 0 } }
  )
});

async function readExecutor<T>(address: Address, functionName: string, args?: readonly unknown[]) {
  return client.readContract({
    address,
    abi: executorViewAbi as never,
    functionName: functionName as never,
    ...(args ? { args: args as never } : {})
  }) as Promise<T>;
}

export async function verifyConfiguredVNextUniswapFeeExecutor(
  config: VNextUniswapFeeExecutorConfig
) {
  const code = await client.getBytecode({ address: config.executor });
  if (!code || keccak256(code).toLowerCase() !== config.executorRuntimeHash.toLowerCase()) {
    throw new Error("RMT fee executor runtime bytecode is not approved.");
  }
  const policy = config.policy;
  const [
    router, factory, weth, treasury, routerHash, factoryHash, wethHash,
    policyIdHash, policyVersion, policyHash, policyFeeBps, policyFromBlock,
    policyBeforeBlock, nativeEligible, currentBlock
  ] = await Promise.all([
    readExecutor<Address>(config.executor, "router"),
    readExecutor<Address>(config.executor, "factory"),
    readExecutor<Address>(config.executor, "weth"),
    readExecutor<Address>(config.executor, "treasury"),
    readExecutor<Hex>(config.executor, "routerRuntimeHash"),
    readExecutor<Hex>(config.executor, "factoryRuntimeHash"),
    readExecutor<Hex>(config.executor, "wethRuntimeHash"),
    readExecutor<Hex>(config.executor, "policyIdHash"),
    readExecutor<bigint>(config.executor, "policyVersion"),
    readExecutor<Hex>(config.executor, "policyHash"),
    readExecutor<number>(config.executor, "policyFeeBps"),
    readExecutor<bigint>(config.executor, "policyFromBlock"),
    readExecutor<bigint>(config.executor, "policyBeforeBlock"),
    readExecutor<boolean>(config.executor, "nativeFeeAssetEligible"),
    client.getBlockNumber()
  ]);
  if (
    getAddress(router) !== ROBINHOOD_SWAP_ROUTER_02
    || getAddress(factory) !== ROBINHOOD_V3_FACTORY
    || getAddress(weth) !== ROBINHOOD_WETH
    || getAddress(treasury) !== policy.treasury
    || routerHash.toLowerCase() !== ROBINHOOD_UNISWAP_ROUTER_RUNTIME_HASH
    || factoryHash.toLowerCase() !== ROBINHOOD_UNISWAP_FACTORY_RUNTIME_HASH
    || wethHash.toLowerCase() !== ROBINHOOD_WETH_RUNTIME_HASH
    || policyIdHash.toLowerCase() !== rmtUniswapV3PolicyIdHash(policy.policyId).toLowerCase()
    || policyVersion !== BigInt(policy.version)
    || policyHash.toLowerCase() !== policy.policyHash.toLowerCase()
    || Number(policyFeeBps) !== policy.feeBps
    || policyFromBlock !== BigInt(policy.effectiveBoundary.fromBlock)
    || policyBeforeBlock !== BigInt(policy.effectiveBoundary.beforeBlock ?? "0")
    || currentBlock < policyFromBlock
    || (policyBeforeBlock !== 0n && currentBlock >= policyBeforeBlock)
  ) throw new Error("RMT fee executor immutable policy or dependency identity changed.");

  for (const assetId of policy.eligibleSettlementAssetIds) {
    const asset = contractAddressFromAssetId(assetId);
    if (asset === null) {
      if (!nativeEligible) throw new Error("RMT fee executor rejected the policy's native settlement asset.");
    } else if (!await readExecutor<boolean>(config.executor, "feeAssetEligible", [asset])) {
      throw new Error("RMT fee executor rejected a policy settlement asset.");
    }
  }
  return { ...config, verifiedAtBlock: currentBlock.toString() };
}

export function vNextFeeAssetId(address: Address, native: boolean) {
  return native
    ? "eip155:4663/native"
    : `eip155:4663/contract:${getAddress(address).toLowerCase()}`;
}
