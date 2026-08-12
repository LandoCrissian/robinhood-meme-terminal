import type { Pool } from "pg";
import { EXTERNAL_ORIGIN_CHAIN_ID } from "./config.js";

export type ExternalAdapterState = {
  adapterId: string;
  sourceId: string;
  sourceName: string;
  evidenceContract: string;
  evidenceRole: string;
  startBlock: string;
  nextBlock: string;
  manifestHash: string;
  schemaVersion: number;
  status: "backfilling" | "ready" | "error";
  lastSyncAt: string | null;
  lastError: string | null;
};

export type StoredExternalOriginClaim = {
  adapterId: string;
  sourceId: string;
  sourceName: string;
  claimKind: "token-created";
  token: string;
  evidenceContract: string;
  evidenceRole: string;
  startBlock: string;
  manifestHash: string;
  schemaVersion: number;
  transactionHash: string;
  logIndex: number;
  transactionIndex: number;
  blockNumber: string;
  blockHash: string;
  creator: string | null;
  market: string | null;
  evidenceHash: string;
  observedAt: string;
};

export interface ExternalOriginStoreLike {
  ping(): Promise<void>;
  adapterStates(adapterIds: readonly string[]): Promise<ExternalAdapterState[]>;
  originClaims(
    tokens: readonly string[],
    adapterIds: readonly string[]
  ): Promise<StoredExternalOriginClaim[]>;
}

function timestamp(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new Error("External-origin timestamp was missing");
}

export class ExternalOriginStore implements ExternalOriginStoreLike {
  constructor(private readonly pool: Pool) {}

  async ping() {
    await this.pool.query("SELECT 1");
  }

  async adapterStates(adapterIds: readonly string[]) {
    if (adapterIds.length === 0) return [];

    const result = await this.pool.query(
      `SELECT
         adapter_id,
         source_id,
         source_name,
         evidence_contract,
         evidence_role,
         start_block::TEXT AS start_block,
         next_block::TEXT AS next_block,
         manifest_hash,
         schema_version,
         status,
         last_sync_at,
         last_error
       FROM external_origin_adapter_state
       WHERE chain_id = $1
         AND adapter_id = ANY($2::text[])
       ORDER BY adapter_id ASC`,
      [EXTERNAL_ORIGIN_CHAIN_ID, adapterIds]
    );

    return result.rows.map((row) => ({
      adapterId: row.adapter_id as string,
      sourceId: row.source_id as string,
      sourceName: row.source_name as string,
      evidenceContract: row.evidence_contract as string,
      evidenceRole: row.evidence_role as string,
      startBlock: row.start_block as string,
      nextBlock: row.next_block as string,
      manifestHash: row.manifest_hash as string,
      schemaVersion: Number(row.schema_version),
      status: row.status as ExternalAdapterState["status"],
      lastSyncAt: row.last_sync_at === null ? null : timestamp(row.last_sync_at),
      lastError: typeof row.last_error === "string" ? row.last_error : null
    }));
  }

  async originClaims(
    tokens: readonly string[],
    adapterIds: readonly string[]
  ) {
    if (tokens.length === 0 || adapterIds.length === 0) return [];

    const result = await this.pool.query(
      `SELECT
         adapter_id,
         source_id,
         source_name,
         claim_kind,
         token,
         evidence_contract,
         evidence_role,
         start_block::TEXT AS start_block,
         manifest_hash,
         schema_version,
         transaction_hash,
         log_index,
         transaction_index,
         block_number::TEXT AS block_number,
         block_hash,
         creator,
         market,
         evidence_hash,
         observed_at
       FROM external_origin_claims
       WHERE chain_id = $1
         AND claim_kind = 'token-created'
         AND token = ANY($2::text[])
         AND adapter_id = ANY($3::text[])
       ORDER BY token ASC, block_number DESC, log_index DESC`,
      [EXTERNAL_ORIGIN_CHAIN_ID, tokens, adapterIds]
    );

    return result.rows.map((row) => ({
      adapterId: row.adapter_id as string,
      sourceId: row.source_id as string,
      sourceName: row.source_name as string,
      claimKind: "token-created" as const,
      token: row.token as string,
      evidenceContract: row.evidence_contract as string,
      evidenceRole: row.evidence_role as string,
      startBlock: row.start_block as string,
      manifestHash: row.manifest_hash as string,
      schemaVersion: Number(row.schema_version),
      transactionHash: row.transaction_hash as string,
      logIndex: Number(row.log_index),
      transactionIndex: Number(row.transaction_index),
      blockNumber: row.block_number as string,
      blockHash: row.block_hash as string,
      creator: typeof row.creator === "string" ? row.creator : null,
      market: typeof row.market === "string" ? row.market : null,
      evidenceHash: row.evidence_hash as string,
      observedAt: timestamp(row.observed_at)
    }));
  }
}
