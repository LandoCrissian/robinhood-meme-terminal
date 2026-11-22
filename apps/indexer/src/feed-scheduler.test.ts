import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { providerBudget, rpcFeed, resourceError } from "./feed-scheduler.js";
import { classifySyncFailure } from "./rpc-resilience.js";

test("one request per provider, paced starts and a foreground turn ahead of queued activity", async () => {
  const budget = providerBudget("fixture", 20);
  let active = 0,
    maximum = 0;
  const order: string[] = [],
    starts: number[] = [];
  const request = (feed: "registration" | "activity", id: string) =>
    rpcFeed.run(feed, () =>
      budget.request("eth_getLogs", async () => {
        starts.push(performance.now());
        maximum = Math.max(maximum, ++active);
        order.push(id);
        await sleep(4);
        active--;
      }),
    );
  await Promise.all([
    request("activity", "first"),
    request("activity", "queued"),
    request("registration", "foreground"),
  ]);
  assert.equal(maximum, 1);
  assert.deepEqual(order, ["first", "foreground", "queued"]);
  assert.ok(starts.slice(1).every((start, i) => start - starts[i]! >= 17));
  assert.equal(budget.stats.attempts, 3);
});

test("retry only transient resource failures, retain classification through wrapped viem errors", async () => {
  for (const failure of [
    { status: 429 },
    { status: 503 },
    { code: -32002 },
    { code: -32005 },
    { name: "TimeoutError" },
  ]) {
    assert.equal(resourceError({ cause: failure }).transient, true);
    assert.equal(classifySyncFailure({ cause: failure }), "upstream");
  }
  const budget = providerBudget("fixture", 1, () => 0);
  let attempts = 0;
  await budget.request("eth_getLogs", async () => {
    if (++attempts === 1)
      throw Object.assign(Error("rate limited"), { status: 429 });
  });
  assert.equal(budget.stats.retries, 1);
  await assert.rejects(
    budget.request("eth_call", async () => {
      throw Object.assign(Error("permission denied"), { status: 403 });
    }),
  );
  assert.equal(budget.stats.attempts, 3);
  assert.equal(budget.stats.limited, 1);
});
