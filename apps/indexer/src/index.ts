import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { Pool, type PoolClient } from "pg";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  toHex,
  zeroAddress,
  type Address
} from "viem";
import {
  factoryReadAbi,
  feeSplitterEvents,
  graduationAdapterReadAbi,
  graduationFeesCollectedEvent,
  marketEvents,
  policyRegistryReadAbi,
  tokenLaunchedEvent
} from "./abi.js";
import { schemaSql } from "./schema.js";

const CHAIN_ID = 4663;
const INDEXER_SCHEMA_VERSION = 5;
const FIXED_TOKEN_SUPPLY = 1_000_000_000n * 10n ** 18n;
const CANONICAL_CURVE_FEE_BPS = 100;
const CANONICAL_CREATOR_SHARE_BPS = 7_000;
const CANONICAL_PROTOCOL_SHARE_BPS = 3_000;
const CANONICAL_POST_GRADUATION_FEE_BPS = 50;
const CANONICAL_V4_POOL_FEE = 5_000;
const CANONICAL_GRADUATION_TARGET = 2n * 10n ** 18n;
const ZERO_HASH = `0x${"00".repeat(32)}`;
const FAIR_POLICY_ID = keccak256(toHex("RMT_SIMPLE_FAIR_V1"));
const OPEN_POLICY_ID = keccak256(toHex("RMT_SIMPLE_OPEN_V1"));

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

function requiredPositiveBigInt(name: string) {
  const raw = required(name);
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    throw new Error(`${name} must be a positive integer`);
  }
  if (value <= 0n) throw new Error(`${name} must be a positive integer`);
  return value;
}

function requiredFactoryAddress() {
  const address = getAddress(required("RMT_FACTORY_ADDRESS"));
  if (address === zeroAddress) throw new Error("RMT_FACTORY_ADDRESS cannot be the zero address");
  return address;
}

const config = {
  databaseUrl: required("DATABASE_URL"),
  rpcUrl: required("RMT_RPC_URL"),
  factory: requiredFactoryAddress(),
  startBlock: requiredPositiveBigInt("RMT_FACTORY_START_BLOCK"),
  confirmations: positiveInteger("RMT_CONFIRMATION_DEPTH", 20),
  chunkSize: positiveInteger("RMT_INDEXER_CHUNK_SIZE", 2_000),
  pollMs: positiveInteger("RMT_INDEXER_POLL_MS", 5_000),
  port: positiveInteger("PORT", 3_001),
  readToken: process.env.RMT_INDEXER_READ_TOKEN?.trim() || null
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
let initialSyncComplete = false;

type V6ProtocolBindings = {
  policyRegistry: Address;
  governance: Address;
  creatorPayoutAuthority: Address;
  protocolTreasury: Address;
};

let protocolBindings: V6ProtocolBindings | null = null;

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
  feeSplitter: Address;
  graduationPoolId: `0x${string}`;
  policyId: `0x${string}`;
  policyVersion: number;
  curveFeeBps: number;
  creatorFeeShareBps: number;
  protocolFeeShareBps: number;
  postGraduationFeeBps: number;
  fairStartEnabled: boolean;
  fairStartDelayBlocks: bigint;
  fairStartDurationBlocks: bigint;
  fairStartMaxTxBps: number;
  fairStartMaxWalletBps: number;
  graduationTarget: bigint;
  officialMigration: boolean;
  name: string;
  symbol: string;
  metadataURI: string;
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

type InitializedArgs = {
  creator: Address;
  protocolTreasury: Address;
  launchToken: Address;
  creatorShareBps: number;
  creatorPayoutAuthority: Address;
  authorizedMarket: Address;
  graduationAdapter: Address;
};
type CreatorWalletChangedArgs = {
  previousCreator: Address;
  newCreator: Address;
  authority: Address;
  evidenceHash: `0x${string}`;
  nonce: bigint;
};
type CreatorPayoutNonceInvalidatedArgs = {
  previousNonce: bigint;
  newNonce: bigint;
  protocolTreasury: Address;
};
type NativePayerAmountArgs = { payer: Address; amount: bigint };
type NativeRecipientAmountArgs = { recipient: Address; amount: bigint };
type TokenPayerAmountArgs = { payer: Address; token: Address; amount: bigint };
type TokenRecipientAmountArgs = { token: Address; recipient: Address; amount: bigint };
type GraduationFeesCollectedArgs = {
  token: Address;
  feeSplitter: Address;
  nativeAmount: bigint;
  tokenAmount: bigint;
};

type DecodedConfirmedLog<Args = unknown> = ConfirmedLog<Args> & {
  blockHash: `0x${string}`;
  transactionIndex: number;
  eventName: string;
};

function asConfirmed<Args>(value: unknown): ConfirmedLog<Args> | null {
  const log = value as Partial<ConfirmedLog<Args>>;
  if (
    typeof log.address !== "string" ||
    typeof log.transactionHash !== "string" ||
    typeof log.logIndex !== "number" ||
    typeof log.blockNumber !== "bigint" ||
    log.args === undefined
  ) return null;
  return log as ConfirmedLog<Args>;
}

function asDecodedConfirmed<Args>(value: unknown): DecodedConfirmedLog<Args> | null {
  const log = value as Partial<DecodedConfirmedLog<Args>>;
  if (
    typeof log.address !== "string" ||
    typeof log.transactionHash !== "string" ||
    typeof log.logIndex !== "number" ||
    typeof log.transactionIndex !== "number" ||
    typeof log.blockNumber !== "bigint" ||
    typeof log.blockHash !== "string" ||
    typeof log.eventName !== "string" ||
    log.args === undefined
  ) return null;
  return log as DecodedConfirmedLog<Args>;
}

function compareLogs(a: DecodedConfirmedLog, b: DecodedConfirmedLog) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  if (a.transactionIndex !== b.transactionIndex) return a.transactionIndex - b.transactionIndex;
  return a.logIndex - b.logIndex;
}

