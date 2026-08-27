import type { Pool } from "pg";
import { createPublicClient, http } from "viem";
import {
  RMT_NFT_ACTIVITY_SOURCES,
  type RmtNftActivitySource,
} from "@rmt/shared/nft/activity-sources";
import type {
  RmtNftCollectionMarketplaceIdentity,
  RmtNftListingEvidence,
} from "@rmt/shared/nft/marketplace-evidence";
import type { NftMarketplaceConfig } from "./config.js";
import { OPENSEA_CHAIN, ROBINHOOD_CHAIN_ID } from "./constants.js";
import {
  assertRobinhoodChainSupported,
  resolveOpenSeaIdentity,
} from "./identity.js";
import {
  normalizeListing,
  normalizeOffer,
  normalizeSale,
  openSeaReportedFloor,
} from "./normalization.js";
import { OpenSeaClient, page } from "./opensea-client.js";
import { assertMarketplaceSourceSet } from "./sources.js";
import {
  cursor,
  lowestNormalizedListingAmount,
  persistIdentity,
  persistPage,
  recordSourceError,
  recordSourceSuccess,
} from "./storage.js";
export type MarketplaceWorkerStatus = {
  running: boolean;
  provider: "OPENSEA";
  collectionCount: number;
  lastSuccessfulPoll: string | null;
  lastProviderError: string | null;
  rateLimitState: ReturnType<MarketplaceWorker["safeRateLimit"]>;
  lowestNormalizedListings: Record<string, string | null>;
  providerReportedFloors: Record<string, string | null>;
};
export class MarketplaceWorker {
  readonly #pool: Pool;
  readonly #config: NftMarketplaceConfig;
  readonly #client: OpenSeaClient;
  readonly #rpc: { getChainId: () => Promise<number> };
  #identities: RmtNftCollectionMarketplaceIdentity[] = [];
  #timer: NodeJS.Timeout | null = null;
  #stopping = false;
  readonly status: MarketplaceWorkerStatus = {
    running: false,
    provider: "OPENSEA",
    collectionCount: 0,
    lastSuccessfulPoll: null,
    lastProviderError: null,
    rateLimitState: { remaining: null, reset: null, retryAfter: null },
    lowestNormalizedListings: {},
    providerReportedFloors: {},
  };
  constructor(
    pool: Pool,
    config: NftMarketplaceConfig,
    options: {
      client?: OpenSeaClient;
      rpc?: { getChainId: () => Promise<number> };
    } = {},
  ) {
    this.#pool = pool;
    this.#config = config;
    this.#client =
      options.client ??
      new OpenSeaClient({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        timeoutMs: config.requestTimeoutMs,
        pageSize: config.pageSize,
      });
    this.#rpc =
      options.rpc ?? createPublicClient({ transport: http(config.rpcUrl) });
  }
  safeRateLimit() {
    return { ...this.#client.rateLimitState };
  }
  async initialize(
    sources: readonly RmtNftActivitySource[] = RMT_NFT_ACTIVITY_SOURCES,
  ) {
    assertMarketplaceSourceSet(sources);
    if ((await this.#rpc.getChainId()) !== ROBINHOOD_CHAIN_ID)
      throw new Error(
        "NFT marketplace RPC must resolve to Robinhood Chain 4663.",
      );
    assertRobinhoodChainSupported(await this.#client.chains());
    const identities = [];
    for (const source of sources) {
      const retrievedAt = new Date().toISOString();
      const contract = await this.#client.contract(
        OPENSEA_CHAIN,
        source.collectionAddress,
      );
      if (!contract || typeof contract !== "object")
        throw new Error(
          "MARKETPLACE_IDENTITY_UNAVAILABLE: OpenSea contract lookup failed.",
        );
      const slug = (contract as Record<string, unknown>).collection;
      if (typeof slug !== "string" || !slug)
        throw new Error(
          "MARKETPLACE_IDENTITY_UNAVAILABLE: OpenSea has not indexed the admitted contract.",
        );
      const collection = await this.#client.collection(slug);
      const identity = resolveOpenSeaIdentity(
        source,
        contract,
        collection,
        retrievedAt,
      );
      await persistIdentity(this.#pool, identity, true);
      identities.push(identity);
    }
    this.#identities = identities;
    this.status.collectionCount = identities.length;
  }
  async runCycle() {
    for (const identity of this.#identities) {
      try {
        await this.processSource(identity);
        this.status.lastSuccessfulPoll = new Date().toISOString();
        this.status.lastProviderError = null;
      } catch (error) {
        this.status.lastProviderError =
          error instanceof Error ? error.message : String(error);
        await recordSourceError(this.#pool, identity.collectionAddress, error);
      }
    }
    this.status.rateLimitState = this.safeRateLimit();
  }
  private async processSource(identity: RmtNftCollectionMarketplaceIdentity) {
    const stats = await this.#client.stats(identity.providerCollectionSlug);
    const reported = openSeaReportedFloor(identity, stats);
    this.status.providerReportedFloors[identity.collectionAddress] =
      reported?.value ?? null;
    const listings = await this.pages(identity, "listings");
    const offers = await this.pages(identity, "offers");
    const sales = await this.pages(identity, "sales");
    this.status.lowestNormalizedListings[identity.collectionAddress] =
      (await lowestNormalizedListingAmount(
        this.#pool,
        identity.collectionAddress,
      )) ?? null;
    await recordSourceSuccess(
      this.#pool,
      identity.collectionAddress,
      listings.hasMore || offers.hasMore || sales.hasMore,
    );
  }
  private async pages(
    identity: RmtNftCollectionMarketplaceIdentity,
    kind: "listings" | "offers" | "sales",
  ): Promise<{ listings: RmtNftListingEvidence[]; hasMore: boolean }> {
    const queryIdentity = `opensea:${kind}:${identity.providerCollectionSlug}:${kind === "sales" ? "event_type=sale" : "all"}`;
    let next = await cursor(
      this.#pool,
      identity.collectionAddress,
      queryIdentity,
    );
    const listings: RmtNftListingEvidence[] = [];
    for (let count = 0; count < this.#config.maxPagesPerCycle; count++) {
      const retrievedAt = new Date().toISOString();
      const raw =
        kind === "listings"
          ? await this.#client.listings(
              identity.providerCollectionSlug,
              next ?? undefined,
            )
          : kind === "offers"
            ? await this.#client.offers(
                identity.providerCollectionSlug,
                next ?? undefined,
              )
            : await this.#client.events(
                identity.providerCollectionSlug,
                next ?? undefined,
              );
      const parsed = page(
        raw,
        kind === "listings"
          ? "listings"
          : kind === "offers"
            ? "offers"
            : "asset_events",
      );
      const evidence = [];
      for (const entry of parsed.entries) {
        try {
          if (kind === "listings") {
            const normalized = normalizeListing(identity, entry, retrievedAt);
            listings.push(normalized);
            evidence.push(normalized);
          } else if (kind === "offers")
            evidence.push(normalizeOffer(identity, entry, retrievedAt));
          else {
            const sale = normalizeSale(identity, entry, retrievedAt);
            if (sale) evidence.push(sale);
          }
        } catch (error) {
          if (
            error instanceof Error &&
            /wrong contract|not the admitted contract|asset is not the admitted/.test(
              error.message,
            )
          )
            continue;
          throw error;
        }
      }
      await persistPage(
        this.#pool,
        identity,
        queryIdentity,
        evidence,
        parsed.next,
      );
      next = parsed.next;
      if (!next) break;
    }
    return { listings, hasMore: !!next };
  }
  start() {
    if (this.status.running) return;
    this.status.running = true;
    const tick = async () => {
      if (this.#stopping) return;
      await this.runCycle();
      if (!this.#stopping)
        this.#timer = setTimeout(tick, this.#config.pollIntervalMs);
    };
    void tick();
  }
  async stop() {
    this.#stopping = true;
    this.status.running = false;
    if (this.#timer) clearTimeout(this.#timer);
  }
}
