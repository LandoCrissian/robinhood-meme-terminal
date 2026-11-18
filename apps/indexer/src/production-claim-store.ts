import { encodeAbiParameters, keccak256, zeroAddress, type Address, type Hash } from "viem";
import type { Client } from "pg";
import { assertIndexWriterLease } from "./index-store.js";
import type { BlockEvidence } from "./curve-launch-evidence.js";
import type { CurveProductionConfig } from "./curve-production-config.js";
import { productionCurveScope } from "./curve-production-store.js";

type Database = Pick<Client, "query">;
type Operation = "curve-claim" | "lp-collect" | "lp-claim" | "lp-claim-native" | "lp-claim-token" | "creation-fees";
export type ProductionClaimActivity = {
  schemaVersion: 1; chainId: 4663; factory: Address; manager: Address; registry: Address; deploymentBlockHash: Hash;
  token: Address | null; ledger: Address; actor: Address; gasPayer: Address; beneficiary: Address; operation: Operation;
  transactionHash: Hash; blockNumber: string; blockHash: Hash; logIndex: number; nativeWei: string; tokenWei: string;
  outerNonce: string; innerNonce: string; intentHash: Hash;
  pool: null | { positionTokenId: string; principalLiquidityWei: string; poolId: Hash; custodian: Address;
    poolKey: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address } };
};
export type ProductionClaimStoreBinding = { profile: "rmt-claim-evidence-v1"; registration: CurveProductionConfig; manager: Address; graduationEngine: Address };
const ops: Operation[] = ["curve-claim", "lp-collect", "lp-claim", "lp-claim-native", "lp-claim-token", "creation-fees"];
const addr = (v: unknown): v is Address => typeof v === "string" && /^0x[0-9a-f]{40}$/i.test(v) && BigInt(v) > 0xffffn;
const hash = (v: unknown): v is Hash => typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v) && BigInt(v) > 0n;
const uint = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const encoded = (v: unknown) => JSON.stringify(v, (_, item) => typeof item === "bigint" ? item.toString() : item);
const lower = <T extends string>(v: T) => v.toLowerCase() as T;
function requireClaim(ok: unknown): asserts ok { if (!ok) throw Error("Production claim evidence identity unavailable or conflicting"); }

/** Explicit installation proposal only. Runtime initialization never performs
 * DDL. Existing registration rollback cascades orphaned claims automatically.
 * A receipt checkpoint anchors the event's actual block, not a later tip. */
export const productionClaimSchemaSql = `
  CREATE TABLE IF NOT EXISTS rmt_curve_production_claim_bindings (
    scope TEXT PRIMARY KEY REFERENCES rmt_curve_production_bindings(scope), identity JSONB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rmt_curve_production_claims (
    scope TEXT NOT NULL REFERENCES rmt_curve_production_claim_bindings(scope),
    token TEXT, ledger TEXT NOT NULL, actor TEXT NOT NULL, gas_payer TEXT NOT NULL, beneficiary TEXT NOT NULL,
    transaction_hash TEXT NOT NULL, log_index INTEGER NOT NULL CHECK(log_index >= 0),
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, payload JSONB NOT NULL,
    PRIMARY KEY(scope,transaction_hash,log_index),
    FOREIGN KEY(scope,token) REFERENCES rmt_curve_production_launches(scope,token) ON DELETE CASCADE,
    FOREIGN KEY(scope,block_number) REFERENCES rmt_curve_production_checkpoints(scope,block_number) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS rmt_curve_production_claims_recipient ON rmt_curve_production_claims(scope,beneficiary,block_number);
`;

