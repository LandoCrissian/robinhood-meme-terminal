import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  assessExternalV4Execution,
  type ExternalV4Evidence,
  type ExternalV4SellSimulation
} from "../external-v4-evidence";
import { PRICE_IMPACT_BLOCK } from "../trade-ticket";
import {
  PERMIT2_ADDRESS,
  ROBINHOOD_UNIVERSAL_ROUTER,
  ROBINHOOD_V4_QUOTER
} from "../uniswap-v4";
import { calculateUniswapPriceImpact } from "./external-uniswap-trade";
import {
  buildExternalV4Swap,
  simulateExactExternalUniswapV4Trade,
  simulateExternalUniswapV4Sell,
  type ExternalV4ExactTradeSimulation
} from "./external-uniswap-v4-simulation";
import {
  verifyExternalUniswapV4Market,
  type VerifiedExternalUniswapV4Market
} from "./external-uniswap-v4-market";

const MAX_UINT128 = (1n << 128n) - 1n;
const PASSPORT_TTL_MS = 30_000;
const MAX_PASSPORT_CACHE_ENTRIES = 256;
const passportCache = new Map<string, {
  expiresAt: number;
  promise: Promise<{
    sellSimulation: ExternalV4SellSimulation;
    assessment: ExternalV4Evidence["executionAssessment"];
  }>;
}>();

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

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL
      ?? process.env.ROBINHOOD_MAINNET_RPC_URL
      ?? process.env.NEXT_PUBLIC_RMT_RPC_URL
      ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 2, timeout: 12_000 }
  )
});

export type ExternalUniswapV4Quote = {
  chainId: 4663;
  venue: "uniswap-v4";
  protocol: "UNISWAP";
  token: Address;
  recipient: Address;
  side: "buy" | "sell";
  router: Address;
  calldata: Hex;
  value: string;
  amountIn: string;
  quoteOut: string;
  minimumOut: string;
  priceImpact: number;
  deadline: string;
  fee: number;
  marketPair: Hex;
  marketVerified: true;
  executable: true;
  approvalRequired: boolean;
  approvalSpender: Address;
  inputToken: { address: Address; symbol: string; name: string; decimals: number };
  outputToken: { address: Address; symbol: string; name: string; decimals: number };
  passport: {
    state: "eligible";
    checkedAt: string;
    sellTestedAtBlock: string;
    exactTradeTestedAtBlock: string;
    hook: Address;
    reasons: string[];
  };
};

type TradeDependencies = {
  verifyMarket?: (params: {
    token: Address;
    poolId: Hex;
  }) => Promise<VerifiedExternalUniswapV4Market>;
  simulateSellPassport?: (
    market: VerifiedExternalUniswapV4Market
  ) => Promise<ExternalV4SellSimulation>;
  quote?: (
    market: VerifiedExternalUniswapV4Market,
    recipient: Address,
    side: "buy" | "sell",
    amountIn: bigint
  ) => Promise<bigint>;
  simulateExact?: (params: {
    market: VerifiedExternalUniswapV4Market;
    account: Address;
    side: "buy" | "sell";
    amountIn: bigint;
    calldata: Hex;
    deadline: bigint;
  }) => Promise<ExternalV4ExactTradeSimulation>;
  metadata?: (token: Address) => Promise<{
    address: Address;
    symbol: string;
    name: string;
    decimals: number;
  }>;
  now?: () => number;
};

function safeText(value: string, fallback: string) {
  const clean = value.trim().slice(0, 80);
  return clean || fallback;
}

async function tokenMetadata(token: Address) {
  const [symbol, name, decimals] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })
  ]);
  if (decimals > 36) throw new Error("The token decimals are outside the supported range.");
  return {
    address: getAddress(token),
    symbol: safeText(symbol, "TOKEN"),
    name: safeText(name, "Token"),
    decimals
  };
}

async function quoteV4(
  market: VerifiedExternalUniswapV4Market,
  recipient: Address,
  side: "buy" | "sell",
  amountIn: bigint
) {
  const inputCurrency = side === "buy" ? zeroAddress : market.token;
  const quote = await client.simulateContract({
    account: recipient,
    address: ROBINHOOD_V4_QUOTER,
    abi: v4QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{
      poolKey: market.poolKey,
      zeroForOne: market.poolKey.currency0.toLowerCase() === inputCurrency.toLowerCase(),
      exactAmount: amountIn,
      hookData: "0x"
    }]
  });
  return quote.result[0];
}

async function eligiblePassport(
  market: VerifiedExternalUniswapV4Market,
  simulateSell: (market: VerifiedExternalUniswapV4Market) => Promise<ExternalV4SellSimulation>
) {
  const key = `${market.token.toLowerCase()}:${market.poolId.toLowerCase()}`;
  const now = Date.now();
  const cached = passportCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = simulateSell(market).then((sellSimulation) => ({
    sellSimulation,
    assessment: assessExternalV4Execution({
      hook: market.hook,
      sellSimulation
    })
  }));
  if (passportCache.size >= MAX_PASSPORT_CACHE_ENTRIES) {
    for (const [cacheKey, entry] of passportCache) {
      if (entry.expiresAt <= now || passportCache.size >= MAX_PASSPORT_CACHE_ENTRIES) {
        passportCache.delete(cacheKey);
      }
      if (passportCache.size < MAX_PASSPORT_CACHE_ENTRIES) break;
    }
  }
  passportCache.set(key, {
    expiresAt: now + PASSPORT_TTL_MS,
    promise
  });
  void promise.catch(() => passportCache.delete(key));
  return promise;
}

