import assert from "node:assert/strict";
import { getAddress, zeroAddress, type Hex } from "viem";
import {
  PERMIT2_ADDRESS,
  ROBINHOOD_UNIVERSAL_ROUTER
} from "../uniswap-v4";
import type { ExternalV4SellSimulation } from "../external-v4-evidence";
import type { VerifiedExternalUniswapV4Market } from "./external-uniswap-v4-market";
import { quoteAndBuildExternalUniswapV4Swap } from "./external-uniswap-v4-trade";

const token = getAddress("0x26616fD1A48cA881cB5ca8181e04E76F64c1e58F");
const recipient = getAddress("0x94973819b134A6F45C57448172Cc2B84019C161f");
const poolId = "0xe3fcfc2539add7e0eb6788d033c77a9cb1a677d567267888726c54371e43f67d" as Hex;
const testedAtBlock = "23743249";

const passedSell: ExternalV4SellSimulation = {
  status: "passed",
  method: "holder-permit2-router-sequence",
  holder: recipient,
  amountIn: "1000",
  quoteOut: "990",
  minimumOut: "980",
  testedAtBlock,
  calls: {
    tokenApproval: "passed",
    permit2Approval: "passed",
    swap: "passed"
  }
};

function market(overrides: Partial<VerifiedExternalUniswapV4Market> = {}): VerifiedExternalUniswapV4Market {
  return {
    protocol: "uniswap-v4",
    token,
    poolId,
    poolManager: getAddress("0x8366a39cC670B4001A1121b8f6A443A643E40951"),
    stateView: getAddress("0xF3334192D15450cDD385c8b70E03F9a6Bd9e673b"),
    quoter: getAddress("0x8dC178efB8111Bb0973dD9D722eBeFF267c98F94"),
    router: ROBINHOOD_UNIVERSAL_ROUTER,
    poolKey: {
      currency0: zeroAddress,
      currency1: token,
      fee: 5_000,
      tickSpacing: 200,
      hooks: zeroAddress
    },
    poolState: {
      sqrtPriceX96: 1n << 96n,
      tick: 0,
      protocolFee: 0,
      lpFee: 5_000,
      initializedAtBlock: 23_711_922n
    },
    hook: {
      address: zeroAddress,
      permissions: [],
      affectsSwap: false,
      returnsSwapDelta: false,
      dynamicFee: false,
      codePresent: true,
      sourcePublished: null,
      isProxy: null,
      bytecodeChanged: null,
      contractName: null,
      customWriteFunctions: []
    },
    liquidityUsd: 50_000,
    url: `https://dexscreener.com/robinhood/${poolId}`,
    ...overrides
  };
}

const exactPassed = {
  status: "passed" as const,
  testedAtBlock,
  calls: {
    tokenApproval: "not-run" as const,
    permit2Approval: "not-run" as const,
    swap: "passed" as const
  }
};

const dependencies = {
  verifyMarket: async () => market(),
  simulateSellPassport: async () => passedSell,
  quote: async () => 990n,
  simulateExact: async () => exactPassed,
  metadata: async () => ({
    address: token,
    symbol: "TEST",
    name: "Test token",
    decimals: 18
  }),
  now: () => 1_800_000_000_000
};

async function main() {
  const quote = await quoteAndBuildExternalUniswapV4Swap({
    token,
    poolId,
    recipient,
    side: "buy",
    amountIn: 1_000n
  }, dependencies);

  assert.equal(quote.venue, "uniswap-v4");
  assert.equal(quote.router, ROBINHOOD_UNIVERSAL_ROUTER);
  assert.equal(quote.approvalSpender, PERMIT2_ADDRESS);
  assert.equal(quote.marketPair, poolId);
  assert.equal(quote.passport.state, "eligible");
  assert.equal(quote.passport.sellTestedAtBlock, testedAtBlock);
  assert.equal(quote.passport.exactTradeTestedAtBlock, testedAtBlock);
  assert.equal(quote.minimumOut, "980");
  assert.equal(quote.value, "1000");

  await assert.rejects(
    quoteAndBuildExternalUniswapV4Swap({
      token,
      poolId,
      recipient,
      side: "buy",
      amountIn: 1_000n
    }, {
      ...dependencies,
      verifyMarket: async () => market({
        hook: {
          ...market().hook,
          address: getAddress("0x0000000000000000000000000000000000000080"),
          permissions: ["before-swap"],
          affectsSwap: true,
          sourcePublished: true,
          isProxy: false,
          bytecodeChanged: false
        }
      })
    }),
    /Passport did not clear/
  );

  await assert.rejects(
    quoteAndBuildExternalUniswapV4Swap({
      token,
      poolId,
      recipient,
      side: "sell",
      amountIn: 1_000n
    }, {
      ...dependencies,
      simulateSellPassport: async () => ({
        ...passedSell,
        status: "blocked",
        calls: { ...passedSell.calls, swap: "blocked" }
      })
    }),
    /Passport did not clear/
  );

  await assert.rejects(
    quoteAndBuildExternalUniswapV4Swap({
      token,
      poolId,
      recipient,
      side: "buy",
      amountIn: 1_000n
    }, {
      ...dependencies,
      simulateExact: async () => ({
        ...exactPassed,
        status: "blocked",
        calls: { ...exactPassed.calls, swap: "blocked" }
      })
    }),
    /exact Uniswap v4 wallet route did not pass/
  );

  await assert.rejects(
    quoteAndBuildExternalUniswapV4Swap({
      token,
      poolId,
      recipient,
      side: "buy",
      amountIn: 1_000n
    }, {
      ...dependencies,
      quote: async () => 900n
    }),
    /price impact exceeds 5%/
  );

  await assert.rejects(
    quoteAndBuildExternalUniswapV4Swap({
      token,
      poolId,
      recipient: zeroAddress,
      side: "buy",
      amountIn: 1_000n
    }, dependencies),
    /valid wallet recipient/
  );

  console.log("Passport-gated Uniswap v4 execution fails closed before wallet signing.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
