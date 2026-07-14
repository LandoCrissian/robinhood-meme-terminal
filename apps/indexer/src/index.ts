import { createServer } from "node:http";
import { Pool, type PoolClient } from "pg";
import {
  createPublicClient,
  getAddress,
  http,
  type Address
} from "viem";
import { marketEvents, tokenLaunchedEvent } from "./abi.js";
import { schemaSql } from "./schema.js";

const CHAIN_ID = 4663;
const DEFAULT_FACTORY = "0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4";
const DEFAULT_START_BLOCK = 8_862_129n;

function positiveInteger(name: string, fallback: number) {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const config = {
  databaseUrl: required("DATABASE_URL"),
  rpcUrl: required("RMT_RPC_URL"),
  factory: getAddress(process.env.RMT_FACTORY_ADDRESS ?? DEFAULT_FACTORY),
  startBlock: BigInt(process.env.RMT_FACTORY_START_BLOCK ?? DEFAULT_START_BLOCK),
  confirmations: positiveInteger("RMT_CONFIRMATION_DEPTH", 20),
  chunkSize: positiveInteger("RMT_INDEXER_CHUNK_SIZE", 2_000),
  pollMs: positiveInteger("RMT_INDEXER_POLL_MS", 5_000),
  port: positiveInteger("PORT", 3_001)
};

const chain = {
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } }
} as const;

const rpc = createPublicClient({
  chain,
  transport: http(config.rpcUrl, { retryCount: 3, timeout: 12_000 })
});

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  max: positiveInteger("RMT_DB_POOL_SIZE", 10)
});

let indexedThrough = config.startBlock - 1n;
let lastSyncAt: string | null = null;
let lastError: string | null = null;

type ConfirmedLog<Args> = {
  address: Address;
  transactionHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
  args: Args;
};

type LaunchArgs = {
  launchId: bigint;
  token: Address;
  creator: Address;
  market: Address;
  rewardVault: Address;
  graduationPoolId: `0x${string}`;
  name: string;
  symbol: string;
  supply: bigint;
  metadataURI: string;
  creatorBps: number;
  communityBps: number;
  traderBps: number;
  liquidityBps: number;
  platformBps: number;
};

type TradeArgs = {
  trader: Address;
  recipient: Address;
  isBuy: boolean;
  tokenAmount: bigint;
  ethAmount: bigint;
  feeAmount: bigint;
  virtualEthReserve: bigint;
  virtualTokenReserve: bigint;
  realEthReserve: bigint;
};

type GraduationArgs = { realEthReserve: bigint; tokenInventory: bigint };
type MigrationArgs = {
  adapter: Address;
  pool: Address;
  ethAmount: bigint;
  tokenAmount: bigint;
  liquidity: bigint;
};

function confirmed<Args>(log: {
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  blockNumber: bigint | null;
}): log is typeof log & ConfirmedLog<Args> {
  return log.transactionHash !== null && log.logIndex !== null && log.blockNumber !== null;
}

function lower(address: Address) {
  return address.toLowerCase();
}

async function migrate() {
  await pool.query(schemaSql);
  await pool.query(
    `INSERT INTO indexer_state (chain_id, next_block)
     VALUES ($1, $2)
     ON CONFLICT (chain_id) DO NOTHING`,
    [CHAIN_ID, config.startBlock.toString()]
  );
}

async function rollbackAfter(db: PoolClient, blockNumber: bigint) {
  const value = blockNumber.toString();
  await db.query("DELETE FROM liquidity_migrations WHERE block_number > $1", [value]);
  await db.query("DELETE FROM graduations WHERE block_number > $1", [value]);
  await db.query("DELETE FROM trades WHERE block_number > $1", [value]);
  await db.query("DELETE FROM launches WHERE block_number > $1", [value]);
  await db.query("DELETE FROM sync_points WHERE chain_id = $1 AND block_number > $2", [CHAIN_ID, value]);
  await db.query(
    "UPDATE indexer_state SET next_block = $2, updated_at = NOW() WHERE chain_id = $1",
    [CHAIN_ID, (blockNumber + 1n).toString()]
  );
}

