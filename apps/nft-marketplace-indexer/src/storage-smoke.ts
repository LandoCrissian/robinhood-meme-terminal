import assert from "node:assert/strict";
import { Pool } from "pg";
import { getAddress } from "viem";
import {
  IDENTITY,
  listingFixture,
  offerFixture,
  saleFixture,
  SOURCE,
} from "./fixtures.js";
import { normalizeListing, normalizeSale } from "./normalization.js";
import { OpenSeaClient } from "./opensea-client.js";
import { MarketplaceWorker } from "./worker.js";
import {
  assertDedicatedMarketplaceDatabase,
  migrateMarketplace,
} from "./schema.js";
import {
  cursor,
  persistIdentity,
  persistPage,
  readIdentity,
  recordSourceError,
  recordSourceSuccess,
  statusRows,
} from "./storage.js";
const databaseUrl = process.env.NFT_MARKETPLACE_TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "NFT_MARKETPLACE_TEST_DATABASE_URL is required for database tests.",
  );
const pool = new Pool({ connectionString: databaseUrl, ssl: false });
try {
  await migrateMarketplace(pool);
  await pool.query(
    "TRUNCATE nft_marketplace_order_snapshots,nft_marketplace_orders,nft_marketplace_sales,nft_marketplace_cursors,nft_marketplace_source_state,nft_marketplace_collection_identity CASCADE",
  );
  await persistIdentity(pool, IDENTITY, true);
  assert.equal(
    (await readIdentity(pool, IDENTITY.collectionAddress))
      ?.providerCollectionSlug,
    IDENTITY.providerCollectionSlug,
  );
  const listing = normalizeListing(
    IDENTITY,
    listingFixture(),
    "2026-08-27T02:00:00Z",
  );
  await persistPage(pool, IDENTITY, "listings-query", [listing], "opaque-one");
  await persistPage(pool, IDENTITY, "listings-query", [listing], "opaque-two");
  assert.equal(
    await cursor(pool, IDENTITY.collectionAddress, "listings-query"),
    "opaque-two",
  );
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) FROM nft_marketplace_orders")).rows[0]
        .count,
    ),
    1,
  );
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) FROM nft_marketplace_order_snapshots"))
        .rows[0].count,
    ),
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT token_id,gross_amount FROM nft_marketplace_orders",
      )
    ).rows[0].token_id,
    "1",
  );
  const conflict = {
    ...listing,
    maker: getAddress("0x9999999999999999999999999999999999999999"),
  };
  await assert.rejects(
    () =>
      persistPage(
        pool,
        IDENTITY,
        "listings-query",
        [conflict],
        "must-not-advance",
      ),
    /Conflicting immutable/,
  );
  assert.equal(
    await cursor(pool, IDENTITY.collectionAddress, "listings-query"),
    "opaque-two",
  );
  const sale = normalizeSale(IDENTITY, saleFixture(), "2026-08-27T02:00:00Z")!;
  await persistPage(pool, IDENTITY, "sales-query", [sale], null);
  await persistPage(pool, IDENTITY, "sales-query", [sale], null);
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) FROM nft_marketplace_sales")).rows[0]
        .count,
    ),
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT authority,settlement_status FROM nft_marketplace_sales",
      )
    ).rows[0].authority,
    "PROVIDER_REPORTED_SALE",
  );
  await recordSourceError(
    pool,
    IDENTITY.collectionAddress,
    new Error("x".repeat(5000)),
  );
  let state = (await statusRows(pool))[0];
  assert.equal(state.status, "ERROR");
  assert.equal(state.last_provider_error.length, 4096);
  await recordSourceSuccess(pool, IDENTITY.collectionAddress, false);
  state = (await statusRows(pool))[0];
  assert.equal(state.status, "SYNCED");
  assert.equal(state.last_provider_error, null);
  await pool.query(
    "TRUNCATE nft_marketplace_order_snapshots,nft_marketplace_orders,nft_marketplace_sales,nft_marketplace_cursors,nft_marketplace_source_state,nft_marketplace_collection_identity CASCADE",
  );
  const mockClient = new OpenSeaClient({
    baseUrl: "https://api.example.test",
    apiKey: "server-only",
    timeoutMs: 1000,
    pageSize: 25,
    fetchImpl: async (input) => {
      const url = new URL(input.toString());
      let body: unknown;
      if (url.pathname === "/api/v2/chains")
        body = { chains: [{ identifier: "robinhood" }] };
      else if (url.pathname.includes("/contract/"))
        body = {
          chain: "robinhood",
          address: SOURCE.collectionAddress,
          collection: IDENTITY.providerCollectionSlug,
        };
      else if (url.pathname.endsWith("/stats"))
        body = { total: { floor_price: 0.1 } };
      else if (
        url.pathname ===
        `/api/v2/collections/${IDENTITY.providerCollectionSlug}`
      )
        body = {
          collection: IDENTITY.providerCollectionSlug,
          contracts: [
            { chain: "robinhood", address: SOURCE.collectionAddress },
          ],
        };
      else if (url.pathname.includes("/listings/"))
        body = { listings: [listingFixture()], next: null };
      else if (url.pathname.includes("/offers/"))
        body = { offers: [offerFixture("COLLECTION")], next: null };
      else if (url.pathname.includes("/events/"))
        body = { asset_events: [saleFixture()], next: null };
      else throw new Error(`Unexpected mock path ${url.pathname}`);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const worker = new MarketplaceWorker(
    pool,
    {
      databaseUrl,
      databaseSsl: false,
      apiKey: "server-only",
      baseUrl: "https://api.example.test",
      rpcUrl: "https://rpc.example.test",
      requestTimeoutMs: 1000,
      pollIntervalMs: 1000,
      databasePoolSize: 2,
      maxPagesPerCycle: 2,
      pageSize: 25,
      port: 3012,
    },
    { client: mockClient, rpc: { getChainId: async () => 4663 } },
  );
  await worker.initialize([SOURCE]);
  await worker.runCycle();
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) FROM nft_marketplace_orders")).rows[0]
        .count,
    ),
    2,
  );
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) FROM nft_marketplace_sales")).rows[0]
        .count,
    ),
    1,
  );
  assert.equal((await statusRows(pool))[0].status, "SYNCED");
  assert.equal(
    worker.status.lowestNormalizedListings[IDENTITY.collectionAddress],
    "100",
  );
  assert.equal(
    worker.status.providerReportedFloors[IDENTITY.collectionAddress],
    "0.1",
  );
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE nft_marketplace_unrelated_probe(id integer)",
    );
    await assert.rejects(
      () => assertDedicatedMarketplaceDatabase(client),
      /unrelated public tables/,
    );
  } finally {
    await client.query("DROP TABLE IF EXISTS nft_marketplace_unrelated_probe");
    client.release();
  }
  console.info("nft-marketplace storage smoke: PASS");
} finally {
  await pool.end();
}
