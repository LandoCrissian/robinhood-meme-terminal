import assert from "node:assert/strict";
import test from "node:test";
import snapshot from "../../data/historical-launches-4663.json";
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
