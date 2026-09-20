import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import type { EnvelopeReason } from "../vnext/execution-envelope-diagnostic";
import { fromZeroXToken } from "../vnext/zero-x-settlement";

/** Exact 1df9087 FlashAccountingCommon/EkuboV3/UniswapV4 packed grammar.
 * These are non-VIP actions: Encoder.encode fixes payer=Settler. No fill contains
 * a withdrawal authority or transfer recipient. The outer action must return to
 * Settler and the execute envelope performs the final post-fee output check.
 */
export function decodeZeroXPackedRoute(input: {
  kind: "EKUBOV3" | "UNISWAPV4"; token: Address; fills: Hex;
  hashMul: bigint; hashMod: bigint; minimum: bigint;
}, fail: (reason: EnvelopeReason) => never) {
  const { kind, fills, hashMul, hashMod, minimum } = input;
  if (!/^0x(?:[0-9a-f]{2})*$/i.test(fills) || fills.length > 131074) fail("ROUTE_FILL_ENCODING_INVALID");
  // Encoder scales both hash arguments by 96 and stores uint128 fields.
  if (hashMul <= 0n || hashMod <= 0n || hashMul * 96n >= 2n ** 128n
    || hashMod * 96n >= 2n ** 128n || minimum >= 2n ** 128n) fail("ROUTE_HASH_INVALID");
  let cursor = 2, sell = getAddress(input.token), buy = sell;
  const known = new Set<Address>([sell]);
  const take = (bytes: number) => {
    const end = cursor + bytes * 2;
    if (end > fills.length) return fail("ROUTE_FILL_TRUNCATED");
    const value = fills.slice(cursor, end); cursor = end; return value;
  };
  const uint = (bytes: number) => BigInt(`0x${take(bytes)}`);
  const address = () => getAddress(`0x${take(20)}`);
  const parsed = [];
  while (cursor < fills.length) {
    if (parsed.length >= 16) fail("ROUTE_FILL_LIMIT");
    const encodedRate = uint(3);
    const forwarding = kind === "EKUBOV3" && (encodedRate & 0x800000n) !== 0n;
    const proportion = kind === "EKUBOV3" ? encodedRate & 0x7fffffn : encodedRate;
    const priceLimit = uint(kind === "EKUBOV3" ? 12 : 20);
    const key = Number(uint(1));
    if (proportion === 0n || proportion > 1_000_000n || key > 3 || (parsed.length === 0 && key !== 1)) fail("ROUTE_FILL_ENCODING_INVALID");
    if (key === 2) sell = buy;
    if (key === 3) sell = address();
    if (key !== 0) buy = address();
    if (sell === zeroAddress || buy === zeroAddress) fail("ROUTE_FILL_ENCODING_INVALID");
    if (sell === buy) fail("ROUTE_SELF_SWAP");
    if (!known.has(sell)) fail("ROUTE_INPUT_MISMATCH");
    known.add(buy);
    // NotesLib has eight slots; collisions revert onchain, not alias balances.
    if (known.size > 8) fail("ROUTE_FILL_LIMIT");
    const currency0 = fromZeroXToken(sell), currency1 = fromZeroXToken(buy);
    const zeroForOne = BigInt(currency0) < BigInt(currency1);
    const poolTokens = zeroForOne ? [currency0, currency1] : [currency1, currency0];
    if (kind === "EKUBOV3") {
      const extension = address(), fee = uint(8), poolType = uint(4);
      // Forwarding has extension-defined return data, unlike CORE.swap. No
      // arbitrary extension implementation is admitted by its address alone.
      if (forwarding || extension !== zeroAddress) fail("UNSUPPORTED_EKUBO_EXTENSION");
      if ((poolType & 0x80000000n) !== 0n) {
        const spacing = poolType & 0x7fffffffn;
        if (spacing === 0n || spacing > 698605n) fail("ROUTE_POOL_INVALID");
      } else {
        const amp = poolType >> 24n;
        const center = BigInt.asIntN(24, poolType & 0xffffffn) * 16n;
        if (amp > 26n || center < -88722835n || center > 88722835n) fail("ROUTE_POOL_INVALID");
      }
      parsed.push({ sell, buy, proportion, priceLimit, zeroForOne, poolTokens, extension, forwarding, fee, poolType });
    } else {
      const fee = uint(3), tickSpacing = BigInt.asIntN(24, uint(3)), hook = address();
      const hookBytes = Number(uint(3));
      if (hookBytes > 8192) fail("ROUTE_HOOK_DATA_LIMIT");
      take(hookBytes);
      // PoolManager validates PoolKey; dynamic fee is the single flag 0x800000.
      if ((fee > 1_000_000n && fee !== 0x800000n) || tickSpacing <= 0n || tickSpacing > 32767n) fail("ROUTE_POOL_INVALID");
      const flags = BigInt(hook) & 0x3fffn;
      if (hook === zeroAddress && fee === 0x800000n) fail("ROUTE_POOL_INVALID");
      if (hook !== zeroAddress && flags === 0n && fee !== 0x800000n) fail("UNSUPPORTED_HOOK");
      // Return-delta permissions require their corresponding callback permission.
      for (const [delta, callback] of [[3n, 7n], [2n, 6n], [1n, 10n], [0n, 8n]]) {
        if ((flags & (1n << delta)) && !(flags & (1n << callback))) fail("UNSUPPORTED_HOOK");
      }
      // Hook data is opaque *to the fixed PoolManager*, not a Settler call. The
      // authenticated callback checks debit <= route credit, nonnegative output,
      // and pays from Settler only. Global minimum/recipient checks remain final.
      parsed.push({ sell, buy, proportion, priceLimit, zeroForOne, poolTokens, fee, tickSpacing, hook, hookBytes });
    }
  }
  if (!parsed.length) fail("ROUTE_FILL_ENCODING_INVALID");
  return { output: fromZeroXToken(buy), tokens: [...known].map(fromZeroXToken), fills: parsed };
}
