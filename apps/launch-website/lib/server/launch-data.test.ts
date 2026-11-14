import assert from "node:assert/strict";
import test from "node:test";
import snapshot from "../../data/historical-launches-4663.json";
import { createLaunchHistoryHandler } from "./launch-api";
import { createLaunchDirectoryReader } from "./launch-data";

const checkpoint = snapshot.verificationBlock;
const v6 = snapshot.launches.filter(({ version }) => version === 6);
const v4 = snapshot.launches.filter(({ version }) => version === 4);
const clock = Date.parse(checkpoint.timestamp) + 120_000;
const word = (char: string) => "0x" + char.repeat(64);
const account = (char: string) => "0x" + char.repeat(40);
const factory = v6[0].factory.toLowerCase();

function indexed() {
  return {
    schemaVersion: 1, chainId: 4663, factory,
    checkpoint: { ...checkpoint, observedAt: new Date(clock).toISOString(), stale: false, finality: "l2-confirmed" },
    launches: v6.map(({ token, creator, market, launchId, name, symbol, receipt }) => ({
      token, creator, curve: market, launchId, name, symbol, registration: receipt,
      lifecycle: "unknown", lifecycleEvidence: null, pool: null, custody: null,
    })),
    nextCursor: null as string | null,
  };
}

function withFeed(fetchFeed: typeof fetch, now = () => clock) {
  return createLaunchDirectoryReader({
    now, fetch: fetchFeed, indexerUrl: "https://history.example", indexerReadToken: "fixture",
  });
}

test("shipped historical evidence is a stale snapshot with no future or external registrations", async () => {
  const read = createLaunchDirectoryReader({ now: () => clock });
  const data = await read();
  assert.equal(data.status, "stale");
  assert.equal(data.coverage, "verified-snapshot");
  assert.equal(data.finality, "l1-unverified");
  assert.equal(data.future, "prelaunch");
  assert.equal(data.launches.length, 4);
  assert.equal(data.launches.filter((row) => row.classification === "deployment-test").length, 1);
  for (const row of data.launches) {
    assert.equal(row.kind, "historical-rmt");
    assert.equal((await read(row.token.toLowerCase())).launches[0].receipt.transactionHash, row.receipt.transactionHash);
  }
  assert.deepEqual((await read(account("4"))).launches, []);
});

test("current authenticated V6 evidence merges with V4 history and keeps prior classifications", async () => {
  let calls = 0;
  const read = withFeed(async (url, request) => {
    calls += 1;
    assert.equal(String(url), "https://history.example/historical-launches?limit=25");
    assert.equal(request?.redirect, "error");
    assert.equal(new Headers(request?.headers).get("authorization"), "Bearer fixture");
    return Response.json(indexed());
  });
  const [data, exact] = await Promise.all([read(), read(v4[0].token)]);
  assert.equal(data.status, "ready");
  assert.equal(data.coverage, "v6-indexed");
  assert.equal(data.launches.length, 4);
  assert.equal(exact.launches.length, 1);
  assert.equal(exact.launches[0].version, 4);
  assert.equal(data.launches.find((row) => row.launchId === "0" && row.version === 6)?.classification, "retired");
  assert.equal(calls, 1);
});

test("marks degraded or old worker observations stale", async () => {
  const data = indexed();
  data.checkpoint.stale = true;
  assert.equal((await withFeed(async () => Response.json(data))()).status, "stale");
  data.checkpoint.stale = false;
  assert.equal((await withFeed(async () => Response.json(data), () => clock + 600_000)()).status, "stale");
});

