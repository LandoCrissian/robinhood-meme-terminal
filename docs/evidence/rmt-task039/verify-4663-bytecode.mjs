import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const [source, compiler, evidence, output] = process.argv.slice(2);
assert.ok(source && compiler && evidence && output, "Usage: node <script> <pinned-checkout> <solc> <2eth-fork-evidence> <new-output-json>");
const repo = resolve(source);
const solc = resolve(compiler);
const evidenceBytes = readFileSync(evidence);
const fork = JSON.parse(evidenceBytes);
const { buildCurveReviewCompilerInput } = await import(
  pathToFileURL(resolve(repo, "packages/contracts/scripts/validate-curve-graduation-4663.mjs"))
);
const { encodeDeployData, getContractAddress, getCreate2Address, keccak256 } =
  createRequire(resolve(repo, "apps/web/package.json"))("viem");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = (hex) => Buffer.from(hex, "hex");
const backingWei = 2_000_000_000_000_000_000n;
assert.equal(fork.manifest.chainId, 4663);
assert.equal(fork.terms.backingWei, backingWei.toString());
const review = buildCurveReviewCompilerInput({ solc }, 4663, backingWei);
const sourceSha256 = Array.isArray(fork.manifest.sourceSha256)
  ? Object.fromEntries(fork.manifest.sourceSha256)
  : fork.manifest.sourceSha256;
assert.deepEqual(review.sourceSha256, sourceSha256);
assert.deepEqual(review.sourceChanges, fork.manifest.sourceChanges);
const inputSha256 = sha(review.input);
assert.equal(inputSha256, fork.manifest.inputSha256);
const outputJson = JSON.parse(execFileSync(solc, ["--standard-json", "--no-import-callback"], {
  cwd: resolve(repo, "packages/contracts"), input: review.input, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  timeout: 180_000, env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
}));
const compilerErrors = (outputJson.errors ?? []).filter((result) => result.severity === "error");
assert.deepEqual(compilerErrors, []);
const templates = Object.fromEntries(Object.values(outputJson.contracts).flatMap((file) => Object.entries(file)
  .map(([name, { evm }]) => {
    const creation = bytes(evm.bytecode.object);
    const runtime = bytes(evm.deployedBytecode.object);
    assert.ok(creation.length && runtime.length && runtime.length <= 24_576, name);
    return [name, { creationBytes: creation.length, runtimeBytes: runtime.length,
      creationSha256: sha(creation), runtimeSha256: sha(runtime) }];
  })));
assert.deepEqual(templates, fork.manifest.templates);
const deployment = fork.deployment.deployment;
const bootstrap = outputJson.contracts["src/RMTLaunchCurveDeploymentV1.sol"].RMTLaunchCurveDeploymentV1;
const asInitcode = ({ abi, evm }, args) => encodeDeployData({ abi, bytecode: "0x" + evm.bytecode.object, args });
const initcode = bytes(asInitcode(bootstrap, [deployment.dependencies, deployment.guardSalt, deployment.operatingRecipient,
  deployment.futureReserveRecipient, deployment.projectRegistry, deployment.successorDeployer,
  deployment.successorDeployerRuntimeHash, BigInt(fork.deployment.creationFeeWei)]).slice(2));
const zeroBytes = initcode.reduce((count, byte) => count + Number(byte === 0), 0);
const measured = {
  sizeBytes: initcode.length,
  constructorBytes: initcode.length - templates.RMTLaunchCurveDeploymentV1.creationBytes,
  sha256: sha(initcode), headroomBytes: 49_152 - initcode.length,
  eip3860Gas: 2 * Math.ceil(initcode.length / 32),
  calldataGas: zeroBytes * 4 + (initcode.length - zeroBytes) * 16,
};
for (const [key, value] of Object.entries(measured)) {
  assert.equal(value, deployment.initcode[key], key);
}
const guard = outputJson.contracts["src/RMTV4CurveInitializationGuardV1.sol"].RMTV4CurveInitializationGuardV1;
const predict = (from, nonce) => getContractAddress({ from, nonce: BigInt(nonce) });
const lower = (address) => address.toLowerCase();
assert.equal(lower(predict(deployment.operator, deployment.nonce)), lower(deployment.address));
const graduationEngine = predict(deployment.address, 2);
assert.equal(lower(graduationEngine), lower(fork.deployment.graduationEngine));
const factory = predict(deployment.address, 3);
assert.equal(lower(factory), lower(fork.deployment.factory));
const guardHash = keccak256(asInitcode(guard, [deployment.dependencies.poolManager, graduationEngine]));
assert.equal(guardHash, deployment.guardCodeHash);
const initializationGuard = getCreate2Address({ from: deployment.address, salt: deployment.guardSalt, bytecodeHash: guardHash });
assert.equal(lower(initializationGuard), lower(fork.deployment.guard));
assert.equal(BigInt(initializationGuard) & 0x3fffn, 0x2000n);

const report = {
  chainId: 4663, backingWei: backingWei.toString(), compilerSha256: review.executableSha256, inputSha256,
  forkEvidenceSha256: sha(evidenceBytes), templates, bootstrapInitcode: measured,
  fixtureAddressDerivations: { bootstrap: deployment.address, graduationEngine, factory, initializationGuard, guardHash },
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ templates: Object.keys(templates).length, bootstrapInitcode: measured }, null, 2));
