import assert from "node:assert/strict";
import { mkdtempSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configuredCurveFixture, parseCurveFixture } from "./curve-fixture";

const address = (digit: string) => `0x${digit.repeat(40)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const env = { RMT_CURVE_FIXTURE: "task036-local-only", RMT_CURVE_FIXTURE_SITE_ORIGIN: "http://127.0.0.1:3100",
  RMT_CURVE_FIXTURE_READ_KEY: "1".repeat(64),
  RMT_CURVE_FIXTURE_RPC: "http://127.0.0.1:3200/", RMT_CURVE_FIXTURE_INDEXER: "http://127.0.0.1:3300/" };
const manifest = { chainId: 31337, factory: address("1"), projectRegistry: address("2"), factoryRuntimeHash: hash("a"),
  registryRuntimeHash: hash("b"), deployBlock: "57648304", deploymentBlockHash: hash("c"), creationFeeWei: "400000000000000", creationFeeRecipient: address("3") };

test("test execution is unreachable unless all loopback inputs and the pinned fixture profile match", () => {
  assert.equal(parseCurveFixture(env, manifest)?.origin, env.RMT_CURVE_FIXTURE_SITE_ORIGIN);
  for (const changes of [{ NETLIFY: "true" }, { VERCEL: "1" }, { DEPLOY_ID: "preview" }, { CONTEXT: "deploy-preview" },
    { RAILWAY_ENVIRONMENT_ID: "reference" }, { RMT_CURVE_FIXTURE_READ_KEY: undefined }, { RMT_CURVE_FIXTURE_READ_KEY: "0".repeat(64) },
    { RMT_CURVE_FIXTURE: "1" }, { RMT_CURVE_FIXTURE_RPC: "http://localhost:3200/" }, { RMT_CURVE_FIXTURE_RPC: "https://127.0.0.1:3200" },
    { RMT_CURVE_FIXTURE_INDEXER: "http://127.0.0.1:3200" }, { RMT_CURVE_FIXTURE_RPC: "http://127.0.0.1:3200/?other" },
    { RMT_CURVE_FIXTURE_RPC: "http://127.0.0.1:3200@outside.invalid" }]) assert.equal(parseCurveFixture({ ...env, ...changes }, manifest), null);
  for (const changes of [{ chainId: 4663 }, { chainId: 31338 }, { deploymentBlockHash: hash("0") }, { creationFeeWei: "1" },
    { factory: address("0") }, { projectRegistry: manifest.factory }, { deployBlock: 0 }]) assert.equal(parseCurveFixture(env, { ...manifest, ...changes }), null);
});

test("server fixture reads the manifest only for the exact bound Host and HTTP transport", () => {
  const folder = mkdtempSync(join(tmpdir(), "rmt-curve-config-"));
  const path = join(folder, "fixture.json");
  writeFileSync(path, JSON.stringify(manifest));
  const overrides = { ...env, RMT_CURVE_FIXTURE_DEPLOYMENT: path };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, overrides);
    const header = () => new Headers({ host: "127.0.0.1:3100", "x-forwarded-proto": "http" });
    assert.equal(configuredCurveFixture(header())?.deploymentBlock, 57648304n);
    assert.equal(configuredCurveFixture(new Headers({ host: "example.invalid" })), null);
    const spoofed = header();
    spoofed.set("x-forwarded-host", "example.invalid");
    assert.equal(configuredCurveFixture(spoofed), null);
    spoofed.delete("x-forwarded-host");
    spoofed.set("x-forwarded-proto", "https");
    assert.equal(configuredCurveFixture(spoofed), null);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(path);
    rmdirSync(folder);
  }
});
