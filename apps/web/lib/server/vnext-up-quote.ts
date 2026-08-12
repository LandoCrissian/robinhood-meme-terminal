import {
  createPublicClient,
  encodePacked,
  getAddress,
  http,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { ROBINHOOD_WETH_ADDRESS, isRobinhoodNativeAsset } from "../vnext/robinhood-assets";

// Contract identities are independently pinned to the current official up.
// production app record and Robinhood Blockscout verified source. Quote-time
// runtime hashes and dependency getters are checked again before any result is
// admitted. This module is observation-only; the CL ABI is Slipstream-specific.
export const UP_OFFICIAL_DEPLOYMENT_RECORD = "https://up33.xyz/assets/index-Cx7kG_8N.js";
export const UP_BLOCKSCOUT_CONTRACT_ROOT = "https://robinhoodchain.blockscout.com/address/";
export const UP_V2_FACTORY = getAddress("0xFA5429AEBa338BEa2BFcc1b9a889862Ee395bc28");
export const UP_V2_ROUTER = getAddress("0xf5198743240fAC98db71868F34c70139b1eb0474");
export const UP_CL_FACTORY = getAddress("0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3");
export const UP_CL_QUOTER = getAddress("0x03983AB2C057a2eac211ff01738a1e49ff325B49");

export const UP_V2_FACTORY_RUNTIME_HASH = "0x7f75a8c0d40ae515facdb48ef7c9deea450868acb62bf3d4a17282e690a64e8d" as Hex;
export const UP_V2_ROUTER_RUNTIME_HASH = "0x89938637dfedb772e3cfca5efa5694db4e54960c96d56bb0b47ee634330dfaef" as Hex;
export const UP_CL_FACTORY_RUNTIME_HASH = "0x4350c8fcdf90361969542249d76c25d6afbd31f10bebf0134bfe21beba1e8f4c" as Hex;
export const UP_CL_QUOTER_RUNTIME_HASH = "0x1ed81396c831d69a6c59384019850c21ac672d24ae83b4b26304a7384e1e4096" as Hex;

const BPS = 10_000n;
const INDICATIVE_PROTECTION_BPS = 100n;
const MAX_TICK_SPACINGS = 16;
const MAX_CL_HOP_CANDIDATES = 64;

const v2FactoryAbi = [{
  type: "function", name: "getPool", stateMutability: "view",
  inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "stable", type: "bool" }],
  outputs: [{ name: "pool", type: "address" }]
}, {
  type: "function", name: "isPool", stateMutability: "view",
  inputs: [{ name: "pool", type: "address" }], outputs: [{ name: "registered", type: "bool" }]
}, {
  type: "function", name: "getFee", stateMutability: "view",
  inputs: [{ name: "pool", type: "address" }, { name: "stable", type: "bool" }], outputs: [{ name: "fee", type: "uint256" }]
}] as const;

const v2RouterAbi = [{
  type: "function", name: "defaultFactory", stateMutability: "view", inputs: [], outputs: [{ name: "factory", type: "address" }]
}, {
  type: "function", name: "weth", stateMutability: "view", inputs: [], outputs: [{ name: "wrappedNative", type: "address" }]
}, {
  type: "function", name: "getAmountsOut", stateMutability: "view",
  inputs: [
    { name: "amountIn", type: "uint256" },
    { name: "routes", type: "tuple[]", components: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "stable", type: "bool" }, { name: "factory", type: "address" }
    ] }
  ],
  outputs: [{ name: "amounts", type: "uint256[]" }]
}] as const;

const clFactoryAbi = [{
  type: "function", name: "tickSpacings", stateMutability: "view", inputs: [], outputs: [{ name: "spacings", type: "int24[]" }]
}, {
  type: "function", name: "getPool", stateMutability: "view",
  inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "tickSpacing", type: "int24" }],
  outputs: [{ name: "pool", type: "address" }]
}, {
  type: "function", name: "isPool", stateMutability: "view",
  inputs: [{ name: "pool", type: "address" }], outputs: [{ name: "registered", type: "bool" }]
}] as const;

const clPoolAbi = [{
  type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ name: "fee", type: "uint24" }]
}] as const;

