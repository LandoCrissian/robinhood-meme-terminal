import assert from "node:assert/strict";
import { mkdtemp, unlink, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { curveFixtureConfig } from "./curve-fixture-config.js";

export async function testCurveFixtureConfig() {
  assert.throws(() => curveFixtureConfig({ DATABASE_URL: "postgresql://example.invalid/production" }), /disabled/);
  // The unit-test manifest contains public-shaped placeholder values only.
  const home = await mkdtemp(join(tmpdir(), "rmt-curve-fixture-manifest-"));
  const manifestPath = join(home, "fixture.json");
  const manifest = { chainId: 31337, deployBlock: "100", deploymentBlockHash: "0x" + "1".repeat(64),
    factory: "0x" + "a".repeat(40), factoryRuntimeHash: "0x" + "2".repeat(64), projectRegistry: "0x" + "b".repeat(40),
    registryRuntimeHash: "0x" + "3".repeat(64), creationFeeWei: "400000000000000", creationFeeRecipient: "0x" + "c".repeat(40),
    graduationEngine: "0x" + "d".repeat(40), graduationRuntimeHash: "0x" + "4".repeat(64),
    guard: "0x" + "e".repeat(36) + "2000", guardRuntimeHash: "0x" + "5".repeat(64) };
  const settings = { RMT_CURVE_FIXTURE: "task036-local-only", RMT_CURVE_FIXTURE_PORT: "4100",
    RMT_CURVE_FIXTURE_RPC: "http://127.0.0.1:4101/", RMT_CURVE_FIXTURE_DATABASE: "postgresql://operator@127.0.0.1:4102/rmt_curve_fixture_unit",
    RMT_CURVE_FIXTURE_DEPLOYMENT: manifestPath, RMT_CURVE_FIXTURE_READ_KEY: "1".repeat(64) };
  try {
    await writeFile(manifestPath, JSON.stringify(manifest));
    const reviewed = curveFixtureConfig(settings);
    assert.equal(reviewed.binding.chainId, 31337);
    assert.equal(reviewed.binding.confirmations, 2);
    assert.equal(reviewed.databaseName, "rmt_curve_fixture_unit");
    assert.throws(() => curveFixtureConfig({ ...settings, RMT_CURVE_FIXTURE_READ_KEY: "missing" }), /read authentication/);
    assert.throws(() => curveFixtureConfig({ ...settings, RAILWAY_ENVIRONMENT_ID: "ignored" }), /local only/);
    assert.throws(() => curveFixtureConfig({ ...settings, RMT_CURVE_FIXTURE_PORT: "4101" }), /distinct ports/);
    assert.throws(() => curveFixtureConfig({ ...settings, RMT_CURVE_FIXTURE_RPC: "https://127.0.0.1:4101/" }), /loopback URL/);
    assert.throws(() => curveFixtureConfig({ ...settings, RMT_CURVE_FIXTURE_RPC: "http://127.0.0.1:4101/dev" }), /bare loopback origin/);
    assert.throws(() => curveFixtureConfig({ ...settings, RMT_CURVE_FIXTURE_RPC: "http://192.0.2.1:4101/" }), /loopback URL/);
    assert.throws(() => curveFixtureConfig({ ...settings, RMT_CURVE_FIXTURE_DATABASE: "postgresql://operator@127.0.0.1:4102/rmt_indexer" }), /dedicated/);
    assert.throws(() => curveFixtureConfig({ ...settings, RMT_CURVE_FIXTURE_DATABASE: "postgresql://operator@service.railway.internal:4102/rmt_curve_fixture_unit" }), /loopback URL/);
    assert.throws(() => curveFixtureConfig({ ...settings, RMT_CURVE_FIXTURE_DATABASE: "postgresql://operator@127.0.0.1:4102/rmt_curve_fixture_unit?host=external.invalid" }), /loopback URL/);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, chainId: 4663 }));
    assert.throws(() => curveFixtureConfig(settings), /Invalid fixture chain/);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, creationFeeWei: "399999999999999" }));
    assert.throws(() => curveFixtureConfig(settings), /exact creation fee/);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, guard: manifest.factory }));
    assert.throws(() => curveFixtureConfig(settings), /graduation deployment binding/);
  } finally {
    await unlink(manifestPath).catch(() => undefined);
    await rmdir(home);
  }
}
