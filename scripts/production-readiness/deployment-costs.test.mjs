import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { buildDeploymentCostReport, fixtureCostRows, observeFeeReference } from "./deployment-costs.mjs";

const safes = JSON.parse(gunzipSync(readFileSync(new URL(
  "../../docs/evidence/production-readiness/acceptance-observations.json.gz", import.meta.url,
)))).safes;
const { anchor } = safes;
const now = Date.parse(anchor.blockTimeUtc);
const reference = {
  status: "CORROBORATED_BLOCK_BASE_FEE", anchor, providers: ["official", "pocket"],
  baseFeeWei: "20000000", l1BaseFeeReferenceWei: "0",
};
const toQuantity = (value) => "0x" + BigInt(value).toString(16);
const mockHeader = {
  number: toQuantity(anchor.number), hash: anchor.hash,
  timestamp: toQuantity(Math.ceil(now / 1000)), baseFeePerGas: toQuantity(reference.baseFeeWei),
};

function reader({ first = mockHeader, after = first, chain = "0x1237", l1 = "0x" + "00".repeat(32) } = {}) {
  let headerCount = 0;
  return async (method, params, transform) => {
    switch (method) {
      case "eth_chainId":
        assert.deepEqual(params, []);
        return { status: "observed", value: transform(chain) };
      case "eth_getBlockByNumber":
        assert.deepEqual(params, [mockHeader.number, false]);
        return { status: "observed", value: transform(headerCount++ === 0 ? first : after) };
      case "eth_call":
        assert.equal(params[0].to, "0x000000000000000000000000000000000000006c");
        assert.equal(params[1], mockHeader.number);
        return l1 ? { status: "observed", value: transform(l1) } : { status: "unavailable" };
      default:
        assert.fail("Unexpected RPC method " + method);
    }
  };
}

test("reads the same 4663 block from independent witnesses before and after the L1 reference", async () => {
  const result = await observeFeeReference(anchor, { official: reader(), pocket: reader() }, () => now);
  assert.equal(result.status, reference.status);
  assert.deepEqual(result.providers, reference.providers);
  assert.equal(result.baseFeeWei, reference.baseFeeWei);
  assert.equal(result.l1BaseFeeReferenceWei, "0");
});

test("fails closed on a stale or reorged header, conflicting fee, insufficient readers, or wrong chain", async () => {
  const reorg = { ...mockHeader, hash: "0x" + "cc".repeat(32) };
  const higherFee = { ...mockHeader, baseFeePerGas: "0x2000000" };
  const failures = [
    [reader(), () => now + 300_001], [reader({ after: reorg }), () => now],
    [reader({ first: higherFee }), () => now], [reader({ chain: "0x1" }), () => now], [null, () => now],
  ];
  for (const [peer, time] of failures) {
    const result = await observeFeeReference(anchor, { official: reader(), ...(peer ? { pocket: peer } : {}) }, time);
    assert.equal(result.status, "UNVERIFIED");
    assert.equal(result.baseFeeWei, null);
    assert.equal(result.l1BaseFeeReferenceWei, null);
  }
});

test("keeps an uncorroborated L1 reference unset even when the 4663 block fee agrees", async () => {
  const result = await observeFeeReference(anchor, { official: reader(), pocket: reader({ l1: null }) }, () => now);
  assert.equal(result.baseFeeWei, reference.baseFeeWei);
  assert.equal(result.l1BaseFeeReferenceWei, null);
});

test("prices ten archived fixture receipts directionally and keeps protocol value and actual mainnet fees distinct", () => {
  const result = buildDeploymentCostReport({ mode: "PUBLIC_READ_ONLY", safes, reference });
  assert.equal(result.broadcastAuthorized, false);
  assert.equal(result.status, "BLOCKED_NO_BROADCAST");
  assert.equal(result.safeEstimates.rows.length, 2);
  for (const { gas } of result.safeEstimates.rows) {
    assert.equal(BigInt(gas.estimatedTotalWei), BigInt(gas.l2ExecutionWei) + BigInt(gas.l1PosterWei));
  }
  const { rows, observedForkGasUsedTotal, illustrativeExecutionSubtotalEth, mainnetTotalNetworkFeeWei, liveTransactions } = result.protocolCosts;
  assert.deepEqual(rows.map(({ action }) => action), [
    "directory", "registry", "successor-v2", "successor-v3", "bootstrap", "factory-schedule", "factory-execute",
    "v3-template-schedule", "v3-template-execute", "first-rmt-project",
  ]);
  assert.equal(observedForkGasUsedTotal, "26346536");
  assert.equal(illustrativeExecutionSubtotalEth, "0.00052693072");
  assert.equal(mainnetTotalNetworkFeeWei, null);
  assert.deepEqual(liveTransactions, []);
  assert.equal(result.protocolCosts.provisionalFirstProjectCreationFeeEth, "0.0004");
  assert.equal(rows.at(-1).provisionalValueWei, "400000000000000");
  assert.ok(rows.slice(0, -1).every(({ provisionalValueWei }) => provisionalValueWei === "0"));
  assert.ok(rows.every((row) => row.mainnetL1PosterWei === null && row.mainnetTotalNetworkFeeWei === null));
  assert.deepEqual(rows.map(({ forkReceipt }) => forkReceipt), fixtureCostRows().rows.map(({ forkReceipt }) => forkReceipt));
});

test("does not convert archived Safe pricing to current quote or accept a modified simulation amount", () => {
  const fixture = buildDeploymentCostReport({ mode: "ARCHIVED_ARITHMETIC_FIXTURE", safes, reference });
  assert.equal(fixture.safeEstimates.scope, "ARCHIVED_PUBLIC_RPC_SIMULATION");
  assert.equal(fixture.protocolCosts.illustrativeExecutionSubtotalEth, null);
  const corrupted = structuredClone(safes);
  corrupted.proposals[0].gas.estimatedTotalWei = "10";
  assert.throws(() => buildDeploymentCostReport({ mode: "PUBLIC_READ_ONLY", safes: corrupted, reference }));
});
