import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { providerBudget, rpcFeed, resourceError, scheduledTransport } from "./feed-scheduler.js";
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

test("retry an explicit valid log interval once, preserving the range and rejecting malformed requests", async () => {
  const error = Object.assign(Error("invalid block range params"), { code: -32000 });
  const params = [{ fromBlock: "0x73207e3", toBlock: "0x7320818" }];
  const budget = providerBudget("fixture", 1, () => 0);
  const seen: string[] = [];
  const read = () => budget.request("eth_getLogs", async () => {
    seen.push(JSON.stringify(params));
    if (seen.length === 1) throw error;
    return [];
  }, params);
  assert.deepEqual(await read(), []);
  assert.deepEqual(seen, [JSON.stringify(params), JSON.stringify(params)]);
  await assert.rejects(budget.request("eth_getLogs", async () => { throw error; }, params),
    e => classifySyncFailure(e) === "upstream");
  for (const bad of [[{ fromBlock: "latest", toBlock: "0x10" }], [{ fromBlock: "0x2", toBlock: "0x1" }],
    [{ fromBlock: "0x1", toBlock: "0x1000" }]]) {
    await assert.rejects(budget.request("eth_getLogs", async () => { throw error; }, bad), e => e === error);
  }
  assert.equal(budget.stats.retries, 2);
  assert.equal(budget.stats.attempts, 7);
  assert.equal(resourceError({ code: -32000, details: "missing trie node" }, true).transient, false);
});

test("a missing numbered header is retried on the same provider and stays unavailable if absent", async () => {
  const requests: unknown[][] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { id, params } = JSON.parse(body);
    requests.push(params);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id, result: requests.length === 2 ? { number: params[0] } : null }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const budget = providerBudget("test", 1, () => 0);
    const wire = scheduledTransport("http://127.0.0.1:" + address.port, budget, new AbortController().signal)({});
    const args = { method: "eth_getBlockByNumber" as const, params: ["0x12", false] as const };
    assert.deepEqual(await wire.request(args), { number: "0x12" });
    await assert.rejects(wire.request(args), e => classifySyncFailure(e) === "upstream");
    assert.deepEqual(requests, Array(4).fill(args.params));
    assert.equal(budget.stats.retries, 2);
  } finally { server.close(); }
});
