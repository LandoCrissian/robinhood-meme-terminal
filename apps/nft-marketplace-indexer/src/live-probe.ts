import { RMT_NFT_ACTIVITY_SOURCES } from "@rmt/shared/nft/activity-sources";
import { OPENSEA_CHAIN } from "./constants.js";
import {
  resolveOpenSeaIdentity,
  assertRobinhoodChainSupported,
} from "./identity.js";
import { OpenSeaClient, page } from "./opensea-client.js";
async function main() {
  const apiKey = process.env.NFT_MARKETPLACE_OPENSEA_API_KEY?.trim();
  if (!apiKey) throw new Error("NFT_MARKETPLACE_OPENSEA_API_KEY is required.");
  const baseUrl =
    process.env.NFT_MARKETPLACE_OPENSEA_BASE_URL?.trim() ||
    "https://api.opensea.io";
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error(
      "NFT_MARKETPLACE_OPENSEA_BASE_URL must be credential-free HTTPS.",
    );
  const client = new OpenSeaClient({
    baseUrl: parsed.origin,
    apiKey,
    timeoutMs: 10000,
    pageSize: 10,
  });
  assertRobinhoodChainSupported(await client.chains());
  for (const source of RMT_NFT_ACTIVITY_SOURCES) {
    const contract = await client.contract(
      OPENSEA_CHAIN,
      source.collectionAddress,
    );
    const slug = (contract as Record<string, unknown>).collection;
    if (typeof slug !== "string")
      throw new Error("OpenSea contract response omitted slug.");
    const collection = await client.collection(slug);
    const identity = resolveOpenSeaIdentity(
      source,
      contract,
      collection,
      new Date().toISOString(),
    );
    const listings = page(await client.listings(slug), "listings");
    const offers = page(await client.offers(slug), "offers");
    const events = page(await client.events(slug), "asset_events");
    console.info(
      JSON.stringify({
        chain: OPENSEA_CHAIN,
        collectionAddress: identity.collectionAddress,
        slug: identity.providerCollectionSlug,
        scope: identity.scope,
        listingCount: listings.entries.length,
        offerCount: offers.entries.length,
        recentSaleCount: events.entries.filter(
          (v) =>
            v &&
            typeof v === "object" &&
            (v as Record<string, unknown>).event_type === "sale",
        ).length,
        hasNextListings: !!listings.next,
        hasNextOffers: !!offers.next,
        hasNextSales: !!events.next,
      }),
    );
  }
}
main().catch((error) => {
  console.error(
    "OpenSea live probe failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
