import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { isAddress, isHash, zeroAddress, type Address, type Hash } from "viem";
import { launchPoolId, type NewLaunchRecord } from "../launchpad/launch-record";
import { copyLaunchSnapshot, copyVerifiedLaunchBackup, stageLaunchBackup } from "./launchpad-sqlite-backup";

export type LaunchCheckpoint = { number: bigint; hash: Hash };
export type LaunchPageCursor = { blockNumber: bigint; logIndex: number };
type LaunchFilter = { token?: Address; creator?: Address };
type Provisional = { token: Address; blockNumber: bigint; blockHash: Hash };
type IndexUpdate = {
  anchor: LaunchCheckpoint;
  keep: LaunchCheckpoint | undefined;
  next?: LaunchCheckpoint;
  records: NewLaunchRecord[];
  orphaned: Provisional[];
  caughtUp: boolean;
};
type LaunchBackup = { bytes: number; sha256: string; checkpoint?: LaunchCheckpoint };

// Provisional receipts remain visible while the worker catches up. A fresh receipt can
// be submitted again if the worker was unavailable for the entire provisional window.
const provisionalWindowMs = 30 * 60_000;
const maximumPending = 128;
const maximumRecordBytes = 8 * 1024;
const maximumCheckpoints = 32;
const maximumBlock = 9_000_000_000_000_000n;
const sameCheckpoint = (left: LaunchCheckpoint | undefined, right: LaunchCheckpoint | undefined) =>
  left?.number === right?.number && left?.hash.toLowerCase() === right?.hash.toLowerCase();

export function launchpadScopeIdentity(scope: string) {
  const [chain, firstBlock, ...pins] = scope.split(":");
  const chainId = Number(chain);
  const guarded = pins.length === 17 && pins[16] === "v2";
  if (!/^[1-9]\d{0,15}$/.test(chain) || !Number.isSafeInteger(chainId)
    || !/^[1-9]\d{0,14}$/.test(firstBlock) || (pins.length !== 14 && !guarded)
    || pins.slice(0, guarded ? -1 : undefined).some((pin, index) => index % 2 ? !isHash(pin) : !isAddress(pin))) {
    throw new Error("Invalid launch index scope");
  }
  return { chainId, firstBlock: BigInt(firstBlock), factory: pins[0].toLowerCase(), manager: pins[2].toLowerCase(),
    hook: guarded ? pins[14].toLowerCase() : zeroAddress, guarded };
}

function blockHeight(value: string) {
  if (!/^[1-9]\d{0,15}$/.test(value) || BigInt(value) >= maximumBlock) throw new Error("Invalid launch record block height");
  return BigInt(value);
}

function requireCheckpoint(checkpoint: LaunchCheckpoint) {
  if (checkpoint.number < 0n || checkpoint.number >= maximumBlock || !isHash(checkpoint.hash)) {
    throw new Error("Invalid launch index checkpoint");
  }
}

function checkedBackup(db: DatabaseSync, scope: string) {
  if (db.prepare("PRAGMA quick_check(1)").get()?.quick_check !== "ok") throw new Error("Launch backup failed SQLite integrity check");
  const row = db.prepare(`SELECT height, hash FROM rmt_new_launch_checkpoints
    WHERE scope = ? ORDER BY height DESC LIMIT 1`).get(scope);
  if (!row && !db.prepare("SELECT 1 FROM rmt_new_launch_health WHERE scope = ?").get(scope)
    && !db.prepare("SELECT 1 FROM rmt_new_launch_records WHERE scope = ? LIMIT 1").get(scope)) {
    throw new Error("Launch backup does not contain the requested index scope");
  }
  if (!row) return undefined;
  const checkpoint = { number: BigInt(String(row.height)), hash: row.hash as Hash };
  requireCheckpoint(checkpoint);
  return checkpoint;
}

export class LaunchpadStore {
  private readonly db: DatabaseSync;
  private readonly identity: ReturnType<typeof launchpadScopeIdentity>;