export function parseProductionClaimActivity(raw: unknown): ProductionClaimActivity {
  requireClaim(raw && typeof raw === "object" && !Array.isArray(raw) && encoded(raw).length <= 12_000);
  const r = raw as ProductionClaimActivity;
  requireClaim(Object.keys(r).length === 22 && r.schemaVersion === 1 && r.chainId === 4663 && ops.includes(r.operation)
    && [r.factory, r.manager, r.registry, r.ledger, r.actor, r.gasPayer, r.beneficiary].every(addr)
    && [r.deploymentBlockHash, r.transactionHash, r.blockHash, r.intentHash].every(hash)
    && /^[1-9][0-9]{0,15}$/.test(r.blockNumber) && Number.isSafeInteger(r.logIndex) && r.logIndex >= 0 && r.logIndex < 2 ** 31
    && [r.nativeWei, r.tokenWei, r.outerNonce, r.innerNonce].every(uint)
    && BigInt(r.outerNonce) <= BigInt(Number.MAX_SAFE_INTEGER) && BigInt(r.innerNonce) <= BigInt(Number.MAX_SAFE_INTEGER)
    && (r.nativeWei !== "0" || r.tokenWei !== "0")
    && (r.operation === "creation-fees" ? r.token === null && same(r.ledger, r.factory) : addr(r.token))
    && (!["curve-claim", "creation-fees", "lp-claim-native"].includes(r.operation) || r.tokenWei === "0")
    && (r.operation !== "lp-claim-token" || r.nativeWei === "0"));
  let pool: ProductionClaimActivity["pool"] = null;
  if (r.operation.startsWith("lp-")) {
    const p = r.pool, key = p?.poolKey;
    requireClaim(p && Object.keys(p).length === 5 && key && Object.keys(key).length === 5
      && uint(p.positionTokenId) && p.positionTokenId !== "0" && uint(p.principalLiquidityWei) && p.principalLiquidityWei !== "0"
      && hash(p.poolId) && addr(p.custodian) && key.currency0 === zeroAddress && addr(key.currency1)
      && same(key.currency1, r.token!) && key.fee === 3000 && key.tickSpacing === 60 && addr(key.hooks));
    const computed = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
    requireClaim(same(computed, p.poolId));
    pool = { ...p, poolId: lower(p.poolId), custodian: lower(p.custodian), poolKey: { ...key, currency1: lower(key.currency1), hooks: lower(key.hooks) } };
  } else requireClaim(r.pool === null);
  return { ...r, factory: lower(r.factory), manager: lower(r.manager), registry: lower(r.registry), ledger: lower(r.ledger), actor: lower(r.actor),
    gasPayer: lower(r.gasPayer), beneficiary: lower(r.beneficiary), deploymentBlockHash: lower(r.deploymentBlockHash), token: r.token && lower(r.token),
    transactionHash: lower(r.transactionHash), blockHash: lower(r.blockHash), intentHash: lower(r.intentHash), pool };
}

function identity(binding: ProductionClaimStoreBinding) {
  requireClaim(binding.profile === "rmt-claim-evidence-v1" && binding.registration.binding.chainId === 4663
    && addr(binding.manager) && addr(binding.graduationEngine));
  return encoded({ profile: binding.profile, scope: productionCurveScope(binding.registration), manager: lower(binding.manager), engine: lower(binding.graduationEngine) });
}
export async function initializeProductionClaimStore(db: Database, binding: ProductionClaimStoreBinding) {
  const present = await db.query<{ present: boolean }>(`SELECT to_regclass('public.rmt_curve_production_claim_bindings') IS NOT NULL
    AND to_regclass('public.rmt_curve_production_claims') IS NOT NULL AS present`);
  if (present.rows[0]?.present !== true) throw Error("Production claims schema requires verified backup and explicit installation approval");
  await assertIndexWriterLease(db, binding.registration.binding.chainId);
  const scope = productionCurveScope(binding.registration), expected = identity(binding);
  await db.query("INSERT INTO rmt_curve_production_claim_bindings(scope,identity) VALUES($1,$2) ON CONFLICT(scope) DO NOTHING", [scope, expected]);
  const state = await db.query<{ matches: boolean }>("SELECT identity=$2::jsonb AS matches FROM rmt_curve_production_claim_bindings WHERE scope=$1", [scope, expected]);
  requireClaim(state.rows[0]?.matches);
}

