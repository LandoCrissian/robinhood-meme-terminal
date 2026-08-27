import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { ROBINHOOD_V4_QUOTER } from "../uniswap-v4";
import { readRmtCuratedCanonicalMarketInventory } from "./rmt-curated-market-registry";
import {
  prepareVNextUniswapV4Authorization,
  verifyVNextUniswapV4Route
} from "./vnext-uniswap-v4-execution";
import {
  disabledVNextFeeEconomics,
  unavailableVNextQuoteAttempt,
  type VNextQuoteProviderAdapter
} from "./vnext-provider-adapter";

const MAX_UINT128 = (1n << 128n) - 1n;
const QUOTE_TTL_MS = 30_000;
const PROTECTED_OUTPUT_BPS = 9_950n;

const poolKeyParameters = [{
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" }
  ]
}] as const;

const quoterAbi = [{
  type: "function",
  name: "quoteExactInputSingle",
  stateMutability: "nonpayable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "poolKey", type: "tuple", components: poolKeyParameters[0].components },
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
    { retryCount: 2, timeout: 4_000 }
  )
});

type V4QuoteDependencies = {
  readInventory?: typeof readRmtCuratedCanonicalMarketInventory;
  quote?: (input: {
    poolKey: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
    zeroForOne: boolean;
    amountIn: bigint;
    recipient: Address;
  }) => Promise<bigint>;
  readFreshness?: () => Promise<{ blockNumber: bigint; blockHash: Hex; timestamp: bigint }>;
  now?: () => number;
  verify?: typeof verifyVNextUniswapV4Route;
  prepareAuthorization?: typeof prepareVNextUniswapV4Authorization;
};