const clQuoterAbi = [{
  type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ name: "factory", type: "address" }]
}, {
  type: "function", name: "WETH9", stateMutability: "view", inputs: [], outputs: [{ name: "wrappedNative", type: "address" }]
}, {
  type: "function", name: "quoteExactInputSingle", stateMutability: "nonpayable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "tickSpacing", type: "int24" },
    { name: "sqrtPriceLimitX96", type: "uint160" }
  ] }],
  outputs: [
    { name: "amountOut", type: "uint256" }, { name: "sqrtPriceX96After", type: "uint160" },
    { name: "initializedTicksCrossed", type: "uint32" }, { name: "gasEstimate", type: "uint256" }
  ]
}, {
  type: "function", name: "quoteExactInput", stateMutability: "nonpayable",
  inputs: [{ name: "path", type: "bytes" }, { name: "amountIn", type: "uint256" }],
  outputs: [
    { name: "amountOut", type: "uint256" }, { name: "sqrtPriceX96AfterList", type: "uint160[]" },
    { name: "initializedTicksCrossedList", type: "uint32[]" }, { name: "gasEstimate", type: "uint256" }
  ]
}] as const;

export type UpQuoteSnapshot = Readonly<{ blockNumber: bigint; blockHash: Hex }>;
export type UpV2RouteLeg = Readonly<{ from: Address; to: Address; stable: boolean; pool: Address; fee: number }>;
export type UpClRouteLeg = Readonly<{ from: Address; to: Address; tickSpacing: number; pool: Address; fee: number }>;
export type UpObservedQuote = Readonly<{
  amountOut: bigint;
  protectedAmountOut: bigint;
  routeKind: "direct" | "weth_hop";
  snapshot: UpQuoteSnapshot;
  legs: readonly (UpV2RouteLeg | UpClRouteLeg)[];
}>;

export type UpQuoteReader = {
  snapshot(): Promise<UpQuoteSnapshot>;
  confirmSnapshot(snapshot: UpQuoteSnapshot): Promise<void>;
  verifyV2(snapshot: UpQuoteSnapshot): Promise<void>;
  verifyCl(snapshot: UpQuoteSnapshot): Promise<void>;
  v2Pool(tokenA: Address, tokenB: Address, stable: boolean, snapshot: UpQuoteSnapshot): Promise<Address>;
  v2PoolRecognized(pool: Address, snapshot: UpQuoteSnapshot): Promise<boolean>;
  v2Fee(pool: Address, stable: boolean, snapshot: UpQuoteSnapshot): Promise<bigint>;
  v2AmountsOut(amountIn: bigint, legs: readonly UpV2RouteLeg[], snapshot: UpQuoteSnapshot): Promise<readonly bigint[]>;
  clTickSpacings(snapshot: UpQuoteSnapshot): Promise<readonly number[]>;
  clPool(tokenA: Address, tokenB: Address, tickSpacing: number, snapshot: UpQuoteSnapshot): Promise<Address>;
  clPoolRecognized(pool: Address, snapshot: UpQuoteSnapshot): Promise<boolean>;
  clFee(pool: Address, snapshot: UpQuoteSnapshot): Promise<number>;
  clAmountOut(amountIn: bigint, legs: readonly UpClRouteLeg[], snapshot: UpQuoteSnapshot): Promise<bigint>;
};

function rpcUrl() {
  const value = process.env.RMT_VNEXT_UP_RPC_URL?.trim()
    || process.env.RMT_MAINNET_RPC_URL?.trim()
    || process.env.ROBINHOOD_MAINNET_RPC_URL?.trim()
    || robinhoodChain.rpcUrls.default.http[0];
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("up. observation RPC must use HTTPS without embedded basic-auth credentials.");
  return value;
}

function assertRuntime(code: Hex | undefined, expected: Hex, label: string) {
  if (!code || keccak256(code).toLowerCase() !== expected.toLowerCase()) throw new Error(`${label} runtime bytecode is not approved.`);
}

function asBlockHash(value: Hex | null) {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("up. quote block hash is unavailable.");
  return value.toLowerCase() as Hex;
}

