import assert from "node:assert/strict";
import type { ExternalMarket } from "../external-market";
import { ponsMetadataForMarket, projectMetadataForMarket } from "./external-project-metadata";
import type { NoxaProjectMetadata } from "./noxa-project-metadata";
import type { PonsProjectMetadata } from "./pons-project-metadata";

const token = "0x74b6Aebfa7336ed1013551bCf786a675F194066D";
const market: ExternalMarket = {
  address: token,
  name: "Unverified name",
  symbol: "UNKNOWN",
  pairAddress: "0x2C86edaA90D4440D07D338645007cdb80f1A98ff",
  url: "https://dexscreener.com/robinhood/0x2c86edaa90d4440d07d338645007cdb80f1a98ff",
  dexId: "uniswap",
  origin: { kind: "external", state: "unknown", coverage: "unavailable" },
  venue: {
    kind: "dex",
    dexId: "uniswap",
    pairAddress: "0x2C86edaA90D4440D07D338645007cdb80f1A98ff",
    url: "https://dexscreener.com/robinhood/0x2c86edaa90d4440d07d338645007cdb80f1a98ff",
    execution: "read-only"
  },
  priceUsd: 0,
  liquidityUsd: 1,
  marketCapUsd: 0,
  fdvUsd: 0,
  volume5m: 0,
  volume1h: 0,
  volume24h: 1,
  priceChange5m: 0,
  priceChange1h: 0,
  priceChange24h: 0,
  buys5m: 0,
  sells5m: 0,
  buys1h: 0,
  sells1h: 0,
  buys24h: 1,
  sells24h: 0,
  pairCreatedAt: null,
  ageMinutes: null,
  momentumScore: 0,
  buyPressureBps: 10_000,
  signal: "active",
  riskFlags: []
};
const metadata: PonsProjectMetadata = {
  sourceId: "pons",
  factory: "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB",
  token,
  creator: "0xac93f07BaC60Ba09A561fB8d4B4289950DDfCC70",
  name: "Fefer",
  symbol: "FEFER",
  description: "Fefer",
  imageUri: "https://cdn.example/fefer.webp",
  pool: "0x2C86edaA90D4440D07D338645007cdb80f1A98ff",
  pairedToken: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  dexFactory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  positionId: 312_778n,
  poolFee: 10_000,
  restrictionsEndBlock: 25_589_018n,
  initialBuyAmount: 1_000_000_000_000_000n,
  socials: { x: "https://x.com/example", telegram: null, discord: null, website: null, farcaster: null },
  provenance: "factory-and-token-cross-checked"
};

const enriched = ponsMetadataForMarket(market, metadata);
assert.equal(enriched.name, "Fefer");
assert.equal(enriched.symbol, "FEFER");
assert.equal(enriched.project?.imageUri, "https://cdn.example/fefer.webp");
assert.equal(enriched.project?.launchPool, market.pairAddress);
assert.equal(enriched.origin.state, "unknown", "Metadata must not silently upgrade origin coverage");

const mismatch = ponsMetadataForMarket({ ...market, address: metadata.pairedToken }, metadata);
assert.equal(mismatch.project, undefined);

const noxaMetadata: NoxaProjectMetadata = {
  ...metadata,
  sourceId: "noxa",
  factory: "0xD9eC2db5f3D1b236843925949fe5bd8a3836FCcB",
  token: "0x6399E2Bd8af62C0ac13f55613C3469b67332a6Fd",
  name: "ROBIN DOG",
  symbol: "ROBINDOG",
  pool: "0x08A9BAfc1E4b70302F752D9ee8bF53cAd8dF939A"
};
const noxaMarket = {
  ...market,
  address: noxaMetadata.token,
  pairAddress: noxaMetadata.pool,
  venue: { ...market.venue, pairAddress: noxaMetadata.pool }
};
const noxaEnriched = projectMetadataForMarket(noxaMarket, noxaMetadata);
assert.equal(noxaEnriched.project?.sourceId, "noxa");
assert.equal(noxaEnriched.project?.sourceName, "Noxa");
assert.equal(noxaEnriched.project?.imageUri, metadata.imageUri);

console.log("external project metadata join smoke passed");