function scoped(binding: ProductionClaimStoreBinding, row: ProductionClaimActivity) {
  const b = binding.registration.binding;
  requireClaim(same(row.factory, b.factory) && same(row.registry, b.projectRegistry) && same(row.deploymentBlockHash, b.deploymentBlockHash)
    && same(row.manager, binding.manager) && BigInt(row.blockNumber) >= b.deploymentBlock
    && (!row.pool || same(row.pool.custodian, binding.graduationEngine)));
}

/** Serial append on the existing authoritative writer after canonical range
 * ingestion. Inputs must come from receipt/trace verification; no event-only
 * path or public endpoint invokes this function. Crash rollback is atomic. */
export async function commitVerifiedProductionClaims(db: Database, binding: ProductionClaimStoreBinding, checkpoint: BlockEvidence,
  records: { activity: ProductionClaimActivity; receiptCheckpoint: BlockEvidence }[]) {
  requireClaim(Array.isArray(records) && records.length <= 128);
  const scope = productionCurveScope(binding.registration);
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL statement_timeout='5s'"); await db.query("SET LOCAL lock_timeout='2s'");
    await assertIndexWriterLease(db, 4663);
    const current = await db.query<{ matches: boolean }>(`SELECT b.next_block-1=$2::bigint AND c.block_hash=$3 AND k.identity=$4::jsonb AS matches
      FROM rmt_curve_production_bindings b JOIN rmt_curve_production_checkpoints c ON c.scope=b.scope AND c.block_number=b.next_block-1
      JOIN rmt_curve_production_claim_bindings k ON k.scope=b.scope WHERE b.scope=$1 FOR UPDATE OF b`,
    [scope, checkpoint.blockNumber, checkpoint.blockHash, identity(binding)]);
    requireClaim(current.rows[0]?.matches);
    for (const record of records) {
      const row = parseProductionClaimActivity(record.activity), at = record.receiptCheckpoint;
      scoped(binding, row);
      requireClaim(at.blockNumber === row.blockNumber && same(at.blockHash, row.blockHash) && Number.isFinite(Date.parse(at.timestamp))
        && BigInt(row.blockNumber) <= BigInt(checkpoint.blockNumber));
      await db.query(`INSERT INTO rmt_curve_production_checkpoints(scope,block_number,block_hash,observed_at)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [scope, row.blockNumber, row.blockHash, at.timestamp]);
      const actual = await db.query<{ matches: boolean }>(`SELECT block_hash=$3 AND observed_at=$4::timestamptz AS matches
        FROM rmt_curve_production_checkpoints WHERE scope=$1 AND block_number=$2`, [scope, row.blockNumber, row.blockHash, at.timestamp]);
      requireClaim(actual.rows[0]?.matches);
      if (row.token) {
        const birth = await db.query<{ ledger: string }>("SELECT payload->>'revenueLedger' AS ledger FROM rmt_curve_production_launches WHERE scope=$1 AND token=$2", [scope, row.token]);
        requireClaim(birth.rows[0] && (row.operation !== "curve-claim" || same(birth.rows[0].ledger, row.ledger)));
      }
      if (row.operation === "creation-fees") requireClaim(same(row.beneficiary, binding.registration.binding.creationFeeRecipient));
      if (row.operation === "lp-collect") requireClaim(same(row.beneficiary, row.ledger));
      else if (row.operation !== "creation-fees") requireClaim(same(row.actor, row.beneficiary));
      const payload = encoded(row);
      await db.query(`INSERT INTO rmt_curve_production_claims(scope,token,ledger,actor,gas_payer,beneficiary,transaction_hash,log_index,block_number,block_hash,payload)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      [scope, row.token, row.ledger, row.actor, row.gasPayer, row.beneficiary, row.transactionHash, row.logIndex, row.blockNumber, row.blockHash, payload]);
      const exact = await db.query<{ matches: boolean }>(`SELECT payload=$4::jsonb AS matches FROM rmt_curve_production_claims
        WHERE scope=$1 AND transaction_hash=$2 AND log_index=$3`, [scope, row.transactionHash, row.logIndex, payload]);
      requireClaim(exact.rows[0]?.matches);
    }
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; }
}

