import {
  createPublicClient,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { ROBINHOOD_SWAP_ROUTER_02, ROBINHOOD_V3_FACTORY, ROBINHOOD_V3_QUOTER, ROBINHOOD_WETH } from "../uniswap-v4";
import { ROBINHOOD_USDG_ADDRESS, isRobinhoodNativeAsset } from "../vnext/robinhood-assets";
import {
  calculateRmtFeeFloor,
  normalizeDisabledRmtFee,
  normalizeInputSideRmtFee,
  normalizeOutputSideRmtFee,
  type RmtNetExecutionEconomics
} from "../vnext/execution-fee-policy";
import {
  createRmtUniswapV3FeeExecution,
  encodeRmtUniswapV3FeeExecution,
  type RmtUniswapV3FeeExecution,
  type RmtUniswapV3FeeRoute
} from "../vnext/uniswap-v3-fee-executor";
import {
  ROBINHOOD_UNISWAP_FACTORY_RUNTIME_HASH,
  ROBINHOOD_UNISWAP_ROUTER_RUNTIME_HASH,
  configuredVNextUniswapFeeExecutor,
  verifyConfiguredVNextUniswapFeeExecutor,
  vNextFeeAssetId
} from "./vnext-uniswap-fee-executor";

const FEES = [100, 500, 3_000, 10_000] as const;
const BPS = 10_000n;
const SLIPPAGE_BPS = 100n;
// The executor rejects deadlines more than five minutes ahead of the current
// block timestamp. Keep the default below that hard ceiling so ordinary RPC,
// server and block-clock drift cannot turn a fresh authorization invalid.
const DEFAULT_AUTHORIZATION_WINDOW_SECONDS = 240n;
const MAX_AUTHORIZATION_WINDOW_SECONDS = 300n;
const MAX_UINT256 = (1n << 256n) - 1n;
// MetaMask currently reserves up to 3x Robinhood Chain's observed gas price for
// EIP-1559 transactions. Match that wallet-side ceiling so RMT never labels a
// balance sufficient only for the final wallet review to reject it.
const WALLET_FEE_CEILING_MULTIPLIER = 3n;
const ROUTER_RUNTIME_HASH = ROBINHOOD_UNISWAP_ROUTER_RUNTIME_HASH;
const FACTORY_RUNTIME_HASH = ROBINHOOD_UNISWAP_FACTORY_RUNTIME_HASH;
const QUOTER_RUNTIME_HASH = "0x3db0868d945e9304c9bc6a8b2181948109ea617647142f3c4083e14393496a28";
const factoryAbi = [{
  type: "function",
  name: "getPool",
  stateMutability: "view",
  inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "fee", type: "uint24" }],
  outputs: [{ name: "pool", type: "address" }]
}] as const;
const quoterAbi = [{
  type: "function",
  name: "quoteExactInputSingle",
  stateMutability: "nonpayable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "fee", type: "uint24" },
    { name: "sqrtPriceLimitX96", type: "uint160" }
  ] }],
  outputs: [
    { name: "amountOut", type: "uint256" },
    { name: "sqrtPriceX96After", type: "uint160" },
    { name: "initializedTicksCrossed", type: "uint32" },
    { name: "gasEstimate", type: "uint256" }
  ]
}, {
  type: "function",
  name: "quoteExactInput",
  stateMutability: "nonpayable",
  inputs: [{ name: "path", type: "bytes" }, { name: "amountIn", type: "uint256" }],
  outputs: [
    { name: "amountOut", type: "uint256" },
    { name: "sqrtPriceX96AfterList", type: "uint160[]" },
    { name: "initializedTicksCrossedList", type: "uint32[]" },
    { name: "gasEstimate", type: "uint256" }
  ]
}] as const;
const routerAbi = [{
  type: "function",
  name: "exactInputSingle",
  stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "recipient", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" },
    { name: "sqrtPriceLimitX96", type: "uint160" }
  ] }],
  outputs: [{ name: "amountOut", type: "uint256" }]
}, {
  type: "function",
  name: "exactInput",
  stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "path", type: "bytes" },
    { name: "recipient", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" }
  ] }],
  outputs: [{ name: "amountOut", type: "uint256" }]
}, {
  type: "function",
  name: "multicall",
  stateMutability: "payable",
  inputs: [{ name: "deadline", type: "uint256" }, { name: "data", type: "bytes[]" }],
  outputs: [{ name: "results", type: "bytes[]" }]
}] as const;

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

