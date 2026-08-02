import assert from "node:assert/strict";
import { decodeFunctionData } from "viem";
import { rmtPositionGuardExecutorAbi } from "../live-position-guard";
import {
  buildLivePositionGuardExecutorCall,
  livePositionGuardServerConfiguration
} from "./live-position-guard-execution";

assert.equal(livePositionGuardServerConfiguration({}), null);
assert.equal(livePositionGuardServerConfiguration({
  NEXT_PUBLIC_RMT_LIVE_POSITION_GUARD_ENABLED: "true",
  NEXT_PUBLIC_RMT_POSITION_GUARD_EXECUTOR: "0x0000000000000000000000000000000000000001",
  NEXT_PUBLIC_RMT_POSITION_GUARD_POLICY_ID: "policy_12345678",
  NEXT_PUBLIC_RMT_POSITION_GUARD_SIGNER_ID: "signer_12345678",
  NEXT_PUBLIC_PRIVY_APP_ID: "clx1234567890123456789012",
  PRIVY_APP_SECRET: "secret_12345678901234567890", // gitleaks:allow -- synthetic test fixture
  RMT_POSITION_GUARD_AUTHORIZATION_PRIVATE_KEY: Buffer.alloc(64, 1).toString("base64"),
  RMT_POSITION_GUARD_EVALUATOR_TOKEN: "evaluator_123456789012345678901234567890", // gitleaks:allow -- synthetic test fixture
  RMT_POSITION_GUARD_WORKER_ENABLED: "true"
})?.executor, "0x0000000000000000000000000000000000000001");

assert.equal(livePositionGuardServerConfiguration({
  NEXT_PUBLIC_RMT_LIVE_POSITION_GUARD_ENABLED: "true",
  NEXT_PUBLIC_RMT_POSITION_GUARD_EXECUTOR: "0x0000000000000000000000000000000000000001",
  NEXT_PUBLIC_RMT_POSITION_GUARD_POLICY_ID: "policy_12345678",
  NEXT_PUBLIC_RMT_POSITION_GUARD_SIGNER_ID: "signer_12345678",
  NEXT_PUBLIC_PRIVY_APP_ID: "clx1234567890123456789012",
  PRIVY_APP_SECRET: "secret_12345678901234567890", // gitleaks:allow -- synthetic test fixture
  RMT_POSITION_GUARD_AUTHORIZATION_PRIVATE_KEY: Buffer.alloc(64, 1).toString("base64"),
  RMT_POSITION_GUARD_EVALUATOR_TOKEN: "evaluator_123456789012345678901234567890", // gitleaks:allow -- synthetic test fixture
  RMT_POSITION_GUARD_WORKER_ENABLED: "false"
}), null);

const call = buildLivePositionGuardExecutorCall({
  amountIn: 100n,
  amountOutMinimum: 95n,
  deadline: 1_000n,
  executor: "0x0000000000000000000000000000000000000001",
  fee: 3_000,
  maxSlippageBps: 500,
  orderId: `0x${"11".repeat(32)}`,
  token: "0x0000000000000000000000000000000000000002"
});
const decoded = decodeFunctionData({ abi: rmtPositionGuardExecutorAbi, data: call.data });
assert.equal(decoded.functionName, "executeV3Exit");
assert.equal(decoded.args[0].token, "0x0000000000000000000000000000000000000002");
assert.equal(decoded.args[0].amountIn, 100n);
assert.equal(decoded.args[0].amountOutMinimum, 95n);
assert.throws(() => buildLivePositionGuardExecutorCall({
  ...call,
  amountIn: 100n,
  amountOutMinimum: 95n,
  deadline: 1_000n,
  executor: call.to,
  fee: 3_000,
  maxSlippageBps: 501,
  orderId: `0x${"11".repeat(32)}`,
  token: "0x0000000000000000000000000000000000000002"
}));

console.log("live Position Guard execution smoke checks passed");
