import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import { delegateArchive } from "./claim-profile-test-fixture";
import { corroborateCreationWallet, curveProductionPins, verifiedReleaseBatch } from "./curve-production";
import { rmtCreationOwner } from "../owner-creation";

const delegate = delegateArchive.delegate;
const anchor = { blockNumber: 200n, blockHash: ("0x" + "11".repeat(32)) as Hex };
const call = { account: rmtCreationOwner, to: curveProductionPins.factory[0], data: "0x", value: 400000000000000n } as const;
function reader(change: { pendingNonce?: number; gas?: bigint; balance?: bigint; pendingCode?: Hex; priorReorg?: boolean } = {}) {
  return {
    getTransactionCount: async ({ blockTag }: { blockTag?: string }) => blockTag === "pending" ? change.pendingNonce ?? 4 : 4,
    getCode: async ({ address, blockTag }: { address: string; blockTag?: string }) => address === rmtCreationOwner
      ? (blockTag === "pending" && change.pendingCode) || "0xef0100" + delegate.address.slice(2) : delegate.code,
    estimateGas: async ({ blockNumber }: { blockNumber: bigint }) => { assert.equal(blockNumber, anchor.blockNumber); return change.gas ?? 3000000n; },
    getBalance: async () => change.balance ?? 10n ** 18n, getGasPrice: async () => 1000n,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: blockNumber === 190n && change.priorReorg ? "0x00" : anchor.blockHash }),
  } as unknown as Parameters<typeof corroborateCreationWallet>[0][number];
}
test("owner creation checks both anchored gas estimates, available funds, pending delegation and nonces", async () => {
  assert.deepEqual(await corroborateCreationWallet([reader(), reader()], call, anchor), { nonce: 4, gas: 3000000n });
  for (const other of [reader({ pendingNonce: 5 }), reader({ gas: 3500000n }), reader({ balance: call.value }),
    reader({ pendingCode: "0x" }), reader({ balance: 10n ** 18n - 1n })])
    await assert.rejects(corroborateCreationWallet([reader(), other], call, anchor));
});
test("owner revalidation checks the original review block on the second provider", async () => {
  const prior = { blockNumber: "0xbe", blockHash: anchor.blockHash } as const;
  await assert.rejects(corroborateCreationWallet([reader(), reader({ priorReorg: true })], call, anchor, prior));
});

test("release RPC accepts a singleton object and unordered answers only with complete, distinct matching IDs", async () => {
  const a = { jsonrpc: "2.0", id: 4, result: "0x1237" }, b = { ...a, id: 5 };
  assert.deepEqual(await (await verifiedReleaseBatch(Response.json(a), [4])).json(), [a]);
  assert.deepEqual(await (await verifiedReleaseBatch(Response.json([b, a]), [4, 5])).json(), [b, a]);
  for (const wrong of [[a], [a, a], [a, { ...b, id: 6 }], [a, { ...b, error: {} }]])
    await assert.rejects(verifiedReleaseBatch(Response.json(wrong), [4, 5]));
  assert.equal((await verifiedReleaseBatch(new Response(null, {status: 429}), [4])).status, 429);
});
