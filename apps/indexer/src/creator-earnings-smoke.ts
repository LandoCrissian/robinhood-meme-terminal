import assert from "node:assert/strict";
import { creatorEarningsProfile, decodeEarningsDiscoveryCursor, earningsBeneficiaryRoles, encodeEarningsDiscoveryCursor,
  parseEarningsDiscoveryQuery, parseFixtureEarningsDiscoveryQuery } from "./creator-earnings.js";
import { productionCurveScope } from "./curve-production-store.js";
import { syntheticProductionConfig as config, syntheticProductionRegistration } from "./curve-production-smoke.js";

export function testCreatorEarnings() {
  const item = syntheticProductionRegistration();
  const { creator } = item;
  const scope = productionCurveScope(config);
  const cursor = { scope, recipient: creator, blockNumber: item.checkpoint.blockNumber,
    blockHash: item.checkpoint.blockHash, after: item.token };
  const encoded = encodeEarningsDiscoveryCursor(cursor);
  assert.deepEqual(decodeEarningsDiscoveryCursor(encoded), cursor);
  assert.equal(creatorEarningsProfile, "rmt-creator-earnings-v1");
  const query = (search: string) => parseEarningsDiscoveryQuery(new URL("http://private.test/curve-earnings?" + search));
  assert.deepEqual(query(`recipient=${creator}`), { recipient: creator.toLowerCase(), limit: 25 });
  assert.equal(query(`recipient=${creator}&limit=50&after=${encoded}`)?.limit, 50);
  assert.deepEqual(query(`recipient=${creator}&token=${item.token}`), { recipient: creator.toLowerCase(), token: item.token.toLowerCase(), limit: 1 });
  for (const text of ["", `recipient=${creator}&recipient=${creator}`, `recipient=${creator}&limit=51`,
    `recipient=${creator}&offset=0`, `recipient=${creator}&after=invalid`, `recipient=${creator}&limit=0`,
    `recipient=${creator}&token=${item.token}&limit=2`, `recipient=${creator}&token=${item.token}&after=${encoded}`,
    "recipient=0x0000000000000000000000000000000000000000"]) assert.equal(query(text), null);
  for (const text of [encoded + "=", "a".repeat(769), Buffer.from(JSON.stringify([1, scope, creator, "0", item.checkpoint.blockHash, item.token])).toString("base64url"),
    Buffer.from(JSON.stringify([2, scope, creator, "100", item.checkpoint.blockHash, item.token])).toString("base64url")]) {
    assert.equal(decodeEarningsDiscoveryCursor(text), null);
  }
  const fixtureCursor = encodeEarningsDiscoveryCursor({ ...cursor, scope: scope.replace(/^4663:/, "31337:") });
  assert.equal(decodeEarningsDiscoveryCursor(fixtureCursor), null, "Production never admits a 31337 cursor");
  assert.equal(parseFixtureEarningsDiscoveryQuery(new URL(`http://127.0.0.1:4100/earnings?recipient=${creator}&after=${fixtureCursor}`))?.after, fixtureCursor);
  assert.equal(parseFixtureEarningsDiscoveryQuery(new URL(`http://127.0.0.1:4100/earnings?recipient=${creator}&after=${encoded}`)), null);
  assert.deepEqual(earningsBeneficiaryRoles(item, creator, config), ["creator"]);
  assert.deepEqual(earningsBeneficiaryRoles(item, config.binding.creationFeeRecipient, config), ["operations"]);
  assert.deepEqual(earningsBeneficiaryRoles(item, config.reserveRecipient, config), ["reserve"]);
  const treasury = config.reserveRecipient;
  const project = { ...item, treasury, treasuryShareBps: 9000 };
  assert.deepEqual(earningsBeneficiaryRoles(project, treasury, config), ["treasury", "reserve"], "One beneficiary can have two immutable roles without duplicating a ledger");
  assert.throws(() => earningsBeneficiaryRoles(item, item.initialCurve, config), /not related/);
  assert.throws(() => earningsBeneficiaryRoles({ ...item, chainId: 31337 }, creator, config), /identity mismatch/);
  assert.throws(() => earningsBeneficiaryRoles({ ...item, revenueLedger: item.factory, totalSupplyWei: "1" }, creator, config), /identity mismatch/);
  assert.throws(() => earningsBeneficiaryRoles({ ...item, treasury, treasuryShareBps: 0 }, creator, config), /identity mismatch/);
  assert.throws(() => earningsBeneficiaryRoles({ ...item, treasury: creator, treasuryShareBps: 9000 }, creator, config), /identity mismatch/);
}
