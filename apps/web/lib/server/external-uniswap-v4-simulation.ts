import {
  BaseError,
  ExecutionRevertedError,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  toHex,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { z } from "zod";
import type { ExternalV4SellSimulation } from "../external-v4-evidence";
import {
  MAX_UINT160,
  PERMIT2_ADDRESS,
  ROBINHOOD_UNIVERSAL_ROUTER,
  ROBINHOOD_V4_QUOTER,
  ROUTER_AS_RECIPIENT,
  permit2Abi
} from "../uniswap-v4";
import type { VerifiedExternalUniswapV4Market } from "./external-uniswap-v4-market";
import {
  calculateRmtExecutionFee,
  type RmtExecutionFeeConfig
} from "./rmt-execution-fee";

const BLOCKSCOUT = "https://robinhoodchain.blockscout.com";
const MAX_UINT128 = (1n << 128n) - 1n;
const TIMEOUT_MS = 12_000;
const V4_SWAP_ACTIONS = "0x060b0e" as Hex;

const holderSchema = z.object({
  address: z.object({
    hash: z.string(),
    is_scam: z.boolean().optional(),
    is_contract: z.boolean().optional()
  }).passthrough(),
  value: z.string().regex(/^\d+$/)
}).passthrough();
const holdersSchema = z.object({
  items: z.array(holderSchema).max(100)
}).passthrough();
const simulateCallSchema = z.object({
  status: z.string(),
  returnData: z.string().optional()
}).passthrough();
const simulateBlockSchema = z.object({
  number: z.string(),
  calls: z.array(simulateCallSchema).min(1)
}).passthrough();
const simulateResponseSchema = z.object({
  result: z.array(simulateBlockSchema).min(1).optional(),
  error: z.object({ message: z.string().optional() }).passthrough().optional()
}).passthrough();

const v4QuoterAbi = [{
  type: "function",
  name: "quoteExactInputSingle",
  stateMutability: "nonpayable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "poolKey", type: "tuple", components: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" }
    ] },
    { name: "zeroForOne", type: "bool" },
    { name: "exactAmount", type: "uint128" },
    { name: "hookData", type: "bytes" }
  ] }],
  outputs: [
    { name: "amountOut", type: "uint256" },
    { name: "gasEstimate", type: "uint256" }
  ]
}] as const;
const universalRouterAbi = [{
  type: "function",
  name: "execute",
  stateMutability: "payable",
  inputs: [
    { name: "commands", type: "bytes" },
    { name: "inputs", type: "bytes[]" },
    { name: "deadline", type: "uint256" }
  ],
  outputs: []
}] as const;
const exactInputSingleParameters = [{
  type: "tuple",
  components: [
    { name: "poolKey", type: "tuple", components: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" }
    ] },
    { name: "zeroForOne", type: "bool" },
    { name: "amountIn", type: "uint128" },
    { name: "amountOutMinimum", type: "uint128" },
    { name: "minHopPriceX36", type: "uint256" },
    { name: "hookData", type: "bytes" }
  ]
}] as const;

type SimulationDependencies = {
  fetch?: typeof fetch;
  findHolder?: (token: Address) => Promise<{ address: Address; amount: bigint } | null>;
  quote?: (
    market: VerifiedExternalUniswapV4Market,
    holder: Address,
    amountIn: bigint
  ) => Promise<bigint>;
  simulateCalls?: (calls: Array<{ from: Address; to: Address; data: Hex; value?: Hex }>) => Promise<{
    blockNumber: bigint;
    statuses: boolean[];
  }>;
  now?: () => number;
  timeoutMs?: number;
};

const rpcUrl = process.env.RMT_RPC_URL
  ?? process.env.ROBINHOOD_MAINNET_RPC_URL
  ?? process.env.NEXT_PUBLIC_RMT_RPC_URL
  ?? robinhoodChain.rpcUrls.default.http[0];
const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(rpcUrl, { retryCount: 2, timeout: 12_000 })
});

function emptySimulation(status: ExternalV4SellSimulation["status"]): ExternalV4SellSimulation {
  return {
    status,
    method: "holder-permit2-router-sequence",
    holder: null,
    amountIn: null,
    quoteOut: null,
    minimumOut: null,
    testedAtBlock: null,
    calls: {
      tokenApproval: "not-run",
      permit2Approval: "not-run",
      swap: "not-run"
    }
  };
}

function statusLabel(value: boolean | undefined) {
  return value ? "passed" as const : "blocked" as const;
}

