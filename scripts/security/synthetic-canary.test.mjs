import assert from "node:assert/strict";
import test from "node:test";
import {canaryEntropy,syntheticCanaryText} from "./synthetic-canary.mjs";

test("generated canaries have bounded supported syntax and admitted entropy, without publishing their bytes", () => {
  const seen = new Set();
  for (let i = 0; i < 64; i++) {
    const text = syntheticCanaryText(), match = text.match(/^api_key = "([0-9a-f]{96})"\n$/);
    assert.ok(match); assert.ok(canaryEntropy(match[1]) >= 3.75); assert.ok(!seen.has(text)); seen.add(text);
  }
});
test("a below-threshold randomness source is rejected after a finite bound", () => {
  let calls = 0;
  assert.throws(() => syntheticCanaryText(() => {calls++; return Buffer.alloc(48);}), /entropy admission/);
  assert.equal(calls, 32);
});
test("wrong randomness types and byte lengths never generate a detector control", () => {
  for (const source of [() => Buffer.alloc(32), () => "invalid", () => null]) assert.throws(() => syntheticCanaryText(source));
});
test("entropy calculation recognizes a constant and a uniform hexadecimal alphabet", () => {
  assert.equal(canaryEntropy("a".repeat(96)), 0);
  assert.equal(canaryEntropy("0123456789abcdef".repeat(6)), 4);
});
