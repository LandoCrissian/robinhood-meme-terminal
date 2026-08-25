import assert from "node:assert/strict";
import { getAddress, zeroAddress } from "viem";
import { createVNextUniswapV4Adapter } from "../server/vnext-uniswap-v4-adapter";
import type { VNextCanonicalMarketInventoryResult } from "../server/vnext-market-indexer";
import { quoteVNextExecutionProviders } from "../server/vnext-provider-adapter";
import {
  VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY,
  hasVNextWalletAuthorizationCodec
} from "./provider-fee-settlement";

const token = getAddress("0x1139d423C1706BDeaD91f03507F521635591eD92");
const poolId = "0x5f5ec0e1016bae2f04c122bbcd2c141a4177cc681d7c2e4463a1d172ed8430b3" as const;
const hooks = getAddress("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044");
const recipient = getAddress("0x1111111111111111111111111111111111111111");
const now = Date.now();
const inventory: VNextCanonicalMarketInventoryResult = {
  status: "verified_shadow",
  chainId: 4_663,
  mode: "shadow",
  authoritative: false,
  sourceManifestHash: `0x${"1".repeat(64)}`,
  coverage: {
    complete: true,
    finalizedHead: "50000000",
    sources: [{ sourceId: "uniswap-v4", status: "shadow-ready", indexedThrough: "50000000" }]
  },
  nextCursor: null,
  pools: [{
    sourceId: "uniswap-v4",
    protocol: "uniswap",
    version: 4,
    poolKey: poolId,
    poolAddress: null,
    token0: zeroAddress,
    token1: token.toLowerCase(),
    stable: null,
    fee: 0,
    tickSpacing: 200,
    hooks: hooks.toLowerCase(),
    transactionHash: `0x${"2".repeat(64)}`,
    blockNumber: "49000000",
    blockHash: `0x${"3".repeat(64)}`,
    stateStatus: "ready",
    liveFee: 0,
    feeDenominator: 1_000_000,
    gaugeAddress: null,
    gaugeAlive: null,
    gaugeWeight: null,
    gaugeClaimable: null,
    feesAddress: null,
    bribeAddress: null,
    stateError: null,
    stateObservedBlock: "50000000",
    stateObservedBlockHash: `0x${"4".repeat(64)}`
  }]
};

const adapter = createVNextUniswapV4Adapter({
  readInventory: async () => inventory,
  quote: async ({ zeroForOne }) => zeroForOne ? 4_000_000n : 500_000_000_000_000n,
  readFreshness: async () => ({
    blockNumber: 50_000_001n,
    blockHash: `0x${"5".repeat(64)}`,
    timestamp: BigInt(Math.floor(now / 1_000))
  }),
  now: () => now
});

const request = {
  chainId: 4_663 as const,
  inputAsset: zeroAddress,
  outputAsset: token,
  inputAmountAtomic: "1000000000000000",
  amountIn: 1_000_000_000_000_000n,
  recipient,
  inputIdentity: { address: zeroAddress, symbol: "ETH", decimals: 18 },
  outputIdentity: { address: token, symbol: "CANNACAT", decimals: 18 },
  canonicalMarket: { sourceId: "uniswap-v4" as const, poolId }
};

async function main() {
const [buy] = await quoteVNextExecutionProviders(request, [adapter]);
assert.equal(buy?.provider, "uniswap-v4");
assert.equal(buy?.status, "indicative");
assert.equal(buy?.v4Evidence?.poolId, poolId);
assert.equal(buy?.v4Evidence?.hooks, hooks);
assert.equal(buy?.v4Evidence?.recipient, recipient);
assert.equal(buy?.v4Evidence?.provenance, "canonical-market-indexer+uniswap-v4-quoter+robinhood-rpc");
assert.equal(buy?.authorizationReady, false);
assert.equal(buy?.strictVerificationAvailable, false);
assert.equal("calldata" in (buy ?? {}), false);
assert.equal("transaction" in (buy ?? {}), false);
assert.equal("target" in (buy ?? {}), false);

const [sell] = await quoteVNextExecutionProviders({
  ...request,
  inputAsset: token,
  outputAsset: zeroAddress,
  inputAmountAtomic: "1000000000000000000",
  amountIn: 1_000_000_000_000_000_000n,
  inputIdentity: request.outputIdentity,
  outputIdentity: request.inputIdentity
}, [adapter]);
assert.equal(sell?.provider, "uniswap-v4");
assert.equal(sell?.status, "indicative");
assert.equal(sell?.v4Evidence?.poolId, poolId);
assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v4"].state, "QUOTE_ONLY");
assert.equal(hasVNextWalletAuthorizationCodec("uniswap-v4"), false);

console.log("Generic canonical Uniswap V4 quote-only provider checks passed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