/** Hook for the existing leased worker, not another scheduler or writer. The
 * adapter must run the canonical receipt/trace verifier and return null when
 * evidence is incomplete. Any thrown conflict aborts this batch before writes.
 * The registration cursor alone is never evidence of a successful claim. */
export async function processProductionClaimEvidenceBatch(db: Database, binding: ProductionClaimStoreBinding, checkpoint: BlockEvidence,
  transactionHashes: Hash[], verify: (transactionHash: Hash, checkpoint: BlockEvidence) => Promise<{
    activity: ProductionClaimActivity; receiptCheckpoint: BlockEvidence;
  } | null>) {
  requireClaim(Array.isArray(transactionHashes) && transactionHashes.length <= 16 && transactionHashes.every(hash));
  const pending: Hash[] = [], records: { activity: ProductionClaimActivity; receiptCheckpoint: BlockEvidence }[] = [];
  for (const transactionHash of [...new Set(transactionHashes.map(lower))]) {
    const evidence = await verify(transactionHash, checkpoint);
    if (!evidence) { pending.push(transactionHash); continue; }
    const activity = parseProductionClaimActivity(evidence.activity);
    requireClaim(same(activity.transactionHash, transactionHash));
    scoped(binding, activity);
    records.push({ activity, receiptCheckpoint: evidence.receiptCheckpoint });
  }
  await commitVerifiedProductionClaims(db, binding, checkpoint, records);
  return { verified: records.length, pending };
}

/** Caller uses the existing read-only transaction and corroborates this
 * checkpoint with chain providers. A restored/stale store never returns a zero. */
export async function readProductionClaimEvidence(db: Database, binding: ProductionClaimStoreBinding, checkpoint: BlockEvidence, transactionHash: Hash) {
  requireClaim(hash(transactionHash)); const scope = productionCurveScope(binding.registration);
  const current = await db.query<{ matches: boolean }>(`SELECT b.next_block-1=$2::bigint AND c.block_hash=$3 AND k.identity=$4::jsonb AS matches
    FROM rmt_curve_production_bindings b JOIN rmt_curve_production_checkpoints c ON c.scope=b.scope AND c.block_number=b.next_block-1
    JOIN rmt_curve_production_claim_bindings k ON k.scope=b.scope WHERE b.scope=$1`, [scope, checkpoint.blockNumber, checkpoint.blockHash, identity(binding)]);
  requireClaim(current.rows[0]?.matches);
  const rows = await db.query<{ payload: ProductionClaimActivity; block_hash: string; block_number: string; log_index: number; transaction_hash: string }>(`SELECT e.payload,e.block_hash,e.block_number::text,e.log_index,e.transaction_hash
    FROM rmt_curve_production_claims e JOIN rmt_curve_production_checkpoints c ON c.scope=e.scope AND c.block_number=e.block_number AND c.block_hash=e.block_hash
    WHERE e.scope=$1 AND e.transaction_hash=$2 AND e.block_number<=$3 ORDER BY e.log_index LIMIT 17`, [scope, lower(transactionHash), checkpoint.blockNumber]);
  requireClaim(rows.rows.length <= 16);
  return rows.rows.map(row => {
    const parsed = parseProductionClaimActivity(row.payload); scoped(binding, parsed);
    requireClaim(parsed.transactionHash === row.transaction_hash && parsed.blockHash === row.block_hash && parsed.blockNumber === row.block_number && parsed.logIndex === row.log_index);
    return parsed;
  });
}