async function requireRuntimeHash(address: Address, expectedHash: Hex, label: string) {
  const code = await client.getBytecode({ address });
  if (!code || keccak256(code) !== expectedHash) throw new Error(`${label} runtime bytecode is not approved.`);
  return expectedHash;
}

export async function quoteVNextUniswapDirect(input: {
  inputAsset: Address;
  outputAsset: Address;
  amountIn: bigint;
}) {
  if (input.amountIn <= 0n) throw new Error("Trade amount must be positive.");
  const inputAsset = getAddress(input.inputAsset);
  const outputAsset = getAddress(input.outputAsset);
  if (inputAsset === outputAsset) throw new Error("Input and output assets must differ.");
  await Promise.all([
    requireRuntimeHash(ROBINHOOD_V3_FACTORY, FACTORY_RUNTIME_HASH, "Uniswap factory"),
    requireRuntimeHash(ROBINHOOD_V3_QUOTER, QUOTER_RUNTIME_HASH, "Uniswap quoter")
  ]);

  const poolsForPair = async (tokenA: Address, tokenB: Address) => {
    const pools = await Promise.all(FEES.map(async (fee) => ({
      fee,
      pool: await client.readContract({
        address: ROBINHOOD_V3_FACTORY,
        abi: factoryAbi,
        functionName: "getPool",
        args: [tokenA, tokenB, fee]
      })
    })));
    const verified = await Promise.all(pools
      .filter((candidate) => candidate.pool !== zeroAddress)
      .map(async (candidate) => ({ ...candidate, code: await client.getBytecode({ address: candidate.pool }) })));
    return verified.filter((candidate) => Boolean(candidate.code));
  };

  type QuoteResult = { route: "direct" | "weth_hop"; fees: number[]; pools: Address[]; quoteOut: bigint; gasEstimate: bigint };
  const results: PromiseSettledResult<QuoteResult>[] = [];
  const directPools = await poolsForPair(inputAsset, outputAsset);
  results.push(...await Promise.allSettled(directPools.map(async (candidate): Promise<QuoteResult> => {
    const quote = await client.simulateContract({
        address: ROBINHOOD_V3_QUOTER,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: inputAsset, tokenOut: outputAsset, amountIn: input.amountIn, fee: candidate.fee, sqrtPriceLimitX96: 0n }]
      });
    if (quote.result[0] <= 0n) throw new Error("Uniswap pool quote is unavailable.");
    return { route: "direct", fees: [candidate.fee], pools: [getAddress(candidate.pool)], quoteOut: quote.result[0], gasEstimate: quote.result[3] };
  })));

  if (inputAsset !== ROBINHOOD_WETH && outputAsset !== ROBINHOOD_WETH) {
    const [firstHop, secondHop] = await Promise.all([
      poolsForPair(inputAsset, ROBINHOOD_WETH),
      poolsForPair(ROBINHOOD_WETH, outputAsset)
    ]);
    const paths = firstHop.flatMap((first) => secondHop.map((second) => ({ first, second })));
    results.push(...await Promise.allSettled(paths.map(async ({ first, second }): Promise<QuoteResult> => {
      const path = encodePacked(
        ["address", "uint24", "address", "uint24", "address"],
        [inputAsset, first.fee, ROBINHOOD_WETH, second.fee, outputAsset]
      );
      const quote = await client.simulateContract({
        address: ROBINHOOD_V3_QUOTER,
        abi: quoterAbi,
        functionName: "quoteExactInput",
        args: [path, input.amountIn]
      });
      if (quote.result[0] <= 0n) throw new Error("Uniswap multihop quote is unavailable.");
      return {
        route: "weth_hop",
        fees: [first.fee, second.fee],
        pools: [getAddress(first.pool), getAddress(second.pool)],
        quoteOut: quote.result[0],
        gasEstimate: quote.result[3]
      };
    })));
  }

  const valid = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (valid.length === 0) return null;
  const best = valid.sort((left, right) => left.quoteOut === right.quoteOut ? left.gasEstimate < right.gasEstimate ? -1 : 1 : left.quoteOut > right.quoteOut ? -1 : 1)[0];
  return {
    ...best,
    inputAsset,
    outputAsset,
    amountIn: input.amountIn,
    minimumOut: best.quoteOut * (BPS - SLIPPAGE_BPS) / BPS
  };
}

