import { DatabaseSync } from "node:sqlite";
import { isHash, type Hash } from "viem";
import { isNativeSettlementProof, type NativeSettlementProof } from "../launchpad/native-settlement";
import { launchpadScopeIdentity } from "./new-launchpad-store";

export const nativeSettlementRetentionMs = 7 * 24 * 60 * 60_000;
const maxScopeRows = 10_000;
const maxProofBytes = 2_048;

type ProofLookup = { transactionHash: Hash; logIndex: number; blockHash: Hash; blockNumber: bigint };

function compact(proof: NativeSettlementProof): string {
  const { chainId, poolManager, factory, poolId, poolKey, blockHash, blockNumber, transactionHash, receiptHash, logIndex,
    account, router, calldataHash, amountAtomic, mode, sources, evidenceHash, observedAtMs } = proof;
  const { currency0, currency1, fee, tickSpacing, hooks } = poolKey;
  return JSON.stringify({ chainId, poolManager, factory, poolId, poolKey: { currency0, currency1, fee, tickSpacing, hooks },
    blockHash, blockNumber, transactionHash, receiptHash, logIndex, account, router, calldataHash, amountAtomic, mode, sources,
    evidenceHash, observedAtMs });
}

/** Review-only compact proof cache. The caller must still recheck canonicality before use. */
export class LaunchpadSettlementStore {
  private readonly db: DatabaseSync;
  private readonly identity: ReturnType<typeof launchpadScopeIdentity>;

  constructor(path: string, private readonly scope: string) {
    this.identity = launchpadScopeIdentity(scope);
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(`
        PRAGMA busy_timeout = 2500;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS rmt_launch_native_settlement_proofs (
          scope TEXT NOT NULL,
          height INTEGER NOT NULL,
          block_hash TEXT NOT NULL,
          tx_hash TEXT NOT NULL,
          log_index INTEGER NOT NULL,
          expires_ms INTEGER NOT NULL,
          proof TEXT NOT NULL,
          PRIMARY KEY (scope, tx_hash, log_index),
          UNIQUE (scope, height, log_index)
        );
        CREATE INDEX IF NOT EXISTS rmt_launch_native_settlement_expiry ON rmt_launch_native_settlement_proofs
          (scope, expires_ms, tx_hash, log_index);
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close() { this.db.close(); }

  private validate(proof: NativeSettlementProof) {
    const { chainId, firstBlock, factory, manager, hook } = this.identity;
    return isNativeSettlementProof(proof) && proof.chainId === chainId && BigInt(proof.blockNumber) >= firstBlock
      && proof.factory.toLowerCase() === factory && proof.poolManager.toLowerCase() === manager
      && proof.poolKey.hooks.toLowerCase() === hook;
  }

  private conflictsWithIndex({ blockNumber, blockHash }: ProofLookup) {
    const hasTable = (table: string) => this.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name = ?").get(table);
    const checkpoint = hasTable("rmt_new_launch_checkpoints") && this.db.prepare(`SELECT hash FROM rmt_new_launch_checkpoints
      WHERE scope = ? AND height = ? AND hash <> ? COLLATE NOCASE LIMIT 1`).get(this.scope, blockNumber, blockHash);
    const launch = hasTable("rmt_new_launch_records") && this.db.prepare(`SELECT block_hash FROM rmt_new_launch_records
      WHERE scope = ? AND height = ? AND indexed = 1 AND block_hash <> ? COLLATE NOCASE LIMIT 1`).get(this.scope, blockNumber, blockHash);
    return !!(checkpoint || launch);
  }

  save(proof: NativeSettlementProof, now = Date.now()): void {
    if (!this.validate(proof) || !Number.isSafeInteger(now) || proof.observedAtMs > now) {
      throw new Error("Settlement proof does not match its deployment scope or observation time");
    }
    const expires = proof.observedAtMs + nativeSettlementRetentionMs;
    const payload = compact(proof);
    if (!Number.isSafeInteger(expires) || expires <= now || Buffer.byteLength(payload) > maxProofBytes) {
      throw new Error("Settlement proof exceeds retention limits");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.prune(now);
      const lookup = { blockNumber: BigInt(proof.blockNumber), blockHash: proof.blockHash,
        transactionHash: proof.transactionHash, logIndex: proof.logIndex };
      if (this.conflictsWithIndex(lookup)) throw new Error("Settlement proof disagrees with the canonical index");
      const prior = this.read(lookup, now);
      if (prior && prior.evidenceHash !== proof.evidenceHash) throw new Error("Conflicting settlement evidence");
      if (!prior) {
        this.db.prepare(`INSERT INTO rmt_launch_native_settlement_proofs
          (scope, height, block_hash, tx_hash, log_index, expires_ms, proof) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(this.scope, BigInt(proof.blockNumber), proof.blockHash.toLowerCase(), proof.transactionHash.toLowerCase(),
            proof.logIndex, expires, payload);
      }
      this.db.prepare(`DELETE FROM rmt_launch_native_settlement_proofs WHERE scope = ? AND rowid IN (
        SELECT rowid FROM rmt_launch_native_settlement_proofs WHERE scope = ?
        ORDER BY expires_ms DESC, tx_hash DESC, log_index DESC LIMIT -1 OFFSET ?
      )`).run(this.scope, this.scope, maxScopeRows);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Expiry is exclusive. Replaying a proof does not extend the original expiry. */
  read(identity: ProofLookup, now = Date.now()): NativeSettlementProof | undefined {
    const { blockNumber, blockHash, transactionHash, logIndex } = identity;
    if (!isHash(blockHash) || !isHash(transactionHash) || typeof blockNumber !== "bigint"
      || blockNumber < this.identity.firstBlock || blockNumber > BigInt(Number.MAX_SAFE_INTEGER)
      || !Number.isSafeInteger(logIndex) || logIndex < 0 || !Number.isSafeInteger(now) || now < 0) return;
    if (this.conflictsWithIndex(identity)) return;
    const row = this.db.prepare(`SELECT proof, expires_ms FROM rmt_launch_native_settlement_proofs
      WHERE scope = ? AND tx_hash = ? AND log_index = ? AND height = ? AND block_hash = ? AND expires_ms > ?`)
      .get(this.scope, transactionHash.toLowerCase(), logIndex, blockNumber, blockHash.toLowerCase(), now);
    if (!row) return;
    if (typeof row.proof !== "string" || Buffer.byteLength(row.proof) > maxProofBytes) throw new Error("Stored settlement proof exceeds bounds");
    const proof = JSON.parse(row.proof) as NativeSettlementProof;
    if (!this.validate(proof) || proof.observedAtMs > now || proof.blockNumber !== blockNumber.toString()
      || proof.blockHash.toLowerCase() !== blockHash.toLowerCase() || proof.transactionHash.toLowerCase() !== transactionHash.toLowerCase()
      || proof.logIndex !== logIndex || proof.observedAtMs + nativeSettlementRetentionMs !== row.expires_ms) {
      throw new Error("Stored settlement proof does not match its identity");
    }
    return JSON.parse(compact(proof)) as NativeSettlementProof;
  }

  prune(now = Date.now()): void {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid settlement proof retention time");
    this.db.prepare("DELETE FROM rmt_launch_native_settlement_proofs WHERE scope = ? AND expires_ms <= ?").run(this.scope, now);
  }
}
