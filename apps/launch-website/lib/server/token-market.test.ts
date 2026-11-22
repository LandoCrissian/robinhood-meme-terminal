import assert from "node:assert/strict";
import test from "node:test";
import receipts from "../../../../docs/evidence/token-market/receipts.json";
import { toEventSelector } from "viem";
import replay from "../../../../docs/evidence/token-market/market-replay.json";
import { checkpointFresh, validMarket } from "../token-market";
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