async function vNextUniswapFeeContext(input: {
  requestedInputAsset: Address;
  routedInputAsset: Address;
  outputAsset: Address;
  userGrossInput: bigint;
}) {
  const configured = configuredVNextUniswapFeeExecutor();
  if (!configured) return null;
  const verified = await verifyConfiguredVNextUniswapFeeExecutor(configured);
  const inputAssetId = vNextFeeAssetId(input.routedInputAsset, isRobinhoodNativeAsset(input.requestedInputAsset));
  const outputAssetId = vNextFeeAssetId(input.outputAsset, false);
  const inputEligible = configured.policy.eligibleSettlementAssetIds.includes(inputAssetId);
  const outputEligible = configured.policy.eligibleSettlementAssetIds.includes(outputAssetId);
  if (!inputEligible && !outputEligible) return { verified, feeSide: null as null, inputAssetId, outputAssetId };
  const feeSide = inputEligible ? "input" as const : "output" as const;
  const providerInput = feeSide === "input"
    ? input.userGrossInput - BigInt(calculateRmtFeeFloor(input.userGrossInput.toString(), configured.policy.feeBps))
    : input.userGrossInput;
  if (providerInput <= 0n) throw new Error("The configured RMT fee leaves no executable provider input.");
  return { verified, feeSide, inputAssetId, outputAssetId, providerInput };
}

export async function quoteVNextUniswapForUser(input: {
  inputAsset: Address;
  outputAsset: Address;
  userGrossInput: bigint;
}) {
  const requestedInputAsset = getAddress(input.inputAsset);
  const outputAsset = getAddress(input.outputAsset);
  const routedInputAsset = isRobinhoodNativeAsset(requestedInputAsset) ? ROBINHOOD_WETH : requestedInputAsset;
  const feeContext = await vNextUniswapFeeContext({
    requestedInputAsset,
    routedInputAsset,
    outputAsset,
    userGrossInput: input.userGrossInput
  });
  const providerInput = feeContext?.feeSide ? feeContext.providerInput : input.userGrossInput;
  const quote = await quoteVNextUniswapDirect({ inputAsset: routedInputAsset, outputAsset, amountIn: providerInput });
  if (!quote) return null;
  let netEconomics: RmtNetExecutionEconomics;
  if (feeContext?.feeSide === "input") {
    netEconomics = normalizeInputSideRmtFee({
      policy: feeContext.verified.policy,
      inputAssetId: feeContext.inputAssetId,
      outputAssetId: feeContext.outputAssetId,
      feeAssetId: feeContext.inputAssetId,
      settlementMode: "rmt-direct-executor-v1",
      userGrossInputAtomic: input.userGrossInput.toString(),
      providerGrossExpectedOutputAtomic: quote.quoteOut.toString(),
      providerProtectedOutputAtomic: quote.minimumOut.toString()
    });
  } else if (feeContext?.feeSide === "output") {
    netEconomics = normalizeOutputSideRmtFee({
      policy: feeContext.verified.policy,
      inputAssetId: feeContext.inputAssetId,
      outputAssetId: feeContext.outputAssetId,
      feeAssetId: feeContext.outputAssetId,
      settlementMode: "rmt-direct-executor-v1",
      userGrossInputAtomic: input.userGrossInput.toString(),
      providerGrossExpectedOutputAtomic: quote.quoteOut.toString(),
      providerProtectedOutputAtomic: quote.minimumOut.toString()
    });
  } else {
    netEconomics = normalizeDisabledRmtFee({
      userGrossInputAtomic: input.userGrossInput.toString(),
      providerGrossExpectedOutputAtomic: quote.quoteOut.toString(),
      providerProtectedOutputAtomic: quote.minimumOut.toString(),
      reason: feeContext ? "execution_not_eligible" : "policy_not_configured"
    });
  }
  return { quote, netEconomics, feeContext };
}

