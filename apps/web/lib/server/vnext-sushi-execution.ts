import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { SUSHI_RED_SNWAPPER } from "../sushi";
import { disabledVNextFeeEconomics, type VNextProviderAuthorizationRequest, type VNextProviderVerificationRequest } from "./vnext-provider-adapter";
import { isRobinhoodNativeAsset } from "../vnext/robinhood-assets";
import {
  assertSushiSwapCalldata,
  SUSHI_RED_SNWAPPER_CODE_HASH,
  SUSHI_ROUTE_EXECUTOR,
  SUSHI_ROUTE_EXECUTOR_CODE_HASH
} from "../vnext/sushi-authorization-codec";
import { quoteAndBuildSushiAssetSwap } from "./sushi-trade";

const MAX_UINT256 = (1n << 256n) - 1n;
const WALLET_FEE_CEILING_MULTIPLIER = 3n;
const AUTHORIZATION_LIFETIME_SECONDS = 90n;

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 1, timeout: 12_000 }
  )
});

type SushiExecutionRpc = {
  getBalance(address: Address): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  readBalance(token: Address, owner: Address): Promise<bigint>;
  readAllowance(token: Address, owner: Address): Promise<bigint>;
  call(input: { account: Address; to: Address; data: Hex; value: bigint }): Promise<void>;
  estimateGas(input: { account: Address; to: Address; data: Hex; value: bigint }): Promise<bigint>;
};

export type VNextSushiExecutionDependencies = {
  build: typeof quoteAndBuildSushiAssetSwap;
  rpc: SushiExecutionRpc;
};

const liveDependencies: VNextSushiExecutionDependencies = {
  build: quoteAndBuildSushiAssetSwap,
  rpc: {
    getBalance: (address) => client.getBalance({ address }),
    getGasPrice: () => client.getGasPrice(),
    readBalance: (token, owner) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    readAllowance: (token, owner) => client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, SUSHI_RED_SNWAPPER] }),
    async call(input) { await client.call(input); },
    estimateGas: (input) => client.estimateGas(input)
  }
};

function authorizationDeadline(input: { deadlineSeconds?: bigint; nowMs: number }) {
  const nowSeconds = BigInt(Math.floor(input.nowMs / 1_000));
  const deadline = input.deadlineSeconds ?? nowSeconds + AUTHORIZATION_LIFETIME_SECONDS;
  if (deadline <= nowSeconds + 10n || deadline > nowSeconds + AUTHORIZATION_LIFETIME_SECONDS) {
    throw new Error("The Sushi server authorization expiry is stale or outside the supported window.");
  }
  return deadline;
}

