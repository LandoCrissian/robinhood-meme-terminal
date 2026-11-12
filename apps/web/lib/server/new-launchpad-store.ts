import { DatabaseSync } from "node:sqlite";
import type { Address, Hash } from "viem";
import type { NewLaunchRecord } from "../launchpad/launch-record";

export type LaunchCheckpoint = { number: bigint; hash: Hash };
type LaunchFilter = { token?: Address; creator?: Address };
type Provisional = { token: Address; blockNumber: bigint; blockHash: Hash };

// Provisional receipts remain visible while the worker catches up. A fresh receipt can
// be submitted again if the worker was unavailable for the entire provisional window.
const provisionalWindowMs = 30 * 60_000;

export class LaunchpadStore {
  private readonly db: DatabaseSync;

  constructor(path: string, private readonly scope: string) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(`
        PRAGMA busy_timeout = 2500;
        PRAGMA journal_mode = WAL;
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
        CREATE TABLE IF NOT EXISTS rmt_new_launch_health (
          scope TEXT PRIMARY KEY,
          caught_up INTEGER NOT NULL CHECK (caught_up IN (0, 1)),
          updated_ms INTEGER NOT NULL
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
      WHERE scope = ? AND height < ? ORDER BY height DESC LIMIT 1`).get(this.scope, before ?? 9_000_000_000_000_000n);
    return row ? { number: BigInt(String(row.height)), hash: row.hash as Hash } : undefined;
  }

  private assertCheckpoint(expected: LaunchCheckpoint | undefined) {
    const current = this.checkpoint();
    if (current?.number !== expected?.number || current?.hash !== expected?.hash) {
      throw new Error("Launch index checkpoint changed during synchronization");
    }
  }

  private write(record: NewLaunchRecord, indexed: boolean, now: number) {
    this.db.prepare(`INSERT INTO rmt_new_launch_records
      (scope, token, creator, height, block_hash, tx_hash, log_index, indexed, published_ms, record)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, token) DO UPDATE SET
        creator=excluded.creator, height=excluded.height, block_hash=excluded.block_hash, tx_hash=excluded.tx_hash,
        log_index=excluded.log_index, indexed=excluded.indexed, published_ms=excluded.published_ms, record=excluded.record
      WHERE rmt_new_launch_records.indexed = 0`)
      .run(this.scope, record.token.toLowerCase(), record.creator.toLowerCase(), BigInt(record.blockNumber),
        record.blockHash.toLowerCase(), record.transactionHash.toLowerCase(), record.logIndex, Number(indexed), now,
        JSON.stringify({ ...record, indexing: indexed ? "indexed" : "pending" }));
  }

  publish(record: NewLaunchRecord, now = Date.now()): NewLaunchRecord {
    return this.transaction(() => {
      const indexed = this.read({ token: record.token }, now)[0];
      if (indexed?.indexing === "indexed") {
        if (indexed.transactionHash.toLowerCase() !== record.transactionHash.toLowerCase()
          || indexed.blockHash.toLowerCase() !== record.blockHash.toLowerCase()) {
          throw new Error("Launch receipt conflicts with an indexed record pending canonical reconciliation");
        }
        return indexed;
      }
      this.write(record, false, now);
      return record;
    });
  }

  advance(expected: LaunchCheckpoint | undefined, next: LaunchCheckpoint, records: NewLaunchRecord[]) {
    this.transaction(() => {
      this.assertCheckpoint(expected);
      for (const record of records) this.write(record, true, Date.now());
      this.db.prepare("DELETE FROM rmt_new_launch_records WHERE scope = ? AND indexed = 0 AND height <= ?")
        .run(this.scope, next.number);
      this.db.prepare("INSERT INTO rmt_new_launch_checkpoints (scope, height, hash) VALUES (?, ?, ?)")
        .run(this.scope, next.number, next.hash);
    });
  }

  rewind(expected: LaunchCheckpoint, keep: LaunchCheckpoint | undefined, startBlock: bigint) {
    const firstOrphan = (keep?.number ?? (startBlock - 1n)) + 1n;
    this.transaction(() => {
      this.assertCheckpoint(expected);
      this.db.prepare("DELETE FROM rmt_new_launch_records WHERE scope = ? AND height >= ?").run(this.scope, firstOrphan);
      this.db.prepare("DELETE FROM rmt_new_launch_checkpoints WHERE scope = ? AND height >= ?").run(this.scope, firstOrphan);
    });
  }

  read(filter: LaunchFilter = {}, now = Date.now()): NewLaunchRecord[] {
    const token = filter.token?.toLowerCase() ?? null;
    const creator = filter.creator?.toLowerCase() ?? null;
    return this.db.prepare(`SELECT record FROM rmt_new_launch_records WHERE scope = ?
      AND (? IS NULL OR token = ?) AND (? IS NULL OR creator = ?)
      AND (indexed = 1 OR published_ms >= ?)
      ORDER BY height DESC, log_index DESC LIMIT 50`)
      .all(this.scope, token, token, creator, creator, now - provisionalWindowMs)
      .map((row) => JSON.parse(String(row.record)) as NewLaunchRecord);
  }

  provisional(now = Date.now()): Provisional[] {
    return this.db.prepare(`SELECT token, height, block_hash FROM rmt_new_launch_records
      WHERE scope = ? AND indexed = 0 AND published_ms >= ? ORDER BY height DESC LIMIT 25`)
      .all(this.scope, now - provisionalWindowMs).map((row) => ({
        token: row.token as Address, blockNumber: BigInt(String(row.height)), blockHash: row.block_hash as Hash,
      }));
  }

  removeProvisional(record: Provisional) {
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
    return row?.caught_up === 1 && now - Number(row.updated_ms) <= 30_000 ? "ready" : "delayed";
  }
}
