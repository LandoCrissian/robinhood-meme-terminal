import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import { RMT_SEAPORT_1_6_ADDRESS } from "@rmt/shared/nft/marketplace-evidence";
import type { RmtNftProjectMarketplaceRead, RmtNftProjectOnchainRead } from "@rmt/shared/nft/project-market";
import { readRmtNftProjectMarket } from "./nft-project-market";

const collection = getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146");
const hash = `0x${"1".repeat(64)}` as `0x${string}`;
const address = getAddress("0x1111111111111111111111111111111111111111");
const otherAddress = getAddress("0x2222222222222222222222222222222222222222");
const onchain: RmtNftProjectOnchainRead = {
  schemaVersion: 1, projectId: "ccff00", chainId: 4663, collectionAddress: collection,
  collectionStandard: "ERC721", sourceStatus: "SYNCED", availability: "AVAILABLE", completeness: "COMPLETE",
  holderCount: "1", circulatingTokenCount: "1", asOf: "2026-08-27T00:00:00.000Z",
  recentActivity: [{ transactionHash: hash, blockNumber: "10929152", blockHash: hash, logIndex: 1, movementIndex: 0,
    kind: "TRANSFER", from: address, to: otherAddress, tokenId: "7", amount: "1", marketMeaning: "NOT_ESTABLISHED" }],
};
const marketplace: RmtNftProjectMarketplaceRead = {
  schemaVersion: 1, projectId: "ccff00", chainId: 4663, collectionAddress: collection, provider: "OPENSEA", protocol: "SEAPORT_1_6",
  availability: "AVAILABLE", availabilityReason: null, sourceStatus: "SYNCED", identityScope: "EXACT_CONTRACT_SCOPE",
  providerCollectionSlug: "ccff00-161927574", asOf: "2026-08-27T00:00:00.000Z",
  lowestNormalizedListing: {
    authority: "LOWEST_NORMALIZED_OPENSEA_LISTING", rmtExecutable: false, orderHash: hash,
    protocolAddress: RMT_SEAPORT_1_6_ADDRESS, tokenId: "7", quantity: "1", grossAmount: "1000000000000000000",
    paymentAsset: { kind: "NATIVE", chainId: 4663, address: null, symbol: "ETH", decimals: 18 },
    maker: address, exactRevalidatedAt: "2026-08-27T00:00:00.000Z",
  },
  recentProviderSales: [{ authority: "PROVIDER_REPORTED_SALE", settlementVerificationStatus: "NOT_VERIFIED", tokenId: "7", quantity: "1",
    seller: address, buyer: otherAddress, paymentAsset: null, grossAmount: null,
    transactionHash: null, orderHash: null, eventTimestamp: "2026-08-27T00:00:00.000Z" }],
  volume24hByPaymentAsset: [{ authority: "OPENSEA_REPORTED_24H_VOLUME",
    paymentAsset: { kind: "NATIVE", chainId: 4663, address: null, symbol: "ETH", decimals: 18 },
    grossAmount: "1000000000000000000", saleCount: 1 }],
};
const env = {
  NFT_INDEXER_URL: "https://nft-indexer.internal", NFT_INDEXER_READ_TOKEN: "a".repeat(64),
  NFT_MARKETPLACE_INDEXER_URL: "https://marketplace.internal", NFT_MARKETPLACE_INDEXER_READ_TOKEN: "b".repeat(64),
};

function fetchFor(onchainBody: unknown, marketplaceBody: unknown): typeof fetch {
  return async (input) => new Response(JSON.stringify(String(input).includes("marketplace") ? marketplaceBody : onchainBody), { status: 200 });
}