  constructor(private readonly path: string, private readonly scope: string) {
    this.identity = launchpadScopeIdentity(scope);
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(`
        PRAGMA busy_timeout = 2500;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA trusted_schema = OFF;
        CREATE TABLE IF NOT EXISTS rmt_new_launch_anchors (
          scope TEXT PRIMARY KEY,
          height INTEGER NOT NULL,
          hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rmt_new_launch_checkpoints (
          scope TEXT NOT NULL,
          height INTEGER NOT NULL,
          hash TEXT NOT NULL,
          PRIMARY KEY (scope, height)
        );
        CREATE TABLE IF NOT EXISTS rmt_new_launch_records (
          scope TEXT NOT NULL,
          token TEXT NOT NULL,
          creator TEXT NOT NULL,
          height INTEGER NOT NULL,
          block_hash TEXT NOT NULL,
          tx_hash TEXT NOT NULL,
          log_index INTEGER NOT NULL,
          indexed INTEGER NOT NULL CHECK (indexed IN (0, 1)),
          published_ms INTEGER NOT NULL,
          record TEXT NOT NULL,
          PRIMARY KEY (scope, token),
          UNIQUE (scope, tx_hash, log_index)
        );
        CREATE INDEX IF NOT EXISTS rmt_new_launch_creator ON rmt_new_launch_records (scope, creator, height DESC);
        CREATE INDEX IF NOT EXISTS rmt_new_launch_height ON rmt_new_launch_records (scope, height DESC);
        CREATE INDEX IF NOT EXISTS rmt_new_launch_pending ON rmt_new_launch_records (scope, published_ms) WHERE indexed = 0;
        CREATE UNIQUE INDEX IF NOT EXISTS rmt_new_launch_event_slot ON rmt_new_launch_records (scope, block_hash, log_index);
        CREATE TABLE IF NOT EXISTS rmt_new_launch_health (
          scope TEXT PRIMARY KEY,
          caught_up INTEGER NOT NULL CHECK (caught_up IN (0, 1)),
          updated_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rmt_new_launch_quota (
          scope TEXT NOT NULL,
          category TEXT NOT NULL,
          window INTEGER NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (scope, category)
        );
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  assertScope(scope: string) {
    if (scope !== this.scope) throw new Error("Launch index runtime does not match the open database scope");
  }

  backup(destination: string): Promise<LaunchBackup> {
    if (!isAbsolute(this.path)) throw new Error("Launch backup requires a file-backed database with an absolute path");
    return stageLaunchBackup(destination, async (staged) => {
      await copyLaunchSnapshot(this.path, staged);
      const snapshot = new DatabaseSync(staged);
      try {
        snapshot.exec("PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL");
        return checkedBackup(snapshot, this.scope);
      } finally { snapshot.close(); }
    });
  }

  static restore(source: string, destination: string, scope: string, expectedSha256: string): Promise<LaunchBackup> {
    launchpadScopeIdentity(scope);
    return stageLaunchBackup(destination, async (staged) => {
      await copyVerifiedLaunchBackup(source, staged, expectedSha256);
      const snapshot = new DatabaseSync(staged);
      try {
        snapshot.exec("PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL");
        const checkpoint = checkedBackup(snapshot, scope);
        snapshot.exec("UPDATE rmt_new_launch_health SET caught_up=0");
        return checkpoint;
      } finally { snapshot.close(); }
    });
  }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  checkpoint(before?: bigint): LaunchCheckpoint | undefined {
    const row = this.db.prepare(`SELECT height, hash FROM rmt_new_launch_checkpoints
      WHERE scope = ? AND height < ? ORDER BY height DESC LIMIT 1`).get(this.scope, before ?? maximumBlock);
    return this.parseCheckpoint(row);
  }

  anchor(): LaunchCheckpoint | undefined {
    return this.parseCheckpoint(this.db.prepare("SELECT height, hash FROM rmt_new_launch_anchors WHERE scope = ?").get(this.scope));
  }

  private parseCheckpoint(row: Record<string, unknown> | undefined) {
    if (!row) return undefined;
    const checkpoint = { number: BigInt(String(row.height)), hash: row.hash as Hash };
    requireCheckpoint(checkpoint);
    return checkpoint;
  }

  private assertCheckpoint(expected: LaunchCheckpoint | undefined) {
    if (!sameCheckpoint(this.checkpoint(), expected)) {
      throw new Error("Launch index checkpoint changed during synchronization");
    }
  }

  private recordHeight(record: NewLaunchRecord): bigint {
    const { chainId, firstBlock, factory, manager, hook, guarded } = this.identity;
    const height = blockHeight(record.blockNumber);
    const { poolKey } = record;
    if (record.chainId !== chainId || height < firstBlock || record.factory?.toLowerCase() !== factory
      || record.poolManager?.toLowerCase() !== manager || record.engineVersion !== (guarded ? 2 : undefined)
      || !isAddress(record.token, { strict: false }) || record.token === zeroAddress
      || !isAddress(record.creator, { strict: false }) || record.creator === zeroAddress
      || poolKey?.hooks.toLowerCase() !== hook || poolKey.currency0.toLowerCase() !== zeroAddress
      || poolKey.currency1.toLowerCase() !== record.token.toLowerCase() || poolKey.fee !== 3000 || poolKey.tickSpacing !== 60
      || !isHash(record.poolId) || launchPoolId(poolKey).toLowerCase() !== record.poolId.toLowerCase()
      || !isHash(record.blockHash) || !isHash(record.transactionHash) || !isHash(record.intentId)
      || !Number.isSafeInteger(record.logIndex) || record.logIndex < 0 || record.logIndex >= 2 ** 31) {
      throw new Error("Launch record does not match its deployment or full event identity");
    }
    return height;
  }

  private decodeRow(row: Record<string, unknown>): NewLaunchRecord {
    if (typeof row.record !== "string" || Buffer.byteLength(row.record) > maximumRecordBytes) {
      throw new Error("Launch record exceeds its storage limit");
    }
    const record = JSON.parse(row.record) as NewLaunchRecord;
    if (this.recordHeight(record) !== BigInt(String(row.height)) || record.token.toLowerCase() !== row.token
      || record.creator.toLowerCase() !== row.creator || record.blockHash.toLowerCase() !== row.block_hash
      || record.transactionHash.toLowerCase() !== row.tx_hash || record.logIndex !== row.log_index
      || record.indexing !== (row.indexed === 1 ? "indexed" : "pending")) {
      throw new Error("Stored launch record does not match its event identity");
    }
    return record;
  }

  private write(record: NewLaunchRecord, indexed: boolean, now: number): NewLaunchRecord {
    const height = this.recordHeight(record);
    const existing = this.db.prepare("SELECT * FROM rmt_new_launch_records WHERE scope = ? AND token = ?")
      .get(this.scope, record.token.toLowerCase());
    if (existing) {
      const prior = this.decodeRow(existing);
      const sameEvent = prior.blockHash.toLowerCase() === record.blockHash.toLowerCase()
        && prior.transactionHash.toLowerCase() === record.transactionHash.toLowerCase() && prior.logIndex === record.logIndex;
      if (sameEvent) {
        const payload = (launch: NewLaunchRecord) => ({ ...launch, indexing: undefined, blockTimestamp: undefined });
        if (!isDeepStrictEqual(payload(prior), payload(record))
          || (prior.blockTimestamp && record.blockTimestamp && prior.blockTimestamp !== record.blockTimestamp)) {
          throw new Error("Launch record has conflicting payloads for the same event");
        }
        if (prior.indexing === "indexed" || !indexed) return prior;
        if (!record.blockTimestamp && prior.blockTimestamp) record = { ...record, blockTimestamp: prior.blockTimestamp };
      } else if (prior.indexing === "indexed") {
        throw new Error("Launch receipt conflicts with an indexed record pending canonical reconciliation");
      }
    }
    const saved: NewLaunchRecord = { ...record, indexing: indexed ? "indexed" : "pending" };
    const payload = JSON.stringify(saved);
    if (Buffer.byteLength(payload) > maximumRecordBytes) throw new Error("Launch record exceeds its storage limit");
    this.db.prepare(`INSERT INTO rmt_new_launch_records
      (scope, token, creator, height, block_hash, tx_hash, log_index, indexed, published_ms, record)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, token) DO UPDATE SET
        creator=excluded.creator, height=excluded.height, block_hash=excluded.block_hash, tx_hash=excluded.tx_hash,
        log_index=excluded.log_index, indexed=excluded.indexed, published_ms=excluded.published_ms, record=excluded.record
      WHERE rmt_new_launch_records.indexed = 0`)
      .run(this.scope, record.token.toLowerCase(), record.creator.toLowerCase(), height,
        record.blockHash.toLowerCase(), record.transactionHash.toLowerCase(), record.logIndex, Number(indexed), now,
        payload);
    return saved;
  }

  private pruneProvisional(now: number) {
    this.db.prepare("DELETE FROM rmt_new_launch_records WHERE scope = ? AND indexed = 0 AND published_ms < ?")
      .run(this.scope, now - provisionalWindowMs);
  }

  publish(record: NewLaunchRecord, now = Date.now()): NewLaunchRecord {
    return this.transaction(() => {
      this.pruneProvisional(now);
      const prior = this.read({ token: record.token }, now)[0];
      const checkpoint = this.checkpoint();
      if (!prior && checkpoint && this.recordHeight(record) <= checkpoint.number) {
        throw new Error("Launch receipt is missing from the covered index range pending canonical reconciliation");
      }
      if (!prior && this.provisional(now).length >= maximumPending) throw new Error("Launch provisional receipt limit reached");
      return this.write(record, false, now);
    });
  }

  advance(expected: LaunchCheckpoint | undefined, next: LaunchCheckpoint, records: NewLaunchRecord[]) {
    this.transaction(() => {
      this.assertCheckpoint(expected);
      this.writeRange(expected, next, records, Date.now());
    });
  }

  private writeRange(keep: LaunchCheckpoint | undefined, next: LaunchCheckpoint, records: NewLaunchRecord[], now: number) {
    const start = keep ? keep.number + 1n : this.identity.firstBlock;
    requireCheckpoint(next);
    if (next.number < start || next.number - start >= 256n || records.length > 128) {
      throw new Error("Invalid launch index checkpoint range");
    }
    for (const record of records) {
      const height = this.recordHeight(record);
      if (height < start || height > next.number
        || (height === next.number && record.blockHash.toLowerCase() !== next.hash.toLowerCase())) {
        throw new Error("Launch record lies outside the verified index range");
      }
      this.write(record, true, now);
    }
    // A verified receipt may have been published while RPC observations were in flight.
    // Leave it available and retry the range before advancing past unexplained evidence.
    if (this.db.prepare("SELECT 1 FROM rmt_new_launch_records WHERE scope = ? AND indexed = 0 AND height <= ? LIMIT 1")
      .get(this.scope, next.number)) throw new Error("Index range leaves a provisional launch receipt unexplained");
    this.db.prepare("INSERT INTO rmt_new_launch_checkpoints (scope, height, hash) VALUES (?, ?, ?)")
      .run(this.scope, next.number, next.hash.toLowerCase());
    this.db.prepare(`DELETE FROM rmt_new_launch_checkpoints WHERE scope = ? AND height IN
      (SELECT height FROM rmt_new_launch_checkpoints WHERE scope = ? ORDER BY height DESC LIMIT -1 OFFSET ?)`)
      .run(this.scope, this.scope, maximumCheckpoints);
  }

  commitIndex(expected: LaunchCheckpoint | undefined, update: IndexUpdate, now = Date.now()) {
    const { anchor, keep, next, records, orphaned, caughtUp } = update;
    this.transaction(() => {
      this.assertCheckpoint(expected);
      requireCheckpoint(anchor);
      const savedAnchor = this.anchor();
      if (anchor.number !== this.identity.firstBlock - 1n || (savedAnchor && !sameCheckpoint(savedAnchor, anchor))) {
        throw new Error("Launch deployment anchor changed during synchronization");
      }
      if (keep && (!expected || keep.number > expected.number || !sameCheckpoint(this.checkpoint(keep.number + 1n), keep))) {
        throw new Error("Launch index rewind checkpoint is unavailable");
      }
      const hasSettlementProofs = this.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='rmt_launch_native_settlement_proofs'").get();
      if (expected && !sameCheckpoint(keep, expected)) {
        const firstOrphan = (keep?.number ?? anchor.number) + 1n;
        this.db.prepare("DELETE FROM rmt_new_launch_records WHERE scope = ? AND indexed = 1 AND height >= ?").run(this.scope, firstOrphan);
        this.db.prepare("DELETE FROM rmt_new_launch_checkpoints WHERE scope = ? AND height >= ?").run(this.scope, firstOrphan);
        if (hasSettlementProofs) {
          this.db.prepare("DELETE FROM rmt_launch_native_settlement_proofs WHERE scope = ? AND height >= ?").run(this.scope, firstOrphan);
        }
      }
      if (hasSettlementProofs) this.db.prepare("DELETE FROM rmt_launch_native_settlement_proofs WHERE scope = ? AND expires_ms <= ?")
        .run(this.scope, now);
      for (const record of orphaned) this.removeProvisional(record);
      this.pruneProvisional(now);
      if (!savedAnchor) this.db.prepare("INSERT INTO rmt_new_launch_anchors (scope, height, hash) VALUES (?, ?, ?)")
        .run(this.scope, anchor.number, anchor.hash.toLowerCase());
      if (next) this.writeRange(keep, next, records, now);
      this.markHealth(caughtUp, now);
    });
  }

  markDelayed(expected: LaunchCheckpoint | undefined) {
    this.transaction(() => {
      if (sameCheckpoint(this.checkpoint(), expected)) this.markHealth(false);
    });
  }

  read(filter: LaunchFilter = {}, now = Date.now()): NewLaunchRecord[] {
    const token = filter.token?.toLowerCase() ?? null;
    const creator = filter.creator?.toLowerCase() ?? null;
    return this.db.prepare(`SELECT * FROM rmt_new_launch_records WHERE scope = ?
      AND (? IS NULL OR token = ?) AND (? IS NULL OR creator = ?)
      AND (indexed = 1 OR published_ms >= ?)
      ORDER BY height DESC, log_index DESC LIMIT 50`)
      .all(this.scope, token, token, creator, creator, now - provisionalWindowMs)
      .map((row) => this.decodeRow(row));
  }

  provisional(now = Date.now()): Provisional[] {
    return this.db.prepare(`SELECT token, height, block_hash FROM rmt_new_launch_records
      WHERE scope = ? AND indexed = 0 AND published_ms >= ? ORDER BY height DESC LIMIT ?`)
      .all(this.scope, now - provisionalWindowMs, maximumPending).map((row) => ({
        token: row.token as Address, blockNumber: BigInt(String(row.height)), blockHash: row.block_hash as Hash,
      }));
  }

  readPage(limit: number, before?: LaunchPageCursor, now = Date.now()): NewLaunchRecord[] {
    return this.db.prepare(`SELECT * FROM rmt_new_launch_records WHERE scope = ?
      AND (height < ? OR (height = ? AND log_index < ?)) AND (indexed = 1 OR published_ms >= ?)
      ORDER BY height DESC, log_index DESC LIMIT ?`)
      .all(this.scope, before?.blockNumber ?? maximumBlock, before?.blockNumber ?? 0n,
        before?.logIndex ?? 0, now - provisionalWindowMs, limit)
      .map((row) => this.decodeRow(row));
  }

  consumePublicQuota(category: string, categoryLimit: number, now = Date.now()): number {
    const window = Math.floor(now / 60_000);
    const retryAfter = 60 - Math.floor((now % 60_000) / 1000);
    return this.transaction(() => {
      const read = this.db.prepare("SELECT count FROM rmt_new_launch_quota WHERE scope = ? AND category = ? AND window = ?");
      const count = (name: string) => Number(read.get(this.scope, name, window)?.count ?? 0);
      const globalCount = count("all");
      const categoryCount = count(category);
      if (globalCount >= 120 || categoryCount >= categoryLimit) return retryAfter;
      const write = this.db.prepare(`INSERT INTO rmt_new_launch_quota (scope, category, window, count) VALUES (?, ?, ?, ?)
        ON CONFLICT(scope, category) DO UPDATE SET window=excluded.window, count=excluded.count`);
      write.run(this.scope, "all", window, globalCount + 1);
      write.run(this.scope, category, window, categoryCount + 1);
      return 0;
    });
  }

  private removeProvisional(record: Provisional) {
    this.db.prepare(`DELETE FROM rmt_new_launch_records WHERE scope = ? AND indexed = 0
      AND token = ? AND height = ? AND block_hash = ?`)
      .run(this.scope, record.token, record.blockNumber, record.blockHash);
  }

  markHealth(caughtUp: boolean, now = Date.now()) {
    this.db.prepare(`INSERT INTO rmt_new_launch_health (scope, caught_up, updated_ms) VALUES (?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET caught_up=excluded.caught_up, updated_ms=excluded.updated_ms`)
      .run(this.scope, Number(caughtUp), now);
  }

  status(now = Date.now()): "ready" | "delayed" {
    const row = this.db.prepare("SELECT caught_up, updated_ms FROM rmt_new_launch_health WHERE scope = ?").get(this.scope);
    const age = now - Number(row?.updated_ms);
    return row?.caught_up === 1 && age >= 0 && age <= 30_000 ? "ready" : "delayed";
  }
}
