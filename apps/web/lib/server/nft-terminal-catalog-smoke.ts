import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import type { RmtCuratedNftProject } from "@rmt/shared/nft/project-registry";
import { RMT_CURATED_NFT_PROJECTS } from "@rmt/shared/nft/project-registry";
import type { RmtNftProjectMarketplaceRead } from "@rmt/shared/nft/project-market";
import type { RmtNftItemRead } from "@rmt/shared/nft/project-inventory";
import {
  activePublicRmtNftCollections,
  activePublicRmtNftProjects,
  hasCurrentNftTrendingEvidence,
  readRmtNftTerminalCatalog,
  recentlyVerifiedPublicRmtNftCollections,
  resolveExactRmtNftItemSearch,
  watchingPublicRmtNftCollections,
  watchingPublicRmtNftProjects,
} from "./nft-terminal-catalog";

const admitted = RMT_CURATED_NFT_PROJECTS.find((project) => project.projectId === "ccff00")!;
const now = new Date("2026-09-21T20:30:00.000Z");
const collection = getAddress(admitted.collections[0]!.contractAddress);
const hash = `0x${"1".repeat(64)}` as `0x${string}`;
const address = getAddress("0x1111111111111111111111111111111111111111");
const marketplace = {
  schemaVersion: 1, projectId: "ccff00", chainId: 4663, collectionAddress: collection,
  provider: "OPENSEA", protocol: "SEAPORT_1_6", availability: "AVAILABLE", availabilityReason: null,
  sourceStatus: "SYNCED", identityScope: "EXACT_CONTRACT_SCOPE", providerCollectionSlug: "ccff00", asOf: now.toISOString(),
  lowestNormalizedListing: null, recentProviderSales: Array.from({ length: 20 }, (_, index) => ({
    authority: "PROVIDER_REPORTED_SALE" as const, settlementVerificationStatus: "NOT_VERIFIED" as const,
    tokenId: String(index + 1), quantity: "1", seller: address, buyer: address, paymentAsset: null, grossAmount: null,
    transactionHash: null, orderHash: null, eventTimestamp: new Date(now.getTime() - index * 60_000).toISOString(),
  })),
  volume24hByPaymentAsset: [{ authority: "OPENSEA_REPORTED_24H_VOLUME" as const,
    paymentAsset: { kind: "NATIVE" as const, chainId: 4663 as const, address: null, symbol: "ETH", decimals: 18 },
    grossAmount: "25000000000000000000", saleCount: 25 }],
} satisfies RmtNftProjectMarketplaceRead;

const itemFive: RmtNftItemRead = {
  schemaVersion: 1, projectId: "ccff00", chainId: 4663, collectionAddress: collection, collectionStandard: "ERC721",
  tokenId: "5", owner: address, asOf: now.toISOString(),
  metadata: { authority: "ONCHAIN_TOKEN_URI", status: "UNAVAILABLE", tokenUriKind: "OTHER", metadataDigest: null,
    name: null, description: null, image: null, attributes: [] },
  tokenBoundAccount: { authority: "ONCHAIN_ERC6551_ACCOUNT", chainId: 4663, collectionAddress: collection,
    tokenId: "5", accountAddress: address },
};

