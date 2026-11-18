import assert from "node:assert/strict";
import { Client } from "pg";
import type { Address, Hash } from "viem";
import type { CurveLaunchRegistration } from "./curve-launch-evidence.js";
import type { CurveProductionConfig } from "./curve-production-config.js";
import { earningsBeneficiaryRoles, encodeEarningsDiscoveryCursor, decodeEarningsDiscoveryCursor,
  type EarningsDiscoveryCursor } from "./creator-earnings.js";
import { commitProductionCurveRange, productionCurveScope, readProductionCurveEarnings, rollbackProductionCurve } from "./curve-production-store.js";

const address = (id: number): Address => `0x${((1n << 156n) + BigInt(id)).toString(16).padStart(40, "0")}`;
const hash = (id: number): Hash => `0x${id.toString(16).padStart(64, "0")}`;

/** Runs only inside the existing expendable production-adapter smoke database.
 * Rows are synthetic canonical-shaped fixture data, not mainnet claim evidence. */
export async function testCreatorEarningsPostgres(writer: Client, connectionString: string,
  config: CurveProductionConfig, original: CurveLaunchRegistration) {
  const scope = productionCurveScope(config);
  const creator = address(700), treasury = address(701), unrelated = address(702);
  const rows: CurveLaunchRegistration[] = Array.from({ length: 53 }, (_, i) => ({ ...original,
    token: address(1_000 + i), initialCurve: address(2_000 + i), revenueLedger: address(3_000 + i), creator,
    treasury, treasuryShareBps: 4500, intentId: hash(4_000 + i), name: `Synthetic earning ${i}`, symbol: `E${i}`,
    creation: { ...original.creation, transactionHash: hash(5_000 + i), logIndex: i * 3 + 4 },
    projectRegistrationLogIndex: i * 3 + 3,
    creationFee: { ...original.creationFee, logIndex: i * 3 + 5 },
  }));
  await commitProductionCurveRange(writer, config, 100n, original.checkpoint, rows);
  await commitProductionCurveRange(writer, config, 100n, original.checkpoint, rows);
  assert.equal((await writer.query("SELECT count(*)::int AS n FROM rmt_curve_production_launches WHERE scope=$1", [scope])).rows[0]?.n, 53,
    "Duplicate event replay never duplicates entitlements");
  const options = { recipient: creator, operatingRecipient: config.binding.creationFeeRecipient,
    reserveRecipient: config.reserveRecipient, limit: 26 };
  const first = await readProductionCurveEarnings(writer, scope, original.checkpoint, options);
  assert.equal(first.launches.length, 26, "A 25-row page uses a bounded lookahead, not a global 25-project cap");
  const cursor: EarningsDiscoveryCursor = { scope, recipient: creator, blockNumber: first.checkpoint.blockNumber,
    blockHash: first.checkpoint.blockHash, after: first.launches[24]!.token };
  const encoded = encodeEarningsDiscoveryCursor(cursor);
  assert.deepEqual(decodeEarningsDiscoveryCursor(encoded), cursor);

  const next = { blockNumber: "101", blockHash: hash(101), timestamp: "2026-11-17T12:00:01.000Z" };
  const later = { ...rows[0]!, token: address(9_000), initialCurve: address(9_001), revenueLedger: address(9_002),
    creation: { ...next, transactionHash: hash(9_003), logIndex: 4 }, checkpoint: { ...original.checkpoint, ...next } };
  await commitProductionCurveRange(writer, config, 101n, next, [later]);
  const restartedReader = new Client({ connectionString, connectionTimeoutMillis: 3_000 });
  try {
    await restartedReader.connect();
    await restartedReader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await restartedReader.query("SET LOCAL statement_timeout='1s'");
    await assert.rejects(restartedReader.query("UPDATE rmt_curve_production_launches SET payload=payload WHERE false"), /read-only/);
    await restartedReader.query("ROLLBACK");
    await restartedReader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    let current = cursor;
    const all = first.launches.slice(0, 25);
    for (;;) {
      const page = await readProductionCurveEarnings(restartedReader, scope, next, { ...options, cursor: current });
      assert.equal(page.checkpoint.blockNumber, "100", "Advancing head does not change a retained cursor's anchor");
      const included = page.launches.slice(0, 25);
      all.push(...included);
      if (page.launches.length <= 25) break;
      current = { ...current, after: included.at(-1)!.token };
    }
    assert.equal(all.length, 53);
    assert.equal(new Set(all.map(row => row.token)).size, 53);
    assert.ok(all.every(row => row.token !== later.token), "Projects after the cursor anchor never leak into a snapshot page");
    assert.deepEqual(all.map(row => row.revenueLedger), rows.map(row => row.revenueLedger),
      "Original per-project ledgers survive database/client restart and later observations; current curve routing is not the ledger lookup");

    for (const [recipient, role] of [[treasury, "treasury"], [config.binding.creationFeeRecipient, "operations"], [config.reserveRecipient, "reserve"]] as const) {
      const page = await readProductionCurveEarnings(restartedReader, scope, next, { ...options, recipient, limit: 51 });
      assert.equal(page.launches.length, 51);
      assert.ok(page.launches.every(row => earningsBeneficiaryRoles(row, recipient, config).includes(role)));
    }
    const missing = await readProductionCurveEarnings(restartedReader, scope, next, { ...options, recipient: unrelated });
    assert.equal(missing.launches.length, 0, "Unrelated EOA, including an unproven Safe owner, inherits no beneficiary relation");
    const exact = await readProductionCurveEarnings(restartedReader, scope, next, { ...options, token: rows[52]!.token, limit: 2 });
    assert.deepEqual(exact.launches.map(row => row.token), [rows[52]!.token]);
    await assert.rejects(readProductionCurveEarnings(restartedReader, scope, next, { ...options, cursor: { ...cursor, recipient: unrelated } }), /beneficiary mismatch/);
    await assert.rejects(readProductionCurveEarnings(restartedReader, scope, next, { ...options, cursor: { ...cursor, scope: "other" } }), /beneficiary mismatch/);
    await assert.rejects(readProductionCurveEarnings(restartedReader, scope, next, { ...options, limit: 52 }), /bound/);
    await restartedReader.query("COMMIT");
  } finally { await restartedReader.end(); }

  await rollbackProductionCurve(writer, scope, 99n);
  await assert.rejects(readProductionCurveEarnings(writer, scope, next, { ...options, cursor }), /checkpoint is unavailable/,
    "A reorg or older restored backup invalidates cursor evidence, rather than advertising zero earnings");
  console.info("Creator earnings PostgreSQL: 53 registrations, recipient roles, stable pagination, exact token, duplicate replay, read-only restart and reorg invalidation passed.");
}
