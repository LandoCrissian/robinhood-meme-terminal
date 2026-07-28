import { createPublicClient, getAddress, http, isAddress, type Address } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { z } from "zod";
import { RUNNER_THRESHOLDS } from "../external-market-ranking";
import { ROBINHOOD_V3_FACTORY, ROBINHOOD_WETH } from "../uniswap-v4";

const DEXSCREENER_TOKEN_PAIRS_API = "https://api.dexscreener.com/token-pairs/v1/robinhood";
const DEXSCREENER_PAGE = "https://dexscreener.com/robinhood/";
const TIMEOUT_MS = 8_000;

const rawTokenSchema = z.object({ address: z.string() }).passthrough();
const rawPairSchema = z.object({
  chainId: z.string(),
  dexId: z.string(),
  url: z.string(),
  pairAddress: z.string(),
  baseToken: rawTokenSchema,
  quoteToken: rawTokenSchema,
  liquidity: z.object({ usd: z.union([z.number(), z.string()]) }).optional()
}).passthrough();

const v3PoolAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" }
    ]
  }
] as const;
const v3FactoryAbi = [{
  type: "function",
  name: "getPool",
  stateMutability: "view",
  inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }],
  outputs: [{ type: "address" }]
}] as const;

type MarketFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ReadPool = (pair: Address) => Promise<{
  factory: Address;
  token0: Address;
  token1: Address;
  fee: number;
  sqrtPriceX96: bigint;
  canonicalPair: Address;
  code: `0x${string}` | undefined;
}>;

export type VerifiedExternalUniswapMarket = {
  token: Address;
  pair: Address;
  fee: number;
  token0: Address;
  token1: Address;
  sqrtPriceX96: bigint;
  liquidityUsd: number;
  url: string;
};

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 3, timeout: 12_000 }
  )
});

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function safeAddress(value: string) {
  return isAddress(value) ? getAddress(value) : undefined;
}

async function readPool(pair: Address) {
  const [factory, token0, token1, fee, slot0, code] = await Promise.all([
    client.readContract({ address: pair, abi: v3PoolAbi, functionName: "factory" }),
    client.readContract({ address: pair, abi: v3PoolAbi, functionName: "token0" }),
    client.readContract({ address: pair, abi: v3PoolAbi, functionName: "token1" }),
    client.readContract({ address: pair, abi: v3PoolAbi, functionName: "fee" }),
    client.readContract({ address: pair, abi: v3PoolAbi, functionName: "slot0" }),
    client.getBytecode({ address: pair })
  ]);
  const canonicalPair = await client.readContract({
    address: ROBINHOOD_V3_FACTORY,
    abi: v3FactoryAbi,
    functionName: "getPool",
    args: [token0, token1, fee]
  });
  return {
    factory: getAddress(factory),
    token0: getAddress(token0),
    token1: getAddress(token1),
    fee: Number(fee),
    sqrtPriceX96: slot0[0],
    canonicalPair: getAddress(canonicalPair),
    code
  };
}

export async function verifyExternalUniswapMarket(
  params: { token: Address; pair: Address },
  dependencies: { fetch?: MarketFetch; readPool?: ReadPool; timeoutMs?: number } = {}
): Promise<VerifiedExternalUniswapMarket> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? TIMEOUT_MS);
  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(`${DEXSCREENER_TOKEN_PAIRS_API}/${params.token}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
  } catch (cause) {
    if (controller.signal.aborted) throw new Error("Market verification timed out.");
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error("Market verification is unavailable.");

  const payload = z.array(rawPairSchema).safeParse(await response.json());
  if (!payload.success) throw new Error("Market verification returned invalid data.");
  const candidate = payload.data.find((entry) => sameAddress(entry.pairAddress, params.pair));
  if (!candidate) throw new Error("This Uniswap pool is no longer verified.");

  const pair = safeAddress(candidate.pairAddress);
  const baseToken = safeAddress(candidate.baseToken.address);
  const quoteToken = safeAddress(candidate.quoteToken.address);
  const liquidityUsd = typeof candidate.liquidity?.usd === "number"
    ? candidate.liquidity.usd
    : Number(candidate.liquidity?.usd);
  if (
    !pair
    || candidate.chainId !== "robinhood"
    || !(candidate.dexId.toLowerCase() === "uniswap" || candidate.dexId.toLowerCase().startsWith("uniswap-"))
    || !candidate.url.startsWith(DEXSCREENER_PAGE)
    || (baseToken?.toLowerCase() !== params.token.toLowerCase()
      && quoteToken?.toLowerCase() !== params.token.toLowerCase())
    || !Number.isFinite(liquidityUsd)
    || liquidityUsd < RUNNER_THRESHOLDS.minimumDisplayLiquidityUsd
  ) {
    throw new Error("This Uniswap pool is no longer eligible for in-RMT trading.");
  }

  const pool = await (dependencies.readPool ?? readPool)(pair);
  const tokens = [pool.token0.toLowerCase(), pool.token1.toLowerCase()];
  if (
    !pool.code
    || pool.code === "0x"
    || !sameAddress(pool.factory, ROBINHOOD_V3_FACTORY)
    || !sameAddress(pool.canonicalPair, pair)
    || !tokens.includes(params.token.toLowerCase())
    || !tokens.includes(ROBINHOOD_WETH.toLowerCase())
    || !Number.isInteger(pool.fee)
    || pool.fee <= 0
    || pool.fee >= 1_000_000
    || pool.sqrtPriceX96 <= 0n
  ) {
    throw new Error("This market is not a verified canonical Uniswap V3 token/WETH pool.");
  }

  return {
    token: getAddress(params.token),
    pair,
    fee: pool.fee,
    token0: pool.token0,
    token1: pool.token1,
    sqrtPriceX96: pool.sqrtPriceX96,
    liquidityUsd,
    url: candidate.url.slice(0, 300)
  };
}
