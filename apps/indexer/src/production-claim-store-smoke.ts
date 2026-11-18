import assert from "node:assert/strict";
import { Client } from "pg";
import type { Address, Hash } from "viem";
import type { CurveProductionConfig } from "./curve-production-config.js";
import type { BlockEvidence } from "./curve-launch-evidence.js";
import { syntheticProductionRegistration } from "./curve-production-smoke.js";
import { commitProductionCurveRange, initializeProductionCurveStore, productionCurveScope, rollbackProductionCurve } from "./curve-production-store.js";
import { productionClaimSchemaSql, initializeProductionClaimStore, commitVerifiedProductionClaims, readProductionClaimEvidence,
  parseProductionClaimActivity, processProductionClaimEvidenceBatch, type ProductionClaimActivity, type ProductionClaimStoreBinding } from "./production-claim-store.js";

const address = (id: number): Address => `0x${((1n << 156n) + BigInt(id)).toString(16).padStart(40, "0")}`;
const hash = (id: number): Hash => `0x${id.toString(16).padStart(64, "0")}`;
const at = (height: number, replacement = false): BlockEvidence => ({ blockNumber: String(height), blockHash: hash(height + (replacement ? 50000 : 0)),
  timestamp: new Date(Date.parse("2026-11-18T12:00:00Z") + height * 1000).toISOString() });

/** Canonical-shaped 4663 persistence test, not blockchain execution evidence.
 * Runs only in the caller's already-verified disposable production smoke DB.
 * This helper closes the supplied writer to prove a genuine lease restart. */