async function evaluateVNextUniswapRoute(input: {
  inputAsset: Address;
  outputAsset: Address;
  amountIn: bigint;
  recipient: Address;
  nowMs?: number;
  deadlineSeconds?: bigint;
  protectedOutputFloorAtomic?: bigint;
  indicativeProtectedOutputFloorAtomic?: bigint;
  executionId?: Hex;
}) {
  const recipient = getAddress(input.recipient);
  const requestedInputAsset = getAddress(input.inputAsset);
  const nativeInput = isRobinhoodNativeAsset(requestedInputAsset);
  const routedInputAsset = nativeInput ? ROBINHOOD_WETH : requestedInputAsset;
  const transactionValue = nativeInput ? input.amountIn : 0n;
  const nowMs = input.nowMs ?? Date.now();
  const [quoted, routerRuntimeHash] = await Promise.all([
    quoteVNextUniswapForUser({ inputAsset: requestedInputAsset, outputAsset: input.outputAsset, userGrossInput: input.amountIn }),
    requireRuntimeHash(ROBINHOOD_SWAP_ROUTER_02, ROUTER_RUNTIME_HASH, "Uniswap router")
  ]);
  if (!quoted) throw new Error("No canonical Uniswap V3 route is available for exact verification.");
  const { quote, netEconomics, feeContext } = quoted;
  const currentSeconds = BigInt(Math.floor(nowMs / 1_000));
  const deadline = input.deadlineSeconds ?? currentSeconds + DEFAULT_AUTHORIZATION_WINDOW_SECONDS;
  if (deadline <= currentSeconds + 30n || deadline > currentSeconds + MAX_AUTHORIZATION_WINDOW_SECONDS) {
    throw new Error("The authorization deadline is stale or outside the supported window.");
  }
  const protectedOutputFloor = input.protectedOutputFloorAtomic ?? 0n;
  if (protectedOutputFloor < 0n) throw new Error("The protected output floor is invalid.");
  if (protectedOutputFloor > BigInt(netEconomics.expectedUserNetOutputAtomic)) {
    throw new Error("The live route moved below the indicative protected-output floor.");
  }
  let routerMinimumGrossOutput = quote.minimumOut;
  if (netEconomics.rmtFee.state === "planned" && netEconomics.rmtFee.feeSide === "output") {
    const grossNeededForContinuity = protectedOutputFloor + BigInt(netEconomics.rmtFee.maximumFeeAtomic);
    if (grossNeededForContinuity > routerMinimumGrossOutput) routerMinimumGrossOutput = grossNeededForContinuity;
  } else if (protectedOutputFloor > routerMinimumGrossOutput) {
    routerMinimumGrossOutput = protectedOutputFloor;
  }
  const finalEconomics = netEconomics.rmtFee.state === "planned"
    ? netEconomics.rmtFee.feeSide === "input"
      ? normalizeInputSideRmtFee({
          policy: feeContext!.verified.policy,
          inputAssetId: feeContext!.inputAssetId,
          outputAssetId: feeContext!.outputAssetId,
          feeAssetId: feeContext!.inputAssetId,
          settlementMode: "rmt-direct-executor-v1",
          userGrossInputAtomic: input.amountIn.toString(),
          providerGrossExpectedOutputAtomic: quote.quoteOut.toString(),
          providerProtectedOutputAtomic: routerMinimumGrossOutput.toString()
        })
      : normalizeOutputSideRmtFee({
          policy: feeContext!.verified.policy,
          inputAssetId: feeContext!.inputAssetId,
          outputAssetId: feeContext!.outputAssetId,
          feeAssetId: feeContext!.outputAssetId,
          settlementMode: "rmt-direct-executor-v1",
          userGrossInputAtomic: input.amountIn.toString(),
          providerGrossExpectedOutputAtomic: quote.quoteOut.toString(),
          providerProtectedOutputAtomic: routerMinimumGrossOutput.toString()
        })
    : normalizeDisabledRmtFee({
        userGrossInputAtomic: input.amountIn.toString(),
        providerGrossExpectedOutputAtomic: quote.quoteOut.toString(),
        providerProtectedOutputAtomic: routerMinimumGrossOutput.toString(),
        reason: netEconomics.rmtFee.reason
      });
  const protectedOutput = BigInt(finalEconomics.protectedUserNetOutputAtomic);
  if (protectedOutput < protectedOutputFloor) throw new Error("The live route weakened protected user output.");
  const path = quote.route === "direct"
    ? null
    : encodePacked(
        ["address", "uint24", "address", "uint24", "address"],
        [quote.inputAsset, quote.fees[0], ROBINHOOD_WETH, quote.fees[1], quote.outputAsset]
      );
  const swap = quote.route === "direct"
    ? encodeFunctionData({
        abi: routerAbi,
        functionName: "exactInputSingle",
        args: [{
          tokenIn: quote.inputAsset,
          tokenOut: quote.outputAsset,
          fee: quote.fees[0],
          recipient,
          amountIn: quote.amountIn,
          amountOutMinimum: routerMinimumGrossOutput,
          sqrtPriceLimitX96: 0n
        }]
      })
    : encodeFunctionData({
        abi: routerAbi,
        functionName: "exactInput",
        args: [{ path: path!, recipient, amountIn: quote.amountIn, amountOutMinimum: routerMinimumGrossOutput }]
      });
  const routerCalldata = encodeFunctionData({
    abi: routerAbi,
    functionName: "multicall",
    args: [deadline, [swap]]
  });
  const feeExecution: RmtUniswapV3FeeExecution | null = finalEconomics.rmtFee.state === "planned"
    ? createRmtUniswapV3FeeExecution({
        executor: feeContext!.verified.executor,
        executorRuntimeHash: feeContext!.verified.executorRuntimeHash,
        executionId: input.executionId ?? (() => { throw new Error("RMT fee execution requires an exact execution ID."); })(),
        policyId: feeContext!.verified.policy.policyId,
        netEconomics: finalEconomics,
        trader: recipient,
        deadline: deadline.toString(),
        routerMinimumGrossOutputAtomic: routerMinimumGrossOutput.toString(),
        route: {
          kind: quote.route === "direct" ? 0 : 1,
          tokenIn: quote.inputAsset,
          tokenOut: quote.outputAsset,
          fee0: quote.fees[0],
          fee1: quote.route === "direct" ? 0 : quote.fees[1],
          pool0: quote.pools[0],
          pool1: quote.route === "direct" ? zeroAddress : quote.pools[1]
        } satisfies RmtUniswapV3FeeRoute
      })
    : null;
  const calldata = feeExecution ? encodeRmtUniswapV3FeeExecution(feeExecution) : routerCalldata;
  const executionTarget = feeExecution?.executor ?? ROBINHOOD_SWAP_ROUTER_02;
  const approvalSpender = feeExecution?.executor ?? ROBINHOOD_SWAP_ROUTER_02;
  const grossInput = input.amountIn;
  const [tokenState, nativeBalance, gasPrice] = await Promise.all([
    nativeInput
      ? Promise.resolve({ balance: 0n, allowance: MAX_UINT256 })
      : Promise.all([
          client.readContract({ address: quote.inputAsset, abi: erc20Abi, functionName: "balanceOf", args: [recipient] }),
          client.readContract({ address: quote.inputAsset, abi: erc20Abi, functionName: "allowance", args: [recipient, approvalSpender] })
        ]).then(([balance, allowance]) => ({ balance, allowance })),
    client.getBalance({ address: recipient }),
    client.getGasPrice()
  ]);
  const balance = nativeInput ? nativeBalance : tokenState.balance;
  const allowance = tokenState.allowance;
  const sufficientBalance = balance >= grossInput;
  const approvalRequired = !nativeInput && allowance < grossInput;
  let simulationPassed = false;
  let status: "verified" | "approval_required" | "insufficient_balance" | "insufficient_gas" | "gas_unavailable" | "simulation_failed";
  let nextAction: "approval" | "swap" | null = null;
  let nextActionTarget: Address | null = null;
  let nextActionCalldataHash: Hex | null = null;
  let approvalCalldata: Hex | null = null;
  let estimatedGasUnits: bigint | null = null;
  let gasLimitUnits: bigint | null = null;
  let estimatedNetworkCostWei: bigint | null = null;
  let estimatedNetworkCostUsdgAtomic: bigint | null = null;
  let networkCostValuationSource: "canonical_uniswap_v3_weth_usdg_quote_plus_1pct" | null = null;
  let networkCostValuedAtMs: number | null = null;
  let networkCostValuationExpiresAtMs: number | null = null;
  const feeCeilingWei = gasPrice * WALLET_FEE_CEILING_MULTIPLIER;
  let gasState: "sufficient" | "insufficient" | "unavailable" | "not_checked" = "not_checked";
  if (!sufficientBalance) {
    status = "insufficient_balance";
  } else if (approvalRequired) {
    status = "approval_required";
    nextAction = "approval";
    nextActionTarget = quote.inputAsset;
    approvalCalldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [approvalSpender, grossInput]
    });
    nextActionCalldataHash = keccak256(approvalCalldata);
    try {
      estimatedGasUnits = await client.estimateGas({ account: recipient, to: quote.inputAsset, data: approvalCalldata, value: 0n });
    } catch {
      gasState = "unavailable";
      status = "gas_unavailable";
    }
  } else {
    try {
      await client.call({ account: recipient, to: executionTarget, data: calldata, value: transactionValue });
      simulationPassed = true;
      status = "verified";
      nextAction = "swap";
      nextActionTarget = executionTarget;
      nextActionCalldataHash = keccak256(calldata);
      try {
        estimatedGasUnits = await client.estimateGas({ account: recipient, to: executionTarget, data: calldata, value: transactionValue });
      } catch {
        gasState = "unavailable";
        status = "gas_unavailable";
      }
    } catch {
      status = "simulation_failed";
    }
  }
  if (estimatedGasUnits !== null) {
    gasLimitUnits = estimatedGasUnits * 120n / 100n;
    estimatedNetworkCostWei = gasLimitUnits * feeCeilingWei;
    gasState = nativeBalance >= transactionValue + estimatedNetworkCostWei ? "sufficient" : "insufficient";
    if (gasState === "insufficient") status = "insufficient_gas";
    try {
      const valuation = await quoteVNextUniswapDirect({
        inputAsset: ROBINHOOD_WETH,
        outputAsset: ROBINHOOD_USDG_ADDRESS,
        amountIn: estimatedNetworkCostWei
      });
      if (valuation) {
        // Round upward so the displayed USDG reserve never understates this
        // conservative wallet-fee ceiling by a fractional atomic unit.
        estimatedNetworkCostUsdgAtomic = (valuation.quoteOut * (BPS + SLIPPAGE_BPS) + BPS - 1n) / BPS;
        networkCostValuationSource = "canonical_uniswap_v3_weth_usdg_quote_plus_1pct";
        networkCostValuedAtMs = nowMs;
        networkCostValuationExpiresAtMs = Math.min(Number(deadline) * 1_000, nowMs + 30_000);
      }
    } catch {
      // USDG valuation is advisory evidence. Exact gas readiness remains onchain.
    }
  }
  return { evidence: {
    provider: "uniswap-v3" as const,
    status,
    chainId: 4_663 as const,
    inputAsset: requestedInputAsset,
    outputAsset: quote.outputAsset,
    inputAmountAtomic: grossInput.toString(),
    indicativeProtectedOutputFloorAtomic: (input.indicativeProtectedOutputFloorAtomic ?? protectedOutputFloor).toString(),
    expectedOutputAtomic: finalEconomics.expectedUserNetOutputAtomic,
    protectedOutputAtomic: protectedOutput.toString(),
    recipient,
    router: ROBINHOOD_SWAP_ROUTER_02,
    approvalSpender,
    approvalRequired,
    sufficientBalance,
    allowanceAtomic: allowance.toString(),
    balanceAtomic: balance.toString(),
    route: quote.route,
    fees: quote.fees,
    pools: quote.pools,
    deadline: deadline.toString(),
    calldataHash: keccak256(calldata),
    nextAction,
    nextActionTarget,
    nextActionCalldataHash,
    transactionValueAtomic: transactionValue.toString(),
    nativeBalanceWei: nativeBalance.toString(),
    gasPriceWei: gasPrice.toString(),
    feeCeilingWei: feeCeilingWei.toString(),
    estimatedGasUnits: estimatedGasUnits?.toString() ?? null,
    gasLimitUnits: gasLimitUnits?.toString() ?? null,
    estimatedNetworkCostWei: estimatedNetworkCostWei?.toString() ?? null,
    estimatedNetworkCostUsdgAtomic: estimatedNetworkCostUsdgAtomic?.toString() ?? null,
    networkCostValuationSource,
    networkCostValuedAtMs,
    networkCostValuationExpiresAtMs,
    gasState,
    routerRuntimeHash,
    factoryRuntimeHash: FACTORY_RUNTIME_HASH,
    quoterRuntimeHash: QUOTER_RUNTIME_HASH,
    exactSimulationPassed: simulationPassed,
    userPaysGas: true,
    rmtFeeEnabled: feeExecution !== null,
    netEconomics: finalEconomics,
    feeExecution,
    verifiedAtMs: nowMs,
    expiresAtMs: Number(deadline) * 1_000,
    authorizationReady: false as const
  }, payloads: { swapCalldata: calldata, approvalCalldata } };
}

