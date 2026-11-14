import { isTransactionHash } from "./test-creation";

// The Base Sepolia fork identities admitted by #594 and checked again on Anvil 31337.
export const testV4Pins = {
  poolManager: { address: "0x05e73354cfdd6745c338b50bcfdfa3aa6fa03408", hash: "0x03c45db6d09b14da7c1f7239a5a49697f976d395277e6d2acb6fbed3f9e0249f" },
  positionManager: { address: "0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80", hash: "0xe8329b35b8b34290b6cf03affc0836f7b23205229cc96ffdc66544b93112c076" },
  router: { address: "0x8702463e73f74d0b6765abceb314ef07acb92650", hash: "0x2aa613cbe4bce524d53cb3ed1d6a8924d9ef1ccd00b250b64aa77c8eb376bf7e" },
  permit2: { address: "0x000000000022d473030f116ddee9f6b43ac78ba3", hash: "0xdcde65555316946c298e4c60c6213eb5c3aeab4354d1f3fac5427236bcbb9ebe" },
  quoter: { address: "0x5e6b8b8afa7e5cef6c09dd2a67aba9fb12c75623", hash: "0x146bee3fc52c77af0dea3bb02e5d733841cd7e682e359c9b08b6ab2b36797c7f" },
  stateView: { address: "0x571291b572ed32ce6751a2cb2486ebee8defb9b4", hash: "0x0e54f1b36938b15a1d4207f9cfe5e13eee61c5393c7a498e859d5bdc86999c39" },
} as const;
export const testPoolFeePips = 3000;
export const testPermit2Lifetime = 720n;
export const testV4RouterSignature = "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable" as const;
export const testV4PermitSignature = "function approve(address token,address spender,uint160 amount,uint48 expiration)" as const;
export const testLpCollectSignature = "function collectLpFees(address token,uint256 deadline) returns (uint256,uint256)" as const;
export const testLpClaimSignature = "function claim() returns (uint256,uint256)" as const;
const nativeAsset = "0x0000000000000000000000000000000000000000";

type Address = `0x${string}`;
export type TestV4PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
export type TestV4Binding = { poolKey: TestV4PoolKey; poolId: Address; ledger: Address; engine: Address };
export type TestLpAmounts = { nativeWei: string; tokenWei: string };

const address = (value: unknown): value is Address => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0+$/i.test(value);
export function isTestV4Binding(value: unknown, token: string): value is TestV4Binding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v4 = value as Partial<TestV4Binding>;
  const key = v4.poolKey;
  return Object.keys(v4).length === 4 && isTransactionHash(v4.poolId) && address(v4.ledger) && address(v4.engine)
    && !!key && typeof key === "object" && !Array.isArray(key) && Object.keys(key).length === 5
    && key.currency0 === nativeAsset && address(key.currency1) && key.currency1.toLowerCase() === token.toLowerCase()
    && key.fee === testPoolFeePips && key.tickSpacing === 60 && address(key.hooks) && (BigInt(key.hooks) & 0x3fffn) === 0x2000n;
}

export function sameTestV4Binding(a: TestV4Binding | undefined, b: TestV4Binding | undefined) {
  if (!a || !b) return a === b;
  return a.poolId.toLowerCase() === b.poolId.toLowerCase() && a.ledger.toLowerCase() === b.ledger.toLowerCase()
    && a.engine.toLowerCase() === b.engine.toLowerCase()
    && a.poolKey.currency0 === b.poolKey.currency0 && a.poolKey.currency1.toLowerCase() === b.poolKey.currency1.toLowerCase()
    && a.poolKey.hooks.toLowerCase() === b.poolKey.hooks.toLowerCase() && a.poolKey.fee === b.poolKey.fee
    && a.poolKey.tickSpacing === b.poolKey.tickSpacing;
}

const poolKeyParameter = { name: "poolKey", type: "tuple", components: [
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
] } as const;

export async function testV4PoolId(poolKey: TestV4PoolKey) {
  const { encodeAbiParameters, keccak256 } = await import("viem");
  return keccak256(encodeAbiParameters([poolKeyParameter], [poolKey]));
}

/** The v4 exact-in path and per-hop floor are adapted from #594's direct-v4.ts, fixed to Router 2.1.2 here. */
export async function encodeTestV4Swap(poolKey: TestV4PoolKey, buy: boolean, amountIn: bigint, minimumOut: bigint, deadline: bigint) {
  const { encodeAbiParameters, encodeFunctionData, parseAbi } = await import("viem");
  const minHopPriceX36 = minimumOut * 10n ** 36n / amountIn;
  if (!minHopPriceX36) throw new Error("The minimum per-hop price is outside the supported range.");
  const swap = encodeAbiParameters([{ type: "tuple", components: [
    poolKeyParameter, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" },
    { name: "amountOutMinimum", type: "uint128" }, { name: "minHopPriceX36", type: "uint256" }, { name: "hookData", type: "bytes" },
  ] }], [{ poolKey, zeroForOne: buy, amountIn, amountOutMinimum: minimumOut, minHopPriceX36, hookData: "0x" }]);
  const [input, output] = buy ? [poolKey.currency0, poolKey.currency1] : [poolKey.currency1, poolKey.currency0];
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], [input, amountIn, true]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [output, minimumOut]);
  const actions = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x060b0f", [swap, settle, take]]);
  return encodeFunctionData({ abi: parseAbi([testV4RouterSignature]), functionName: "execute", args: ["0x10", [actions], deadline] });
}
