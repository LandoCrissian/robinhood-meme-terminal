import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import {
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  type PublicClient
} from "viem";
import { loadMarketIndexerConfig } from "../apps/market-indexer/src/config.js";
import { createMarketIndexerServer } from "../apps/market-indexer/src/server.js";
import { marketSources } from "../apps/market-indexer/src/sources.js";
import { ensureCanonicalTokenIdentity } from "../apps/market-indexer/src/token-identity-index.js";
import type { MarketIndexerWorker } from "../apps/market-indexer/src/worker.js";
import { createVNextExecutionIdentityAuthority } from "../apps/web/lib/server/vnext-execution-identity-authority.js";
import { searchVNextCanonicalTokenIdentities } from "../apps/web/lib/server/vnext-market-indexer.js";

const shcat = "0x14C51bB55592372eAC7141A1D0527D1dD7Fbd42F";
const control = "0x3333333333333333333333333333333333333333";
const readToken = "producer-consumer-smoke-read-token-0123456789";
const config = loadMarketIndexerConfig({
  MARKET_INDEXER_DATABASE_URL: "postgres://postgres:postgres@localhost:5432/producer_consumer",
  MARKET_INDEXER_RPC_URL: "https://rpc.mainnet.chain.robinhood.com/",
  MARKET_INDEXER_READ_TOKEN: readToken,
  MARKET_INDEXER_STORAGE_MODE: "rebuildable",
  PGSSLMODE: "disable"
});
const shards = new Map<number, Buffer>();
const query = async (text: string, values: unknown[] = []) => {
  if (text.startsWith("SELECT shard,payload")) {
    return { rows: [...shards].map(([shard, payload]) => ({ shard, payload })) };
  }
  if (text.startsWith("SELECT total_canonical_markets")) return { rows: [] };
  if (text.startsWith("INSERT INTO market_token_identity_shard")) {
    shards.set(values[0] as number, values[1] as Buffer);
    return { rows: [] };
  }
  if (text.startsWith("INSERT INTO market_token_identity_catalog_state")) return { rows: [] };
  if (text.includes("FROM matched_pools AS pools")) return { rows: [] };
  throw new Error(`unexpected producer-consumer query: ${text}`);
};
const pool = { query } as unknown as Pool;
let metadataCalls = 0;
const rpc = {
  getBytecode: async () => {
    metadataCalls++;
    return "0x6000" as const;
  },
  call: async ({ to, data }: { to: string; data: `0x${string}` }) => {
    metadataCalls++;
    const { functionName } = decodeFunctionData({ abi: erc20Abi, data });
    const isControl = to.toLowerCase() === control.toLowerCase();
    const result = functionName === "name" ? (isControl ? "Poolless Control" : "Shareholder Cat")
      : functionName === "symbol" ? (isControl ? "CONTROL" : "SHCAT")
        : functionName === "decimals" ? 18 : 1_000_000n;
    return { data: encodeFunctionResult({ abi: erc20Abi, functionName, result }) };
  }
} as unknown as PublicClient;
const now = new Date().toISOString();
const worker = {
  status: {
    running: false,
    cycleSequence: 1,
    verifiedSources: [],
    verifiedDependencies: [],
    indexedThrough: Object.fromEntries(marketSources.map((source) => [source.id, null])),
    lastSyncAt: null,
    lastError: null,
    lastCycleStartedAt: now,
    lastCycleCompletedAt: now,
    lastCycleDurationMs: 1,
    lastFinalizedHead: null,
    telemetry: null
  },
  ensureTokenIdentity: (address: string) => ensureCanonicalTokenIdentity(pool, rpc, address, 100n)
} as unknown as MarketIndexerWorker;

async function main() {
  const server = createMarketIndexerServer(pool, config, worker);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
  const port = (server.address() as AddressInfo).port;
  const env = {
    RMT_MARKET_INDEXER_URL: `http://127.0.0.1:${port}`,
    RMT_MARKET_INDEXER_READ_TOKEN: readToken
  };
  let liveReads = 0;
  const authority = createVNextExecutionIdentityAuthority({
    readIndex: (address) => searchVNextCanonicalTokenIdentities(address, { env }),
    readInventory: async () => ({ status: "upstream_unavailable", reason: "request_failed" }),
    readLive: async () => {
      liveReads++;
      throw new Error("execution live metadata RPC unavailable");
    }
  });
  const identity = await authority.read(shcat, { required: true });
  assert.deepEqual(identity, {
    address: shcat,
    chainId: 4663,
    name: "Shareholder Cat",
    symbol: "SHCAT",
    decimals: 18,
    native: false,
    provenance: "verified-token-identity-index",
    sourceManifestHash: identity?.sourceManifestHash,
    freshness: "last-known"
  });
  assert.match(identity?.sourceManifestHash ?? "", /^0x[0-9a-f]{64}$/);
  assert.equal(liveReads, 0);
  assert.equal(metadataCalls, 5);
  assert.equal(shards.size, 1);

  const indexed = await searchVNextCanonicalTokenIdentities(shcat, { env });
  assert.equal(indexed.status, "ready");
  if (indexed.status === "ready") {
    assert.equal(indexed.entries.length, 1);
    assert.equal(indexed.entries[0]?.address, shcat.toLowerCase());
    assert.deepEqual(indexed.entries[0]?.markets, []);
  }
  assert.equal(metadataCalls, 5, "warm exact-address search must not require another RPC read");

  const controlIdentity = await authority.read(control, { required: true });
  assert.equal(controlIdentity?.symbol, "CONTROL");
  assert.equal(controlIdentity?.provenance, "verified-token-identity-index");
  assert.equal(liveReads, 0);
  assert.equal(metadataCalls, 10);
  assert.equal(shards.size, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  console.log("Verified poolless producer evidence reaches the real execution identity consumer without live RPC fallback.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
