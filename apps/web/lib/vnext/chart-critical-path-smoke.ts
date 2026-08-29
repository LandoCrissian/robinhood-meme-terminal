import assert from "node:assert/strict";
import { GET } from "../../app/api/markets/ohlcv/route";

const pons = "0x39dbed3a2bd333467115de45665cc57f813c4571";
const ponsPool = "0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA";
const cashcat = "0x020bfc650a365f8bb26819deaabf3e21291018b4";
const cashcatPool = "0xA70fc67C9F69da90B63a0e4C05D229954574E313";
const weth = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const poolId = `0x${"44".repeat(32)}`;
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
let ohlcvRequests = 0;
let tradeRequests = 0;
let responseMode: "pons-wrong" | "pons" | "cashcat" | "error" = "pons-wrong";
const seenHeaders: string[] = [];
const seenTokens: string[] = [];

globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(input.toString());
  if (url.pathname.includes("/trades")) {
    tradeRequests += 1;
    throw new Error("Trade enrichment must not be on the first-chart critical path.");
  }
  ohlcvRequests += 1;
  seenHeaders.push(new Headers(init?.headers).get("accept") ?? "");
  seenTokens.push(url.searchParams.get("token") ?? "");
  if (responseMode === "error") return new Response(null, { status: 429 });
  const wrong = responseMode === "pons-wrong";
  const token = responseMode === "cashcat" ? cashcat : pons;
  const counterpart = weth;
  const start = wrong ? 3_200 : responseMode === "cashcat" ? 0.00042 : 0.012;
  return Response.json({
    data: { attributes: { ohlcv_list: [
      [100, start, start * 1.02, start * 0.98, start * 1.01, 10],
      [160, start * 1.01, start * 1.03, start, start * 1.02, 12]
    ] } },
    meta: responseMode === "cashcat"
      ? { base: { address: counterpart }, quote: { address: token } }
      : { base: { address: token }, quote: { address: counterpart } }
  });
}) as typeof fetch;

async function main() {
  try {
    const wrongSide = await GET(new Request(`http://localhost/api/markets/ohlcv?token=${pons}&pair=${ponsPool}&range=1H&referencePrice=0.012`));
    assert.equal(wrongSide.status, 503, "PONS must reject WETH-magnitude candles even when pair metadata contains PONS");
    assert.equal(ohlcvRequests, 1, "Each route read makes exactly one exact-token provider request");
    assert.deepEqual(seenTokens.map((value) => value.toLowerCase()), [pons]);
    assert.deepEqual(seenHeaders, ["application/json;version=20230203"]);

    responseMode = "pons";
    const ponsResponse = await GET(new Request(`http://localhost/api/markets/ohlcv?token=${pons}&pair=${ponsPool}&range=15M&referencePrice=0.012`));
    const ponsBody = await ponsResponse.json() as { candles?: Array<{ close: number }>; pair?: string };
    assert.equal(ponsResponse.status, 200, "PONS token-priced candles must be accepted");
    assert.equal(ponsBody.pair, ponsPool.toLowerCase());
    assert.ok((ponsBody.candles?.at(-1)?.close ?? 0) < 1);

    responseMode = "cashcat";
    const response = await GET(new Request(`http://localhost/api/markets/ohlcv?token=${cashcat}&pair=${cashcatPool}&range=1H&referencePrice=0.00042`));
    const body = await response.json() as { candles?: unknown[]; lastTradeAt?: unknown; pair?: string };
    assert.equal(response.status, 200, "CASHCAT opposite-side pool orientation must remain valid");
    assert.equal(body.candles?.length, 2);
    assert.equal(body.lastTradeAt, null);
    assert.equal(body.pair, cashcatPool.toLowerCase());
    assert.equal(tradeRequests, 0, "Optional trade enrichment is not on first render");

    responseMode = "pons";
    const v4Response = await GET(new Request(
      `http://localhost/api/markets/ohlcv?token=${pons}&pair=${poolId}&range=6H&referencePrice=0.012`
    ));
    const v4Body = await v4Response.json() as { pair?: unknown; candles?: unknown[] };
    assert.equal(v4Response.status, 200, "A canonical V4 PoolId must be accepted as a chart identity");
    assert.equal(v4Body.pair, poolId);
    assert.equal(v4Body.candles?.length, 2);

    responseMode = "pons";
    const beforeCoalesced = ohlcvRequests;
    const coalescedUrl = `http://localhost/api/markets/ohlcv?token=${pons}&pair=${ponsPool}&range=24H&referencePrice=0.012`;
    const [coalescedA, coalescedB] = await Promise.all([
      GET(new Request(coalescedUrl)),
      GET(new Request(coalescedUrl))
    ]);
    assert.equal(coalescedA.status, 200);
    assert.equal(coalescedB.status, 200);
    assert.equal(ohlcvRequests - beforeCoalesced, 1, "Simultaneous identical refreshes must coalesce to one provider request");

    responseMode = "cashcat";
    const staleRange = "5M";
    const first = await GET(new Request(`http://localhost/api/markets/ohlcv?token=${cashcat}&pair=${cashcatPool}&range=${staleRange}&referencePrice=0.00042`));
    assert.equal(first.status, 200);
    const clock = originalNow();
    Date.now = () => clock + 16_000;
    responseMode = "error";
    const stale = await GET(new Request(`http://localhost/api/markets/ohlcv?token=${cashcat}&pair=${cashcatPool}&range=${staleRange}&referencePrice=0.00042`));
    const staleBody = await stale.json() as { stale?: boolean; candles?: unknown[] };
    assert.equal(stale.status, 200, "A transient provider failure must preserve a valid last-known snapshot");
    assert.equal(staleBody.stale, true);
    assert.equal(staleBody.candles?.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
  console.log("VNext chart first-useful-OHLCV critical path checks passed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