function liveReader(client: PublicClient): UpQuoteReader {
  return {
    async snapshot() {
      const block = await client.getBlock({ blockTag: "latest" });
      return { blockNumber: block.number, blockHash: asBlockHash(block.hash) };
    },
    async confirmSnapshot(snapshot) {
      const block = await client.getBlock({ blockNumber: snapshot.blockNumber });
      if (asBlockHash(block.hash) !== snapshot.blockHash) throw new Error("up. quote block was reorganized.");
    },
    async verifyV2(snapshot) {
      const [factoryCode, routerCode, factory, weth] = await Promise.all([
        client.getBytecode({ address: UP_V2_FACTORY, blockNumber: snapshot.blockNumber }),
        client.getBytecode({ address: UP_V2_ROUTER, blockNumber: snapshot.blockNumber }),
        client.readContract({ address: UP_V2_ROUTER, abi: v2RouterAbi, functionName: "defaultFactory", blockNumber: snapshot.blockNumber }),
        client.readContract({ address: UP_V2_ROUTER, abi: v2RouterAbi, functionName: "weth", blockNumber: snapshot.blockNumber })
      ]);
      assertRuntime(factoryCode, UP_V2_FACTORY_RUNTIME_HASH, "up v2 factory");
      assertRuntime(routerCode, UP_V2_ROUTER_RUNTIME_HASH, "up v2 router");
      if (getAddress(factory) !== UP_V2_FACTORY || getAddress(weth) !== ROBINHOOD_WETH_ADDRESS) throw new Error("up v2 router dependencies changed.");
    },
    async verifyCl(snapshot) {
      const [factoryCode, quoterCode, factory, weth] = await Promise.all([
        client.getBytecode({ address: UP_CL_FACTORY, blockNumber: snapshot.blockNumber }),
        client.getBytecode({ address: UP_CL_QUOTER, blockNumber: snapshot.blockNumber }),
        client.readContract({ address: UP_CL_QUOTER, abi: clQuoterAbi, functionName: "factory", blockNumber: snapshot.blockNumber }),
        client.readContract({ address: UP_CL_QUOTER, abi: clQuoterAbi, functionName: "WETH9", blockNumber: snapshot.blockNumber })
      ]);
      assertRuntime(factoryCode, UP_CL_FACTORY_RUNTIME_HASH, "up CL factory");
      assertRuntime(quoterCode, UP_CL_QUOTER_RUNTIME_HASH, "up CL quoter");
      if (getAddress(factory) !== UP_CL_FACTORY || getAddress(weth) !== ROBINHOOD_WETH_ADDRESS) throw new Error("up CL quoter dependencies changed.");
    },
    v2Pool: (tokenA, tokenB, stable, snapshot) => client.readContract({ address: UP_V2_FACTORY, abi: v2FactoryAbi, functionName: "getPool", args: [tokenA, tokenB, stable], blockNumber: snapshot.blockNumber }),
    v2PoolRecognized: (pool, snapshot) => client.readContract({ address: UP_V2_FACTORY, abi: v2FactoryAbi, functionName: "isPool", args: [pool], blockNumber: snapshot.blockNumber }),
    v2Fee: (pool, stable, snapshot) => client.readContract({ address: UP_V2_FACTORY, abi: v2FactoryAbi, functionName: "getFee", args: [pool, stable], blockNumber: snapshot.blockNumber }),
    v2AmountsOut: (amountIn, legs, snapshot) => client.readContract({
      address: UP_V2_ROUTER, abi: v2RouterAbi, functionName: "getAmountsOut", blockNumber: snapshot.blockNumber,
      args: [amountIn, legs.map((leg) => ({ from: leg.from, to: leg.to, stable: leg.stable, factory: UP_V2_FACTORY }))]
    }),
    async clTickSpacings(snapshot) {
      return await client.readContract({ address: UP_CL_FACTORY, abi: clFactoryAbi, functionName: "tickSpacings", blockNumber: snapshot.blockNumber });
    },
    clPool: (tokenA, tokenB, tickSpacing, snapshot) => client.readContract({ address: UP_CL_FACTORY, abi: clFactoryAbi, functionName: "getPool", args: [tokenA, tokenB, tickSpacing], blockNumber: snapshot.blockNumber }),
    clPoolRecognized: (pool, snapshot) => client.readContract({ address: UP_CL_FACTORY, abi: clFactoryAbi, functionName: "isPool", args: [pool], blockNumber: snapshot.blockNumber }),
    clFee: (pool, snapshot) => client.readContract({ address: pool, abi: clPoolAbi, functionName: "fee", blockNumber: snapshot.blockNumber }),
    async clAmountOut(amountIn, legs, snapshot) {
      if (legs.length === 1) {
        const result = await client.simulateContract({
          address: UP_CL_QUOTER, abi: clQuoterAbi, functionName: "quoteExactInputSingle", blockNumber: snapshot.blockNumber,
          args: [{ tokenIn: legs[0].from, tokenOut: legs[0].to, amountIn, tickSpacing: legs[0].tickSpacing, sqrtPriceLimitX96: 0n }]
        });
        return result.result[0];
      }
      const path = encodePacked(
        ["address", "int24", "address", "int24", "address"],
        [legs[0].from, legs[0].tickSpacing, legs[0].to, legs[1].tickSpacing, legs[1].to]
      );
      const result = await client.simulateContract({ address: UP_CL_QUOTER, abi: clQuoterAbi, functionName: "quoteExactInput", args: [path, amountIn], blockNumber: snapshot.blockNumber });
      return result.result[0];
    }
  };
}