async function findHolder(
  token: Address,
  fetcher: typeof fetch,
  timeoutMs: number
): Promise<{ address: Address; amount: bigint } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${BLOCKSCOUT}/api/v2/tokens/${token}/holders`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Holder evidence is unavailable.");
    const payload = holdersSchema.safeParse(await response.json());
    if (!payload.success) throw new Error("Holder evidence is malformed.");
    const candidates = payload.data.items.flatMap((holder) => {
      if (
        holder.address.is_contract !== false
        || holder.address.is_scam === true
        || !/^0x[0-9a-fA-F]{40}$/.test(holder.address.hash)
      ) return [];
      const balance = BigInt(holder.value);
      if (balance <= 0n) return [];
      const probe = balance / 1_000n || 1n;
      return [{
        address: getAddress(holder.address.hash),
        amount: probe > MAX_UINT128 ? MAX_UINT128 : probe
      }];
    });
    return candidates.sort((left, right) => left.amount > right.amount ? -1 : left.amount < right.amount ? 1 : 0)[0] ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

async function quoteSell(
  market: VerifiedExternalUniswapV4Market,
  holder: Address,
  amountIn: bigint
) {
  const zeroForOne = market.poolKey.currency0.toLowerCase() === market.token.toLowerCase();
  const result = await client.simulateContract({
    account: holder,
    address: ROBINHOOD_V4_QUOTER,
    abi: v4QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{
      poolKey: market.poolKey,
      zeroForOne,
      exactAmount: amountIn,
      hookData: "0x"
    }]
  });
  return result.result[0];
}

export function buildExternalV4Swap(params: {
  market: VerifiedExternalUniswapV4Market;
  recipient: Address;
  side: "buy" | "sell";
  amountIn: bigint;
  quoteOut: bigint;
  deadline: bigint;
  executionFee?: RmtExecutionFeeConfig;
  minimumOutFloor?: bigint;
}) {
  const nativeIsCurrency0 = params.market.poolKey.currency0.toLowerCase() === zeroAddress;
  const nativeIsCurrency1 = params.market.poolKey.currency1.toLowerCase() === zeroAddress;
  if (!nativeIsCurrency0 && !nativeIsCurrency1) {
    throw new Error("RMT v4 execution requires a native ETH quote pool.");
  }
  const inputCurrency = params.side === "buy" ? zeroAddress : params.market.token;
  const outputCurrency = params.side === "buy" ? params.market.token : zeroAddress;
  const zeroForOne = params.market.poolKey.currency0.toLowerCase() === inputCurrency.toLowerCase();
  const quotedMinimumOut = params.quoteOut * 99n / 100n;
  const grossMinimumOut = params.minimumOutFloor && params.minimumOutFloor > quotedMinimumOut
    ? params.minimumOutFloor
    : quotedMinimumOut;
  const feeConfig = params.executionFee?.enabled ? params.executionFee : undefined;
  const quoteAmounts = calculateRmtExecutionFee(params.quoteOut, feeConfig?.feeBps ?? 0);
  const minimumAmounts = calculateRmtExecutionFee(grossMinimumOut, feeConfig?.feeBps ?? 0);
  const minimumOut = minimumAmounts.netOutput;
  if (
    params.amountIn <= 0n
    || params.amountIn > MAX_UINT128
    || grossMinimumOut <= 0n
    || grossMinimumOut > MAX_UINT128
    || minimumOut <= 0n
  ) {
    throw new Error("The v4 quote cannot enforce a valid input and minimum received.");
  }
  const swapAction = encodeAbiParameters(exactInputSingleParameters, [{
    poolKey: params.market.poolKey,
    zeroForOne,
    amountIn: params.amountIn,
    amountOutMinimum: grossMinimumOut,
    minHopPriceX36: 0n,
    hookData: "0x"
  }]);
  const settleAction = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "bool" }],
    [inputCurrency, params.amountIn, false]
  );
  const takeAction = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [outputCurrency, ROUTER_AS_RECIPIENT, 0n]
  );
  const v4Swap = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [V4_SWAP_ACTIONS, [swapAction, settleAction, takeAction]]
  );
  const outputSweep = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [outputCurrency, params.recipient, minimumOut]
  );
  const feePayment = feeConfig
    ? encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }],
        [outputCurrency, feeConfig.treasury!, BigInt(feeConfig.feeBps)]
      )
    : undefined;
  const safeNativeSweep = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [zeroAddress, params.recipient, 0n]
  );
  const isBuy = params.side === "buy";
  const commands = feeConfig
    ? isBuy ? "0x10060404" : "0x0210060404"
    : isBuy ? "0x100404" : "0x02100404";
  const inputs = isBuy
    ? feePayment ? [v4Swap, feePayment, outputSweep, safeNativeSweep] : [v4Swap, outputSweep, safeNativeSweep]
    : [
        encodeAbiParameters(
          [{ type: "address" }, { type: "address" }, { type: "uint160" }],
          [params.market.token, ROUTER_AS_RECIPIENT, params.amountIn]
        ),
        v4Swap,
        ...(feePayment ? [feePayment] : []),
        outputSweep,
        safeNativeSweep
      ];
  const calldata = encodeFunctionData({
    abi: universalRouterAbi,
    functionName: "execute",
    args: [commands, inputs, params.deadline]
  });
  return {
    calldata,
    minimumOut,
    grossMinimumOut,
    netQuoteOut: quoteAmounts.netOutput,
    estimatedFee: quoteAmounts.fee,
    value: isBuy ? params.amountIn : 0n
  };
}

export function buildExternalV4SellSwap(params: Omit<Parameters<typeof buildExternalV4Swap>[0], "side">) {
  return buildExternalV4Swap({ ...params, side: "sell" });
}

async function simulateCalls(
  calls: Array<{ from: Address; to: Address; data: Hex; value?: Hex }>,
  fetcher: typeof fetch,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_simulateV1",
        params: [{
          blockStateCalls: [{ calls }],
          validation: false,
          traceTransfers: false,
          returnFullTransactions: false
        }, "latest"]
      }),
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Sequential route simulation is unavailable.");
    const payload = simulateResponseSchema.safeParse(await response.json());
    if (!payload.success || payload.data.error || !payload.data.result?.[0]) {
      throw new Error("Sequential route simulation returned invalid evidence.");
    }
    return {
      blockNumber: BigInt(payload.data.result[0].number),
      statuses: payload.data.result[0].calls.map((call) => call.status === "0x1")
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function simulateExternalUniswapV4Sell(
  market: VerifiedExternalUniswapV4Market,
  dependencies: SimulationDependencies = {}
): Promise<ExternalV4SellSimulation> {
  const hasNative = (
    market.poolKey.currency0.toLowerCase() === zeroAddress
    || market.poolKey.currency1.toLowerCase() === zeroAddress
  );
  if (!hasNative) return emptySimulation("not-run");
  const fetcher = dependencies.fetch ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? TIMEOUT_MS;
  let holder: { address: Address; amount: bigint } | null;
  try {
    holder = await (dependencies.findHolder ?? ((token) => findHolder(token, fetcher, timeoutMs)))(market.token);
  } catch {
    return emptySimulation("unavailable");
  }
  if (!holder || holder.amount <= 0n || holder.amount > MAX_UINT128 || holder.amount > MAX_UINT160) {
    return emptySimulation("not-run");
  }

  const quote = dependencies.quote ?? quoteSell;
  let amountIn = holder.amount;
  let quoteOut: bigint | undefined;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const candidate = await quote(market, holder.address, amountIn);
      if (candidate > 0n && candidate <= MAX_UINT128) {
        quoteOut = candidate;
        break;
      }
    } catch (cause) {
      const reverted = cause instanceof BaseError
        && cause.walk((entry) => entry instanceof ExecutionRevertedError);
      if (!reverted) {
        return {
          ...emptySimulation("unavailable"),
          holder: holder.address,
          amountIn: amountIn.toString()
        };
      }
    }
    if (amountIn <= 1n) break;
    amountIn = amountIn / 10n || 1n;
  }
  if (quoteOut === undefined) {
    return {
      ...emptySimulation("blocked"),
      holder: holder.address,
      amountIn: amountIn.toString()
    };
  }
  const now = dependencies.now?.() ?? Date.now();
  const deadline = BigInt(Math.floor(now / 1_000) + 600);
  const built = buildExternalV4Swap({
    market,
    recipient: holder.address,
    side: "sell",
    amountIn,
    quoteOut,
    deadline
  });
  const tokenApproval = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [PERMIT2_ADDRESS, amountIn]
  });
  const permit2Approval = encodeFunctionData({
    abi: permit2Abi,
    functionName: "approve",
    args: [market.token, ROBINHOOD_UNIVERSAL_ROUTER, amountIn, Number(deadline)]
  });
  let result: { blockNumber: bigint; statuses: boolean[] };
  try {
    result = await (dependencies.simulateCalls ?? ((calls) => simulateCalls(calls, fetcher, timeoutMs)))([
      { from: holder.address, to: market.token, data: tokenApproval },
      { from: holder.address, to: PERMIT2_ADDRESS, data: permit2Approval },
      { from: holder.address, to: ROBINHOOD_UNIVERSAL_ROUTER, data: built.calldata, value: "0x0" }
    ]);
  } catch {
    return {
      ...emptySimulation("unavailable"),
      holder: holder.address,
      amountIn: amountIn.toString(),
      quoteOut: quoteOut.toString(),
      minimumOut: built.minimumOut.toString()
    };
  }
  const statuses = result.statuses.slice(0, 3);
  const passed = statuses.length === 3 && statuses.every(Boolean);
  return {
    status: passed ? "passed" : "blocked",
    method: "holder-permit2-router-sequence",
    holder: holder.address,
    amountIn: amountIn.toString(),
    quoteOut: quoteOut.toString(),
    minimumOut: built.minimumOut.toString(),
    testedAtBlock: result.blockNumber.toString(),
    calls: {
      tokenApproval: statusLabel(statuses[0]),
      permit2Approval: statuses[0] ? statusLabel(statuses[1]) : "not-run",
      swap: statuses[0] && statuses[1] ? statusLabel(statuses[2]) : "not-run"
    }
  };
}

export type ExternalV4ExactTradeSimulation = {
  status: "passed" | "blocked" | "unavailable";
  testedAtBlock: string | null;
  calls: {
    tokenApproval: "passed" | "blocked" | "not-run";
    permit2Approval: "passed" | "blocked" | "not-run";
    swap: "passed" | "blocked" | "not-run";
  };
};

export async function simulateExactExternalUniswapV4Trade(
  params: {
    market: VerifiedExternalUniswapV4Market;
    account: Address;
    side: "buy" | "sell";
    amountIn: bigint;
    calldata: Hex;
    deadline: bigint;
  },
  dependencies: Pick<SimulationDependencies, "fetch" | "simulateCalls" | "timeoutMs"> = {}
): Promise<ExternalV4ExactTradeSimulation> {
  const fetcher = dependencies.fetch ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? TIMEOUT_MS;
  const calls: Array<{ from: Address; to: Address; data: Hex; value?: Hex }> = [];
  if (params.side === "sell") {
    calls.push(
      {
        from: params.account,
        to: params.market.token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [PERMIT2_ADDRESS, params.amountIn]
        })
      },
      {
        from: params.account,
        to: PERMIT2_ADDRESS,
        data: encodeFunctionData({
          abi: permit2Abi,
          functionName: "approve",
          args: [
            params.market.token,
            ROBINHOOD_UNIVERSAL_ROUTER,
            params.amountIn,
            Number(params.deadline)
          ]
        })
      }
    );
  }
  calls.push({
    from: params.account,
    to: ROBINHOOD_UNIVERSAL_ROUTER,
    data: params.calldata,
    value: params.side === "buy" ? toHex(params.amountIn) : "0x0"
  });

  try {
    const result = await (dependencies.simulateCalls ?? ((nextCalls) => (
      simulateCalls(nextCalls, fetcher, timeoutMs)
    )))(calls);
    const statuses = result.statuses.slice(0, calls.length);
    const passed = statuses.length === calls.length && statuses.every(Boolean);
    if (params.side === "buy") {
      return {
        status: passed ? "passed" : "blocked",
        testedAtBlock: result.blockNumber.toString(),
        calls: {
          tokenApproval: "not-run",
          permit2Approval: "not-run",
          swap: statusLabel(statuses[0])
        }
      };
    }
    return {
      status: passed ? "passed" : "blocked",
      testedAtBlock: result.blockNumber.toString(),
      calls: {
        tokenApproval: statusLabel(statuses[0]),
        permit2Approval: statuses[0] ? statusLabel(statuses[1]) : "not-run",
        swap: statuses[0] && statuses[1] ? statusLabel(statuses[2]) : "not-run"
      }
    };
  } catch {
    return {
      status: "unavailable",
      testedAtBlock: null,
      calls: {
        tokenApproval: "not-run",
        permit2Approval: "not-run",
        swap: "not-run"
      }
    };
  }
}
