import assert from "node:assert/strict";
import { test } from "node:test";
import { openingExamples } from "./opening-examples";

test("full-range opening examples use independent exact inputs and v4 rounded output", () => {
  const deposit = 100n * 10n ** 18n;
  const position = { depositedETH: deposit, depositedTokens: deposit, sqrtPrice: 1n << 96n, liquidity: deposit };
  const example = openingExamples(position);
  assert.equal(example.grossBuy, 10n ** 18n);
  assert.equal(example.grossSell, example.grossBuy);
  assert.equal(example.tokensOut, 987158034397061298n);
  assert.equal(example.nativeOut, 987158034397061298n);
  assert.ok(example.tokensOut < example.grossBuy);
});
