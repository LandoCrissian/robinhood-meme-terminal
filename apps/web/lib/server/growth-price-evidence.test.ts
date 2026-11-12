import assert from "node:assert/strict";
import { test } from "node:test";
import { toHex, zeroAddress } from "viem";
import {
  growthPricePolicy, validateGrowthPriceEvidence, withinActualPriceBps,
  type GrowthPriceBlock, type GrowthPriceMarket, type GrowthPriceObservation, type GrowthPriceSource,
} from "./growth-price-evidence";

const address = (value: number) => toHex(value, { size: 20 });
const hash = (value: number) => toHex(value, { size: 32 });
const now = 1_800_000_000n;
const q96 = 1n << 96n;
const token = address(2);
const market = (id: number): GrowthPriceMarket => ({ chainId: 31337, authority: address(id), marketId: hash(id) });
const target = { market: market(5), token };
const sources: GrowthPriceSource[] = [
  { market: market(6), venue: "venue-a", operator: "operator-a", authorityCodeHash: hash(16) },
  { market: market(7), venue: "venue-b", operator: "operator-b", authorityCodeHash: hash(17) },
];
const block = (number: number, secondsAgo: bigint): GrowthPriceBlock => ({
  number: BigInt(number), hash: hash(number), timestamp: now - secondsAgo,
});
const head = block(2000, 1n);
const observations: GrowthPriceObservation[] = sources.map((source, index) => ({
  market: source.market, token, quote: zeroAddress, method: "time-weighted",
  start: block(1000 + index, 3_630n - BigInt(index)), end: block(1995 + index, 30n - BigInt(index)),
  observations: 40n, minQuoteDepthWei: 10n * 10n ** 18n, sqrtPriceX96: q96 + q96 * BigInt(index) / 1_000n,
}));
const blocks = new Map([head, ...observations.flatMap(({ start, end }) => [start, end])]
  .map((value) => [value.number, value]));
const reader = {
  async getChainId() { return 31337; },
  async getHead() { return head; },
  async getCanonicalBlock(number: bigint) {
    const found = blocks.get(number);
    assert.ok(found);
    return found;
  },
  async getAuthorityCodeHash(authority: string) {
    const source = sources.find(({ market: candidate }) => candidate.authority === authority);
    assert.ok(source);
    return source.authorityCodeHash;
  },
  async getTargetSqrtPrice(key: GrowthPriceMarket, at: GrowthPriceBlock) {
    assert.deepEqual(key, target.market);
    assert.deepEqual(at, head);
    return q96;
  },
};
const evaluate = (
  evidence = observations, input = reader, registry = sources,
) => validateGrowthPriceEvidence(target, registry, evidence, input, now);
const fail = (reason: string) => ({ status: "unavailable", reason });

test("combines two pinned, distinct markets and returns the oldest observation deadline", async () => {
  const result = await evaluate();
  assert.equal(result.status, "verified");
  assert.equal(result.referenceSqrtPriceX96, (observations[0].sqrtPriceX96 + observations[1].sqrtPriceX96) / 2n);
  assert.equal(result.observedAt, observations[0].end.timestamp);
  assert.equal(result.validUntil, result.observedAt + growthPricePolicy.maxAgeSeconds);
  assert.deepEqual(result.sources.map(({ source }) => source), sources);
});

test("rejects absent independent markets, the target market, and the same operator or authority", async () => {
  for (const registry of [[], sources.slice(0, 1), [sources[0], { ...sources[1], market: target.market }],
    [sources[0], { ...sources[1], venue: sources[0].venue }],
    [sources[0], { ...sources[1], operator: sources[0].operator }],
    [sources[0], { ...sources[1], market: { ...sources[1].market, authority: sources[0].market.authority } }],
    [sources[0], { ...sources[1], market: { ...sources[1].market, chainId: 84532 } }]]) {
    assert.deepEqual(await evaluate(observations, reader, registry), fail("independent_sources_missing"));
  }
  assert.deepEqual(await evaluate([observations[0], observations[0]]), fail("invalid_observation"));
});

test("rejects future or stale observations, wrong assets, inadequate lookback and thin liquidity", async () => {
  const [a, b] = observations;
  assert.deepEqual(await evaluate([{ ...a, end: block(1995, 121n) }, b]), fail("stale"));
  assert.deepEqual(await evaluate([{ ...a, end: block(1995, -1n) }, b]), fail("stale"));
  assert.deepEqual(await evaluate([{ ...a, token: address(99) }, b]), fail("invalid_observation"));
  assert.deepEqual(await evaluate([{ ...a, start: block(1000, 1_000n) }, b]), fail("insufficient_history"));
  assert.deepEqual(await evaluate([{ ...a, observations: 11n }, b]), fail("insufficient_history"));
  assert.deepEqual(await evaluate([{ ...a, minQuoteDepthWei: growthPricePolicy.minQuoteDepthWei - 1n }, b]), fail("thin_market"));
  assert.deepEqual(await evaluate([a, { ...b, end: block(1996, 61n) }]), fail("stale"));
});

test("checks actual price bps and rejects source disagreement or manipulated target spot", async () => {
  const [a, b] = observations;
  assert.equal(withinActualPriceBps(10_049n * q96, 10_000n * q96, 100n), true);
  assert.equal(withinActualPriceBps(10_050n * q96, 10_000n * q96, 100n), false);
  assert.equal(withinActualPriceBps(9_950n * q96, 10_000n * q96, 100n), true);
  assert.deepEqual(await evaluate([a, { ...b, sqrtPriceX96: 1003n * q96 / 1000n }]), fail("source_disagreement"));
  assert.deepEqual(await evaluate(observations, { ...reader, async getTargetSqrtPrice() { return 101n * q96 / 100n; } }),
    fail("spot_outside_bounds"));
});

test("rejects insufficient confirmations, source and head reorgs, and runtime changes", async () => {
  const [a] = observations;
  const reorged = (number: bigint) => ({
    ...reader,
    async getCanonicalBlock(requested: bigint) {
      const canonical = await reader.getCanonicalBlock(requested);
      return requested === number ? { ...canonical, hash: hash(99) } : canonical;
    },
  });
  assert.deepEqual(await evaluate(observations, reorged(a.start.number)), fail("noncanonical"));
  assert.deepEqual(await evaluate(observations, reorged(a.end.number)), fail("noncanonical"));
  assert.deepEqual(await evaluate(observations, reorged(head.number)), fail("noncanonical"));
  assert.deepEqual(await evaluate(observations, { ...reader, async getAuthorityCodeHash() { return hash(99); } }), fail("noncanonical"));
  assert.deepEqual(await evaluate(observations, { ...reader, async getHead() { return block(1997, 1n); } }), fail("noncanonical"));
});

test("holds when verification RPC is unavailable or on the wrong chain", async () => {
  assert.deepEqual(await evaluate(observations, { ...reader, async getCanonicalBlock() { throw new Error("offline"); } }),
    fail("source_unavailable"));
  assert.deepEqual(await evaluate(observations, { ...reader, async getChainId() { return 1; } }), fail("wrong_chain"));
});
