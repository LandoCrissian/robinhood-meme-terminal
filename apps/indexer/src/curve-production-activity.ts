import assert from "node:assert/strict";
import type { Client } from "pg";
import { isAddress, parseAbi, toEventSelector, zeroAddress, type Address, type Hash, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { blockEvidence, type BlockEvidence, type CurveLaunchRegistration } from "./curve-launch-evidence.js";
import type { CurveProductionConfig } from "./curve-production-config.js";
import { productionCurveScope } from "./curve-production-store.js";
import { assertIndexWriterLease } from "./index-store.js";

type Database = Pick<Client, "query">;
export const productionActivityProfile = "rmt-curve-activity-v1";
export const activityEventLimit = 128;
const rangeEventLimit = 512;
const registrationLimit = 256;
const hashPattern = /^0x[0-9a-f]{64}$/i;
export const activityPermit2 = "0x000000000022d473030f116ddee9f6b43ac78ba3" as Address;
export const activityRouter212 = "0x204faca1764b154221e35c0d20abb3c525710498" as Address;
const dependencyAbi = parseAbi([
  "function graduationEngine() view returns(address)", "function poolManager() view returns(address)",
  "function permit2() view returns(address)",
  "function curveForToken(address) view returns(address)", "function migrationCandidate(address,uint32) view returns(address)",
  "function poolId() view returns(bytes32)", "function lpFeeLedger(address) view returns(address)",
]);
const swap = parseAbi(["event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)"])[0];
const permitApproval = parseAbi(["event Approval(address indexed owner,address indexed token,address indexed spender,uint160 amount,uint48 expiration)"])[0];
const creationFeesClaimed = toEventSelector("CreationFeesClaimed(address,uint256)");
export type ProductionActivityEvent = {
  address: Address; logIndex: number; blockNumber: string; blockHash: Hash; transactionHash: Hash;
  transactionIndex: number; topics: readonly Hex[]; data: Hex;
};
export type ActivityQuery = { transactionHash: Hash; token?: Address };

export function parseProductionActivityQuery(url: URL): ActivityQuery | null {
  const keys = Array.from(url.searchParams.keys());
  const transactionHash = url.searchParams.get("transactionHash"), token = url.searchParams.get("token");
  if (url.pathname !== "/curve-activity" || keys.length < 1 || keys.length > 2 || new Set(keys).size !== keys.length
      || keys.some(key => !["transactionHash", "token"].includes(key))
      || !transactionHash || !hashPattern.test(transactionHash) || (token !== null && (!isAddress(token, { strict: false }) || token.toLowerCase() === zeroAddress))) return null;
  return { transactionHash: transactionHash.toLowerCase() as Hash, ...(token ? { token: token.toLowerCase() as Address } : {}) };
}

/** Explicit migration only. The running worker never executes this DDL. */
export const productionActivitySchemaSql = `
CREATE TABLE IF NOT EXISTS rmt_curve_activity_bindings (
 scope TEXT PRIMARY KEY REFERENCES rmt_curve_production_bindings(scope), next_block BIGINT NOT NULL CHECK(next_block > 0)
);
CREATE TABLE IF NOT EXISTS rmt_curve_activity_checkpoints (
 scope TEXT NOT NULL REFERENCES rmt_curve_activity_bindings(scope), block_number BIGINT NOT NULL,
 block_hash TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(scope,block_number)
);
CREATE TABLE IF NOT EXISTS rmt_curve_activity_events (
 scope TEXT NOT NULL REFERENCES rmt_curve_activity_bindings(scope), token TEXT NOT NULL,
 transaction_hash TEXT NOT NULL, log_index INTEGER NOT NULL CHECK(log_index >= 0), block_number BIGINT NOT NULL,
 block_hash TEXT NOT NULL, payload JSONB NOT NULL, PRIMARY KEY(scope,token,transaction_hash,log_index)
);
CREATE INDEX IF NOT EXISTS rmt_curve_activity_events_block ON rmt_curve_activity_events(scope,block_number);
`;

function raw(log: { address: Address; logIndex: number | null; blockNumber: bigint | null; blockHash: Hash | null;
  transactionHash: Hash | null; transactionIndex: number | null; topics: readonly Hex[]; data: Hex; removed?: boolean }): ProductionActivityEvent {
  if (log.removed || !isAddress(log.address, { strict: false }) || log.logIndex === null || !Number.isSafeInteger(log.logIndex)
      || log.logIndex < 0 || log.blockNumber === null || log.blockNumber < 0n || !log.blockHash || !hashPattern.test(log.blockHash)
      || !log.transactionHash || !hashPattern.test(log.transactionHash) || log.transactionIndex === null
      || !Number.isSafeInteger(log.transactionIndex) || log.transactionIndex < 0 || log.topics.length > 4
      || log.topics.some(topic => !hashPattern.test(topic)) || !/^0x(?:[0-9a-f]{2})*$/i.test(log.data)
      || log.data.length > 131_074) throw new Error("Incomplete or excessive production activity log");
  return { address: log.address.toLowerCase() as Address, logIndex: log.logIndex, blockNumber: log.blockNumber.toString(),
    blockHash: log.blockHash.toLowerCase() as Hash, transactionHash: log.transactionHash.toLowerCase() as Hash,
    transactionIndex: log.transactionIndex, topics: log.topics.map(topic => topic.toLowerCase() as Hex), data: log.data.toLowerCase() as Hex };
}
function sortEvents(events: ProductionActivityEvent[]) {
  return events.sort((a, b) => BigInt(a.blockNumber) === BigInt(b.blockNumber) ? a.logIndex - b.logIndex
    : BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : 1);
}
export function validateProductionActivityEvent(event: ProductionActivityEvent) {
  assert.deepEqual(raw({ ...event, blockNumber: BigInt(event.blockNumber) }), event, "Activity must have normalized exact identity");
}
async function atomic<T>(db: Database, task: () => Promise<T>) {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL lock_timeout = '2s'"); await db.query("SET LOCAL statement_timeout = '5s'");
    const value = await task(); await db.query("COMMIT"); return value;
  } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; }
}
export async function initializeProductionActivityStore(db: Database, config: CurveProductionConfig) {
  const found = await db.query<{ present: boolean }>(`SELECT to_regclass('public.rmt_curve_activity_bindings') IS NOT NULL
    AND to_regclass('public.rmt_curve_activity_events') IS NOT NULL
    AND to_regclass('public.rmt_curve_activity_checkpoints') IS NOT NULL AS present`);
  if (found.rows[0]?.present !== true) throw new Error("Production activity requires explicitly approved schema installation");
  await assertIndexWriterLease(db, config.binding.chainId);
  await db.query(`INSERT INTO rmt_curve_activity_bindings(scope,next_block) VALUES($1,$2) ON CONFLICT DO NOTHING`,
    [productionCurveScope(config), config.binding.deploymentBlock.toString()]);
}
export async function productionActivityCursor(db: Database, scope: string) {
  const result = await db.query<{ next_block: string }>("SELECT next_block::text FROM rmt_curve_activity_bindings WHERE scope=$1", [scope]);
  if (!result.rows[0]) throw new Error("Production activity cursor unavailable");
  return BigInt(result.rows[0].next_block);
}
export async function commitProductionActivity(db: Database, config: CurveProductionConfig, from: bigint,
  checkpoint: BlockEvidence, rows: { token: Address; event: ProductionActivityEvent }[]) {
  const scope = productionCurveScope(config), to = BigInt(checkpoint.blockNumber);
  if (rows.length > rangeEventLimit || to < from) throw new Error("Activity range exceeds its bound");
  await assertIndexWriterLease(db, config.binding.chainId);
  await atomic(db, async () => {
    const cursor = await db.query<{ next_block: string }>("SELECT next_block::text FROM rmt_curve_activity_bindings WHERE scope=$1 FOR UPDATE", [scope]);
    if (!cursor.rows[0] || BigInt(cursor.rows[0].next_block) !== from) throw new Error("Activity cursor changed during ingestion");
    for (const { token, event } of rows) {
      validateProductionActivityEvent(event);
      if (!isAddress(token, { strict: false }) || BigInt(event.blockNumber) < from || BigInt(event.blockNumber) > to) throw new Error("Activity scope or range mismatch");
      const payload = JSON.stringify(event);
      await db.query(`INSERT INTO rmt_curve_activity_events(scope,token,transaction_hash,log_index,block_number,block_hash,payload)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [scope, token.toLowerCase(), event.transactionHash, event.logIndex, event.blockNumber, event.blockHash, payload]);
      const exact = await db.query<{ matches: boolean }>(`SELECT payload=$5::jsonb AS matches FROM rmt_curve_activity_events
        WHERE scope=$1 AND token=$2 AND transaction_hash=$3 AND log_index=$4`, [scope, token.toLowerCase(), event.transactionHash, event.logIndex, payload]);
      if (exact.rows[0]?.matches !== true) throw new Error("Conflicting durable activity identity");
    }
    await db.query("INSERT INTO rmt_curve_activity_checkpoints(scope,block_number,block_hash,observed_at) VALUES($1,$2,$3,$4)",
      [scope, checkpoint.blockNumber, checkpoint.blockHash, checkpoint.timestamp]);
    await db.query("UPDATE rmt_curve_activity_bindings SET next_block=$2 WHERE scope=$1", [scope, (to + 1n).toString()]);
  });
}
export async function rollbackProductionActivity(db: Database, scope: string, keep: bigint) {
  await assertIndexWriterLease(db, 4663);
  await atomic(db, async () => {
    await db.query("SELECT scope FROM rmt_curve_activity_bindings WHERE scope=$1 FOR UPDATE", [scope]);
    await db.query("DELETE FROM rmt_curve_activity_events WHERE scope=$1 AND block_number>$2", [scope, keep.toString()]);
    await db.query("DELETE FROM rmt_curve_activity_checkpoints WHERE scope=$1 AND block_number>$2", [scope, keep.toString()]);
    await db.query("UPDATE rmt_curve_activity_bindings SET next_block=LEAST(next_block,$2) WHERE scope=$1", [scope, (keep + 1n).toString()]);
  });
}
export async function readProductionActivity(db: Database, scope: string, point: BlockEvidence, query: ActivityQuery) {
  const current = await db.query<{ matches: boolean }>(`SELECT a.next_block-1=$2::bigint AND c.block_hash=$3
      AND b.next_block=a.next_block AND p.block_hash=c.block_hash AS matches
    FROM rmt_curve_activity_bindings a JOIN rmt_curve_activity_checkpoints c ON c.scope=a.scope AND c.block_number=a.next_block-1
    JOIN rmt_curve_production_bindings b ON b.scope=a.scope
    JOIN rmt_curve_production_checkpoints p ON p.scope=b.scope AND p.block_number=b.next_block-1 WHERE a.scope=$1`,
    [scope, point.blockNumber, point.blockHash]);
  if (current.rows[0]?.matches !== true) throw new Error("Activity is not caught up to the canonical production checkpoint");
  if (query.token) {
    const registered = await db.query("SELECT token FROM rmt_curve_production_launches WHERE scope=$1 AND token=$2 AND block_number<=$3", [scope, query.token, point.blockNumber]);
    if (registered.rows.length !== 1) throw new Error("Activity token is not registered to this deployment");
  }
  const result = await db.query<{ payload: ProductionActivityEvent }>(`SELECT payload FROM rmt_curve_activity_events
    WHERE scope=$1 AND token=$2 AND transaction_hash=$3 AND block_number<=$4 ORDER BY log_index LIMIT $5`,
    [scope, query.token ?? zeroAddress, query.transactionHash, point.blockNumber, activityEventLimit + 1]);
  if (result.rows.length > activityEventLimit) throw new Error("Activity receipt exceeds its event bound");
  for (const { payload } of result.rows) validateProductionActivityEvent(payload);
  return result.rows.map(row => row.payload);
}

/** Existing writer lease owns this separate backfill cursor; no new writer or runtime DDL. */
export function createProductionActivityIndexer(config: CurveProductionConfig, db: Database, primary: PublicClient, archive: PublicClient | undefined) {
  const scope = productionCurveScope(config);
  let readyPoint: BlockEvidence | null = null;
  let initialized = false;
  async function canonical(height: bigint) {
    if (!archive) throw new Error("Activity requires two corroborating providers");
    const points = await Promise.all([primary, archive].map(async rpc => blockEvidence(await rpc.getBlock({ blockNumber: height, includeTransactions: false }), height)));
    assert.deepEqual(points[0], points[1], "Activity canonical providers disagree"); return points[0]!;
  }
  async function sync(point: BlockEvidence, catalogHeight = BigInt(point.blockNumber)) {
    readyPoint = null;
    if (!archive) throw new Error("Activity requires a distinct corroborating provider");
    assert.ok(catalogHeight >= BigInt(point.blockNumber), "Activity catalog is behind its history target");
    if (!initialized) { await initializeProductionActivityStore(db, config); initialized = true; }
    const saved = await db.query<{ block_number: string; block_hash: string }>(`SELECT block_number::text,block_hash
      FROM rmt_curve_activity_checkpoints WHERE scope=$1 ORDER BY block_number DESC LIMIT 25`, [scope]);
    if (saved.rows.length) {
      let keep: bigint | null = null;
      for (const row of saved.rows.slice(0, 24)) {
        if (BigInt(row.block_number) <= BigInt(point.blockNumber) && (await canonical(BigInt(row.block_number))).blockHash.toLowerCase() === row.block_hash) { keep = BigInt(row.block_number); break; }
      }
      if (keep === null && saved.rows.length > 24) throw new Error("Activity reorg exceeds bounded automatic recovery");
      if (keep === null || keep !== BigInt(saved.rows[0]!.block_number)) await rollbackProductionActivity(db, scope, keep ?? config.binding.deploymentBlock - 1n);
    }
    const from = await productionActivityCursor(db, scope);
    if (from <= BigInt(point.blockNumber)) {
      const to = from + 1_999n < BigInt(point.blockNumber) ? from + 1_999n : BigInt(point.blockNumber);
      const end = await canonical(to);
      const registrations = await db.query<{ payload: CurveLaunchRegistration }>(`SELECT payload FROM rmt_curve_production_launches
        WHERE scope=$1 AND block_number<=$2 ORDER BY token LIMIT $3`, [scope, to.toString(), registrationLimit + 1]);
      if (registrations.rows.length > registrationLimit) throw new Error("Activity registration set exceeds its bounded release profile");
      const launches = registrations.rows.map(row => row.payload);
      const catalog = launches.length ? await canonical(catalogHeight) : null;
      const addressTokens = new Map<Address, Set<Address>>();
      const poolTokens = new Map<Hash, Set<Address>>();
      const allTokens = launches.map(launch => launch.token.toLowerCase() as Address);
      function associate(address: Address, tokens: Address[]) {
        if (address.toLowerCase() === zeroAddress) return;
        const key = address.toLowerCase() as Address, existing = addressTokens.get(key) ?? new Set<Address>();
        for (const token of tokens) existing.add(token); addressTokens.set(key, existing);
      }
      async function agreedRead(address: Address, functionName: "graduationEngine" | "poolManager" | "permit2" | "curveForToken" | "migrationCandidate" | "poolId" | "lpFeeLedger", args?: readonly unknown[]) {
        // These immutable/append-only values enumerate emitters, not historic
        // financial state. Original curve plus every supported successor,
        // one-time pool ID and LP ledger remain included after migration.
        const values = await Promise.all([primary, archive!].map(rpc => rpc.readContract({ address, abi: dependencyAbi, functionName, args, blockNumber: catalogHeight } as never)));
        assert.deepEqual(values[0], values[1], "Activity dependency providers disagree"); return String(values[0]).toLowerCase();
      }
      // Before the first verified registration there can be no curve, ledger,
      // pool or Permit2 activity. Still audit canonical factory logs; do not
      // require unrelated historical-state eth_calls to advance empty history.
      const engine = launches.length ? await agreedRead(config.binding.factory, "graduationEngine") as Address : null;
      const manager = engine ? await agreedRead(engine, "poolManager") as Address : null;
      if (engine && await agreedRead(engine, "permit2") !== activityPermit2) throw new Error("Activity Permit2 differs from the approved production dependency");
      if (engine && ![engine, manager].every(address => address && isAddress(address, { strict: false }) && address !== zeroAddress)) throw new Error("Activity dependency identity unavailable");
      // Shared emitters are discovered once, then associated by their exact
      // indexed token. Broadcasting each factory/engine receipt to every token
      // would exhaust bounds as the admitted registration set grows.
      associate(config.binding.factory, []); if (engine) associate(engine, []);
      for (const launch of launches) {
        const token = launch.token.toLowerCase() as Address;
        associate(token, [token]); associate(launch.revenueLedger, [token]); associate(launch.initialCurve, [token]);
        // Current release has original V1 plus published V2/V3 successors. No unlimited address scan.
        const curves = [launch.initialCurve, await agreedRead(config.binding.factory, "curveForToken", [token]),
          await agreedRead(config.binding.factory, "migrationCandidate", [token, 2]), await agreedRead(config.binding.factory, "migrationCandidate", [token, 3])];
        for (const curve of new Set(curves.map(address => address.toLowerCase()))) {
          if (curve === zeroAddress) continue;
          if (!isAddress(curve, { strict: false })) throw new Error("Activity curve identity unavailable");
          associate(curve, [token]);
          const pool = await agreedRead(curve, "poolId") as Hash;
          if (!hashPattern.test(pool)) throw new Error("Activity pool identity unavailable");
          if (BigInt(pool) !== 0n) { const tokens = poolTokens.get(pool) ?? new Set<Address>(); tokens.add(token); poolTokens.set(pool, tokens); }
        }
        associate(await agreedRead(engine!, "lpFeeLedger", [token]) as Address, [token]);
      }
      const addresses = [...addressTokens.keys()];
      async function references(rpc: PublicClient) {
        const logs: ProductionActivityEvent[] = [];
        for (let offset = 0; offset < addresses.length; offset += 32) {
          logs.push(...(await rpc.getLogs({ address: addresses.slice(offset, offset + 32), fromBlock: from, toBlock: to })).map(raw));
          if (logs.length > rangeEventLimit) throw new Error("Activity log range exceeds its bound");
        }
        for (const id of poolTokens.keys()) {
          logs.push(...(await rpc.getLogs({ address: manager!, event: swap, args: { id }, fromBlock: from, toBlock: to, strict: true })).map(raw));
          if (logs.length > rangeEventLimit) throw new Error("Activity pool range exceeds its bound");
        }
        // Permit2 approval-only receipts have no token/curve log. Query just
        // the approved router's indexed spender and admitted token topics;
        // never scan all users/pools of this shared deployment.
        for (let offset = 0; offset < allTokens.length; offset += 32) {
          logs.push(...(await rpc.getLogs({ address: activityPermit2, event: permitApproval,
            args: { token: allTokens.slice(offset, offset + 32), spender: activityRouter212 }, fromBlock: from, toBlock: to, strict: true })).map(raw));
          if (logs.length > rangeEventLimit) throw new Error("Activity Permit2 range exceeds its bound");
        }
        return sortEvents(logs);
      }
      const referencesBoth = await Promise.all([primary, archive].map(references));
      assert.deepEqual(referencesBoth[0], referencesBoth[1], "Activity providers disagree on event discovery");
      const grouped = new Map<Hash, ProductionActivityEvent[]>();
      for (const event of referencesBoth[0]!) { const events = grouped.get(event.transactionHash) ?? []; events.push(event); grouped.set(event.transactionHash, events); }
      if (grouped.size > activityEventLimit) throw new Error("Activity transaction range exceeds its bound");
      const rows: { token: Address; event: ProductionActivityEvent }[] = [];
      for (const [transactionHash, discovered] of grouped) {
        const receipts: TransactionReceipt[] = await Promise.all([primary, archive].map(rpc => rpc.getTransactionReceipt({ hash: transactionHash })));
        const normalized: { blockNumber: string; blockHash: string; transactionIndex: number; events: ProductionActivityEvent[] }[] = receipts.map(receipt => {
          if (receipt.status !== "success" || receipt.transactionHash.toLowerCase() !== transactionHash || receipt.logs.length > activityEventLimit) throw new Error("Activity receipt is unsuccessful or excessive");
          const events = sortEvents(receipt.logs.map(raw));
          if (Buffer.byteLength(JSON.stringify(events), "utf8") > 65_536) throw new Error("Activity receipt exceeds its byte bound");
          for (const event of events) if (event.transactionHash !== transactionHash || event.blockNumber !== receipt.blockNumber.toString()
              || event.blockHash !== receipt.blockHash.toLowerCase() || event.transactionIndex !== receipt.transactionIndex) throw new Error("Activity receipt log identity mismatch");
          if (new Set(events.map(event => event.logIndex)).size !== events.length) throw new Error("Duplicate activity receipt log index");
          return { blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash.toLowerCase(), transactionIndex: receipt.transactionIndex, events };
        });
        assert.deepEqual(normalized[0], normalized[1], "Activity receipt providers disagree");
        const receipt = normalized[0]!;
        const block = await canonical(BigInt(receipt.blockNumber));
        if (block.blockHash.toLowerCase() !== receipt.blockHash || BigInt(receipt.blockNumber) < from || BigInt(receipt.blockNumber) > to) throw new Error("Activity receipt is not canonical in this range");
        const blocks = await Promise.all([primary, archive].map(rpc => rpc.getBlock({ blockNumber: BigInt(receipt.blockNumber), includeTransactions: false })));
        for (const observed of blocks) if (observed.transactions[receipt.transactionIndex]?.toString().toLowerCase() !== transactionHash) throw new Error("Activity receipt is not a member of its canonical block");
        const tokens = new Set<Address>();
        for (const event of discovered) {
          assert.ok(receipt.events.some(row => JSON.stringify(row) === JSON.stringify(event)), "Discovered activity is absent from canonical receipt");
          for (const token of addressTokens.get(event.address) ?? poolTokens.get(event.topics[1] as Hash) ?? []) tokens.add(token);
          if (event.address === config.binding.factory.toLowerCase() || event.address === engine) {
            if (event.address === config.binding.factory.toLowerCase() && event.topics[0] === creationFeesClaimed) tokens.add(zeroAddress);
            else {
              const token = `0x${event.topics[1]?.slice(-40)}`.toLowerCase() as Address;
              if (!allTokens.includes(token)) throw new Error("Shared activity emitter token is outside its registered deployment scope");
              tokens.add(token);
            }
          }
          if (event.address === activityPermit2) {
            const token = `0x${event.topics[2]?.slice(-40)}`.toLowerCase() as Address;
            const spender = `0x${event.topics[3]?.slice(-40)}`.toLowerCase();
            if (!allTokens.includes(token) || spender !== activityRouter212) throw new Error("Activity Permit2 event is outside the admitted token/router scope");
            tokens.add(token);
          }
        }
        for (const token of tokens) for (const event of receipt.events) rows.push({ token, event });
        if (rows.length > rangeEventLimit) throw new Error("Durable activity range exceeds its bound");
      }
      assert.deepEqual(await canonical(to), end, "Activity range changed during receipt verification");
      if (catalog) assert.deepEqual(await canonical(catalogHeight), catalog, "Activity emitter catalog changed during receipt verification");
      await commitProductionActivity(db, config, from, end, rows);
    }
    if (await productionActivityCursor(db, scope) === BigInt(point.blockNumber) + 1n) {
      assert.deepEqual(await canonical(BigInt(point.blockNumber)), point, "Activity checkpoint changed"); readyPoint = point;
    }
  }
  return { sync, invalidate: () => { readyPoint = null; }, ready: (point: BlockEvidence) => readyPoint !== null
    && readyPoint.blockNumber === point.blockNumber && readyPoint.blockHash === point.blockHash };
}