async function reconcileReorg() {
  const points = await pool.query<{ block_number: string; block_hash: string }>(
    `SELECT block_number, block_hash
     FROM sync_points
     WHERE chain_id = $1
     ORDER BY block_number DESC
     LIMIT 64`,
    [CHAIN_ID]
  );
  if (points.rows.length === 0) return;

  let ancestor = config.startBlock - 1n;
  for (const point of points.rows) {
    const blockNumber = BigInt(point.block_number);
    const canonical = await rpc.getBlock({ blockNumber });
    if (canonical.hash?.toLowerCase() === point.block_hash.toLowerCase()) {
      ancestor = blockNumber;
      break;
    }
  }

  const newest = BigInt(points.rows[0]!.block_number);
  if (ancestor === newest) return;

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await rollbackAfter(db, ancestor);
    await db.query("COMMIT");
    console.warn(JSON.stringify({ event: "reorg_rollback", fromBlock: newest.toString(), ancestor: ancestor.toString() }));
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

async function readMarketLogs(markets: Address[], fromBlock: bigint, toBlock: bigint) {
  const trades: Awaited<ReturnType<typeof rpc.getLogs>> = [];
  const graduations: Awaited<ReturnType<typeof rpc.getLogs>> = [];
  const migrations: Awaited<ReturnType<typeof rpc.getLogs>> = [];

  for (let offset = 0; offset < markets.length; offset += 100) {
    const addresses = markets.slice(offset, offset + 100);
    const [tradeBatch, graduationBatch, migrationBatch] = await Promise.all([
      rpc.getLogs({ address: addresses, event: marketEvents[0], fromBlock, toBlock }),
      rpc.getLogs({ address: addresses, event: marketEvents[1], fromBlock, toBlock }),
      rpc.getLogs({ address: addresses, event: marketEvents[2], fromBlock, toBlock })
    ]);
    trades.push(...tradeBatch);
    graduations.push(...graduationBatch);
    migrations.push(...migrationBatch);
  }

  return { trades, graduations, migrations };
}

async function processRange(fromBlock: bigint, toBlock: bigint) {
  const launches = await rpc.getLogs({
    address: config.factory,
    event: tokenLaunchedEvent,
    fromBlock,
    toBlock
  });

  const storedMarkets = await pool.query<{ market: string }>("SELECT market FROM launches");
  const marketSet = new Set<string>(storedMarkets.rows.map((row) => row.market));
  const confirmedLaunches = launches.filter((log) => confirmed<LaunchArgs>(log));
  for (const launch of confirmedLaunches) marketSet.add(lower(launch.args.market));
  const markets = [...marketSet].map((market) => getAddress(market));
  const marketLogs = markets.length
    ? await readMarketLogs(markets, fromBlock, toBlock)
    : { trades: [], graduations: [], migrations: [] };

  const boundary = await rpc.getBlock({ blockNumber: toBlock });
  if (!boundary.hash) throw new Error(`Block ${toBlock} has no hash`);

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    for (const log of confirmedLaunches) {
      const args = log.args;
      await db.query(
        `INSERT INTO launches (
          token, launch_id, creator, market, reward_vault, graduation_pool_id,
          name, symbol, supply, metadata_uri, creator_bps, community_bps,
          trader_bps, liquidity_bps, platform_bps, transaction_hash, block_number, log_index
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
        ) ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
        [
          lower(args.token), args.launchId.toString(), lower(args.creator), lower(args.market),
          lower(args.rewardVault), args.graduationPoolId, args.name, args.symbol,
          args.supply.toString(), args.metadataURI, Number(args.creatorBps), Number(args.communityBps),
          Number(args.traderBps), Number(args.liquidityBps), Number(args.platformBps),
          log.transactionHash, log.blockNumber.toString(), log.logIndex
        ]
      );
    }

    for (const rawLog of marketLogs.trades) {
      if (!confirmed<TradeArgs>(rawLog)) continue;
      const log = rawLog;
      const args = log.args;
      await db.query(
        `INSERT INTO trades (
          transaction_hash, log_index, market, trader, recipient, is_buy,
          token_amount, eth_amount, fee_amount, virtual_eth_reserve,
          virtual_token_reserve, real_eth_reserve, block_number
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
        [
          log.transactionHash, log.logIndex, log.address.toLowerCase(), lower(args.trader),
          lower(args.recipient), args.isBuy, args.tokenAmount.toString(), args.ethAmount.toString(),
          args.feeAmount.toString(), args.virtualEthReserve.toString(),
          args.virtualTokenReserve.toString(), args.realEthReserve.toString(),
          log.blockNumber.toString()
        ]
      );
    }

    for (const rawLog of marketLogs.graduations) {
      if (!confirmed<GraduationArgs>(rawLog)) continue;
      const log = rawLog;
      await db.query(
        `INSERT INTO graduations (
          market, transaction_hash, log_index, real_eth_reserve, token_inventory, block_number
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (market) DO UPDATE SET
          transaction_hash = EXCLUDED.transaction_hash,
          log_index = EXCLUDED.log_index,
          real_eth_reserve = EXCLUDED.real_eth_reserve,
          token_inventory = EXCLUDED.token_inventory,
          block_number = EXCLUDED.block_number`,
        [
          log.address.toLowerCase(), log.transactionHash, log.logIndex,
          log.args.realEthReserve.toString(), log.args.tokenInventory.toString(),
          log.blockNumber.toString()
        ]
      );
    }

    for (const rawLog of marketLogs.migrations) {
      if (!confirmed<MigrationArgs>(rawLog)) continue;
      const log = rawLog;
      await db.query(
        `INSERT INTO liquidity_migrations (
          market, transaction_hash, log_index, adapter, pool, eth_amount,
          token_amount, liquidity, block_number
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (market) DO UPDATE SET
          transaction_hash = EXCLUDED.transaction_hash,
          log_index = EXCLUDED.log_index,
          adapter = EXCLUDED.adapter,
          pool = EXCLUDED.pool,
          eth_amount = EXCLUDED.eth_amount,
          token_amount = EXCLUDED.token_amount,
          liquidity = EXCLUDED.liquidity,
          block_number = EXCLUDED.block_number`,
        [
          log.address.toLowerCase(), log.transactionHash, log.logIndex,
          lower(log.args.adapter), lower(log.args.pool), log.args.ethAmount.toString(),
          log.args.tokenAmount.toString(), log.args.liquidity.toString(),
          log.blockNumber.toString()
        ]
      );
    }

    await db.query(
      `INSERT INTO sync_points (chain_id, block_number, block_hash, parent_hash)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (chain_id, block_number) DO UPDATE SET
         block_hash = EXCLUDED.block_hash,
         parent_hash = EXCLUDED.parent_hash,
         indexed_at = NOW()`,
      [CHAIN_ID, toBlock.toString(), boundary.hash, boundary.parentHash]
    );
    await db.query(
      "UPDATE indexer_state SET next_block = $2, updated_at = NOW() WHERE chain_id = $1",
      [CHAIN_ID, (toBlock + 1n).toString()]
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }

  indexedThrough = toBlock;
  lastSyncAt = new Date().toISOString();
  console.info(JSON.stringify({
    event: "range_indexed",
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    launches: launches.length,
    trades: marketLogs.trades.length,
    graduations: marketLogs.graduations.length,
    migrations: marketLogs.migrations.length
  }));
}

async function syncOnce() {
  await reconcileReorg();
  const state = await pool.query<{ next_block: string }>(
    "SELECT next_block FROM indexer_state WHERE chain_id = $1",
    [CHAIN_ID]
  );
  const nextBlock = BigInt(state.rows[0]?.next_block ?? config.startBlock);
  const latest = await rpc.getBlockNumber();
  if (latest <= BigInt(config.confirmations)) return;
  const safeHead = latest - BigInt(config.confirmations);
  if (nextBlock > safeHead) {
    indexedThrough = nextBlock - 1n;
    lastSyncAt = new Date().toISOString();
    return;
  }

  let cursor = nextBlock;
  while (cursor <= safeHead) {
    const candidate = cursor + BigInt(config.chunkSize) - 1n;
    const end = candidate < safeHead ? candidate : safeHead;
    await processRange(cursor, end);
    cursor = end + 1n;
  }
}

async function launchRows(limit: number) {
  const result = await pool.query(
    `SELECT
      l.*,
      COALESCE(stats.volume_wei, 0)::TEXT AS volume_wei,
      COALESCE(stats.trade_count, 0)::INTEGER AS trade_count,
      COALESCE(stats.buy_count, 0)::INTEGER AS buy_count,
      COALESCE(stats.sell_count, 0)::INTEGER AS sell_count,
      COALESCE(last_trade.real_eth_reserve, 0)::TEXT AS reserve_wei,
      (g.market IS NOT NULL) AS graduated,
      m.pool AS dex_pool
    FROM launches l
    LEFT JOIN LATERAL (
      SELECT
        SUM(eth_amount) AS volume_wei,
        COUNT(*) AS trade_count,
        COUNT(*) FILTER (WHERE is_buy) AS buy_count,
        COUNT(*) FILTER (WHERE NOT is_buy) AS sell_count
      FROM trades t WHERE t.market = l.market
    ) stats ON TRUE
    LEFT JOIN LATERAL (
      SELECT real_eth_reserve FROM trades t
      WHERE t.market = l.market
      ORDER BY block_number DESC, log_index DESC LIMIT 1
    ) last_trade ON TRUE
    LEFT JOIN graduations g ON g.market = l.market
    LEFT JOIN liquidity_migrations m ON m.market = l.market
    ORDER BY l.block_number DESC, l.log_index DESC
    LIMIT $1`,
    [limit]
  );
  return result.rows;
}

function json(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function startServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        const latest = await rpc.getBlockNumber();
        json(response, lastError ? 503 : 200, {
          ok: !lastError,
          chainId: CHAIN_ID,
          factory: config.factory,
          indexedThrough: indexedThrough.toString(),
          latestBlock: latest.toString(),
          confirmationDepth: config.confirmations,
          lagBlocks: latest > indexedThrough ? (latest - indexedThrough).toString() : "0",
          lastSyncAt,
          error: lastError
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/launches") {
        const requested = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
        const limit = Number.isSafeInteger(requested) ? Math.min(100, Math.max(1, requested)) : 25;
        json(response, 200, { launches: await launchRows(limit), indexedThrough: indexedThrough.toString(), syncedAt: lastSyncAt });
        return;
      }
      json(response, 404, { error: "Not found" });
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : "Unknown server error" });
    }
  }).listen(config.port, () => {
    console.info(JSON.stringify({ event: "indexer_listening", port: config.port }));
  });
}

let stopping = false;
async function run() {
  await migrate();
  await reconcileReorg();
  const server = startServer();

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!stopping) {
    try {
      await syncOnce();
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: "indexer_error", error: lastError }));
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollMs));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