async function main() {
  assert.deepEqual(activePublicRmtNftProjects().map((project) => project.projectId), ["ccff00"]);
  assert.deepEqual(watchingPublicRmtNftProjects().map((project) => project.projectId), ["robin-rabbits", "gogh-punks"]);
  assert.deepEqual(activePublicRmtNftCollections().map((entry) => entry.projectId), ["ccff00"]);
  assert.deepEqual(watchingPublicRmtNftCollections().map((entry) => entry.projectId), ["robin-rabbits", "gogh-punks"]);

  const approvalChanged = [{ ...admitted, approvedAt: "2099-01-01T00:00:00.000Z" }] satisfies RmtCuratedNftProject[];
  const verified = recentlyVerifiedPublicRmtNftCollections(approvalChanged);
  assert.equal(verified[0]!.newEvidence?.authority, "TECHNICAL_VERIFICATION_OBSERVED");
  assert.equal(verified[0]!.newEvidence?.observedAt, "2026-08-28T11:29:53.179Z");
  assert.notEqual(verified[0]!.newEvidence?.observedAt, approvalChanged[0]!.approvedAt, "New evidence must not alias project approval time");

  const unidentifiedCollection = [{ ...admitted, collections: admitted.collections.map((value) => ({ ...value,
    contractAddress: getAddress("0x2222222222222222222222222222222222222222") })) }] satisfies RmtCuratedNftProject[];
  assert.equal(activePublicRmtNftCollections(unidentifiedCollection).length, 1, "missing date enrichment must not hide active identity");
  assert.equal(recentlyVerifiedPublicRmtNftCollections(unidentifiedCollection).length, 0, "missing provenance must not fabricate New classification");

  const catalog = readRmtNftTerminalCatalog("active");
  assert.equal(catalog.projects[0]!.projectToken, null);
  assert.deepEqual(catalog.newCollections.map((entry) => entry.projectId), ["gogh-punks", "robin-rabbits", "ccff00"]);
  assert.equal(catalog.newCollections.every((entry) => entry.newEvidence?.authority === "TECHNICAL_VERIFICATION_OBSERVED"), true);

  assert.equal(hasCurrentNftTrendingEvidence(marketplace, now), true, "scoped current 24h aggregate establishes Trending");
  assert.equal(hasCurrentNftTrendingEvidence({ ...marketplace, volume24hByPaymentAsset: [] }, now), false,
    "unwindowed provider history alone does not establish Trending");
  assert.equal(hasCurrentNftTrendingEvidence({ ...marketplace, asOf: "2026-09-20T20:00:00.000Z" }, now), false,
    "old observation does not establish current Trending");
  assert.equal(hasCurrentNftTrendingEvidence({ ...marketplace, availability: "UNAVAILABLE", availabilityReason: "SOURCE_STALE",
    lowestNormalizedListing: null, recentProviderSales: [], volume24hByPaymentAsset: [] }, now), false);

  const confirmed = await resolveExactRmtNftItemSearch("ccff00 #5", catalog.projects, async (_projectId, tokenId) => tokenId === "5" ? itemFive : null);
  assert.equal(confirmed.status, "CONFIRMED", "exact item outside the four-record preview resolves through the item reader");
  if (confirmed.status === "CONFIRMED") assert.equal(confirmed.matches[0]!.item.tokenId, "5");
  assert.equal((await resolveExactRmtNftItemSearch("#999", catalog.projects, async () => null)).status, "NOT_FOUND");
  assert.equal((await resolveExactRmtNftItemSearch("#999", catalog.projects, async () => ({ availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" }))).status, "UNAVAILABLE");

  const catalogPage = readFileSync(new URL("../../app/nft/page.tsx", import.meta.url), "utf8");
  const projectPage = readFileSync(new URL("../../app/nft/[projectId]/page.tsx", import.meta.url), "utf8");
  const reader = readFileSync(new URL("./nft-project-market.ts", import.meta.url), "utf8");
  for (const text of [catalogPage, projectPage]) assert.match(text, /Suspense/);
  assert.match(catalogPage, /data-nft-known-identity/);
  assert.match(projectPage, /data-nft-project-known-identity/);
  assert.match(reader, /readRmtNftProjectOnchain/);
  assert.match(reader, /readRmtNftProjectMarketplace/);
  assert.doesNotMatch(projectPage, /24H SALES/);
  assert.match(projectPage, /RECENT REPORTS/);
  assert.match(projectPage, /bounded to.*20 records.*not a 24h total/i);
  assert.match(projectPage, /Lowest normalized native-payment OpenSea listing/);
  assert.doesNotMatch(catalogPage, /approvedAt/);
  assert.match(catalogPage, /Technical verification/);
  assert.match(catalogPage, /data-nft-item-lookup="UNAVAILABLE"/);
  assert.match(catalogPage, /data-nft-item-lookup="NOT_FOUND"/);
  assert.doesNotMatch(catalogPage, />\s*(?:Mint|Buy|List|Offer|Fulfill|Sign|Submit)\s*</i);
  console.info("NFT Terminal date, trending, exact-item search, metric authority, and progressive-streaming smoke: PASS");
}

void main();