async function evaluateSushiRoute(
  input: VNextProviderVerificationRequest | VNextProviderAuthorizationRequest,
  dependencies: VNextSushiExecutionDependencies
) {
  if (input.chainId !== 4_663) throw new Error("Sushi execution is available only on Robinhood Chain mainnet.");
  const nowMs = "nowMs" in input ? input.nowMs : Date.now();
  const deadline = authorizationDeadline({
    nowMs,
    ...("deadlineSeconds" in input ? { deadlineSeconds: input.deadlineSeconds } : {})
  });
  const inputAsset = getAddress(input.inputAsset);
  const outputAsset = getAddress(input.outputAsset);
  const recipient = getAddress(input.recipient);
  const executable = await dependencies.build({
    inputAsset,
    outputAsset,
    recipient,
    amountIn: input.amountIn,
    protectedOutputFloorAtomic: input.indicativeProtectedOutputFloorAtomic
  });
  if (
    executable.chainId !== 4_663
    || getAddress(executable.inputAsset) !== inputAsset
    || getAddress(executable.outputAsset) !== outputAsset
    || getAddress(executable.recipient) !== recipient
    || getAddress(executable.router) !== SUSHI_RED_SNWAPPER
    || getAddress(executable.executor) !== SUSHI_ROUTE_EXECUTOR
    || executable.amountIn !== input.amountIn.toString()
    || BigInt(executable.quoteOut) <= 0n
    || BigInt(executable.minimumOut) <= 0n
    || BigInt(executable.minimumOut) > BigInt(executable.quoteOut)
    || executable.onchainDeadline !== false
    || BigInt(executable.quoteExpiresAt) * 1_000n <= BigInt(nowMs)
    || BigInt(executable.quoteExpiresAt) * 1_000n > BigInt(nowMs) + AUTHORIZATION_LIFETIME_SECONDS * 1_000n
  ) throw new Error("RMT rejected inconsistent executable Sushi evidence.");
  assertSushiSwapCalldata(executable.calldata, {
    inputAsset,
    outputAsset,
    inputAmountAtomic: input.amountIn.toString(),
    protectedOutputAtomic: executable.minimumOut,
    recipient,
    transactionValueAtomic: executable.value
  });
  const protectedFloor = "protectedOutputFloorAtomic" in input
    ? input.protectedOutputFloorAtomic
    : input.indicativeProtectedOutputFloorAtomic;
  if (BigInt(executable.minimumOut) < protectedFloor) {
    throw new Error("The live Sushi route moved below the protected-output floor.");
  }

  const nativeInput = isRobinhoodNativeAsset(inputAsset);
  const [nativeBalance, gasPrice, tokenState] = await Promise.all([
    dependencies.rpc.getBalance(recipient),
    dependencies.rpc.getGasPrice(),
    nativeInput
      ? Promise.resolve({ balance: 0n, allowance: MAX_UINT256 })
      : Promise.all([
          dependencies.rpc.readBalance(inputAsset, recipient),
          dependencies.rpc.readAllowance(inputAsset, recipient)
        ]).then(([balance, allowance]) => ({ balance, allowance }))
  ]);
  const balance = nativeInput ? nativeBalance : tokenState.balance;
  const allowance = tokenState.allowance;
  const sufficientBalance = balance >= input.amountIn;
  const approvalRequired = !nativeInput && allowance < input.amountIn;
  const approvalCalldata = approvalRequired
    ? encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SUSHI_RED_SNWAPPER, input.amountIn] })
    : null;
  let status: "verified" | "approval_required" | "approval_simulation_failed" | "insufficient_balance" | "insufficient_gas" | "gas_unavailable" | "simulation_failed";
  let exactSimulationPassed = false;
  let nextAction: "approval" | "swap" | null = null;
  let nextActionTarget: Address | null = null;
  let nextActionCalldataHash: Hex | null = null;
  let estimatedGasUnits: bigint | null = null;
  let gasState: "sufficient" | "insufficient" | "unavailable" | "not_checked" = "not_checked";
  if (!sufficientBalance) {
    status = "insufficient_balance";
  } else if (approvalRequired && approvalCalldata) {
    status = "approval_required";
    nextAction = "approval";
    nextActionTarget = inputAsset;
    nextActionCalldataHash = keccak256(approvalCalldata);
    try {
      await dependencies.rpc.call({ account: recipient, to: inputAsset, data: approvalCalldata, value: 0n });
    } catch {
      status = "approval_simulation_failed";
    }
    if (status === "approval_required") {
      try {
        estimatedGasUnits = await dependencies.rpc.estimateGas({ account: recipient, to: inputAsset, data: approvalCalldata, value: 0n });
      } catch {
        status = "gas_unavailable";
        gasState = "unavailable";
      }
    }
  } else {
    const value = BigInt(executable.value);
    try {
      await dependencies.rpc.call({ account: recipient, to: executable.router, data: executable.calldata, value });
      exactSimulationPassed = true;
      status = "verified";
      nextAction = "swap";
      nextActionTarget = executable.router;
      nextActionCalldataHash = keccak256(executable.calldata);
      try {
        estimatedGasUnits = await dependencies.rpc.estimateGas({ account: recipient, to: executable.router, data: executable.calldata, value });
      } catch {
        status = "gas_unavailable";
        gasState = "unavailable";
      }
    } catch {
      status = "simulation_failed";
    }
  }

  const feeCeilingWei = gasPrice * WALLET_FEE_CEILING_MULTIPLIER;
  let gasLimitUnits: bigint | null = null;
  let estimatedNetworkCostWei: bigint | null = null;
  if (estimatedGasUnits !== null) {
    gasLimitUnits = estimatedGasUnits * 120n / 100n;
    estimatedNetworkCostWei = gasLimitUnits * feeCeilingWei;
    gasState = nativeBalance >= BigInt(executable.value) + estimatedNetworkCostWei ? "sufficient" : "insufficient";
    if (gasState === "insufficient") status = "insufficient_gas";
  }

  const evidence = {
    provider: "sushi" as const,
    status,
    chainId: 4_663 as const,
    inputAsset,
    outputAsset,
    inputAmountAtomic: input.amountIn.toString(),
    indicativeProtectedOutputFloorAtomic: input.indicativeProtectedOutputFloorAtomic.toString(),
    expectedOutputAtomic: executable.quoteOut,
    protectedOutputAtomic: executable.minimumOut,
    recipient,
    router: executable.router,
    approvalSpender: SUSHI_RED_SNWAPPER,
    approvalRequired,
    sufficientBalance,
    allowanceAtomic: allowance.toString(),
    balanceAtomic: balance.toString(),
    route: "aggregated" as const,
    fees: [] as number[],
    pools: [] as string[],
    deadline: deadline.toString(),
    calldataHash: keccak256(executable.calldata),
    nextAction,
    nextActionTarget,
    nextActionCalldataHash,
    transactionValueAtomic: executable.value,
    nativeBalanceWei: nativeBalance.toString(),
    gasPriceWei: gasPrice.toString(),
    feeCeilingWei: feeCeilingWei.toString(),
    estimatedGasUnits: estimatedGasUnits?.toString() ?? null,
    gasLimitUnits: gasLimitUnits?.toString() ?? null,
    estimatedNetworkCostWei: estimatedNetworkCostWei?.toString() ?? null,
    estimatedNetworkCostUsdgAtomic: null,
    networkCostValuationSource: null,
    networkCostValuedAtMs: null,
    networkCostValuationExpiresAtMs: null,
    gasState,
    routerRuntimeHash: SUSHI_RED_SNWAPPER_CODE_HASH,
    factoryRuntimeHash: null,
    quoterRuntimeHash: null,
    executor: SUSHI_ROUTE_EXECUTOR,
    executorRuntimeHash: SUSHI_ROUTE_EXECUTOR_CODE_HASH,
    exactSimulationPassed,
    userPaysGas: true as const,
    rmtFeeEnabled: false as const,
    netEconomics: disabledVNextFeeEconomics({
      inputAmountAtomic: input.amountIn.toString(),
      expectedOutputAtomic: executable.quoteOut,
      protectedOutputAtomic: executable.minimumOut
    }),
    feeExecution: null,
    onchainDeadline: false as const,
    freshnessKind: "server_authorization_expiry" as const,
    verifiedAtMs: nowMs,
    expiresAtMs: Number(deadline) * 1_000,
    authorizationReady: false as const
  };
  return { evidence, payloads: { swapCalldata: executable.calldata, approvalCalldata } };
}