test("fails closed on wrong chain, substituted origins, missing receipts and duplicate registrations", async () => {
  const cases = [
    { ...indexed(), chainId: 31337 },
    { ...indexed(), factory: account("4") },
    { ...indexed(), checkpoint: { ...indexed().checkpoint, blockHash: word("4") } },
    { ...indexed(), launches: indexed().launches.slice(1) },
    { ...indexed(), launches: [...indexed().launches, indexed().launches[0]] },
    { ...indexed(), launches: indexed().launches.map((row) => ({ ...row, token: account("4") })) },
    { ...indexed(), launches: indexed().launches.map((row) => ({ ...row, registration: undefined })) },
    { ...indexed(), launches: indexed().launches.map((row) => ({ ...row, registration: { ...row.registration, blockHash: word("4") } })) },
  ];
  for (const bad of cases) {
    const data = await withFeed(async () => Response.json(bad))();
    assert.equal(data.status, "stale");
    assert.equal(data.coverage, "verified-snapshot");
    assert.equal(data.launches.length, 4);
  }
});

test("rejects oversized and failed reads with a bounded negative cache", async () => {
  for (const response of [
    new Response(null, { status: 429 }), new Response(null, { status: 503 }),
    new Response("0".repeat(65_537), { headers: { "content-type": "application/json" } }),
  ]) {
    let calls = 0;
    let at = clock;
    const read = withFeed(async () => { calls += 1; return response.clone(); }, () => at);
    assert.equal((await read()).coverage, "verified-snapshot");
    assert.equal((await read()).coverage, "verified-snapshot");
    assert.equal(calls, 1);
    at += 30_001;
    await read();
    assert.equal(calls, 2);
  }
});

test("publishes unavailable when the snapshot cannot be verified", async () => {
  const read = createLaunchDirectoryReader({ now: () => clock, snapshot: { ...snapshot, chainId: 31337 } });
  const data = await read();
  assert.equal(data.status, "unavailable");
  assert.equal(data.checkpoint, null);
  assert.deepEqual(data.launches, []);
});

test("uses address-bound indexed lookup for an older result outside a truncated list", async () => {
  const token = account("4");
  const newestTime = new Date(clock - 2000).toISOString();
  const olderTime = new Date(clock - 3000).toISOString();
  const data = indexed();
  data.checkpoint = { ...data.checkpoint, blockNumber: String(BigInt(checkpoint.blockNumber) + 3n), timestamp: newestTime };
  data.nextCursor = "opaque";
  const row = {
    ...data.launches[0], token, launchId: "7", registration: {
      ...data.launches[0].registration, transactionHash: word("4"), blockHash: word("7"),
      blockNumber: String(BigInt(checkpoint.blockNumber) + 1n), timestamp: olderTime,
    },
  };
  const requested: string[] = [];
  const read = withFeed(async (url) => {
    const query = new URL(String(url)).search;
    requested.push(query);
    return Response.json(query === "?limit=25" ? data : { ...data, nextCursor: null, launches: [row] });
  });
  assert.equal((await read(token)).launches[0].token, token);
  assert.deepEqual(requested, ["?limit=25", "?token=" + token]);
});

test("serves snapshot during an outage and resumes fresh reads after the cache window", async () => {
  let at = clock;
  let stage = "down";
  let calls = 0;
  const read = withFeed(async () => {
    calls++;
    if (stage === "down") return new Response(null, { status: 503 });
    if (stage === "disagreement") {
      const response = indexed();
      response.checkpoint.blockHash = word("8");
      return Response.json(response);
    }
    return Response.json(indexed());
  }, () => at);

  assert.equal((await read()).coverage, "verified-snapshot");
  stage = "up";
  assert.equal((await read()).status, "stale");
  assert.equal(calls, 1);
  at += 30_001;
  assert.equal((await read()).status, "ready");
  stage = "disagreement";
  at += 30_001;
  assert.equal((await read()).coverage, "verified-snapshot");
  stage = "up";
  at += 30_001;
  assert.equal((await read()).status, "ready");
  assert.equal(calls, 4);
});

