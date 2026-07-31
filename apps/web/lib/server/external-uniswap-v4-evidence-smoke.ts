import assert from "node:assert/strict";
import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import {
  assessExternalV4Execution,
  decodeUniswapV4HookPermissions
} from "../external-v4-evidence";
import { verifyExternalUniswapV4Market } from "./external-uniswap-v4-market";
import {
  buildExternalV4SellSwap,
  simulateExternalUniswapV4Sell
} from "./external-uniswap-v4-simulation";

const token = getAddress("0x26616fD1A48cA881cB5ca8181e04E76F64c1e58F");
const hook = getAddress("0x4b16B138089673cC37a85E2aafe69Dd5265208Cc");
const holder = getAddress("0x94973819b134A6F45C57448172Cc2B84019C161f");
const other = getAddress("0x1111111111111111111111111111111111111111");
const poolId = "0xe3fcfc2539add7e0eb6788d033c77a9cb1a677d567267888726c54371e43f67d" as Hex;

function dexPair() {
  return {
    chainId: "robinhood",
    dexId: "uniswap",
    url: `https://dexscreener.com/robinhood/${poolId}`,
    pairAddress: poolId,
    baseToken: { address: token },
    quoteToken: { address: zeroAddress },
    liquidity: { usd: 50_000 }
  };
}

async function verifiedMarket(overrides: {
  logToken?: Address;
  managerCode?: Hex | undefined;
} = {}) {
  return verifyExternalUniswapV4Market(
    { token, poolId },
    {
      fetch: async (input) => {
        const url = input.toString();
        if (url.includes("/token-pairs/")) return Response.json([dexPair()]);
        return Response.json({
          name: "JetstreamHook",
          is_verified: true,
          proxy_type: null,
          implementations: [],
          is_changed_bytecode: false,
          abi: [
            { type: "function", name: "beforeSwap", stateMutability: "nonpayable" },
            { type: "function", name: "claim", stateMutability: "nonpayable" },
            { type: "function", name: "quote", stateMutability: "view" }
          ]
        });
      },
      getInitializeLogs: async () => [{
        args: {
          id: poolId,
          currency0: zeroAddress,
          currency1: overrides.logToken ?? token,
          fee: 0,
          tickSpacing: 200,
          hooks: hook,
          sqrtPriceX96: 1n << 96n,
          tick: 0
        },
        blockNumber: 23_711_922n
      }],
      readSlot0: async () => [1n << 96n, 0, 0, 0] as const,
      getBytecode: async (address) => (
        address.toLowerCase().includes("8366a39c")
          ? overrides.managerCode ?? "0x6000"
          : "0x6000"
      )
    }
  );
}

async function main() {
  assert.deepEqual(decodeUniswapV4HookPermissions(hook), [
    "before-add-liquidity",
    "before-swap",
    "after-swap",
    "before-swap-return-delta",
    "after-swap-return-delta"
  ]);

  const market = await verifiedMarket();
  assert.equal(market.poolId, poolId);
  assert.equal(market.poolKey.hooks, hook);
  assert.equal(market.hook.contractName, "JetstreamHook");
  assert.equal(market.hook.sourcePublished, true);
  assert.equal(market.hook.isProxy, false);
  assert.equal(market.hook.bytecodeChanged, false);
  assert.deepEqual(market.hook.customWriteFunctions, ["claim"]);
  assert.equal(market.hook.returnsSwapDelta, true);

  await assert.rejects(verifiedMarket({ logToken: other }), /does not match the canonical v4 pool key/);
  await assert.rejects(verifiedMarket({ managerCode: "0x" }), /execution contracts or pool state are unavailable/);

  const built = buildExternalV4SellSwap({
    market,
    recipient: holder,
    amountIn: 1_000n,
    quoteOut: 500n,
    deadline: 2_000_000_000n
  });
  assert.match(built.calldata, /^0x[0-9a-f]+$/);
  assert.equal(built.minimumOut, 495n);

  const passed = await simulateExternalUniswapV4Sell(market, {
    findHolder: async () => ({ address: holder, amount: 1_000n }),
    quote: async () => 500n,
    simulateCalls: async (calls) => {
      assert.equal(calls.length, 3);
      assert.equal(calls[0]?.from, holder);
      return { blockNumber: 23_743_249n, statuses: [true, true, true] };
    },
    now: () => 1_800_000_000_000
  });
  assert.equal(passed.status, "passed");
  assert.equal(passed.calls.swap, "passed");
  assert.equal(passed.minimumOut, "495");

  const blocked = await simulateExternalUniswapV4Sell(market, {
    findHolder: async () => ({ address: holder, amount: 1_000n }),
    quote: async () => 500n,
    simulateCalls: async () => ({ blockNumber: 23_743_250n, statuses: [true, true, false] }),
    now: () => 1_800_000_000_000
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.calls.swap, "blocked");
  assert.equal(assessExternalV4Execution({ hook: market.hook, sellSimulation: blocked }).state, "blocked");

  const reviewed = assessExternalV4Execution({ hook: market.hook, sellSimulation: passed });
  assert.equal(reviewed.state, "review");
  assert.match(reviewed.reasons.join(" "), /alter swap input or output deltas/);

  const eligible = assessExternalV4Execution({
    hook: {
      ...market.hook,
      address: zeroAddress,
      permissions: [],
      affectsSwap: false,
      returnsSwapDelta: false,
      sourcePublished: null,
      isProxy: null,
      bytecodeChanged: null,
      contractName: null,
      customWriteFunctions: []
    },
    sellSimulation: passed
  });
  assert.equal(eligible.state, "eligible");

  const nonNative = await simulateExternalUniswapV4Sell({
    ...market,
    poolKey: { ...market.poolKey, currency0: other, currency1: token }
  });
  assert.equal(nonNative.status, "not-run");

  console.log("Uniswap v4 hook evidence and no-broadcast sell rehearsal fail closed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