export function verifyVNextSushiRoute(input: VNextProviderVerificationRequest, dependencies = liveDependencies) {
  return evaluateSushiRoute(input, dependencies).then(({ evidence }) => evidence);
}

export async function prepareVNextSushiAuthorization(input: VNextProviderAuthorizationRequest, dependencies = liveDependencies) {
  const evaluated = await evaluateSushiRoute(input, dependencies);
  if (evaluated.evidence.status === "approval_required" && evaluated.payloads.approvalCalldata && evaluated.evidence.gasLimitUnits) {
    return {
      evidence: evaluated.evidence,
      transaction: {
        kind: "erc20_approval" as const,
        target: evaluated.evidence.inputAsset,
        data: evaluated.payloads.approvalCalldata,
        value: "0",
        gasLimit: evaluated.evidence.gasLimitUnits
      }
    };
  }
  if (evaluated.evidence.status === "verified" && evaluated.evidence.gasLimitUnits) {
    return {
      evidence: evaluated.evidence,
      transaction: {
        kind: "swap" as const,
        target: evaluated.evidence.router,
        data: evaluated.payloads.swapCalldata,
        value: evaluated.evidence.transactionValueAtomic,
        gasLimit: evaluated.evidence.gasLimitUnits
      }
    };
  }
  throw new Error(`The exact Sushi next action is not ready for wallet authorization (${evaluated.evidence.status}).`);
}