export async function testProductionClaimStorePostgres(writer: Client, connectionString: string, existing: CurveProductionConfig, onWriterClosed: () => void) {
  const url = new URL(connectionString);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/rmt_curve_production_smoke_[a-z0-9_]+$/.test(url.pathname));
  const registration: CurveProductionConfig = { ...existing, binding: { ...existing.binding,
    factory: address(75001), projectRegistry: address(75002), deploymentBlock: 500n, deploymentBlockHash: hash(500) } };
  const binding: ProductionClaimStoreBinding = { profile: "rmt-claim-evidence-v1", registration, manager: address(75003), graduationEngine: address(75004) };
  const scope = productionCurveScope(registration);
  await initializeProductionCurveStore(writer, registration);
  await assert.rejects(initializeProductionClaimStore(writer, binding), /verified backup and explicit installation/);
  await writer.query(productionClaimSchemaSql);
  await initializeProductionClaimStore(writer, binding);
  const birth = { ...syntheticProductionRegistration(), factory: registration.binding.factory, projectRegistry: registration.binding.projectRegistry,
    token: address(75005), revenueLedger: address(75006), creator: address(75007), creation: { ...at(500), transactionHash: hash(75100), logIndex: 1 },
    checkpoint: { ...at(500), confirmations: 20, finality: "l2-confirmed" as const, l1Finality: "unverified" as const } };
  await commitProductionCurveRange(writer, registration, 500n, at(500), [birth]);
  await commitProductionCurveRange(writer, registration, 501n, at(510), []);
  const activity: ProductionClaimActivity = { schemaVersion: 1, chainId: 4663, factory: binding.registration.binding.factory,
    manager: binding.manager, registry: registration.binding.projectRegistry, deploymentBlockHash: hash(500), token: birth.token,
    ledger: birth.revenueLedger, actor: birth.creator, gasPayer: address(75008), beneficiary: birth.creator, operation: "curve-claim",
    transactionHash: hash(75101), blockNumber: "505", blockHash: hash(505), logIndex: 7, nativeWei: "17", tokenWei: "0",
    outerNonce: "11", innerNonce: "7", intentHash: hash(75102), pool: null };
  const record = { activity, receiptCheckpoint: at(505) };
  const reader = new Client({ connectionString, connectionTimeoutMillis: 3000 });
  const unauthorized = new Client({ connectionString, connectionTimeoutMillis: 3000 });
  const reopened = new Client({ connectionString, connectionTimeoutMillis: 3000 });
  try {
    await reader.connect(); await unauthorized.connect();
    await assert.rejects(initializeProductionClaimStore(unauthorized, binding), /database_writer_conflict/);
    await assert.rejects(commitVerifiedProductionClaims(unauthorized, binding, at(510), [record]), /database_writer_conflict/);
    await commitVerifiedProductionClaims(writer, binding, at(510), [record, record]);
    await commitVerifiedProductionClaims(writer, binding, at(510), [record]);
    let verifiedCalls = 0;
    const deferredHash = hash(75888);
    const batch = await processProductionClaimEvidenceBatch(writer, binding, at(510), [activity.transactionHash, activity.transactionHash, deferredHash], async tx => {
      verifiedCalls++;
      return tx === activity.transactionHash ? record : null;
    });
    assert.equal(verifiedCalls, 2); assert.deepEqual(batch, { verified: 1, pending: [deferredHash] });
    await assert.rejects(processProductionClaimEvidenceBatch(writer, binding, at(510), [deferredHash], async () => record), /identity/);
    await assert.rejects(processProductionClaimEvidenceBatch(writer, binding, at(510), Array.from({ length: 17 }, () => deferredHash), async () => null), /identity/);
    await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const rows = await readProductionClaimEvidence(reader, binding, at(510), activity.transactionHash);
    assert.equal(rows.length, 1); assert.equal(rows[0]?.nativeWei, "17");
    assert.notEqual(rows[0]?.actor, rows[0]?.gasPayer); assert.equal(rows[0]?.outerNonce, "11"); assert.equal(rows[0]?.innerNonce, "7");
    await assert.rejects(commitVerifiedProductionClaims(reader, binding, at(510), [record]), /read.only|transaction|writer_conflict/i);
    await reader.query("ROLLBACK");
    for (const changed of [{ ...activity, nativeWei: "18" }, { ...activity, manager: address(88888) },
      { ...activity, ledger: address(88888) }, { ...activity, token: address(88888) },
      { ...activity, operation: "lp-claim" as const, pool: null }]) {
      await assert.rejects(commitVerifiedProductionClaims(writer, binding, at(510), [{ ...record, activity: changed }]), /identity/);
    }
    assert.throws(() => parseProductionClaimActivity({ ...activity, tokenWei: "1" }), /identity/);
    assert.throws(() => parseProductionClaimActivity({ ...activity, extraPrivateData: "never-store" }), /identity/);
    await assert.rejects(commitVerifiedProductionClaims(writer, binding, at(509), [record]), /identity/);
    await assert.rejects(commitVerifiedProductionClaims(writer, binding, at(510), [{ activity: { ...activity, blockNumber: "511", blockHash: hash(511) }, receiptCheckpoint: at(511) }]), /identity/);
    await writer.query("ALTER TABLE rmt_curve_production_claims ADD CONSTRAINT synthetic_claim_interruption CHECK(log_index<>99)");
    const first = { activity: { ...activity, transactionHash: hash(75103), blockNumber: "506", blockHash: hash(506) }, receiptCheckpoint: at(506) };
    const interrupted = { activity: { ...activity, transactionHash: hash(75104), blockNumber: "507", blockHash: hash(507), logIndex: 99 }, receiptCheckpoint: at(507) };
    await assert.rejects(commitVerifiedProductionClaims(writer, binding, at(510), [first, interrupted]), /synthetic_claim_interruption/);
    await writer.query("ALTER TABLE rmt_curve_production_claims DROP CONSTRAINT synthetic_claim_interruption");
    assert.equal((await writer.query("SELECT count(*)::int AS count FROM rmt_curve_production_claims WHERE scope=$1", [scope])).rows[0]?.count, 1);
    assert.equal((await writer.query("SELECT count(*)::int AS count FROM rmt_curve_production_checkpoints WHERE scope=$1 AND block_number IN(506,507)", [scope])).rows[0]?.count, 0);
    await writer.end();
    onWriterClosed();
    await reopened.connect(); await initializeProductionCurveStore(reopened, registration); await initializeProductionClaimStore(reopened, binding);
    assert.deepEqual(await readProductionClaimEvidence(reopened, binding, at(510), activity.transactionHash), rows);
    // Rolling back only the tip retains the still-canonical event checkpoint.
    await rollbackProductionCurve(reopened, scope, 505n);
    assert.equal((await readProductionClaimEvidence(reopened, binding, at(505), activity.transactionHash)).length, 1);
    await rollbackProductionCurve(reopened, scope, 500n);
    assert.equal((await reopened.query("SELECT count(*)::int AS count FROM rmt_curve_production_claims WHERE scope=$1", [scope])).rows[0]?.count, 0);
    await assert.rejects(readProductionClaimEvidence(reopened, binding, at(510), activity.transactionHash), /identity/);
    await commitProductionCurveRange(reopened, registration, 501n, at(510, true), []);
    assert.deepEqual(await readProductionClaimEvidence(reopened, binding, at(510, true), activity.transactionHash), []);
    await assert.rejects(readProductionClaimEvidence(reopened, binding, at(510), activity.transactionHash), /identity/);
    console.info("Production-shaped claim evidence PostgreSQL scope, actor/payer, duplicate/conflict, atomic interruption, lease restart and reorg smoke passed; no chain execution or production DDL claim.");
  } finally {
    await reader.end().catch(() => undefined); await unauthorized.end().catch(() => undefined); await reopened.end().catch(() => undefined);
  }
}
