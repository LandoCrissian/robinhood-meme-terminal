import assert from "node:assert/strict";
import { Pool } from "pg";
import { getAddress } from "viem";
import {
  IDENTITY,
  listingFixture,
  listingFixtureFor,
  offerFixture,
  saleFixture,
  SOURCE,
} from "./fixtures.js";
import { normalizeListing, normalizeSale } from "./normalization.js";
import { OpenSeaClient } from "./opensea-client.js";
import { MarketplaceWorker } from "./worker.js";
import { readNftProjectMarketplace } from "./project-read.js";
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
    /projection conflicts with protocol data/,
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
  const listingAActive = listingFixtureFor({ tokenId: 1n, price: 100n });
  const listingACancelled = {
    ...listingAActive,
    status: "cancelled",
    remaining_quantity: "0",
  };
  const listingBActive = listingFixtureFor({ tokenId: 2n, price: 200n });
  const zeroRemaining = listingFixtureFor({
    tokenId: 3n,
    price: 50n,
    remainingQuantity: 0n,
  });
  let phase = 1;
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
        body = {
          listings:
            phase === 1
              ? [listingAActive, listingBActive, zeroRemaining]
              : [],
          next: null,
        };
      else if (url.pathname.includes("/offers/"))
        body = { offers: [offerFixture("COLLECTION")], next: null };
      else if (url.pathname.includes("/events/"))
        body = { asset_events: [saleFixture()], next: null };
      else if (url.pathname.includes("/api/v2/orders/chain/")) {
        if (phase === 3)
          return new Response(JSON.stringify({ error: "transient" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        if (url.pathname.endsWith(listingAActive.order_hash))
          body = { order: phase === 1 ? listingAActive : listingACancelled };
        else if (url.pathname.endsWith(listingBActive.order_hash))
          body = { order: listingBActive };
        else throw new Error(`Unexpected exact order ${url.pathname}`);
      }
      else throw new Error(`Unexpected mock path ${url.pathname}`);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    sleep: async () => {},
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
      maxLowestListingCandidates: 8,
      port: 3012,
      readToken: "b".repeat(64),
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
    4,
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
    (
      await pool.query(
        "SELECT exact_revalidated_at IS NOT NULL AS fresh FROM nft_marketplace_orders WHERE order_hash=$1",
        [listingAActive.order_hash],
      )
    ).rows[0].fresh,
    true,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT remaining_quantity FROM nft_marketplace_orders WHERE order_hash=$1",
        [zeroRemaining.order_hash],
      )
    ).rows[0].remaining_quantity,
    "0",
  );
  phase = 2;
  await worker.runCycle();
  assert.equal(
    worker.status.lowestNormalizedListings[IDENTITY.collectionAddress],
    "200",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT normalized_status FROM nft_marketplace_orders WHERE order_hash=$1",
        [listingAActive.order_hash],
      )
    ).rows[0].normalized_status,
    "CANCELLED",
  );
  const history = await pool.query(
    "SELECT normalized_status FROM nft_marketplace_order_snapshots WHERE order_hash=$1 ORDER BY observed_at",
    [listingAActive.order_hash],
  );
  assert.ok(history.rows.some((row) => row.normalized_status === "ACTIVE"));
  assert.ok(history.rows.some((row) => row.normalized_status === "CANCELLED"));
  await pool.query(`INSERT INTO nft_marketplace_sales(provider,chain_id,evidence_digest,project_id,collection_address,token_id,quantity,seller,buyer,payment_kind,payment_address,payment_symbol,payment_decimals,gross_amount,transaction_hash,order_hash,protocol_address,event_timestamp,authority,settlement_status,retrieved_at)
    SELECT provider,chain_id,$1,project_id,collection_address,token_id,quantity,seller,buyer,'ERC20',$2,'WETH',18,300,NULL,NULL,protocol_address,event_timestamp,authority,settlement_status,retrieved_at
    FROM nft_marketplace_sales LIMIT 1`, [`0x${"c".repeat(64)}`, "0x0bd7d308f8e1639fab988df18a8011f41eacad73"]);
  const exactTime = (await pool.query("SELECT exact_revalidated_at FROM nft_marketplace_orders WHERE order_hash=$1", [listingBActive.order_hash])).rows[0].exact_revalidated_at as Date;
  const readNow = new Date(exactTime.getTime() + 60_000);
  const persistedPoll = new Date(readNow.getTime() - 30_000);
  await pool.query(
    "UPDATE nft_marketplace_source_state SET status='SYNCED',last_successful_poll=$2,last_provider_error=NULL WHERE collection_address=$1",
    [IDENTITY.collectionAddress, persistedPoll],
  );
  const freshRead = await readNftProjectMarketplace(pool, "ccff00", 60_000, readNow);
  assert.equal(freshRead.lowestNormalizedListing?.orderHash, listingBActive.order_hash);
  assert.equal(freshRead.lowestNormalizedListing?.authority, "LOWEST_NORMALIZED_OPENSEA_LISTING");
  assert.equal(freshRead.asOf, persistedPoll.toISOString());
  assert.ok(freshRead.recentProviderSales.every((sale) => sale.authority === "PROVIDER_REPORTED_SALE" && sale.settlementVerificationStatus === "NOT_VERIFIED"));
  assert.equal(freshRead.volume24hByPaymentAsset.length, 2);
  assert.deepEqual(new Set(freshRead.volume24hByPaymentAsset.map((volume) => volume.paymentAsset.kind)), new Set(["NATIVE", "ERC20"]));

  await pool.query("UPDATE nft_marketplace_sales SET event_timestamp=$1", [new Date(persistedPoll.getTime() - 25 * 60 * 60_000)]);
  const insertBoundarySale = async (digest: string, grossAmount: string, eventTimestamp: Date) => {
    await pool.query(`INSERT INTO nft_marketplace_sales(provider,chain_id,evidence_digest,project_id,collection_address,token_id,quantity,seller,buyer,payment_kind,payment_address,payment_symbol,payment_decimals,gross_amount,transaction_hash,order_hash,protocol_address,event_timestamp,authority,settlement_status,retrieved_at)
      SELECT provider,chain_id,$1,project_id,collection_address,token_id,quantity,seller,buyer,'NATIVE',NULL,'ETH',18,$2,NULL,NULL,protocol_address,$3,authority,settlement_status,retrieved_at
      FROM nft_marketplace_sales WHERE payment_kind='NATIVE' LIMIT 1`,
    [digest, grossAmount, eventTimestamp]);
  };
  await insertBoundarySale(`0x${"d".repeat(64)}`, "230", new Date(persistedPoll.getTime() - 23 * 60 * 60_000));
  await insertBoundarySale(`0x${"e".repeat(64)}`, "1000", new Date(persistedPoll.getTime() + 60_000));
  const firstObservationRead = await readNftProjectMarketplace(pool, "ccff00", 60_000, new Date(persistedPoll.getTime() + 30_000));
  const laterRequestRead = await readNftProjectMarketplace(pool, "ccff00", 60_000, new Date(persistedPoll.getTime() + 4 * 60_000));
  assert.equal(firstObservationRead.asOf, persistedPoll.toISOString());
  assert.equal(laterRequestRead.asOf, persistedPoll.toISOString());
  assert.deepEqual(laterRequestRead.volume24hByPaymentAsset, firstObservationRead.volume24hByPaymentAsset);
  assert.deepEqual(firstObservationRead.volume24hByPaymentAsset, [{
    authority: "OPENSEA_REPORTED_24H_VOLUME",
    paymentAsset: { kind: "NATIVE", chainId: 4663, address: null, symbol: "ETH", decimals: 18 },
    grossAmount: "230",
    saleCount: 1,
  }]);

  const historyBeforeStaleRead = {
    orders: Number((await pool.query("SELECT count(*) FROM nft_marketplace_orders")).rows[0].count),
    snapshots: Number((await pool.query("SELECT count(*) FROM nft_marketplace_order_snapshots")).rows[0].count),
    sales: Number((await pool.query("SELECT count(*) FROM nft_marketplace_sales")).rows[0].count),
  };
  const stalePoll = new Date(readNow.getTime() - 600_000);
  await pool.query(
    "UPDATE nft_marketplace_source_state SET status='SYNCED',last_successful_poll=$2 WHERE collection_address=$1",
    [IDENTITY.collectionAddress, stalePoll],
  );
  const staleSourceRead = await readNftProjectMarketplace(pool, "ccff00", 60_000, readNow);
  assert.equal(staleSourceRead.availability, "UNAVAILABLE");
  assert.equal(staleSourceRead.availabilityReason, "SOURCE_STALE");
  assert.equal(staleSourceRead.asOf, stalePoll.toISOString());
  assert.equal(staleSourceRead.lowestNormalizedListing, null);
  assert.deepEqual(staleSourceRead.recentProviderSales, []);
  assert.deepEqual(staleSourceRead.volume24hByPaymentAsset, []);
  assert.deepEqual({
    orders: Number((await pool.query("SELECT count(*) FROM nft_marketplace_orders")).rows[0].count),
    snapshots: Number((await pool.query("SELECT count(*) FROM nft_marketplace_order_snapshots")).rows[0].count),
    sales: Number((await pool.query("SELECT count(*) FROM nft_marketplace_sales")).rows[0].count),
  }, historyBeforeStaleRead);

  await pool.query(
    "UPDATE nft_marketplace_source_state SET status='BACKFILLING',last_successful_poll=$2 WHERE collection_address=$1",
    [IDENTITY.collectionAddress, persistedPoll],
  );
  const backfillingRead = await readNftProjectMarketplace(pool, "ccff00", 60_000, readNow);
  assert.equal(backfillingRead.availability, "PARTIAL");
  assert.equal(backfillingRead.lowestNormalizedListing?.orderHash, listingBActive.order_hash);

  await pool.query(
    "UPDATE nft_marketplace_source_state SET status='BACKFILLING',last_successful_poll=NULL WHERE collection_address=$1",
    [IDENTITY.collectionAddress],
  );
  const notReadyRead = await readNftProjectMarketplace(pool, "ccff00", 60_000, readNow);
  assert.equal(notReadyRead.availability, "UNAVAILABLE");
  assert.equal(notReadyRead.availabilityReason, "SOURCE_NOT_READY");
  assert.equal(notReadyRead.asOf, null);
  assert.equal(notReadyRead.lowestNormalizedListing, null);
  assert.deepEqual(notReadyRead.recentProviderSales, []);
  assert.deepEqual(notReadyRead.volume24hByPaymentAsset, []);

  await pool.query(
    "UPDATE nft_marketplace_source_state SET status='ERROR',last_successful_poll=$2,last_provider_error='fixture error' WHERE collection_address=$1",
    [IDENTITY.collectionAddress, persistedPoll],
  );
  const errorRead = await readNftProjectMarketplace(pool, "ccff00", 60_000, readNow);
  assert.equal(errorRead.availabilityReason, "SOURCE_ERROR");
  assert.equal(errorRead.asOf, persistedPoll.toISOString());
  assert.deepEqual(errorRead.recentProviderSales, []);

  await pool.query(
    "UPDATE nft_marketplace_source_state SET status='SYNCED',last_successful_poll=$2,last_provider_error=NULL WHERE collection_address=$1",
    [IDENTITY.collectionAddress, persistedPoll],
  );
  await pool.query("UPDATE nft_marketplace_orders SET exact_revalidated_at=$2 WHERE order_hash=$1", [listingBActive.order_hash, new Date(readNow.getTime() - 600_000)]);
  const staleRead = await readNftProjectMarketplace(pool, "ccff00", 60_000, readNow);
  assert.equal(staleRead.lowestNormalizedListing, null);
  assert.equal(staleRead.availabilityReason, "STALE");
  await pool.query("UPDATE nft_marketplace_orders SET exact_revalidated_at=$2 WHERE order_hash=$1", [listingBActive.order_hash, exactTime]);
  await assert.rejects(() => readNftProjectMarketplace(pool, "unknown", 60_000, readNow), /not publicly admitted/);
  phase = 3;
  await worker.runCycle();
  assert.equal(
    worker.status.lowestNormalizedListings[IDENTITY.collectionAddress],
    null,
  );
  assert.equal((await statusRows(pool))[0].status, "ERROR");
  assert.ok(
    (await statusRows(pool))[0].last_provider_error.includes(
      "bounded retries",
    ) ||
      (await statusRows(pool))[0].last_provider_error.includes("HTTP 503"),
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