export function createVNextUniswapV4Adapter(
  dependencies: V4QuoteDependencies = {}
): VNextQuoteProviderAdapter {
  const adapter: VNextQuoteProviderAdapter = {
    provider: "uniswap-v4",
    providerLabel: "Uniswap v4",
    providerFamily: "uniswap",
    adapterVersion: 1,
    executionKind: "direct_amm",
    capabilities: { strictVerification: true, walletAuthorization: true },
    async quote(request) {
      const startedAtMs = dependencies.now?.() ?? Date.now();
      try {
        if (request.amountIn <= 0n || request.amountIn > MAX_UINT128) throw new Error("V4 quote amount is invalid.");
        const inventoryToken = request.inputAsset.toLowerCase() === "0x0000000000000000000000000000000000000000"
          ? request.outputAsset.toLowerCase()
          : request.inputAsset.toLowerCase();
        const inventory = await (dependencies.readInventory ?? readRmtCuratedCanonicalMarketInventory)({
          token: inventoryToken,
          source: "uniswap-v4",
          limit: 100
        });
        if (inventory.status !== "verified_shadow") throw new Error("Canonical V4 inventory is unavailable.");
        const input = request.inputAsset.toLowerCase();
        const output = request.outputAsset.toLowerCase();
        const market = inventory.pools.find((pool) => (
          pool.sourceId === "uniswap-v4"
          && pool.version === 4
          && pool.protocol === "uniswap"
          && pool.poolAddress === null
          && pool.fee !== null
          && pool.tickSpacing !== null
          && pool.hooks !== null
          && (!request.canonicalMarket || pool.poolKey === request.canonicalMarket.poolId.toLowerCase())
          && ((pool.token0 === input && pool.token1 === output) || (pool.token0 === output && pool.token1 === input))
        ));
        if (!market || market.fee === null || market.tickSpacing === null || market.hooks === null) {
          return unavailableVNextQuoteAttempt({
            adapter, request, status: "no_route",
            detail: "No canonical Uniswap v4 PoolKey matches the exact asset pair.", startedAtMs
          });
        }
        const poolKey = {
          currency0: getAddress(market.token0),
          currency1: getAddress(market.token1),
          fee: market.fee,
          tickSpacing: market.tickSpacing,
          hooks: getAddress(market.hooks)
        };
        const derivedPoolId = keccak256(encodeAbiParameters(poolKeyParameters, [poolKey]));
        if (derivedPoolId.toLowerCase() !== market.poolKey) throw new Error("Canonical V4 PoolId does not match its PoolKey.");
        const [amountOut, freshness] = await Promise.all([
          (dependencies.quote ?? (async (input) => {
            const result = await client.simulateContract({
              account: input.recipient,
              address: ROBINHOOD_V4_QUOTER,
              abi: quoterAbi,
              functionName: "quoteExactInputSingle",
              args: [{
                poolKey: input.poolKey,
                zeroForOne: input.zeroForOne,
                exactAmount: input.amountIn,
                hookData: "0x"
              }]
            });
            return result.result[0];
          }))({
            poolKey,
            zeroForOne: poolKey.currency0.toLowerCase() === input,
            amountIn: request.amountIn,
            recipient: request.recipient
          }),
          (dependencies.readFreshness ?? (async () => {
            const block = await client.getBlock();
            if (!block.hash) throw new Error("V4 freshness block hash is unavailable.");
            return { blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp };
          }))()
        ]);
        if (amountOut <= 0n) throw new Error("Uniswap v4 returned no output.");
        const protectedOutput = amountOut * PROTECTED_OUTPUT_BPS / 10_000n;
        if (protectedOutput <= 0n) throw new Error("Protected V4 output is invalid.");
        const quotedAtMs = dependencies.now?.() ?? Date.now();
        return {
          provider: "uniswap-v4",
          providerLabel: "Uniswap v4",
          providerFamily: "uniswap",
          adapterVersion: 1,
          status: "indicative",
          chainId: 4_663,
          inputAsset: request.inputAsset,
          outputAsset: request.outputAsset,
          inputAmountAtomic: request.inputAmountAtomic,
          expectedOutputAtomic: amountOut.toString(),
          protectedOutputAtomic: protectedOutput.toString(),
          outputDecimals: request.outputIdentity.decimals,
          priceImpact: null,
          liquidityFeeEvidence: [],
          quotedAtMs,
          expiresAtMs: quotedAtMs + QUOTE_TTL_MS,
          latencyMs: Math.max(0, quotedAtMs - startedAtMs),
          executionKind: "direct_amm",
          strictVerificationAvailable: true,
          userPaysGas: true,
          providerFeeAsset: null,
          providerFeeAtomic: null,
          gasSponsorshipFeeAsset: null,
          gasSponsorshipFeeAtomic: null,
          explicitProviderFeeOutputAtomic: null,
          netEconomics: disabledVNextFeeEconomics({
            inputAmountAtomic: request.inputAmountAtomic,
            expectedOutputAtomic: amountOut.toString(),
            protectedOutputAtomic: protectedOutput.toString()
          }),
          networkFeeNativeAtomic: null,
          networkFeeNativeSymbol: "ETH",
          protectedNetOutputAtomic: null,
          costState: "network_fee_pending",
          authorizationReady: false,
          v4Evidence: {
            poolId: derivedPoolId,
            currency0: poolKey.currency0,
            currency1: poolKey.currency1,
            fee: poolKey.fee,
            tickSpacing: poolKey.tickSpacing,
            hooks: poolKey.hooks,
            recipient: request.recipient,
            provenance: "canonical-market-indexer+uniswap-v4-quoter+robinhood-rpc",
            observedBlock: freshness.blockNumber.toString(),
            observedBlockHash: freshness.blockHash,
            observedAtMs: Number(freshness.timestamp * 1_000n)
          },
          detail: "Canonical PoolKey quote. Wallet execution requires a fresh exact-call verification."
        };
      } catch {
        return unavailableVNextQuoteAttempt({
          adapter, request, status: "temporarily_unavailable",
          detail: "Uniswap v4 quote evidence is temporarily unavailable.", startedAtMs
        });
      }
    },
    verify(request) {
      return (dependencies.verify ?? verifyVNextUniswapV4Route)(request);
    },
    prepareAuthorization(request) {
      return (dependencies.prepareAuthorization ?? prepareVNextUniswapV4Authorization)(request);
    }
  };
  return adapter;
}

export const vNextUniswapV4Adapter = createVNextUniswapV4Adapter();
