import assert from "node:assert/strict";
import { externalTradesRequestUrl, parseExternalPoolTrades } from "./external-trades";

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

console.log("External live trade tape validation passed.");