async function expectOnchainRejected(value: unknown) {
  const result = await readRmtNftProjectMarket("ccff00", { env, fetchImpl: fetchFor(value, marketplace) });
  assert.deepEqual(result?.onchain, { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" });
  assert.equal("provider" in result!.marketplace, true, "healthy marketplace evidence must remain usable");
}

async function expectMarketplaceRejected(value: unknown) {
  const result = await readRmtNftProjectMarket("ccff00", { env, fetchImpl: fetchFor(onchain, value) });
  assert.deepEqual(result?.marketplace, { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" });
  assert.equal("sourceStatus" in result!.onchain, true, "healthy onchain evidence must remain usable");
}

async function main() {
  const complete = await readRmtNftProjectMarket("ccff00", { env, fetchImpl: fetchFor(onchain, marketplace) });
  assert.equal(complete?.project.rmtCurated, true);
  assert.equal(complete?.projectToken, null);
  assert.equal("sourceStatus" in complete!.onchain && complete.onchain.recentActivity[0]?.kind, "TRANSFER");
  assert.equal("provider" in complete!.marketplace && complete.marketplace.recentProviderSales[0]?.authority, "PROVIDER_REPORTED_SALE");
  assert.equal(JSON.stringify(complete).includes("discoveryProvenance"), false);
  assert.equal(await readRmtNftProjectMarket("unknown", { env, fetchImpl: fetchFor(onchain, marketplace) }), null);

  const absent = await readRmtNftProjectMarket("ccff00", { env: {}, fetchImpl: fetchFor(onchain, marketplace) });
  assert.deepEqual(absent?.onchain, { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" });
  assert.deepEqual(absent?.marketplace, { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" });
  const onchainOnly = await readRmtNftProjectMarket("ccff00", {
    env: { NFT_INDEXER_URL: env.NFT_INDEXER_URL, NFT_INDEXER_READ_TOKEN: env.NFT_INDEXER_READ_TOKEN },
    fetchImpl: fetchFor(onchain, marketplace),
  });
  assert.equal("sourceStatus" in onchainOnly!.onchain, true);
  assert.deepEqual(onchainOnly?.marketplace, { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" });

  await expectOnchainRejected({ ...onchain, sourceStatus: "BACKFILLING", availability: "PARTIAL", completeness: "PARTIAL", circulatingTokenCount: null });
  await expectOnchainRejected({ ...onchain, sourceStatus: "ERROR", availability: "UNAVAILABLE", completeness: "UNAVAILABLE", holderCount: null, circulatingTokenCount: null });
  await expectOnchainRejected({ ...onchain, collectionStandard: "ERC1155" });

  await expectMarketplaceRejected({ ...marketplace, lowestNormalizedListing: { ...marketplace.lowestNormalizedListing!, authority: "RMT_VERIFIED_FLOOR" } });
  await expectMarketplaceRejected({ ...marketplace, lowestNormalizedListing: { ...marketplace.lowestNormalizedListing!, rmtExecutable: true } });
  await expectMarketplaceRejected({ ...marketplace, lowestNormalizedListing: { ...marketplace.lowestNormalizedListing!, protocolAddress: otherAddress } });
  await expectMarketplaceRejected({ ...marketplace, lowestNormalizedListing: { ...marketplace.lowestNormalizedListing!, paymentAsset: { kind: "ERC20", chainId: 4663, address: otherAddress, symbol: "WETH", decimals: 18 } } });
  await expectMarketplaceRejected({ ...marketplace, recentProviderSales: [{ ...marketplace.recentProviderSales[0]!, settlementVerificationStatus: "VERIFIED" }] });
  await expectMarketplaceRejected({ ...marketplace, availability: "UNAVAILABLE", availabilityReason: "SOURCE_STALE", lowestNormalizedListing: null, recentProviderSales: [] });
  await expectMarketplaceRejected({ ...marketplace, asOf: null });
  await expectMarketplaceRejected({ ...marketplace, sourceStatus: "BACKFILLING", availability: "PARTIAL", asOf: null });
  await expectMarketplaceRejected({ ...marketplace, availabilityReason: "STALE" });
  await expectMarketplaceRejected({ ...marketplace, availability: "UNAVAILABLE", availabilityReason: null, lowestNormalizedListing: null, recentProviderSales: [], volume24hByPaymentAsset: [] });
  await expectMarketplaceRejected({ ...marketplace, availability: "UNAVAILABLE", availabilityReason: "SOURCE_STALE", asOf: null, lowestNormalizedListing: null, recentProviderSales: [], volume24hByPaymentAsset: [] });
  await expectMarketplaceRejected({ ...marketplace, sourceStatus: "BACKFILLING", availability: "UNAVAILABLE", availabilityReason: "SOURCE_NOT_READY", lowestNormalizedListing: null, recentProviderSales: [], volume24hByPaymentAsset: [] });

  for (const coherentUnavailable of [
    { ...marketplace, sourceStatus: "BACKFILLING", availability: "UNAVAILABLE", availabilityReason: "SOURCE_NOT_READY", asOf: null, lowestNormalizedListing: null, recentProviderSales: [], volume24hByPaymentAsset: [] },
    { ...marketplace, availability: "UNAVAILABLE", availabilityReason: "SOURCE_STALE", lowestNormalizedListing: null, recentProviderSales: [], volume24hByPaymentAsset: [] },
    { ...marketplace, sourceStatus: "ERROR", availability: "UNAVAILABLE", availabilityReason: "SOURCE_ERROR", asOf: null, lowestNormalizedListing: null, recentProviderSales: [], volume24hByPaymentAsset: [] },
  ]) {
    const result = await readRmtNftProjectMarket("ccff00", { env, fetchImpl: fetchFor(onchain, coherentUnavailable) });
    assert.equal("provider" in result!.marketplace, true);
  }
  const exactOrderStale = await readRmtNftProjectMarket("ccff00", {
    env,
    fetchImpl: fetchFor(onchain, { ...marketplace, availabilityReason: "STALE", lowestNormalizedListing: null }),
  });
  assert.ok(exactOrderStale);
  assert.equal("provider" in exactOrderStale.marketplace && exactOrderStale.marketplace.availabilityReason, "STALE");
  assert.equal("provider" in exactOrderStale.marketplace && exactOrderStale.marketplace.recentProviderSales.length, 1);

  const page = readFileSync(new URL("../../app/nft/[projectId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /RMT CURATED/);
  assert.match(page, /OPENSEA REPORTED SALE/);
  assert.match(page, /market meaning not established/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /model\.project\.displayName.*project market metrics/);
  assert.doesNotMatch(page, /HoodStreet|discoveryProvenance/);
  assert.doesNotMatch(page, />\s*(BUY|LIST|OFFER|ACCEPT|SWEEP)\s*</i);

  const nextConfig = readFileSync(new URL("../../next.config.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(nextConfig, /config\.resolve\.extensionAlias/);
  assert.match(nextConfig, /path\.resolve\(appDirectory, "\.\.\/\.\.\/packages\/shared\/src"\)/);
  assert.match(nextConfig, /transpilePackages: \["@rmt\/shared"\]/);
  const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  for (const name of ["NFT_INDEXER_URL", "NFT_INDEXER_READ_TOKEN", "NFT_MARKETPLACE_INDEXER_URL", "NFT_MARKETPLACE_INDEXER_READ_TOKEN"]) {
    assert.match(envExample, new RegExp(`^${name}=$`, "m"));
  }
  assert.match(envExample, /SERVER ONLY[\s\S]*NEVER NEXT_PUBLIC_/);
  console.info("CCFF00 project-market web read model, authority validation, and scoped resolution smoke: PASS");
}

void main();