function lower(address: Address) {
  return address.toLowerCase();
}

function requireProtocolBindings() {
  if (!protocolBindings) throw new Error("V6 protocol bindings have not been verified");
  return protocolBindings;
}

async function verifyV6Factory(): Promise<V6ProtocolBindings> {
  const latestBlock = await rpc.getBlockNumber();
  if (config.startBlock > latestBlock) {
    throw new Error("RMT_FACTORY_START_BLOCK is ahead of the current chain head");
  }
  const [factoryCodeAtStart, factoryCodeBeforeStart] = await Promise.all([
    rpc.getBytecode({ address: config.factory, blockNumber: config.startBlock }),
    rpc.getBytecode({ address: config.factory, blockNumber: config.startBlock - 1n })
  ]);
  if (!factoryCodeAtStart || factoryCodeAtStart === "0x") {
    throw new Error("RMT_FACTORY_START_BLOCK does not contain the configured V6 factory deployment");
  }
  if (factoryCodeBeforeStart && factoryCodeBeforeStart !== "0x") {
    throw new Error("RMT_FACTORY_START_BLOCK is later than the configured factory deployment block");
  }

  const [version, creatorPayoutAuthority, policyRegistry] = await Promise.all([
    rpc.readContract({
      address: config.factory,
      abi: factoryReadAbi,
      functionName: "protocolVersion"
    }),
    rpc.readContract({
      address: config.factory,
      abi: factoryReadAbi,
      functionName: "creatorPayoutAuthority"
    }),
    rpc.readContract({
      address: config.factory,
      abi: factoryReadAbi,
      functionName: "policyRegistry"
    })
  ]);
  if (Number(version) !== 6) {
    throw new Error(
      `RMT_FACTORY_ADDRESS must expose protocolVersion()==6; received ${String(version)}`
    );
  }
  if (policyRegistry === zeroAddress || creatorPayoutAuthority === zeroAddress) {
    throw new Error("RMT_FACTORY_ADDRESS exposes a zero V6 policy-registry or creator-payout authority");
  }

  const [governance, protocolTreasury, policyRegistryBytecode] = await Promise.all([
    rpc.readContract({
      address: policyRegistry,
      abi: policyRegistryReadAbi,
      functionName: "governance"
    }),
    rpc.readContract({
      address: policyRegistry,
      abi: policyRegistryReadAbi,
      functionName: "canonicalProtocolTreasury"
    }),
    rpc.getBytecode({ address: policyRegistry })
  ]);
  if (!policyRegistryBytecode || policyRegistryBytecode === "0x") {
    throw new Error("RMT_FACTORY_ADDRESS points to a policy registry without deployed bytecode");
  }
  if (governance === zeroAddress || protocolTreasury === zeroAddress) {
    throw new Error("The V6 policy registry exposes a zero governance or protocol-treasury address");
  }
  if (lower(creatorPayoutAuthority) !== lower(governance)) {
    throw new Error("The V6 factory creator-payout authority does not match policy-registry governance");
  }
  if (lower(protocolTreasury) !== lower(governance)) {
    throw new Error("The V6 policy registry canonical protocol treasury does not match V6 governance");
  }
  const governanceBytecode = await rpc.getBytecode({ address: governance });
  if (!governanceBytecode || governanceBytecode === "0x") {
    throw new Error("The V6 governance and protocol-treasury address has no deployed bytecode");
  }

  const bindings = {
    policyRegistry: getAddress(policyRegistry),
    governance: getAddress(governance),
    creatorPayoutAuthority: getAddress(creatorPayoutAuthority),
    protocolTreasury: getAddress(protocolTreasury)
  };
  console.info(JSON.stringify({
    event: "v6_factory_verified",
    factory: lower(config.factory),
    protocolVersion: Number(version),
    policyRegistry: lower(bindings.policyRegistry),
    governance: lower(bindings.governance),
    creatorPayoutAuthority: lower(bindings.creatorPayoutAuthority),
    protocolTreasury: lower(bindings.protocolTreasury),
    startBlock: config.startBlock.toString()
  }));
  return bindings;
}

async function refreshCreatorPayoutState(db: PoolClient) {
  await db.query(
    `UPDATE launches l
     SET original_creator = COALESCE(l.original_creator, l.creator),
         current_creator_fee_recipient = COALESCE(
           (
             SELECT e.new_recipient
             FROM creator_payout_events e
             WHERE e.fee_splitter = l.reward_vault AND e.event_type = 'changed'
             ORDER BY e.block_number DESC, e.transaction_index DESC, e.log_index DESC
             LIMIT 1
           ),
           l.original_creator,
           l.creator
         )`
  );
}