test("a stale or unavailable worker cannot establish absence for an exact token", async () => {
  const token = account("4");
  const archived = v6[0].token;
  let at = clock;
  let stage = "unauthorized";
  const read = withFeed(async () => {
    if (stage === "unauthorized") return new Response(null, { status: 401 });
    const data = indexed();
    data.checkpoint.stale = stage === "behind";
    return Response.json(data);
  }, () => at);
  const respond = createLaunchHistoryHandler(read, () => at);
  const url = "https://rmt.example/api/launchpad/launches/";

  assert.equal((await respond(new Request(url + archived), archived)).status, 200);
  const unauthorized = await respond(new Request(url + token), token);
  assert.equal(unauthorized.status, 503);
  assert.equal(unauthorized.headers.get("netlify-cdn-cache-control"), "no-store");
  assert.equal((await unauthorized.json()).status, "unavailable");

  stage = "behind";
  at += 30_001;
  assert.equal((await respond(new Request(url + token), token)).status, 503);
  assert.equal((await respond(new Request(url + archived), archived)).status, 200);

  stage = "current";
  at += 30_001;
  const absent = await respond(new Request(url + token), token);
  assert.equal(absent.status, 404);
  assert.equal((await absent.json()).status, "ready");
});

test("ages out a previously ready checkpoint even within its local cache window", async () => {
  let at = Date.parse(checkpoint.timestamp) + 290_000;
  const read = withFeed(async () => Response.json(indexed()), () => at);
  assert.equal((await read()).status, "ready");
  at += 10_000;
  assert.equal((await read()).status, "stale");
});

test("coalesces exact reads and invalidates them when the list checkpoint changes", async () => {
  const token = account("4");
  let at = clock;
  let exactCalls = 0;
  let head = BigInt(checkpoint.blockNumber) + 10n;
  let checkpointCharacter = "c";
  const read = withFeed(async (url) => {
    const query = new URL(String(url)).search;
    const data = indexed();
    data.checkpoint = {
      ...data.checkpoint, blockNumber: String(head), blockHash: word(checkpointCharacter),
      timestamp: new Date(at - 2000).toISOString(), observedAt: new Date(at).toISOString(),
    };
    if (query === "?limit=25") return Response.json({ ...data, nextCursor: "opaque" });
    exactCalls += 1;
    return Response.json({ ...data, nextCursor: null, launches: [] });
  }, () => at);
  await Promise.all([read(token), read(token)]);
  await read(token.toUpperCase());
  assert.equal(exactCalls, 1);
  at += 30_001;
  head += 1n;
  checkpointCharacter = "d";
  await read(token);
  assert.equal(exactCalls, 2);
});

test("authenticates over a real HTTP connection and recovers from an interrupted response", async () => {
  const { createServer } = await import("node:http");
  const fixture = indexed();
  let at = clock;
  let closeConnection = true;
  const headers: Array<string | undefined> = [];
  const server = createServer((request, response) => {
    headers.push(request.headers.authorization);
    if (request.url !== "/historical-launches?limit=25" || request.headers.authorization !== "Bearer fixture") {
      response.writeHead(401).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    if (closeConnection) {
      response.write("{");
      response.destroy();
    } else {
      response.end(JSON.stringify(fixture));
    }
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const listener = server.address();
    assert.ok(listener && typeof listener !== "string");
    const read = withFeed((request, init) => {
      // The production reader still validates its HTTPS origin. Transport stays on this test's local socket.
      const original = new URL(String(request));
      assert.equal(original.origin, "https://history.example");
      const loopback = new URL(original.pathname + original.search, "http://127.0.0.1:" + listener.port);
      return fetch(loopback, init);
    }, () => at);
    assert.equal((await read()).coverage, "verified-snapshot");
    closeConnection = false;
    at += 30_001;
    const recovered = await read();
    assert.equal(recovered.coverage, "v6-indexed");
    assert.equal(recovered.status, "ready");
    assert.ok(!JSON.stringify(recovered).includes("Bearer fixture"));
    assert.deepEqual(headers, ["Bearer fixture", "Bearer fixture"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
