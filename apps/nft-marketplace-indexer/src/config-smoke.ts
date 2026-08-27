import assert from "node:assert/strict";
import { loadNftMarketplaceConfig } from "./config.js";
import { isMarketplaceReadAuthorized } from "./server.js";
const valid = {
  NFT_MARKETPLACE_DATABASE_URL:
    "postgresql://marketplace:secret@localhost:5432/rmt_nft_marketplace?sslmode=disable",
  NFT_MARKETPLACE_OPENSEA_API_KEY: "server-secret",
  NFT_MARKETPLACE_RPC_URL: "https://rpc.example.test",
  NFT_MARKETPLACE_READ_TOKEN: "b".repeat(64),
} as NodeJS.ProcessEnv;
assert.throws(
  () =>
    loadNftMarketplaceConfig({
      ...valid,
      NFT_MARKETPLACE_DATABASE_URL: undefined,
    }),
  /DATABASE_URL is required/,
);
assert.throws(() => loadNftMarketplaceConfig({ ...valid, NFT_MARKETPLACE_READ_TOKEN: undefined }), /READ_TOKEN is required/);
assert.throws(() => loadNftMarketplaceConfig({ ...valid, NFT_MARKETPLACE_READ_TOKEN: "short" }), /32 to 512/);
assert.throws(
  () =>
    loadNftMarketplaceConfig({
      ...valid,
      NFT_MARKETPLACE_OPENSEA_API_KEY: undefined,
    }),
  /API_KEY is required/,
);
assert.throws(
  () =>
    loadNftMarketplaceConfig({
      ...valid,
      NFT_MARKETPLACE_RPC_URL: "http://rpc.test",
    }),
  /must use https/,
);
assert.throws(
  () =>
    loadNftMarketplaceConfig({
      ...valid,
      NFT_MARKETPLACE_RPC_URL: "https://a:b@rpc.test",
    }),
  /embedded credentials/,
);
for (const collision of [
  "NFT_INDEXER_DATABASE_URL",
  "MARKET_INDEXER_DATABASE_URL",
  "DATABASE_URL",
  "EXTERNAL_ORIGIN_DATABASE_URL",
] as const)
  assert.throws(
    () =>
      loadNftMarketplaceConfig({
        ...valid,
        [collision]: "postgresql://other@localhost/rmt_nft_marketplace",
      }),
    new RegExp(collision),
  );
for (const [key, value] of [
  ["NFT_MARKETPLACE_PAGE_SIZE", "0"],
  ["NFT_MARKETPLACE_MAX_PAGES_PER_CYCLE", "65"],
  ["NFT_MARKETPLACE_MAX_LOWEST_LISTING_CANDIDATES", "33"],
  ["NFT_MARKETPLACE_REQUEST_TIMEOUT_MS", "x"],
] as const)
  assert.throws(
    () => loadNftMarketplaceConfig({ ...valid, [key]: value }),
    new RegExp(key),
  );
const config = loadNftMarketplaceConfig(valid);
assert.equal(config.apiKey, "server-secret");
assert.equal(isMarketplaceReadAuthorized(`Bearer ${valid.NFT_MARKETPLACE_READ_TOKEN}`, valid.NFT_MARKETPLACE_READ_TOKEN!), true);
assert.equal(isMarketplaceReadAuthorized("Bearer invalid", valid.NFT_MARKETPLACE_READ_TOKEN!), false);
assert.equal(
  JSON.stringify({ baseUrl: config.baseUrl, rpcUrl: config.rpcUrl }).includes(
    "server-secret",
  ),
  false,
);
console.info("nft-marketplace config smoke: PASS");