async function migrate() {
  await pool.query(schemaSql);
  const factory = lower(config.factory);
  const state = await pool.query<{
    factory: string | null;
    start_block: string | null;
    schema_version: number | null;
  }>(
    "SELECT factory, start_block, schema_version FROM indexer_state WHERE chain_id = $1",
    [CHAIN_ID]
  );
  const previous = state.rows[0];
  const indexedData = await pool.query<{ has_rows: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM launches LIMIT 1) AS has_rows"
  );
  const hasIndexedRows = indexedData.rows[0]?.has_rows === true;
  const configurationChanged = previous
    ? previous.factory !== factory ||
      previous.start_block !== config.startBlock.toString() ||
      previous.schema_version !== INDEXER_SCHEMA_VERSION
    : hasIndexedRows;

  if (configurationChanged) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("DELETE FROM fee_splitter_events");
      await db.query("DELETE FROM graduation_fee_collections");
      await db.query("DELETE FROM creator_payout_events");
      await db.query("DELETE FROM liquidity_migrations");
      await db.query("DELETE FROM graduations");
      await db.query("DELETE FROM trades");
      await db.query("DELETE FROM launches");
      await db.query("DELETE FROM sync_points WHERE chain_id = $1", [CHAIN_ID]);
      await db.query(
        `INSERT INTO indexer_state (chain_id, next_block, factory, start_block, schema_version)
         VALUES ($1, $2, $3, $2, $4)
         ON CONFLICT (chain_id) DO UPDATE SET
           next_block = EXCLUDED.next_block,
           factory = EXCLUDED.factory,
           start_block = EXCLUDED.start_block,
           schema_version = EXCLUDED.schema_version,
           updated_at = NOW()`,
        [CHAIN_ID, config.startBlock.toString(), factory, INDEXER_SCHEMA_VERSION]
      );
      await db.query("COMMIT");
      console.info(JSON.stringify({ event: "factory_cutover", factory, startBlock: config.startBlock.toString() }));
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
    return;
  }

  await pool.query(
    `INSERT INTO indexer_state (chain_id, next_block, factory, start_block, schema_version)
     VALUES ($1, $2, $3, $2, $4)
     ON CONFLICT (chain_id) DO UPDATE SET
       factory = EXCLUDED.factory,
       start_block = EXCLUDED.start_block,
       schema_version = EXCLUDED.schema_version`,
    [CHAIN_ID, config.startBlock.toString(), factory, INDEXER_SCHEMA_VERSION]
  );
  const db = await pool.connect();
  try {
    await refreshCreatorPayoutState(db);
  } finally {
    db.release();
  }
}