let defaultReader: UpQuoteReader | null = null;
function reader() {
  if (defaultReader) return defaultReader;
  defaultReader = liveReader(createPublicClient({
    chain: robinhoodChain,
    transport: http(rpcUrl(), { retryCount: 1, timeout: 5_000, batch: { batchSize: 64, wait: 0 } })
  }));
  return defaultReader;
}

function quoteAssets(inputAsset: Address, outputAsset: Address) {
  const input = isRobinhoodNativeAsset(inputAsset) ? ROBINHOOD_WETH_ADDRESS : getAddress(inputAsset);
  const output = isRobinhoodNativeAsset(outputAsset) ? ROBINHOOD_WETH_ADDRESS : getAddress(outputAsset);
  if (input === output) throw new Error("up. quote input and output resolve to the same asset.");
  return { input, output };
}

function protectedAmount(amountOut: bigint) {
  const value = amountOut * (BPS - INDICATIVE_PROTECTION_BPS) / BPS;
  if (value <= 0n) throw new Error("up. quote cannot produce a protected output.");
  return value;
}

function bestQuote<T extends UpObservedQuote>(results: PromiseSettledResult<T>[]) {
  return results
    .filter((result): result is PromiseFulfilledResult<T> => result.status === "fulfilled" && result.value.amountOut > 0n)
    .map((result) => result.value)
    .sort((left, right) => left.amountOut === right.amountOut ? 0 : left.amountOut > right.amountOut ? -1 : 1)[0] ?? null;
}

export async function quoteUpV2(input: { inputAsset: Address; outputAsset: Address; amountIn: bigint }, source: UpQuoteReader = reader()) {
  if (input.amountIn <= 0n) throw new Error("up v2 quote amount must be positive.");
  const assets = quoteAssets(input.inputAsset, input.outputAsset);
  const snapshot = await source.snapshot();
  await source.verifyV2(snapshot);
  const routeShapes: Array<Array<{ from: Address; to: Address; stable: boolean }>> = [
    [{ from: assets.input, to: assets.output, stable: false }],
    [{ from: assets.input, to: assets.output, stable: true }]
  ];
  if (assets.input !== ROBINHOOD_WETH_ADDRESS && assets.output !== ROBINHOOD_WETH_ADDRESS) {
    for (const firstStable of [false, true]) for (const secondStable of [false, true]) routeShapes.push([
      { from: assets.input, to: ROBINHOOD_WETH_ADDRESS, stable: firstStable },
      { from: ROBINHOOD_WETH_ADDRESS, to: assets.output, stable: secondStable }
    ]);
  }
  const attempts = await Promise.allSettled(routeShapes.map(async (shape): Promise<UpObservedQuote> => {
    const legs = await Promise.all(shape.map(async (leg): Promise<UpV2RouteLeg> => {
      const pool = await source.v2Pool(leg.from, leg.to, leg.stable, snapshot);
      if (pool === zeroAddress || !await source.v2PoolRecognized(pool, snapshot)) throw new Error("up v2 pool is unavailable.");
      const rawFee = await source.v2Fee(pool, leg.stable, snapshot);
      if (rawFee < 0n || rawFee > 300n) throw new Error("up v2 live fee is outside the reviewed domain.");
      return { ...leg, pool: getAddress(pool), fee: Number(rawFee) };
    }));
    const amounts = await source.v2AmountsOut(input.amountIn, legs, snapshot);
    if (amounts.length !== legs.length + 1 || amounts[0] !== input.amountIn || amounts.at(-1)! <= 0n) throw new Error("up v2 returned inconsistent quote economics.");
    const amountOut = amounts.at(-1)!;
    return { amountOut, protectedAmountOut: protectedAmount(amountOut), routeKind: legs.length === 1 ? "direct" : "weth_hop", snapshot, legs };
  }));
  const best = bestQuote(attempts);
  await source.confirmSnapshot(snapshot);
  return best;
}

