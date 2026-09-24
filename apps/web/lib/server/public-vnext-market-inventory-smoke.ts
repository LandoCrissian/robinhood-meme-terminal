import assert from "node:assert/strict";
import { getAddress } from "viem";
// @ts-expect-error the deterministic browser fixture has no emitted declaration.
import { VISIBLE_TOKEN_MARKETS } from "../../../../scripts/visual-qa/legion-fixtures.mjs";
import type { VNextDirectoryMarket } from "../vnext/market-directory";
import {
  isPublicVNextInventoryMarket,
  selectPublicVNextMarketInventory
} from "./public-vnext-market-inventory";

const template = (VISIBLE_TOKEN_MARKETS as VNextDirectoryMarket[]).find((market) => market.pairAddress)!;
const address = (value: number) => getAddress(`0x${value.toString(16).padStart(40, "0")}`);

function market(value: number, changes: Partial<VNextDirectoryMarket> = {}): VNextDirectoryMarket {
  return {
    ...template,
    address: address(value),
    pairAddress: address(value + 1_000),
    name: `Open discovery ${value}`,
    symbol: `OPEN${value}`,
    ...changes
  };
}

const lowLiquidity = market(1, { liquidityUsd: 4_999, volume24h: 1_000 });
const lowVolume = market(2, { liquidityUsd: 10_000, volume24h: 99 });
const nullLiquidity = market(3, { liquidityUsd: null, volume24h: 1_000 });
const nullVolume = market(4, { liquidityUsd: 10_000, volume24h: null });
const newIncomplete = market(5, {
  ageMinutes: 15,
  liquidityUsd: null,
  volume24h: null,
  volume1h: null,
  buys1h: null,
  sells1h: null,
  signal: null
});
const inactive = market(6, {
  volume1h: 0,
  buys1h: 0,
  sells1h: 0,
  priceChange5m: null,
  priceChange1h: null,
  priceChange24h: null,
  signal: null
});
const markets = [lowLiquidity, lowVolume, nullLiquidity, nullVolume, newIncomplete, inactive];

for (const candidate of markets) {
  assert.equal(isPublicVNextInventoryMarket(candidate), true);
}
assert.deepEqual(selectPublicVNextMarketInventory(markets, "all").map(({ address }) => address).sort(), markets.map(({ address }) => address).sort());
assert.equal(selectPublicVNextMarketInventory(markets, "new").some(({ address }) => address === newIncomplete.address), true);
assert.equal(selectPublicVNextMarketInventory(markets, "active").some(({ address }) => address === inactive.address), false);
assert.equal(selectPublicVNextMarketInventory(markets, "all").some(({ address }) => address === inactive.address), true);
assert.equal(selectPublicVNextMarketInventory(markets, "movers").some(({ address }) => address === inactive.address), false);
assert.equal(selectPublicVNextMarketInventory(markets, "trending").some(({ address }) => address === inactive.address), false);

assert.equal(isPublicVNextInventoryMarket({ ...template, address: "not-an-address" }), false);
assert.equal(isPublicVNextInventoryMarket({ ...template, pairAddress: undefined }), false);
assert.equal(isPublicVNextInventoryMarket({ ...template, name: "" }), false);
assert.equal(isPublicVNextInventoryMarket({ ...template, symbol: "" }), false);

console.log("Public VNext discovery admits identified markets independently of optional metrics while views remain evidence classifications.");
