import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClient, custom, type Address } from "viem";
import { classifyFixtureTreasury } from "./fixture-treasury";

const address = "0x1111111111111111111111111111111111111111" as const;
const sink = "0x000000000000000000000000000000000000dead" as const;

test("classifies absent code and rejects contracts without the exact pinned proxy runtime", async () => {
  for (const [bytecode, expected] of [["0x", "no-code"], ["0x60006000f3", null]] as const) {
    const requests: unknown[] = [];
    const rpc = createPublicClient({ transport: custom({ request: async ({ method, params }) => {
      requests.push([method, params]);
      assert.equal(method, "eth_getCode");
      return bytecode;
    } }, { retryCount: 0 }) });
    assert.equal(await classifyFixtureTreasury(rpc, address, 256n), expected);
    assert.deepEqual(requests, [["eth_getCode", [address, "0x100"]]]);
  }
});

test("rejects reserved addresses before an empty code result could classify them as wallets", async () => {
  const rpc = createPublicClient({ transport: custom({ request: async () => {
    assert.fail("The RPC must not be used to classify a reserved address");
  } }, { retryCount: 0 }) });
  for (const reserved of [sink, "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000100"] as Address[]) {
    assert.equal(await classifyFixtureTreasury(rpc, reserved, 256n), null);
  }
});