export async function quoteAndBuildExternalUniswapV4Swap(
  params: {
    token: Address;
    poolId: Hex;
    recipient: Address;
    side: "buy" | "sell";
    amountIn: bigint;
  },
  dependencies: TradeDependencies = {}
): Promise<ExternalUniswapV4Quote> {
  if (params.amountIn <= 0n || params.amountIn > MAX_UINT128) {
    throw new Error("Trade amount is outside the supported range.");
  }
  if (params.recipient.toLowerCase() === zeroAddress) {
    throw new Error("A valid wallet recipient is required.");
  }
  const verifyMarket = dependencies.verifyMarket ?? ((input) => verifyExternalUniswapV4Market(input));
  const market = await verifyMarket({ token: params.token, poolId: params.poolId });
  const nativePool = (
    market.poolKey.currency0.toLowerCase() === zeroAddress
    || market.poolKey.currency1.toLowerCase() === zeroAddress
  );
  if (!nativePool) throw new Error("RMT v4 execution requires a native ETH quote pool.");

  const simulateSell = dependencies.simulateSellPassport ?? simulateExternalUniswapV4Sell;
  const { sellSimulation, assessment } = dependencies.simulateSellPassport
    ? await simulateSell(market).then((simulation) => ({
        sellSimulation: simulation,
        assessment: assessExternalV4Execution({
          hook: market.hook,
          sellSimulation: simulation
        })
      }))
    : await eligiblePassport(market, simulateSell);
  if (
    assessment.state !== "eligible"
    || sellSimulation.status !== "passed"
    || !sellSimulation.testedAtBlock
  ) {
    throw new Error("The RMT v4 Passport did not clear this pool for execution.");
  }

  const quoteOut = await (dependencies.quote ?? quoteV4)(
    market,
    params.recipient,
    params.side,
    params.amountIn
  );
  if (quoteOut <= 0n || quoteOut > MAX_UINT128) {
    throw new Error("The Uniswap v4 pool returned an invalid quote.");
  }
  const inputCurrency = params.side === "buy" ? zeroAddress : market.token;
  const priceImpact = calculateUniswapPriceImpact({
    sqrtPriceX96: market.poolState.sqrtPriceX96,
    tokenInIsToken0: market.poolKey.currency0.toLowerCase() === inputCurrency.toLowerCase(),
    amountIn: params.amountIn,
    quoteOut
  });
  if (priceImpact > PRICE_IMPACT_BLOCK) {
    throw new Error("RMT blocked this Uniswap v4 trade because price impact exceeds 5%.");
  }

  const now = dependencies.now?.() ?? Date.now();
  const deadline = BigInt(Math.floor(now / 1_000) + 600);
  const built = buildExternalV4Swap({
    market,
    recipient: params.recipient,
    side: params.side,
    amountIn: params.amountIn,
    quoteOut,
    deadline
  });
  const exactSimulation = await (dependencies.simulateExact ?? simulateExactExternalUniswapV4Trade)({
    market,
    account: params.recipient,
    side: params.side,
    amountIn: params.amountIn,
    calldata: built.calldata,
    deadline
  });
  if (exactSimulation.status !== "passed" || !exactSimulation.testedAtBlock) {
    throw new Error("The exact Uniswap v4 wallet route did not pass simulation.");
  }

  const metadata = await (dependencies.metadata ?? tokenMetadata)(params.token);
  const native = {
    address: zeroAddress,
    symbol: "ETH",
    name: "Ether",
    decimals: 18
  };
  return {
    chainId: 4663,
    venue: "uniswap-v4",
    protocol: "UNISWAP",
    token: getAddress(params.token),
    recipient: getAddress(params.recipient),
    side: params.side,
    router: ROBINHOOD_UNIVERSAL_ROUTER,
    calldata: built.calldata,
    value: built.value.toString(),
    amountIn: params.amountIn.toString(),
    quoteOut: quoteOut.toString(),
    minimumOut: built.minimumOut.toString(),
    priceImpact,
    deadline: deadline.toString(),
    fee: market.poolState.lpFee,
    marketPair: market.poolId,
    marketVerified: true,
    executable: true,
    approvalRequired: params.side === "sell",
    approvalSpender: PERMIT2_ADDRESS,
    inputToken: params.side === "buy" ? native : metadata,
    outputToken: params.side === "buy" ? metadata : native,
    passport: {
      state: "eligible",
      checkedAt: new Date(now).toISOString(),
      sellTestedAtBlock: sellSimulation.testedAtBlock,
      exactTradeTestedAtBlock: exactSimulation.testedAtBlock,
      hook: getAddress(market.hook.address),
      reasons: assessment.reasons
    }
  };
}
