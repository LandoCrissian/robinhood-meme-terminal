import assert from "node:assert/strict";
import test from "node:test";
import receipts from "../../../../docs/evidence/token-market/receipts.json";
import { toEventSelector } from "viem";
import replay from "../../../../docs/evidence/token-market/market-replay.json";
import { checkpointFresh, validMarket } from "../token-market";
import { GET as marketRoute } from "../../app/api/launchpad/market/[token]/route";
import { curveProductionDeployment, curveProductionPins, curveProductionProfile } from "./curve-production";
const frame = replay.frames.at(-1)!;
test("independent receipt-word reconstruction matches every final candle and ETH volume", () => {
  const trade = toEventSelector(
    "CurveTrade(address,bool,uint256,uint256,uint256,uint256,uint256,uint256)",
  );
  const swap = toEventSelector(
    "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)",
  );
  const fills = receipts.primary
    .filter((r) => r.status === "success")
    .flatMap((r) =>
      r.logs.flatMap((log) => {
        const words = log.data
          .slice(2)
          .match(/.{64}/g)!
          .map((hex) => BigInt("0x" + hex));
        if (
          log.address.toLowerCase() === replay.curve &&
          log.topics[0] === trade
        ) {
          return [
            {
              time: r.time,
              eth:
                BigInt(log.topics[2]) === 1n ? words[1] : words[1] - words[2],
              units: words[0],
            },
          ];
        }
        if (
          log.address.toLowerCase() ===
            "0x8366a39cc670b4001a1121b8f6a443a643e40951" &&
          log.topics[0] === swap &&
          log.topics[1] === replay.poolId
        ) {
          const abs = (n: bigint) => (n < 0n ? -n : n);
          return [
            {
              time: r.time,
              eth: abs(BigInt.asIntN(128, words[0])),
              units: abs(BigInt.asIntN(128, words[1])),
            },
          ];
        }
        return [];
      }),
    );
  assert.equal(fills.length, 35);
  for (const [step, candles] of Object.entries(frame.charts)) {
    assert.equal(
      candles.reduce((sum, c) => sum + c.count, 0),
      fills.length,
    );
    for (const c of candles) {
      const rows = fills.filter(
        (f) => f.time >= c.time && f.time < c.time + Number(step),
      );
      const prices = rows.map((f) => Number(f.eth) / Number(f.units));
      assert.deepEqual(
        [c.open, c.high, c.low, c.close],
        [prices[0], Math.max(...prices), Math.min(...prices), prices.at(-1)],
      );
      assert.equal(
        BigInt(c.volumeWei),
        rows.reduce((sum, r) => sum + r.eth, 0n),
      );
    }
  }
});
const snapshot = {
  ...frame,
  interval: 60,
  candles: frame.charts["60"],
  earlier: false,
};
test("website market GET authenticates privately, exposes only verified chart fields and closes on upstream errors", async t => {
  const bindings: Record<string,string> = {
    RMT_CURVE_PRODUCTION_DISCOVERY: curveProductionProfile,
    RMT_CURVE_FIXTURE: "",
    RMT_LAUNCH_HISTORY_INDEXER_URL: "https://worker.example.invalid/",
    RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: "fixture-only",
  };
  const saved = Object.fromEntries(Object.keys(bindings).map(key => [key, process.env[key]]));
  Object.assign(process.env, bindings);
  t.after(() => { for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const privateNote = "internal-test-field";
  const body = {
    ...snapshot, schemaVersion: 1, chainId: 4663, privateNote,
    checkpoint: { ...snapshot.checkpoint, timestamp: new Date().toISOString(), privateNote },
    candles: snapshot.candles.map(candle => ({ ...candle, privateNote })),
    graduation: { ...snapshot.graduation, privateNote },
  };
  let upstreamId: string | null = null;
  let upstream = () => Response.json(body);
  const fetcher = t.mock.method(globalThis, "fetch", async (input: URL, init: RequestInit) => {
    assert.equal(input.href, bindings.RMT_LAUNCH_HISTORY_INDEXER_URL + "curve-market/" + replay.token + "?interval=60");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-only");
    upstreamId = new Headers(init.headers).get("x-rmt-market-request-id");
    assert.match(upstreamId ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
    return upstream();
  });
  const read = (host: string, query = "interval=60") => marketRoute(new Request("https://" + host + "/api/launchpad/market/" + replay.token + "?" + query,
    { headers: { host, "x-forwarded-proto": "https" } }), { params: Promise.resolve({ token: replay.token }) });
  assert.equal((await read("preview.example.invalid")).status, 404);
  assert.equal((await read("www.rmtlaunch.fun", "interval=7")).status, 400);
  assert.equal((await read("www.rmtlaunch.fun", "interval=6e1")).status, 400);
  assert.equal(fetcher.mock.callCount(), 0);
  const response = await read("www.rmtlaunch.fun");
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(response.headers.get("x-rmt-market-request-id"), upstreamId);
  upstream = () => new Response(null, {status:429});
  const limited = await read("www.rmtlaunch.fun");
  assert.equal(limited.status,503);
  assert.equal(limited.headers.get("Retry-After"),"1");
  assert.equal(limited.headers.get("x-rmt-market-request-id"),upstreamId);
  assert.notEqual(upstreamId,response.headers.get("x-rmt-market-request-id"));
  const payload = await response.text(); assert.ok(!payload.includes(privateNote)); assert.ok(!payload.includes("fixture-only"));
  const page = JSON.parse(payload); assert.ok(validMarket(page, replay.token, 60)); assert.deepEqual(page.checkpoint, { ...snapshot.checkpoint, timestamp: body.checkpoint.timestamp });
  assert.deepEqual(page.candles, snapshot.candles);
  const absent = { status: "not_found", schemaVersion: 1, chainId: 4663, token: replay.token, privateNote,
    deployment: {factory: curveProductionPins.factory[0], registry: curveProductionPins.registry[0],
      blockNumber: String(curveProductionDeployment.blockNumber), blockHash: curveProductionDeployment.blockHash, privateNote},
    checkpoint: {...body.checkpoint, confirmations:20, finality:"l2-confirmed", l1Finality:"unverified"} };
  const missing = (payload: unknown) => Response.json(payload, {status:404});
  upstream = () => missing(absent);
  const verified = await read("www.rmtlaunch.fun"); assert.equal(verified.status,404);
  const text = await verified.text(); assert.ok(!text.includes(privateNote)); assert.ok(!text.includes("fixture-only"));
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["chainId","checkpoint","deployment","schemaVersion","status","token"]);
  assert.equal(JSON.parse(text).checkpoint.blockHash, absent.checkpoint.blockHash);
  for (const invalid of [{}, {...absent, chainId:1}, {...absent, token:curveProductionPins.guard[0]}, {...absent, candles:[]},
      {...absent, deployment:{...absent.deployment,factory:curveProductionPins.guard[0]}},
      {...absent, deployment:{...absent.deployment,blockHash:absent.checkpoint.blockHash}},
      {...absent, deployment:{...absent.deployment,registry:curveProductionPins.guard[0]}},
      {...absent, checkpoint:{...absent.checkpoint,blockNumber:"1"}},
      {...absent, checkpoint:{...absent.checkpoint,timestamp:new Date(Date.now()-120001).toISOString()}},
      {...absent, checkpoint:{...absent.checkpoint,confirmations:0}}, {...absent,padding:"x".repeat(4096)}]) {
    upstream=()=>missing(invalid);
    const result=await read("www.rmtlaunch.fun"); assert.equal(result.status,503); assert.deepEqual(await result.json(),{status:"unavailable"});
  }
  for (const rejected of [() => new Response(null, { status: 401 }), () => new Response(null, {status:404}),
    () => Response.json({...body,checkpoint:{...body.checkpoint,timestamp:"2020-01-01T00:00:00Z"}}), () => Response.json({ ...body, chainId: 1 }),
    () => Response.json({ ...body, padding: "x".repeat(131072) })]) {
    upstream = rejected;
    const result = await read("www.rmtlaunch.fun"); assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { status: "unavailable" });
  }
});
test("recorded market validates real backing, phase, ordered fill prices and token identity", () => {
  assert.ok(validMarket(snapshot, replay.token, 60));
  assert.equal(
    validMarket(
      { ...snapshot, backingWei: "2000000000000000000" },
      replay.token,
      60,
    ),
    false,
  );
  assert.equal(
    validMarket({ ...snapshot, graduation: null }, replay.token, 60),
    false,
  );
  assert.equal(
    validMarket(
      { ...snapshot, candles: [snapshot.candles[1], snapshot.candles[0]] },
      replay.token,
      60,
    ),
    false,
  );
  assert.equal(
    validMarket(
      { ...snapshot, candles: [{ ...snapshot.candles[0], low: Infinity }] },
      replay.token,
      60,
    ),
    false,
  );
  assert.equal(validMarket(snapshot, "0x" + "9".repeat(40), 60), false);
});
test("live expires, pending eligibility is reversible, no trade becomes a candle", () => {
  const first = replay.frames[0],
    pending = replay.pending;
  assert.equal(first.charts["60"].length, 0);
  assert.equal(pending.phase, "eligible");
  const index = replay.frames.findIndex((f) =>
    f.label.startsWith("Curve sell"),
  );
  assert.ok(
    BigInt(replay.frames[index].soldWei) <
      BigInt(replay.frames[index - 1].soldWei),
  );
  assert.ok(
    BigInt(replay.frames[index].backingWei) <
      BigInt(replay.frames[index - 1].backingWei),
  );
  assert.ok(
    validMarket(
      {
        ...pending,
        interval: 60,
        candles: pending.charts["60"],
        earlier: false,
      },
      replay.token,
      60,
    ),
  );
  assert.equal(
    validMarket(
      {
        ...pending,
        backingWei: "4000000000000000000",
        interval: 60,
        candles: [],
        earlier: false,
      },
      replay.token,
      60,
    ),
    false,
  );
  if (validMarket(snapshot, replay.token, 60)) {
    const time = Date.parse(frame.checkpoint.timestamp);
    assert.equal(checkpointFresh(snapshot, time + 119999), true);
    assert.equal(checkpointFresh(snapshot, time + 120000), false);
    assert.equal(checkpointFresh(snapshot, time - 15001), false);
  }
});
