import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { routingPrerequisites, verifyGuardedRoutingFixture } from "./routing.mjs";

test("exact 4663 fixture routes stay separate from production PoolKey, quotes and binding", () => {
  const { fixture, hosted } = routingPrerequisites();
  assert.equal(fixture.status, "LOOPBACK_FORK_VERIFIED");
  assert.equal(fixture.chainId, 4663);
  assert.equal(fixture.poolKey.tickSpacing, 60);
  assert.equal(BigInt(fixture.poolKey.hooks) & 0x3fffn, 0x2000n);
  assert.notEqual(fixture.buyReceipt, fixture.sellReceipt);
  assert.equal(hosted.status, "DEPLOYMENT_DEPENDENT");
  assert.equal(hosted.productionPoolKey, null);
  assert.equal(hosted.quotesObserved, false);
});

test("tampered fork routes fail the archived release hash before any probe action", () => {
  const bytes = readFileSync(new URL("../../docs/evidence/fixed-supply-release/fork-4663.json.gz", import.meta.url));
  bytes[bytes.length - 5] ^= 1;
  assert.throws(() => verifyGuardedRoutingFixture(bytes), /archive differs/);
});
