import assert from "node:assert/strict";
import { externalTradesRequestUrl, parseExternalPoolTrades, summarizeExternalSellPressure, summarizeExternalTradeActors } from "./external-trades";

const token = "0x232CDFc415D10b673845D83Dc02ba2eaBe7e30d1";
const weth = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const pair = "0x39A200271525E9641e799127bdAB299DAeF21953";
const hash = `0x${"ab".repeat(32)}`;
const trader = "0x1111111111111111111111111111111111111111";
const parsed = parseExternalPoolTrades({
  data: [{
    id: "trade-1",
    attributes: {
      tx_hash: hash,
      tx_from_address: trader,
      from_token_amount: "0.2",
      to_token_amount: "120",
      from_token_address: weth,
      to_token_address: token,
      block_timestamp: "2026-07-28T00:00:00.000Z",
      kind: "buy",
      volume_in_usd: "650"
    }
  }]
}, token);

assert.equal(parsed.length, 1);
assert.equal(parsed[0]?.side, "buy");
assert.equal(parsed[0]?.tokenAmount, 120);
assert.equal(parsed[0]?.quoteAmount, 0.2);
assert.equal(new URL(externalTradesRequestUrl(pair, token)).hostname, "api.geckoterminal.com");
assert.throws(() => externalTradesRequestUrl("bad", token), /Invalid/);
assert.equal(parseExternalPoolTrades({ data: [{ id: "bad", attributes: {} }] }, token).length, 0);

const secondTrader = "0x2222222222222222222222222222222222222222";
const actorSummary = summarizeExternalTradeActors([
  parsed[0]!,
  { ...parsed[0]!, id: "trade-2", side: "sell", volumeUsd: 150, timestamp: "2026-07-28T00:01:00.000Z" },
  { ...parsed[0]!, id: "trade-3", trader: secondTrader, side: "sell", volumeUsd: 900, timestamp: "2026-07-28T00:02:00.000Z" }
]);
assert.equal(actorSummary.uniqueActors, 2);
assert.equal(actorSummary.repeatActors, 1);
assert.equal(actorSummary.actors[0]?.trader, secondTrader);
const repeatActor = actorSummary.actors.find((actor) => actor.trader === trader);
assert.equal(repeatActor?.buyCount, 1);
assert.equal(repeatActor?.sellCount, 1);
assert.equal(repeatActor?.netVolumeUsd, 500);
assert.equal(actorSummary.largestNetBuyer?.trader, trader);
assert.equal(actorSummary.largestNetSeller?.trader, secondTrader);
assert.equal(actorSummary.largestNetSeller?.netVolumeUsd, -900);
assert.deepEqual(summarizeExternalTradeActors([]), {
  uniqueActors: 0,
  repeatActors: 0,
  largestNetBuyer: null,
  largestNetSeller: null,
  actors: []
});

const sellPressure = summarizeExternalSellPressure([
  {
    id: "large-sell",
    transactionHash: `0x${"1".repeat(64)}`,
    trader: `0x${"2".repeat(40)}`,
    side: "sell",
    tokenAmount: 100,
    quoteAmount: 3,
    volumeUsd: 3_100,
    timestamp: "2026-07-31T23:59:00.000Z"
  },
  {
    id: "small-buy",
    transactionHash: `0x${"3".repeat(64)}`,
    trader: `0x${"4".repeat(40)}`,
    side: "buy",
    tokenAmount: 20,
    quoteAmount: 0.2,
    volumeUsd: 100,
    timestamp: "2026-07-31T23:58:00.000Z"
  }
], 100_000, Date.parse("2026-08-01T00:00:00.000Z"));
assert.equal(sellPressure.level, "urgent");
assert.equal(sellPressure.largestSellLiquidityBps, 310);
assert.equal(sellPressure.netSellVolume5mUsd, 3_000);
assert.equal(sellPressure.netSellLiquidityBps, 300);
assert.equal(summarizeExternalSellPressure([], 100_000).level, "none");

console.log("External live trade tape validation passed.");