export async function verifyVNextUniswapRoute(input: {
  inputAsset: Address;
  outputAsset: Address;
  amountIn: bigint;
  recipient: Address;
  protectedOutputFloorAtomic: bigint;
  indicativeProtectedOutputFloorAtomic: bigint;
  executionId?: Hex;
  nowMs?: number;
}) {
  return (await evaluateVNextUniswapRoute(input)).evidence;
}

export async function prepareVNextUniswapAuthorization(input: {
  inputAsset: Address;
  outputAsset: Address;
  amountIn: bigint;
  recipient: Address;
  deadlineSeconds: bigint;
  protectedOutputFloorAtomic: bigint;
  indicativeProtectedOutputFloorAtomic: bigint;
  executionId?: Hex;
  nowMs?: number;
}) {
  const evaluated = await evaluateVNextUniswapRoute(input);
  const { evidence, payloads } = evaluated;
  if (evidence.status === "approval_required" && payloads.approvalCalldata && evidence.gasLimitUnits) {
    return {
      evidence,
      transaction: {
        kind: "erc20_approval" as const,
        target: evidence.inputAsset,
        data: payloads.approvalCalldata,
        value: "0" as const,
        gasLimit: evidence.gasLimitUnits
      }
    };
  }
  if (evidence.status === "verified" && evidence.gasLimitUnits) {
    return {
      evidence,
      transaction: {
        kind: "swap" as const,
        target: evidence.nextActionTarget!,
        data: payloads.swapCalldata,
        value: evidence.transactionValueAtomic,
        gasLimit: evidence.gasLimitUnits
      }
    };
  }
  throw new Error(`The exact next action is not ready for wallet authorization (${evidence.status}).`);
}
