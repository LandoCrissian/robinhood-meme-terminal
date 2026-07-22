import assert from "node:assert/strict";
import { createPublicClient, http } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  CIRCUS_LAUNCHPAD,
  CIRCUS_WETH,
  fetchCircusCurveMarkets,
  parseCircusCurveFeed,
  rankCircusCurveMarket
} from "./circus-curve-feed";

const baseCoin = {
  mechanism: "curve",
  token: "0x8c77663b9cc08124ba4d9a3bded36fab1fe2b1a3",
  quote: CIRCUS_WETH,
  creator: "0x1c99fa9394624519610115576221597bf20d52c5",
  name: "GUSH",
  symbol: "GUSH",
  metadataURI: "https://cdn.example/meta.json",
  meta: {
    image: "https://cdn.example/gush.webp",
    twitter: "https://x.com/gushprotocol",
    description: "Test project"
  },
  createdAt: 1_784_739_361,
  lastTradeAt: 1_784_739_364,
  stats: { price: 0.0000000034, mcapUsd: 6_645, volumeQuote: 0.396 },
  mech: { state: { graduated: false, migrated: false, progressBps: 2_567 } },
  signals: { liquidityUsd: 771, uniqueTraders: 4, tradeDiversity: 1, score: 42.7 }
};

const parsed = parseCircusCurveFeed({ coins: [
  baseCoin,
  { ...baseCoin, token: "invalid" },
  { ...baseCoin, quote: "0x0000000000000000000000000000000000000001" },
  { ...baseCoin, mech: { state: { graduated: true, migrated: true, progressBps: 10_000 } } },
  { ...baseCoin, token: "0x91f9743ce5ab12a14b0da31bc0334f2687db2ba8", meta: { image: "javascript:alert(1)" } }
] });
assert.equal(parsed.length, 2);
assert.equal(parsed[0]?.imageUri, "https://cdn.example/gush.webp");
assert.equal(parsed[1]?.imageUri, null);
assert.throws(() => parseCircusCurveFeed({ coins: "invalid" }));

const now = 1_784_739_500;
const strongCurve = rankCircusCurveMarket({
  progressBps: 6_000,
  ethRaised: 3.5,
  uniqueTraders: 180,
  tradeDiversity: 0.9,
  liquidityUsd: 4_000,
  lastTradeAt: now - 60
}, now);
const weakCurve = rankCircusCurveMarket({
  progressBps: 100,
  ethRaised: 0.01,
  uniqueTraders: 2,
  tradeDiversity: 0.1,
  liquidityUsd: 25,
  lastTradeAt: now - 48 * 3_600
}, now);
assert.ok(strongCurve.momentumScore > weakCurve.momentumScore);
assert.equal(strongCurve.signal, "moving");
assert.equal(weakCurve.signal, "active");
assert.ok(strongCurve.momentumScore < 100, "curve scores should not saturate by default");

async function main() {
  if (process.env.CIRCUS_LIVE_CURVE_SMOKE !== "true") {
    console.log("Circus curve parser smoke passed");
    return;
  }
  const client = createPublicClient({
    chain: robinhoodChain,
    transport: http(
      process.env.ROBINHOOD_MAINNET_RPC_URL || robinhoodChain.rpcUrls.default.http[0],
      { retryCount: 2, timeout: 12_000 }
    )
  });
  const markets = await fetchCircusCurveMarkets(client);
  assert.ok(markets.length > 0 && markets.length <= 8);
  for (const market of markets) {
    assert.equal(market.project?.sourceId, "circus");
    assert.equal(market.project?.provenance, "launchpad-and-token-cross-checked");
    assert.equal(market.venue.kind, "external-launchpad");
    assert.equal(market.pairAddress, CIRCUS_LAUNCHPAD);
    assert.equal(market.curve?.state, "curve-live");
    assert.equal(market.curve?.graduated, false);
    assert.equal(market.curve?.migrated, false);
    assert.ok((market.curve?.progressBps ?? -1) >= 0);
    assert.ok((market.curve?.ethRaised ?? -1) >= 0);
  }
  console.log(JSON.stringify({
    event: "circus_live_curve_feed",
    count: markets.length,
    markets: markets.map((market) => ({
      token: market.address,
      symbol: market.symbol,
      signal: market.signal,
      momentumScore: market.momentumScore,
      progressBps: market.curve?.progressBps,
      ethRaised: market.curve?.ethRaised,
      imageUri: market.project?.imageUri
    }))
  }));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
