import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ExternalMarket } from "./external-market";
import {
  buildPublicMarketMetadata,
  isPublicSearchMarket,
  publicMarketImageVersion,
  publicMarketPath,
  publicMarketSitemapPaths,
  publicMarketStructuredData
} from "./public-market-discovery";
import {
  buildLegacyTokenMetadata,
  buildPublicProjectMetadata,
  officialRmtProjectPath
} from "./public-project-discovery";
import { OFFICIAL_RMT_V6_TOKEN } from "./project-page";

const token = "0x1111111111111111111111111111111111111111";
const pair = "0x2222222222222222222222222222222222222222";
const eligibleMarket: ExternalMarket = {
  address: token,
  name: "Reach Token",
  symbol: "REACH",
  pairAddress: pair,
  url: "https://dexscreener.com/robinhood/0x2222222222222222222222222222222222222222",
  dexId: "sushi",
  project: {
    sourceId: "pons",
    sourceName: "Pons",
    provenance: "factory-and-token-cross-checked",
    creator: "0x3333333333333333333333333333333333333333",
    launchPool: pair,
    name: "Reach Token",
    symbol: "REACH",
    description: "A cross-checked fixture.",
    imageUri: null,
    socials: { x: null, telegram: null, discord: null, website: null, farcaster: null }
  },
  origin: { kind: "external", state: "unknown", coverage: "unavailable" },
  venue: {
    kind: "dex",
    dexId: "sushi",
    pairAddress: pair,
    url: "https://dexscreener.com/robinhood/0x2222222222222222222222222222222222222222",
    execution: "read-only"
  },
  priceUsd: 0.0001,
  liquidityUsd: 25_000,
  marketCapUsd: 120_000,
  fdvUsd: 120_000,
  volume5m: 1_000,
  volume1h: 8_000,
  volume24h: 42_000,
  priceChange5m: 2,
  priceChange1h: 8,
  priceChange24h: 12,
  buys5m: 4,
  sells5m: 3,
  buys1h: 18,
  sells1h: 12,
  buys24h: 110,
  sells24h: 95,
  pairCreatedAt: Date.now() - 86_400_000,
  ageMinutes: 1_440,
  momentumScore: 67,
  buyPressureBps: 6_000,
  signal: "moving",
  riskFlags: []
};

assert.equal(isPublicSearchMarket(eligibleMarket), true);
assert.equal(publicMarketPath(token), `/market/${token}`);
assert.deepEqual(publicMarketSitemapPaths([eligibleMarket]), [`/market/${token}`]);

const marketMetadata = buildPublicMarketMetadata(token, eligibleMarket);
assert.equal(marketMetadata.title, "Reach Token ($REACH) | RMT Market");
assert.deepEqual(marketMetadata.alternates, { canonical: `/market/${token}` });
assert.match(String(marketMetadata.description), /origin, activity, holder concentration, risk evidence/);
assert.equal((marketMetadata.robots as { index?: boolean }).index, true);
assert.equal(marketMetadata.twitter && "card" in marketMetadata.twitter ? marketMetadata.twitter.card : null, "summary_large_image");
assert.equal(publicMarketImageVersion(eligibleMarket), "p-16-3c");
assert.match(
  JSON.stringify(marketMetadata.openGraph && "images" in marketMetadata.openGraph ? marketMetadata.openGraph.images : ""),
  /opengraph-image\?v=p-16-3c/
);

const structured = publicMarketStructuredData(eligibleMarket);
assert.equal(structured?.["@type"], "WebPage");
assert.equal(structured?.about.identifier, token);

for (const blocked of [
  { ...eligibleMarket, project: undefined },
  { ...eligibleMarket, liquidityUsd: 4_999 },
  { ...eligibleMarket, volume24h: 99 },
  { ...eligibleMarket, riskFlags: ["extreme-price-spike"] as ExternalMarket["riskFlags"] },
  {
    ...eligibleMarket,
    project: { ...eligibleMarket.project!, launchPool: "0x4444444444444444444444444444444444444444" }
  }
]) {
  assert.equal(isPublicSearchMarket(blocked), false);
  assert.equal((buildPublicMarketMetadata(token, blocked).robots as { index?: boolean }).index, false);
  assert.deepEqual(publicMarketSitemapPaths([blocked]), []);
}

const invalidMetadata = buildPublicMarketMetadata("not-an-address", null);
assert.equal((invalidMetadata.robots as { index?: boolean }).index, false);

const officialProjectMetadata = buildPublicProjectMetadata(OFFICIAL_RMT_V6_TOKEN);
assert.equal(officialProjectMetadata.title, "Robinhood Meme Terminal ($RMT) | RMT Project");
assert.deepEqual(officialProjectMetadata.alternates, { canonical: officialRmtProjectPath() });
assert.equal((officialProjectMetadata.robots as { index?: boolean }).index, true);

const hiddenProjectMetadata = buildPublicProjectMetadata(token);
assert.equal((hiddenProjectMetadata.robots as { index?: boolean }).index, false);
const legacyMetadata = buildLegacyTokenMetadata(OFFICIAL_RMT_V6_TOKEN);
assert.deepEqual(legacyMetadata.alternates, { canonical: officialRmtProjectPath() });
assert.equal((legacyMetadata.robots as { index?: boolean }).index, false);

const marketPageSource = readFileSync(new URL("../app/market/[address]/page.tsx", import.meta.url), "utf8");
const marketImageSource = readFileSync(new URL("../app/market/[address]/opengraph-image.tsx", import.meta.url), "utf8");
const publicMarketImageSource = readFileSync(new URL("./server/public-market-image.ts", import.meta.url), "utf8");
const projectPageSource = readFileSync(new URL("../app/project/[address]/page.tsx", import.meta.url), "utf8");
const projectImageSource = readFileSync(new URL("../app/project/[address]/opengraph-image.tsx", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("../app/external-market-workspace.tsx", import.meta.url), "utf8");
assert.match(marketPageSource, /generateMetadata/);
assert.match(marketPageSource, /publicMarketStructuredData/);
assert.match(marketPageSource, /initialMarket=\{market \?\? undefined\}/);
assert.match(marketImageSource, /summary|ORIGIN CROSS-CHECKED/);
assert.match(marketImageSource, /fetchPublicMarketImageDataUri/);
assert.match(publicMarketImageSource, /uri\?\.startsWith\("ipfs:\/\/"\)/);
assert.match(publicMarketImageSource, /MAX_PUBLIC_IMAGE_BYTES/);
assert.match(publicMarketImageSource, /redirect: "error"/);
assert.match(projectPageSource, /generateMetadata/);
assert.match(projectImageSource, /OFFICIAL · FACTORY VERIFIED/);
assert.match(workspaceSource, /navigator\.share/);
assert.match(workspaceSource, /Share market/);

console.info("Public market discovery smoke test passed");
