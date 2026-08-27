import type { Pool, PoolClient } from "pg";
export const NFT_MARKETPLACE_TABLES = [
  "nft_marketplace_collection_identity",
  "nft_marketplace_orders",
  "nft_marketplace_order_snapshots",
  "nft_marketplace_sales",
  "nft_marketplace_cursors",
  "nft_marketplace_source_state",
] as const;
export async function assertDedicatedMarketplaceDatabase(
  client: Pick<PoolClient, "query">,
) {
  const result = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const allowed = new Set<string>(NFT_MARKETPLACE_TABLES);
  const unrelated = result.rows
    .map((row) => row.tablename)
    .filter((table) => !allowed.has(table));
  if (unrelated.length)
    throw new Error(
      `NFT marketplace database contains unrelated public tables: ${unrelated.join(", ")}`,
    );
}
export async function migrateMarketplace(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(4663, 1600)");
    await assertDedicatedMarketplaceDatabase(client);
    await client.query(`
CREATE TABLE IF NOT EXISTS nft_marketplace_collection_identity (
 provider text NOT NULL CHECK(provider='OPENSEA'), chain_id integer NOT NULL CHECK(chain_id=4663), project_id text NOT NULL CHECK(project_id<>''),
 collection_address text NOT NULL CHECK(collection_address~'^0x[0-9A-Fa-f]{40}$'), collection_standard text NOT NULL CHECK(collection_standard IN('ERC721','ERC1155')),
 provider_chain text NOT NULL CHECK(provider_chain='robinhood'), collection_slug text NOT NULL CHECK(length(collection_slug) BETWEEN 1 AND 255),
 scope text NOT NULL CHECK(scope IN('EXACT_CONTRACT_SCOPE','MULTI_CONTRACT_COLLECTION_SCOPE')), member_contracts jsonb NOT NULL CHECK(jsonb_typeof(member_contracts)='array'),
 CHECK((scope='EXACT_CONTRACT_SCOPE')=(jsonb_array_length(member_contracts)=1)),
 verified_at timestamptz NOT NULL, evidence_digest text NOT NULL CHECK(evidence_digest~'^0x[0-9a-f]{64}$'),
 PRIMARY KEY(provider,chain_id,collection_address)
);
CREATE TABLE IF NOT EXISTS nft_marketplace_source_state (
 provider text NOT NULL CHECK(provider='OPENSEA'), chain_id integer NOT NULL CHECK(chain_id=4663), project_id text NOT NULL,
 collection_address text NOT NULL, status text NOT NULL CHECK(status IN('BACKFILLING','SYNCED','ERROR')),
 last_successful_poll timestamptz, last_provider_error text CHECK(last_provider_error IS NULL OR length(last_provider_error) BETWEEN 1 AND 4096),
 updated_at timestamptz NOT NULL DEFAULT now(), CHECK((status='ERROR')=(last_provider_error IS NOT NULL)),
 PRIMARY KEY(provider,chain_id,collection_address), FOREIGN KEY(provider,chain_id,collection_address) REFERENCES nft_marketplace_collection_identity(provider,chain_id,collection_address)
);
CREATE TABLE IF NOT EXISTS nft_marketplace_orders (
 provider text NOT NULL CHECK(provider='OPENSEA'), chain_id integer NOT NULL CHECK(chain_id=4663), protocol_address text NOT NULL CHECK(protocol_address~'^0x[0-9A-Fa-f]{40}$'), order_hash text NOT NULL CHECK(order_hash~'^0x[0-9A-Fa-f]{64}$'),
 project_id text NOT NULL, collection_address text NOT NULL, evidence_kind text NOT NULL CHECK(evidence_kind IN('LISTING','OFFER')),
 order_scope text NOT NULL CHECK(order_scope IN('ITEM','COLLECTION','TRAIT')), token_id numeric(78,0) CHECK(token_id IS NULL OR token_id>=0), criteria jsonb, maker text NOT NULL CHECK(maker~'^0x[0-9A-Fa-f]{40}$'),
 payment_kind text NOT NULL CHECK(payment_kind IN('NATIVE','ERC20')), payment_address text, payment_symbol text NOT NULL, payment_decimals integer NOT NULL CHECK(payment_decimals BETWEEN 0 AND 255), CHECK((payment_kind='NATIVE')=(payment_address IS NULL)),
 gross_amount numeric(78,0) NOT NULL CHECK(gross_amount>=0), quantity numeric(78,0) NOT NULL CHECK(quantity>0), start_time numeric(78,0) NOT NULL CHECK(start_time>=0), end_time numeric(78,0) NOT NULL CHECK(end_time>=0),
 remaining_quantity numeric(78,0) NOT NULL CHECK(remaining_quantity>=0), provider_status text NOT NULL, normalized_status text NOT NULL CHECK(normalized_status IN('ACTIVE','INACTIVE','FULFILLED','EXPIRED','CANCELLED','UNKNOWN')),
 order_identity_status text NOT NULL CHECK(order_identity_status IN('ORDER_IDENTITY_VERIFIED','ORDER_IDENTITY_UNVERIFIED')),
 protocol_data jsonb, evidence_digest text NOT NULL, first_seen_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL, exact_revalidated_at timestamptz,
 PRIMARY KEY(provider,chain_id,protocol_address,order_hash)
);
CREATE INDEX IF NOT EXISTS nft_marketplace_orders_collection_idx ON nft_marketplace_orders(provider,chain_id,collection_address,evidence_kind,normalized_status);
CREATE TABLE IF NOT EXISTS nft_marketplace_order_snapshots (
 provider text NOT NULL, chain_id integer NOT NULL, protocol_address text NOT NULL, order_hash text NOT NULL, evidence_digest text NOT NULL,
 observed_at timestamptz NOT NULL, provider_status text NOT NULL, normalized_status text NOT NULL, remaining_quantity numeric(78,0) NOT NULL,
 PRIMARY KEY(provider,chain_id,protocol_address,order_hash,evidence_digest),
 FOREIGN KEY(provider,chain_id,protocol_address,order_hash) REFERENCES nft_marketplace_orders(provider,chain_id,protocol_address,order_hash)
);
CREATE TABLE IF NOT EXISTS nft_marketplace_sales (
 provider text NOT NULL CHECK(provider='OPENSEA'), chain_id integer NOT NULL CHECK(chain_id=4663), evidence_digest text NOT NULL,
 project_id text NOT NULL, collection_address text NOT NULL, token_id numeric(78,0) NOT NULL CHECK(token_id>=0), quantity numeric(78,0) NOT NULL CHECK(quantity>0),
 seller text NOT NULL, buyer text NOT NULL, payment_kind text, payment_address text, payment_symbol text, payment_decimals integer CHECK(payment_decimals IS NULL OR payment_decimals BETWEEN 0 AND 255),
 gross_amount numeric(78,0) CHECK(gross_amount IS NULL OR gross_amount>=0), transaction_hash text, order_hash text, protocol_address text, event_timestamp timestamptz NOT NULL,
 authority text NOT NULL CHECK(authority='PROVIDER_REPORTED_SALE'), settlement_status text NOT NULL CHECK(settlement_status='NOT_VERIFIED'),
 retrieved_at timestamptz NOT NULL, PRIMARY KEY(provider,chain_id,evidence_digest)
);
CREATE TABLE IF NOT EXISTS nft_marketplace_cursors (
 provider text NOT NULL CHECK(provider='OPENSEA'), chain_id integer NOT NULL CHECK(chain_id=4663), collection_address text NOT NULL,
 query_identity text NOT NULL CHECK(length(query_identity) BETWEEN 1 AND 512), next_cursor text, updated_at timestamptz NOT NULL,
 PRIMARY KEY(provider,chain_id,collection_address,query_identity)
);
ALTER TABLE nft_marketplace_orders ADD COLUMN IF NOT EXISTS exact_revalidated_at timestamptz;
`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
