import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deriveVNextAuthorizationTiming,
  VNEXT_AUTHORIZATION_WINDOW_SECONDS,
  VNEXT_MAX_AUTHORIZATION_WINDOW_SECONDS,
  VNEXT_MINIMUM_WALLET_REVIEW_RUNWAY_MS,
  VNEXT_PLAN_MAX_AGE_MS,
  vNextAuthorizationRpcUrl
} from "./vnext-authorization-time";
import { vNextAuthorizationRequestSchema } from "./vnext-authorization-request";

const chainTimestamp = 1_788_101_000n;
const preparedAtMs = Number(chainTimestamp * 1_000n) + 1_000;
const timing = deriveVNextAuthorizationTiming(chainTimestamp, preparedAtMs);
assert.equal(VNEXT_AUTHORIZATION_WINDOW_SECONDS, 240n);
assert.equal(VNEXT_MAX_AUTHORIZATION_WINDOW_SECONDS, 300n);
assert.equal(VNEXT_PLAN_MAX_AGE_MS, 60_000);
assert.equal(VNEXT_MINIMUM_WALLET_REVIEW_RUNWAY_MS, 180_000);
assert.equal(timing.deadlineSeconds, chainTimestamp + 240n);
assert.equal(timing.expiresAtMs, preparedAtMs + 59_000);
assert.equal(timing.expiresAtMs <= timing.deadlineMs - 180_000, true);
assert.throws(() => deriveVNextAuthorizationTiming(chainTimestamp, preparedAtMs + 31_000), /Chain time/);
assert.throws(() => deriveVNextAuthorizationTiming(chainTimestamp, preparedAtMs - 7_000), /Chain time/);
assert.equal(vNextAuthorizationRpcUrl({
  RMT_RPC_URL: "https://server-authority.invalid",
  RMT_MAINNET_RPC_URL: "https://legacy-server.invalid",
  ROBINHOOD_MAINNET_RPC_URL: "https://compatible-server.invalid",
  NEXT_PUBLIC_RMT_RPC_URL: "https://public-fallback.invalid"
}, "https://default.invalid"), "https://server-authority.invalid");

const request = {
  chainId: 4_663,
  quoteRequestId: "11111111-1111-4111-8111-111111111111",
  verificationId: "22222222-2222-4222-8222-222222222222",
  provider: "uniswap-v3",
  settlementMode: "DIRECT_NO_RMT_FEE",
  inputAsset: "0x1111111111111111111111111111111111111111",
  outputAsset: "0x2222222222222222222222222222222222222222",
  inputAmountAtomic: "100000000000000",
  recipient: "0x3333333333333333333333333333333333333333",
  expectedStatus: "verified",
  indicativeProtectedOutputFloorAtomic: "980",
  expectedProtectedOutputAtomic: "990"
};
assert.equal(vNextAuthorizationRequestSchema.safeParse(request).success, true);
assert.equal(vNextAuthorizationRequestSchema.safeParse({ ...request, deadline: "1788101461" }).success, false,
  "the browser cannot supply, preserve, shorten, or extend the final onchain deadline");

const route = readFileSync(new URL("../../app/api/vnext/authorize/route.ts", import.meta.url), "utf8");
const timeAuthority = readFileSync(new URL("./vnext-authorization-time.ts", import.meta.url), "utf8");
const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
assert.match(route, /readVNextAuthorizationChainTimestamp/);
assert.match(route, /deadlineSeconds: finalDeadlineSeconds/);
assert.match(route, /nowMs: authorizationWallClockMs/);
assert.doesNotMatch(route, /nowMs: Number\(chainTimestampSeconds \* 1_000n\)/);
assert.ok(timeAuthority.lastIndexOf("env.RMT_RPC_URL") < timeAuthority.lastIndexOf("env.RMT_MAINNET_RPC_URL"));
assert.doesNotMatch(composer, /deadline:\s*evidence\.deadline/);

console.log("RMT server-owned authorization deadline and wallet-review runway smoke checks passed.");