async function rollbackAfter(db: PoolClient, blockNumber: bigint) {
  const value = blockNumber.toString();
  await db.query("DELETE FROM fee_splitter_events WHERE block_number > $1", [value]);
  await db.query("DELETE FROM graduation_fee_collections WHERE block_number > $1", [value]);
  await db.query("DELETE FROM creator_payout_events WHERE block_number > $1", [value]);
  await db.query("DELETE FROM liquidity_migrations WHERE block_number > $1", [value]);
  await db.query("DELETE FROM graduations WHERE block_number > $1", [value]);
  await db.query("DELETE FROM trades WHERE block_number > $1", [value]);
  await db.query("DELETE FROM launches WHERE block_number > $1", [value]);
  await db.query("DELETE FROM sync_points WHERE chain_id = $1 AND block_number > $2", [CHAIN_ID, value]);
  await db.query(
    "UPDATE indexer_state SET next_block = $2, updated_at = NOW() WHERE chain_id = $1",
    [CHAIN_ID, (blockNumber + 1n).toString()]
  );
  await refreshCreatorPayoutState(db);
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

async function readFeeSplitterLogs(splitters: Address[], fromBlock: bigint, toBlock: bigint) {
  const logs: unknown[] = [];
  for (let offset = 0; offset < splitters.length; offset += 100) {
    const addresses = splitters.slice(offset, offset + 100);
    const batch = await rpc.getLogs({
      address: addresses,
      events: feeSplitterEvents,
      fromBlock,
      toBlock
    });
    logs.push(...batch);
  }
  return logs;
}

async function readGraduationFeeLogs(adapters: Address[], fromBlock: bigint, toBlock: bigint) {
  const logs: unknown[] = [];
  for (let offset = 0; offset < adapters.length; offset += 100) {
    const addresses = adapters.slice(offset, offset + 100);
    const batch = await rpc.getLogs({
      address: addresses,
      event: graduationFeesCollectedEvent,
      fromBlock,
      toBlock
    });
    logs.push(...batch);
  }
  return logs;
}

async function insertFeeSplitterEvent(
  db: PoolClient,
  log: DecodedConfirmedLog,
  launchToken: string,
  eventType: string,
  amount: bigint,
  payer: Address | null,
  recipient: Address | null,
  currencyToken: Address | null
) {
  await db.query(
    `INSERT INTO fee_splitter_events (
       transaction_hash, log_index, transaction_index, block_number, block_hash,
       fee_splitter, launch_token, event_type, payer, recipient, currency_token, amount
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
    [
      log.transactionHash,
      log.logIndex,
      log.transactionIndex,
      log.blockNumber.toString(),
      log.blockHash,
      lower(log.address),
      launchToken,
      eventType,
      payer ? lower(payer) : null,
      recipient ? lower(recipient) : null,
      currencyToken ? lower(currencyToken) : null,
      amount.toString()
    ]
  );
}

async function insertCreatorPayoutEvent(
  db: PoolClient,
  log: DecodedConfirmedLog,
  launchToken: string,
  eventType: "changed" | "invalidated",
  previousRecipient: Address | null,
  proposedRecipient: Address | null,
  newRecipient: Address | null,
  authority: Address,
  evidenceHash: `0x${string}` | null,
  changeNonce: bigint
) {
  await db.query(
    `INSERT INTO creator_payout_events (
       transaction_hash, log_index, transaction_index, block_number, block_hash,
       fee_splitter, token, event_type, previous_recipient, proposed_recipient,
       new_recipient, authority, evidence_hash, change_nonce
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
    [
      log.transactionHash,
      log.logIndex,
      log.transactionIndex,
      log.blockNumber.toString(),
      log.blockHash,
      lower(log.address),
      launchToken,
      eventType,
      previousRecipient ? lower(previousRecipient) : null,
      proposedRecipient ? lower(proposedRecipient) : null,
      newRecipient ? lower(newRecipient) : null,
      lower(authority),
      evidenceHash,
      changeNonce.toString()
    ]
  );
}

async function processRange(fromBlock: bigint, toBlock: bigint) {
  const bindings = requireProtocolBindings();
  const canonicalCreatorPayoutAuthority = lower(bindings.creatorPayoutAuthority);
  const canonicalProtocolTreasury = lower(bindings.protocolTreasury);
  const launches = await rpc.getLogs({
    address: config.factory,
    event: tokenLaunchedEvent,
    fromBlock,
    toBlock
  });

  const storedLaunches = await pool.query<{
    market: string;
    reward_vault: string;
    token: string;
    fee_graduation_adapter: string | null;
    original_creator: string;
    protocol_treasury: string | null;
  }>(
    "SELECT market, reward_vault, token, fee_graduation_adapter, original_creator, protocol_treasury FROM launches"
  );
  const marketSet = new Set<string>(storedLaunches.rows.map((row) => row.market));
  const splitterToToken = new Map<string, string>(
    storedLaunches.rows.map((row) => [row.reward_vault, row.token])
  );
  const splitterToMarket = new Map<string, string>(
    storedLaunches.rows.map((row) => [row.reward_vault, row.market])
  );
  const splitterToAdapter = new Map<string, string>(
    storedLaunches.rows.flatMap((row) => row.fee_graduation_adapter
      ? [[row.reward_vault, row.fee_graduation_adapter] as const]
      : [])
  );
  const splitterToOriginalCreator = new Map<string, string>(
    storedLaunches.rows.map((row) => [row.reward_vault, row.original_creator])
  );
  const splitterToTreasury = new Map<string, string>(
    storedLaunches.rows.flatMap((row) => row.protocol_treasury
      ? [[row.reward_vault, row.protocol_treasury] as const]
      : [])
  );
  const confirmedLaunches = launches
    .map((log) => asConfirmed<LaunchArgs>(log))
    .filter((log): log is ConfirmedLog<LaunchArgs> => log !== null);
  for (const launch of confirmedLaunches) {
    const args = launch.args;
    const fairPolicy = args.policyId.toLowerCase() === FAIR_POLICY_ID.toLowerCase()
      && Number(args.policyVersion) === 1
      && args.fairStartEnabled
      && args.fairStartDelayBlocks === 1n
      && args.fairStartDurationBlocks === 10n
      && Number(args.fairStartMaxTxBps) === 100
      && Number(args.fairStartMaxWalletBps) === 300;
    const openPolicy = args.policyId.toLowerCase() === OPEN_POLICY_ID.toLowerCase()
      && Number(args.policyVersion) === 1
      && !args.fairStartEnabled
      && args.fairStartDelayBlocks === 0n
      && args.fairStartDurationBlocks === 0n
      && Number(args.fairStartMaxTxBps) === 0
      && Number(args.fairStartMaxWalletBps) === 0;
    if (
      Number(args.curveFeeBps) !== CANONICAL_CURVE_FEE_BPS
        || Number(args.creatorFeeShareBps) !== CANONICAL_CREATOR_SHARE_BPS
        || Number(args.protocolFeeShareBps) !== CANONICAL_PROTOCOL_SHARE_BPS
        || Number(args.postGraduationFeeBps) !== CANONICAL_POST_GRADUATION_FEE_BPS
        || args.graduationTarget !== CANONICAL_GRADUATION_TARGET
        || !(fairPolicy || openPolicy)
        || (args.officialMigration && !fairPolicy)
    ) {
      throw new Error(`Launch ${args.token} emitted noncanonical V6 economics`);
    }
    marketSet.add(lower(launch.args.market));
    splitterToToken.set(lower(launch.args.feeSplitter), lower(launch.args.token));
    splitterToMarket.set(lower(launch.args.feeSplitter), lower(launch.args.market));
    splitterToOriginalCreator.set(lower(launch.args.feeSplitter), lower(launch.args.creator));
  }
  const launchTimestamps = new Map<bigint, string>();
  await Promise.all([...new Set(confirmedLaunches.map((launch) => launch.blockNumber))].map(async (blockNumber) => {
    const block = await rpc.getBlock({ blockNumber });
    launchTimestamps.set(blockNumber, new Date(Number(block.timestamp) * 1_000).toISOString());
  }));
  const markets = [...marketSet].map((market) => getAddress(market));
  const marketLogs = markets.length
    ? await readMarketLogs(markets, fromBlock, toBlock)
    : { trades: [], graduations: [], migrations: [] };

  const storedAdapters = await pool.query<{ adapter: string }>(
    "SELECT DISTINCT adapter FROM liquidity_migrations"
  );
  const adapterSet = new Set<string>(storedAdapters.rows.map((row) => row.adapter));
  for (const rawLog of marketLogs.migrations) {
    const migration = asConfirmed<MigrationArgs>(rawLog);
    if (migration) adapterSet.add(lower(migration.args.adapter));
  }

  const splitters = [...splitterToToken.keys()].map((address) => getAddress(address));
  const adapters = [...adapterSet].map((address) => getAddress(address));
  const [rawSplitterLogs, rawGraduationFeeLogs] = await Promise.all([
    splitters.length ? readFeeSplitterLogs(splitters, fromBlock, toBlock) : Promise.resolve([]),
    adapters.length ? readGraduationFeeLogs(adapters, fromBlock, toBlock) : Promise.resolve([])
  ]);
  const splitterLogs = rawSplitterLogs
    .map((log) => asDecodedConfirmed(log))
    .filter((log): log is DecodedConfirmedLog => log !== null)
    .sort(compareLogs);
  const graduationFeeLogs = rawGraduationFeeLogs
    .map((log) => asDecodedConfirmed<GraduationFeesCollectedArgs>(log))
    .filter((log): log is DecodedConfirmedLog<GraduationFeesCollectedArgs> => log !== null)
    .sort(compareLogs);

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
          trader_bps, liquidity_bps, platform_bps, transaction_hash, block_number, log_index,
          protocol_version, policy_id, policy_version, curve_fee_bps, protocol_fee_share_bps,
          post_graduation_fee_bps, graduation_target, fair_start_enabled, fair_start_delay_blocks,
          fair_start_duration_blocks, fair_start_max_tx_bps, fair_start_max_wallet_bps,
          official_migration, created_at, original_creator, current_creator_fee_recipient
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
          $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
        ) ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
        [
          lower(args.token), args.launchId.toString(), lower(args.creator), lower(args.market),
          lower(args.feeSplitter), args.graduationPoolId, args.name, args.symbol,
          FIXED_TOKEN_SUPPLY.toString(), args.metadataURI, Number(args.creatorFeeShareBps), 0,
          0, 0, Number(args.protocolFeeShareBps), log.transactionHash, log.blockNumber.toString(), log.logIndex,
          6, args.policyId, Number(args.policyVersion), Number(args.curveFeeBps), Number(args.protocolFeeShareBps),
          Number(args.postGraduationFeeBps), args.graduationTarget.toString(), args.fairStartEnabled,
          args.fairStartDelayBlocks.toString(), args.fairStartDurationBlocks.toString(),
          Number(args.fairStartMaxTxBps), Number(args.fairStartMaxWalletBps), args.officialMigration,
          launchTimestamps.get(log.blockNumber), lower(args.creator), lower(args.creator)
        ]
      );
    }

    for (const rawLog of marketLogs.trades) {
      const log = asConfirmed<TradeArgs>(rawLog);
      if (!log) continue;
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
      const log = asConfirmed<GraduationArgs>(rawLog);
      if (!log) continue;
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
      const log = asConfirmed<MigrationArgs>(rawLog);
      if (!log) continue;
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

    for (const log of splitterLogs) {
      const feeSplitter = lower(log.address);
      const launchToken = splitterToToken.get(feeSplitter);
      if (!launchToken) throw new Error(`Unknown V6 fee splitter ${feeSplitter}`);

      switch (log.eventName) {
        case "Initialized": {
          const args = log.args as InitializedArgs;
          if (lower(args.launchToken) !== launchToken) {
            throw new Error(`Fee splitter ${feeSplitter} emitted a mismatched launch token`);
          }
          const expectedMarket = splitterToMarket.get(feeSplitter);
          if (!expectedMarket || lower(args.authorizedMarket) !== expectedMarket) {
            throw new Error(`Fee splitter ${feeSplitter} emitted a mismatched authorized market`);
          }
          if (
            lower(args.protocolTreasury) !== canonicalProtocolTreasury
              || lower(args.creatorPayoutAuthority) !== canonicalCreatorPayoutAuthority
              || Number(args.creatorShareBps) !== CANONICAL_CREATOR_SHARE_BPS
              || lower(args.creator) !== splitterToOriginalCreator.get(feeSplitter)
          ) {
            throw new Error(`Fee splitter ${feeSplitter} emitted noncanonical V6 payout bindings`);
          }
          const adapter = lower(args.graduationAdapter);
          if (adapter === lower(zeroAddress)) {
            throw new Error(`Fee splitter ${feeSplitter} emitted a zero graduation adapter`);
          }
          const [adapterFactory, adapterPoolFee, adapterMarket, adapterSplitter, adapterLaunchFee] =
            await Promise.all([
              rpc.readContract({ address: args.graduationAdapter, abi: graduationAdapterReadAbi, functionName: "factory" }),
              rpc.readContract({ address: args.graduationAdapter, abi: graduationAdapterReadAbi, functionName: "poolFee" }),
              rpc.readContract({ address: args.graduationAdapter, abi: graduationAdapterReadAbi, functionName: "markets", args: [args.launchToken] }),
              rpc.readContract({ address: args.graduationAdapter, abi: graduationAdapterReadAbi, functionName: "feeSplitters", args: [args.launchToken] }),
              rpc.readContract({ address: args.graduationAdapter, abi: graduationAdapterReadAbi, functionName: "postGraduationFeeBps", args: [args.launchToken] })
            ]);
          if (
            lower(adapterFactory) !== lower(config.factory)
              || Number(adapterPoolFee) !== CANONICAL_V4_POOL_FEE
              || lower(adapterMarket) !== expectedMarket
              || lower(adapterSplitter) !== feeSplitter
              || Number(adapterLaunchFee) !== CANONICAL_POST_GRADUATION_FEE_BPS
          ) {
            throw new Error(`Fee splitter ${feeSplitter} is bound to a noncanonical V6 graduation adapter`);
          }
          splitterToAdapter.set(feeSplitter, adapter);
          splitterToTreasury.set(feeSplitter, canonicalProtocolTreasury);
          const update = await db.query(
            `UPDATE launches
             SET protocol_treasury = $2,
                 creator_payout_authority = $3,
                 original_creator = $4,
                 current_creator_fee_recipient = COALESCE(current_creator_fee_recipient, $4),
                 fee_authorized_market = $7,
                 fee_graduation_adapter = $8
             WHERE reward_vault = $1
               AND token = $5
               AND creator = $4
               AND creator_bps = $6
               AND market = $7`,
            [
              feeSplitter,
              lower(args.protocolTreasury),
              lower(args.creatorPayoutAuthority),
              lower(args.creator),
              launchToken,
              Number(args.creatorShareBps),
              lower(args.authorizedMarket),
              lower(args.graduationAdapter)
            ]
          );
          if (update.rowCount !== 1) {
            throw new Error(`Fee splitter initialization did not match launch ${launchToken}`);
          }
          break;
        }
        case "CreatorWalletChanged": {
          const args = log.args as CreatorWalletChangedArgs;
          const originalCreator = splitterToOriginalCreator.get(feeSplitter);
          const treasury = splitterToTreasury.get(feeSplitter);
          if (
            lower(args.authority) !== canonicalCreatorPayoutAuthority
              || args.evidenceHash.toLowerCase() === ZERO_HASH
              || !originalCreator || treasury !== canonicalProtocolTreasury
              || ![originalCreator, treasury].includes(lower(args.previousCreator))
              || ![originalCreator, treasury].includes(lower(args.newCreator))
              || lower(args.previousCreator) === lower(args.newCreator)
          ) {
            throw new Error(`Fee splitter ${feeSplitter} emitted an invalid creator-payout change`);
          }
          await insertCreatorPayoutEvent(
            db,
            log,
            launchToken,
            "changed",
            args.previousCreator,
            null,
            args.newCreator,
            args.authority,
            args.evidenceHash,
            args.nonce
          );
          break;
        }
        case "CreatorPayoutNonceInvalidated": {
          const args = log.args as CreatorPayoutNonceInvalidatedArgs;
          const treasury = splitterToTreasury.get(feeSplitter);
          if (
            treasury !== canonicalProtocolTreasury
              || lower(args.protocolTreasury) !== canonicalProtocolTreasury
              || args.newNonce !== args.previousNonce + 1n
          ) {
            throw new Error(`Fee splitter ${feeSplitter} emitted an invalid payout-nonce invalidation`);
          }
          await insertCreatorPayoutEvent(
            db,
            log,
            launchToken,
            "invalidated",
            null,
            null,
            null,
            args.protocolTreasury,
            null,
            args.previousNonce
          );
          break;
        }
        case "FeeReceived": {
          const args = log.args as NativePayerAmountArgs;
          const payer = lower(args.payer);
          if (payer !== splitterToMarket.get(feeSplitter) && payer !== splitterToAdapter.get(feeSplitter)) {
            throw new Error(`Fee splitter ${feeSplitter} reported native fees from an unauthorized source`);
          }
          await insertFeeSplitterEvent(db, log, launchToken, "fee_received", args.amount, args.payer, null, null);
          break;
        }
        case "DirectPayment": {
          const args = log.args as NativeRecipientAmountArgs;
          await insertFeeSplitterEvent(
            db, log, launchToken, "direct_payment", args.amount, null, args.recipient, null
          );
          break;
        }
        case "PaymentDeferred": {
          const args = log.args as NativeRecipientAmountArgs;
          await insertFeeSplitterEvent(
            db, log, launchToken, "payment_deferred", args.amount, null, args.recipient, null
          );
          break;
        }
        case "DeferredPaymentClaimed": {
          const args = log.args as NativeRecipientAmountArgs;
          await insertFeeSplitterEvent(
            db, log, launchToken, "deferred_payment_claimed", args.amount, null, args.recipient, null
          );
          break;
        }
        case "TokenFeeReceived": {
          const args = log.args as TokenPayerAmountArgs;
          if (lower(args.payer) !== splitterToAdapter.get(feeSplitter)) {
            throw new Error(`Fee splitter ${feeSplitter} reported token fees from an unauthorized source`);
          }
          if (lower(args.token) !== launchToken) {
            throw new Error(`Fee splitter ${feeSplitter} reported fees for a different token`);
          }
          await insertFeeSplitterEvent(
            db, log, launchToken, "token_fee_received", args.amount, args.payer, null, args.token
          );
          break;
        }
        case "DirectTokenPayment": {
          const args = log.args as TokenRecipientAmountArgs;
          await insertFeeSplitterEvent(
            db, log, launchToken, "direct_token_payment", args.amount, null, args.recipient, args.token
          );
          break;
        }
        case "TokenPaymentDeferred": {
          const args = log.args as TokenRecipientAmountArgs;
          await insertFeeSplitterEvent(
            db, log, launchToken, "token_payment_deferred", args.amount, null, args.recipient, args.token
          );
          break;
        }
        case "DeferredTokenPaymentClaimed": {
          const args = log.args as TokenRecipientAmountArgs;
          await insertFeeSplitterEvent(
            db,
            log,
            launchToken,
            "deferred_token_payment_claimed",
            args.amount,
            null,
            args.recipient,
            args.token
          );
          break;
        }
        default:
          throw new Error(`Unsupported fee splitter event ${log.eventName}`);
      }
    }

    for (const log of graduationFeeLogs) {
      const args = log.args;
      const token = lower(args.token);
      const feeSplitter = lower(args.feeSplitter);
      if (splitterToToken.get(feeSplitter) !== token) {
        throw new Error(`Graduation fee collection used an unknown token/splitter binding`);
      }
      if (splitterToAdapter.get(feeSplitter) !== lower(log.address)) {
        throw new Error(`Graduation fee collection used an unknown adapter/splitter binding`);
      }
      await db.query(
        `INSERT INTO graduation_fee_collections (
           transaction_hash, log_index, transaction_index, block_number, block_hash,
           adapter, token, fee_splitter, native_amount, token_amount
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
        [
          log.transactionHash,
          log.logIndex,
          log.transactionIndex,
          log.blockNumber.toString(),
          log.blockHash,
          lower(log.address),
          token,
          feeSplitter,
          args.nativeAmount.toString(),
          args.tokenAmount.toString()
        ]
      );
    }

    await refreshCreatorPayoutState(db);
    const incompleteLaunch = await db.query<{ token: string }>(
      `SELECT token
       FROM launches
       WHERE protocol_version <> 6
          OR original_creator IS NULL
          OR current_creator_fee_recipient IS NULL
          OR protocol_treasury IS NULL
          OR creator_payout_authority IS NULL
          OR fee_authorized_market IS NULL
          OR fee_authorized_market <> market
          OR fee_graduation_adapter IS NULL
          OR creator_bps <> ${CANONICAL_CREATOR_SHARE_BPS}
          OR protocol_fee_share_bps <> ${CANONICAL_PROTOCOL_SHARE_BPS}
          OR curve_fee_bps <> ${CANONICAL_CURVE_FEE_BPS}
          OR post_graduation_fee_bps <> ${CANONICAL_POST_GRADUATION_FEE_BPS}
          OR graduation_target <> '${CANONICAL_GRADUATION_TARGET.toString()}'
          OR protocol_treasury <> $1
          OR creator_payout_authority <> $2
       LIMIT 1`,
      [canonicalProtocolTreasury, canonicalCreatorPayoutAuthority]
    );
    if (incompleteLaunch.rows[0]) {
      throw new Error(`Incomplete V6 launch accounting for ${incompleteLaunch.rows[0].token}`);
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
    migrations: marketLogs.migrations.length,
    feeSplitterEvents: splitterLogs.length,
    graduationFeeCollections: graduationFeeLogs.length
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
      m.pool AS dex_pool,
      COALESCE(post_grad.native_fees, 0)::TEXT AS post_graduation_native_fees_collected,
      COALESCE(post_grad.token_fees, 0)::TEXT AS post_graduation_token_fees_collected,
      COALESCE(post_grad.collection_count, 0)::INTEGER AS post_graduation_collection_count
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
    LEFT JOIN LATERAL (
      SELECT
        SUM(native_amount) AS native_fees,
        SUM(token_amount) AS token_fees,
        COUNT(*) AS collection_count
      FROM graduation_fee_collections f
      WHERE f.token = l.token
    ) post_grad ON TRUE
    WHERE l.protocol_version = 6
    ORDER BY l.block_number DESC, l.log_index DESC
    LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function rmtOriginRows(tokens: readonly string[]) {
  const result = await pool.query(
    `SELECT
      token,
      launch_id::TEXT AS launch_id,
      creator,
      market,
      transaction_hash,
      block_number::TEXT AS block_number
    FROM launches
    WHERE protocol_version = 6
      AND LOWER(token) = ANY($1::text[])
    ORDER BY block_number DESC, log_index DESC`,
    [tokens]
  );

  return result.rows.map((row) => ({
    token: row.token as string,
    state: "rmt-verified" as const,
    claimKind: "token-created" as const,
    platform: "RMT",
    protocolVersion: 6,
    factory: config.factory,
    launchId: row.launch_id as string,
    creator: row.creator as string,
    market: row.market as string,
    launchTransactionHash: row.transaction_hash as string,
    launchBlock: row.block_number as string
  }));
}

function parseOriginTokens(value: string | null) {
  if (!value) return { error: "At least one token address is required." } as const;
  const requested = value.split(",").map((token) => token.trim()).filter(Boolean);
  if (requested.length === 0 || requested.length > 100) {
    return { error: "Origin lookups require between 1 and 100 token addresses." } as const;
  }
  if (requested.some((token) => !/^0x[0-9a-fA-F]{40}$/.test(token))) {
    return { error: "Every origin lookup value must be an EVM token address." } as const;
  }
  return { tokens: [...new Set(requested.map((token) => token.toLowerCase()))] } as const;
}

async function marketTradeRows(market: string, limit: number) {
  const launch = await pool.query(
    `SELECT token FROM launches WHERE market = $1 AND protocol_version = 6 LIMIT 1`,
    [market]
  );
  if (launch.rowCount !== 1) return null;

  const result = await pool.query(
    `SELECT
      transaction_hash,
      log_index,
      trader,
      recipient,
      is_buy,
      token_amount::TEXT AS token_amount,
      eth_amount::TEXT AS eth_amount,
      fee_amount::TEXT AS fee_amount,
      virtual_eth_reserve::TEXT AS virtual_eth_reserve,
      virtual_token_reserve::TEXT AS virtual_token_reserve,
      real_eth_reserve::TEXT AS real_eth_reserve,
      block_number::TEXT AS block_number
    FROM trades
    WHERE market = $1
    ORDER BY block_number DESC, log_index DESC
    LIMIT $2`,
    [market, limit]
  );

  return {
    token: launch.rows[0].token as string,
    trades: result.rows.map((row) => ({
      transactionHash: row.transaction_hash as string,
      logIndex: Number(row.log_index),
      trader: row.trader as string,
      recipient: row.recipient as string,
      isBuy: Boolean(row.is_buy),
      tokenAmount: row.token_amount as string,
      ethAmount: row.eth_amount as string,
      feeAmount: row.fee_amount as string,
      virtualEthReserve: row.virtual_eth_reserve as string,
      virtualTokenReserve: row.virtual_token_reserve as string,
      realEthReserve: row.real_eth_reserve as string,
      blockNumber: row.block_number as string
    }))
  };
}

function hasReadAccess(request: import("node:http").IncomingMessage) {
  if (!config.readToken) return true;
  const authorization = request.headers.authorization;
  if (!authorization) return false;
  const actual = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${config.readToken}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
  const bindings = requireProtocolBindings();
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method !== "GET") {
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      if (url.pathname === "/health") {
        const latest = await rpc.getBlockNumber();
        const healthy = initialSyncComplete && !lastError;
        json(response, healthy ? 200 : 503, {
          ok: healthy,
          chainId: CHAIN_ID,
          protocolVersion: 6,
          factory: config.factory,
          policyRegistry: bindings.policyRegistry,
          governance: bindings.governance,
          creatorPayoutAuthority: bindings.creatorPayoutAuthority,
          protocolTreasury: bindings.protocolTreasury,
          factoryStartBlock: config.startBlock.toString(),
          indexedThrough: indexedThrough.toString(),
          latestBlock: latest.toString(),
          confirmationDepth: config.confirmations,
          lagBlocks: latest > indexedThrough ? (latest - indexedThrough).toString() : "0",
          initialSyncComplete,
          lastSyncAt,
          error: lastError ?? (initialSyncComplete ? null : "Initial V6 backfill and invariants are still running")
        });
        return;
      }
      if (!hasReadAccess(request)) {
        response.setHeader("WWW-Authenticate", "Bearer");
        json(response, 401, { error: "Unauthorized" });
        return;
      }
      if (url.pathname === "/launches") {
        if (!initialSyncComplete || lastError) {
          json(response, 503, {
            error: lastError ?? "Initial V6 backfill and invariants are still running"
          });
          return;
        }
        const requested = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
        const limit = Number.isSafeInteger(requested) ? Math.min(100, Math.max(1, requested)) : 25;
        json(response, 200, { launches: await launchRows(limit), indexedThrough: indexedThrough.toString(), syncedAt: lastSyncAt });
        return;
      }
      if (url.pathname === "/origins") {
        if (!initialSyncComplete || lastError) {
          json(response, 503, {
            error: lastError ?? "Initial V6 backfill and invariants are still running"
          });
          return;
        }
        const query = parseOriginTokens(url.searchParams.get("tokens"));
        if ("error" in query) {
          json(response, 400, { error: query.error });
          return;
        }
        json(response, 200, {
          chainId: CHAIN_ID,
          coverage: "complete",
          claims: await rmtOriginRows(query.tokens),
          factory: config.factory,
          indexedThrough: indexedThrough.toString(),
          syncedAt: lastSyncAt
        });
        return;
      }

      const tradeRoute = /^\/markets\/(0x[0-9a-fA-F]{40})\/trades$/.exec(url.pathname);
      if (tradeRoute) {
        if (!initialSyncComplete || lastError) {
          json(response, 503, {
            error: lastError ?? "Initial V6 backfill and invariants are still running"
          });
          return;
        }
        const requested = Number.parseInt(url.searchParams.get("limit") ?? "12", 10);
        const limit = Number.isSafeInteger(requested) ? Math.min(50, Math.max(1, requested)) : 12;
        const market = tradeRoute[1]!.toLowerCase();
        const data = await marketTradeRows(market, limit);
        if (!data) {
          json(response, 404, { error: "V6 market not found" });
          return;
        }
        json(response, 200, {
          market,
          token: data.token,
          trades: data.trades,
          indexedThrough: indexedThrough.toString(),
          confirmationDepth: config.confirmations,
          syncedAt: lastSyncAt
        });
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
  protocolBindings = await verifyV6Factory();
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
      initialSyncComplete = true;
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
