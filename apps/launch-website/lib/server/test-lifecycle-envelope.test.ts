import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi } from "viem";
import { curveBuySignature, isTestLifecycleRequest, lifecycleCalldataMatches, sameTestLifecycleRequest, type TestLifecycleRequest } from "../test-lifecycle";

test("the reviewed curve buy envelope matches the wallet's exact calldata", async () => {
  const request = {
    operation: "buy", token: "0x1000000000000000000000000000000000000000",
    curve: "0x2000000000000000000000000000000000000000", factory: "0x3000000000000000000000000000000000000000",
    from: "0x4000000000000000000000000000000000000000", to: "0x2000000000000000000000000000000000000000",
    data: encodeFunctionData({ abi: parseAbi([curveBuySignature]), functionName: "buy", args: [10n, 100n] }),
    chainId: "0x7a69", value: "0x14", nonce: "0x1", blockNumber: "0x2",
    blockHash: `0x${"1".repeat(64)}`, reviewBlockNumber: "0x3", reviewBlockHash: `0x${"2".repeat(64)}`,
    deadline: "100", amountWei: "20", minimumOutputWei: "10", slippageBps: 0,
  } as const satisfies TestLifecycleRequest;
  assert.equal(isTestLifecycleRequest(request), true);
  assert.equal(await lifecycleCalldataMatches(request), true);
  assert.equal(isTestLifecycleRequest({ ...request, extras: {} }), false);
  assert.equal(isTestLifecycleRequest({ ...request, value: "0x15" }), false);
  assert.equal(await lifecycleCalldataMatches({ ...request, deadline: "101" }), false);
  assert.equal(sameTestLifecycleRequest(request, { ...request, nonce: "0x2" }), false);
});
