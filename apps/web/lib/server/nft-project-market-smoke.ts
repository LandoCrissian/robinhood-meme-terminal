import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import type { RmtNftProjectMarketplaceRead, RmtNftProjectOnchainRead } from "@rmt/shared/nft/project-market";
import { readRmtNftProjectMarket } from "./nft-project-market";

const collection = getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146");
const hash = `0x${"1".repeat(64)}` as `0x${string}`;
const address = getAddress("0x1111111111111111111111111111111111111111");
const onchain: RmtNftProjectOnchainRead = {
  schemaVersion: 1, projectId: "ccff00", chainId: 4663, collectionAddress: collection,
  collectionStandard: "ERC721", sourceStatus: "SYNCED", availability: "AVAILABLE", completeness: "COMPLETE",
  holderCount: "1", circulatingTokenCount: "1", asOf: "2026-08-27T00:00:00.000Z",
  recentActivity: [{ transactionHash: hash, blockNumber: "10929152", blockHash: hash, logIndex: 1, movementIndex: 0,
    kind: "TRANSFER", from: address, to: getAddress("0x2222222222222222222222222222222222222222"), tokenId: "7", amount: "1", marketMeaning: "NOT_ESTABLISHED" }],
};
const marketplace: RmtNftProjectMarketplaceRead = {
  schemaVersion: 1, projectId: "ccff00", chainId: 4663, collectionAddress: collection, provider: "OPENSEA", protocol: "SEAPORT_1_6",
  availability: "AVAILABLE", availabilityReason: null, sourceStatus: "SYNCED", identityScope: "EXACT_CONTRACT_SCOPE",
  providerCollectionSlug: "ccff00-161927574", asOf: "2026-08-27T00:00:00.000Z", volume24hByPaymentAsset: [],
  lowestNormalizedListing: null,
  recentProviderSales: [{ authority: "PROVIDER_REPORTED_SALE", settlementVerificationStatus: "NOT_VERIFIED", tokenId: "7", quantity: "1",
    seller: address, buyer: getAddress("0x2222222222222222222222222222222222222222"), paymentAsset: null, grossAmount: null,
    transactionHash: null, orderHash: null, eventTimestamp: "2026-08-27T00:00:00.000Z" }],
};
const env = {
  NFT_INDEXER_URL: "https://nft-indexer.internal", NFT_INDEXER_READ_TOKEN: "a".repeat(64),
  NFT_MARKETPLACE_INDEXER_URL: "https://marketplace.internal", NFT_MARKETPLACE_INDEXER_READ_TOKEN: "b".repeat(64),
};
const fetchImpl: typeof fetch = async (input) => new Response(JSON.stringify(String(input).includes("marketplace") ? marketplace : onchain), { status: 200 });

async function main() {
const complete = await readRmtNftProjectMarket("ccff00", { env, fetchImpl });
assert.equal(complete?.project.rmtCurated, true);
assert.equal(complete?.projectToken, null);
assert.equal("sourceStatus" in complete!.onchain && complete.onchain.recentActivity[0]?.kind, "TRANSFER");
assert.equal("provider" in complete!.marketplace && complete.marketplace.recentProviderSales[0]?.authority, "PROVIDER_REPORTED_SALE");
assert.equal(JSON.stringify(complete).includes("discoveryProvenance"), false);
assert.equal(await readRmtNftProjectMarket("unknown", { env, fetchImpl }), null);

const absent = await readRmtNftProjectMarket("ccff00", { env: {}, fetchImpl });
assert.deepEqual(absent?.onchain, { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" });
assert.deepEqual(absent?.marketplace, { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" });
const onchainOnly = await readRmtNftProjectMarket("ccff00", { env: { NFT_INDEXER_URL: env.NFT_INDEXER_URL, NFT_INDEXER_READ_TOKEN: env.NFT_INDEXER_READ_TOKEN }, fetchImpl });
assert.equal("sourceStatus" in onchainOnly!.onchain, true);
assert.deepEqual(onchainOnly?.marketplace, { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" });
const mismatch = await readRmtNftProjectMarket("ccff00", {
  env, fetchImpl: async (input) => new Response(JSON.stringify(String(input).includes("marketplace") ? marketplace : { ...onchain, projectId: "wrong" }), { status: 200 }),
});
assert.deepEqual(mismatch?.onchain, { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" });
assert.equal("provider" in mismatch!.marketplace, true);

const page = readFileSync(new URL("../../app/nft/[projectId]/page.tsx", import.meta.url), "utf8");
assert.match(page, /RMT CURATED/);
assert.match(page, /OPENSEA REPORTED SALE/);
assert.match(page, /market meaning not established/);
assert.match(page, /notFound\(\)/);
assert.doesNotMatch(page, /HoodStreet|discoveryProvenance/);
assert.doesNotMatch(page, />\s*(BUY|LIST|OFFER|ACCEPT|SWEEP)\s*</i);
console.info("CCFF00 project-market web read model and route smoke: PASS");
}

void main();
