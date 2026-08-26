import assert from "node:assert/strict";
import { GET } from "../../app/api/markets/ohlcv/route";

const token = "0x1111111111111111111111111111111111111111";
const quoteToken = "0x2222222222222222222222222222222222222222";
const pair = "0x3333333333333333333333333333333333333333";
const poolId = `0x${"44".repeat(32)}`;
const originalFetch = globalThis.fetch;
let ohlcvRequests = 0;
let tradeRequests = 0;

globalThis.fetch = (async (input: string | URL) => {
  const url = new URL(input.toString());
  if (url.pathname.includes("/trades")) {
    tradeRequests += 1;
    throw new Error("Trade enrichment must not be on the first-chart critical path.");
  }
  ohlcvRequests += 1;
  const side = url.searchParams.get("token");
  await new Promise((resolve) => setTimeout(resolve, side === "base" ? 450 : 20));
  return Response.json({
    data: { attributes: { ohlcv_list: [
      [100, 1, 1.2, 0.9, 1.1, 10],
      [160, 1.1, 1.3, 1, 1.2, 12]
    ] } },
    meta: { base: { address: quoteToken }, quote: { address: token } }
  });
}) as typeof fetch;

async function main() {
  try {
    const startedAt = Date.now();
    const response = await GET(new Request(`http://localhost/api/markets/ohlcv?token=${token}&pair=${pair}&range=1H`));
    const elapsed = Date.now() - startedAt;
    const body = await response.json() as { candles?: unknown[]; lastTradeAt?: unknown };
    assert.equal(response.status, 200);
    assert.equal(body.candles?.length, 2);
    assert.equal(body.lastTradeAt, null);
    assert.ok(elapsed < 300, `The useful quote-side OHLCV response was blocked for ${elapsed}ms`);
    assert.equal(ohlcvRequests, 2, "Base and quote orientation reads start together");
    assert.equal(tradeRequests, 0, "Optional trade enrichment is not on first render");

    const v4Response = await GET(new Request(
      `http://localhost/api/markets/ohlcv?token=${token}&pair=${poolId}&range=1H`
    ));
    const v4Body = await v4Response.json() as { pair?: unknown; candles?: unknown[] };
    assert.equal(v4Response.status, 200, "A canonical V4 PoolId must be accepted as a chart identity");
    assert.equal(v4Body.pair, poolId);
    assert.equal(v4Body.candles?.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("VNext chart first-useful-OHLCV critical path checks passed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