async function clPools(source: UpQuoteReader, tokenA: Address, tokenB: Address, spacings: readonly number[], snapshot: UpQuoteSnapshot) {
  const results = await Promise.all(spacings.map(async (tickSpacing): Promise<UpClRouteLeg | null> => {
    const pool = await source.clPool(tokenA, tokenB, tickSpacing, snapshot);
    if (pool === zeroAddress || !await source.clPoolRecognized(pool, snapshot)) return null;
    const fee = await source.clFee(pool, snapshot);
    if (!Number.isSafeInteger(fee) || fee < 0 || fee > 1_000_000) throw new Error("up CL live fee is outside the reviewed domain.");
    return { from: tokenA, to: tokenB, tickSpacing, pool: getAddress(pool), fee };
  }));
  return results.filter((leg): leg is UpClRouteLeg => leg !== null);
}

export async function quoteUpCl(input: { inputAsset: Address; outputAsset: Address; amountIn: bigint }, source: UpQuoteReader = reader()) {
  if (input.amountIn <= 0n) throw new Error("up CL quote amount must be positive.");
  const assets = quoteAssets(input.inputAsset, input.outputAsset);
  const snapshot = await source.snapshot();
  await source.verifyCl(snapshot);
  const spacings = [...new Set(await source.clTickSpacings(snapshot))];
  if (spacings.length === 0 || spacings.length > MAX_TICK_SPACINGS || spacings.some((value) => !Number.isSafeInteger(value) || value <= 0 || value > 16_383)) throw new Error("up CL tick-spacing registry is outside the reviewed domain.");
  const direct = await clPools(source, assets.input, assets.output, spacings, snapshot);
  const routes: UpClRouteLeg[][] = direct.map((leg) => [leg]);
  if (assets.input !== ROBINHOOD_WETH_ADDRESS && assets.output !== ROBINHOOD_WETH_ADDRESS) {
    const [firstLegs, secondLegs] = await Promise.all([
      clPools(source, assets.input, ROBINHOOD_WETH_ADDRESS, spacings, snapshot),
      clPools(source, ROBINHOOD_WETH_ADDRESS, assets.output, spacings, snapshot)
    ]);
    const hopRoutes = firstLegs.flatMap((first) => secondLegs.map((second) => [first, second]));
    if (hopRoutes.length > MAX_CL_HOP_CANDIDATES) throw new Error("up CL route fanout exceeds the reviewed bound.");
    routes.push(...hopRoutes);
  }
  const attempts = await Promise.allSettled(routes.map(async (legs): Promise<UpObservedQuote> => {
    const amountOut = await source.clAmountOut(input.amountIn, legs, snapshot);
    if (amountOut <= 0n) throw new Error("up CL returned an invalid output.");
    return { amountOut, protectedAmountOut: protectedAmount(amountOut), routeKind: legs.length === 1 ? "direct" : "weth_hop", snapshot, legs };
  }));
  const best = bestQuote(attempts);
  await source.confirmSnapshot(snapshot);
  return best;
}
