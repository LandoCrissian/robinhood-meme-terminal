import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deriveFixtureAddress, verifyExportInputs } from "../../../packages/contracts/scripts/export-blockscout-4663.mjs";
import { probeBlockscout } from "../../../packages/contracts/scripts/probe-blockscout-4663.mjs";

const evidence = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, evidence));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const archive = read("fixed-supply-release/fork-4663.json.gz");
const savedBundle = read("fixed-supply-release/unsigned-bundle.json");
const pinned = JSON.parse(read("fixed-supply-security/4663-profile.json"));
const release = JSON.parse(read("fixed-supply-release/release-manifest.json"));
const compiled = { ...pinned };

test("rejects different compiler settings, source input bytes or a changed release gate", () => {
  const input = Buffer.from("{}");
  const args = { input, archive, release, pinned, compiled, savedBundle };
  assert.throws(() => verifyExportInputs(args), /Standard JSON input digest mismatch/);
  assert.throws(() => verifyExportInputs({ ...args, compiled: { ...compiled, chainId: 31337 } }), /differs from the pinned 4663 release/);
  assert.throws(() => verifyExportInputs({ ...args, compiled: { ...compiled, compilerSettings: {
    ...compiled.compilerSettings, viaIR: false,
  } } }), /differs from the pinned 4663 release/);
  assert.throws(() => verifyExportInputs({ ...args, release: { ...release, broadcastAuthorized: true } }));
});

test("rejects tampered fork archive and constructor evidence before deriving an address", () => {
  // Substitute a local input digest only to exercise the archived evidence gates
  // without requiring solc in the Node unit-test job.
  const input = Buffer.from("{}");
  const inputSha256 = sha256(input);
  const local = { ...pinned, inputSha256 };
  const evidence = { ...release, compiler: { ...release.compiler, inputSha256 } };
  const args = { input, archive, release: evidence, pinned: local, compiled: local, savedBundle };
  assert.doesNotThrow(() => verifyExportInputs(args));
  const corrupt = Buffer.from(archive);
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => verifyExportInputs({ ...args, archive: corrupt }), /Archived loopback evidence digest mismatch/);
  const changed = Buffer.from(savedBundle.toString("utf8").replace("firstProjectTreasuryBps", "unrecognizedInput"));
  assert.throws(() => verifyExportInputs({ ...args, savedBundle: changed }), /Reviewed bundle digest mismatch/);
});

test("derives exact reviewed bootstrap and token CREATE2 children separately from live bindings", () => {
  const { production, fixtureOnly } = JSON.parse(savedBundle);
  const { deployer, transactions, bootstrapChildren, firstProject } = fixtureOnly;
  const bootstrap = transactions.at(-1);
  const [guard, engine, factory] = bootstrapChildren;
  assert.equal(deriveFixtureAddress({ opcode: "CREATE", deployer, nonce: bootstrap.nonce }, bootstrap.initcodeHash).toLowerCase(),
    bootstrap.address.toLowerCase());
  assert.equal(deriveFixtureAddress({ opcode: "CREATE2", deployer: bootstrap.address, salt: guard.create2Salt }, guard.initcodeHash).toLowerCase(),
    guard.address.toLowerCase());
  assert.equal(deriveFixtureAddress({ opcode: "CREATE", deployer: bootstrap.address, nonce: 2 }, engine.initcodeHash).toLowerCase(),
    engine.address.toLowerCase());
  assert.equal(deriveFixtureAddress({ opcode: "CREATE2", deployer: factory.address, salt: firstProject.token.create2Salt },
    firstProject.token.initcodeHash).toLowerCase(), firstProject.token.address.toLowerCase());
  assert.throws(() => deriveFixtureAddress({ opcode: "CALL", deployer, nonce: 1 }, engine.initcodeHash));
  assert.deepEqual(production.transactions, []);
  assert.equal(production.firstProjectCreator, null);
});

test("Blockscout probe uses bounded public GET and leaves 403 or partial records unapproved", async () => {
  const requests = [];
  const report = await probeBlockscout(async (url, options) => {
    const endpoint = new URL(url);
    requests.push(endpoint.pathname);
    assert.equal(endpoint.origin, "https://robinhoodchain.blockscout.com");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, { accept: "application/json" });
    if (endpoint.pathname.endsWith("/verification/config")) return Response.json({
      is_rust_verifier_microservice_enabled: true,
      verification_options: ["standard-input"], solidity_compiler_versions: ["v0.8.26+commit.8a97fa7a"],
      solidity_evm_versions: ["cancun"], hidden: "never emitted",
    });
    if (endpoint.pathname.endsWith("/config/backend-version")) return new Response("denied", { status: 403 });
    return Response.json({
      is_verified: true, is_fully_verified: false, is_partially_verified: true, deployed_bytecode: "0x00",
    });
  });
  assert.equal(requests.length, 11);
  assert.deepEqual(report.config, { httpStatus: 200, status: "OBSERVED", rustVerifier: true, standardInputSupported: true,
    compilerSupported: true, cancunSupported: true });
  assert.deepEqual(report.backend, { httpStatus: 403, status: "UNAVAILABLE" });
  assert.ok(report.external.every((row) => row.partialSource && !row.isFullyVerified && !row.runtimeMatchesPin));
  assert.doesNotMatch(JSON.stringify(report), /never emitted|denied/);
  assert.equal(report.newRmtVerification, "DEPLOYMENT_DEPENDENT");
  assert.equal(report.sourceVerificationSubmitted, false);
  assert.equal(report.broadcastAuthorized, false);
});
