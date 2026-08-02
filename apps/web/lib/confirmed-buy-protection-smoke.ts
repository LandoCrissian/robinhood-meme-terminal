import assert from "node:assert/strict";
import { parseEther, parseUnits } from "viem";
import { confirmedBuyProtectionSnapshot } from "./confirmed-buy-protection";

const newPosition = confirmedBuyProtectionSnapshot({
  beforeBalance: 0n,
  afterBalance: parseUnits("1000", 18),
  tokenDecimals: 18,
  amountInWei: parseEther("0.05"),
  ethUsd: 2_000,
  marketPriceUsd: 0.1
});
assert.ok(newPosition);
assert.equal(newPosition?.acquiredTokenBalance, 1_000);
assert.equal(newPosition?.basisUsd, 100);
assert.equal(newPosition?.basisKind, "confirmed-purchase");

const addedPosition = confirmedBuyProtectionSnapshot({
  beforeBalance: parseUnits("500", 18),
  afterBalance: parseUnits("1000", 18),
  tokenDecimals: 18,
  amountInWei: parseEther("0.025"),
  ethUsd: 2_000,
  marketPriceUsd: 0.2
});
assert.ok(addedPosition);
assert.equal(addedPosition?.basisUsd, 200);
assert.equal(addedPosition?.basisKind, "full-position-reference");

const marketFallback = confirmedBuyProtectionSnapshot({
  beforeBalance: 0n,
  afterBalance: parseUnits("10", 6),
  tokenDecimals: 6,
  amountInWei: parseEther("0.001"),
  marketPriceUsd: 0.25
});
assert.equal(marketFallback?.basisUsd, 2.5);
assert.equal(marketFallback?.basisKind, "market-estimate");
assert.equal(confirmedBuyProtectionSnapshot({
  beforeBalance: 1n,
  afterBalance: 1n,
  tokenDecimals: 18,
  amountInWei: 1n,
  marketPriceUsd: 1
}), null);

console.log("Confirmed buy protection smoke checks passed");
