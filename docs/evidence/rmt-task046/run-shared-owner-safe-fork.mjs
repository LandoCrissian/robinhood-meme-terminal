import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync,
  unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  checkout: { type: "string" }, anvil: { type: "string" }, solc: { type: "string" }, lib: { type: "string" },
  archive: { type: "string", default: "pinax" },
} });
assert.ok(values.checkout && values.anvil && values.solc, "Supply the pinned #594 checkout, Anvil and Solc");
const source = "8dca5773cbd4dc98f52a45616f420bce96b000f0";
const checkout = realpathSync(values.checkout);
assert.equal(execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), source);
const evidence = dirname(fileURLToPath(import.meta.url));
const dependencies = realpathSync(join(checkout, "apps/web/node_modules"));
const scratchRoot = realpathSync(tmpdir());
const scratch = mkdtempSync(join(scratchRoot, "rmt-task046-shared-owner-safes-"));
const linkedModules = join(scratch, "apps/web/node_modules");
const scriptsPath = "packages/contracts/scripts";

function economicOutcome(item) {
  return {
    bps: item.bps, supply: item.supply, creationFee: item.creation.fee.fee,
    curveAccrued: item.curve.accrued, curveBuckets: item.curve.buckets, lpClaims: item.lp.amountsClaimed,
    nativeDeposited: item.graduation.nativeUsed, assetDeposited: item.graduation.tokenUsed, liquidity: item.graduation.liquidity,
    swaps: item.swaps.map(({ buy, sell }) => [[buy.amountIn, buy.output], [sell.amountIn, sell.output]]),
  };
}

try {
  const archive = join(scratch, "pinned.tar");
  const archived = ["build-launch-4663-review.mjs", "launch-4663-review-inputs.json", "robinhood-4663-fork-environment.mjs",
    "validate-curve-graduation-4663.mjs"];
  execFileSync("git", ["-C", checkout, "archive", "--format=tar", "--output=" + archive, source,
    "apps/web/package.json", "packages/contracts/test/fixtures/rmt-v4-deployment-identities.json",
    ...archived.map((name) => scriptsPath + "/" + name)]);
  execFileSync("tar", ["-xf", archive, "-C", scratch]);
  symlinkSync(dependencies, linkedModules, process.platform === "win32" ? "junction" : "dir");
  const scripts = join(scratch, scriptsPath);
  for (const [task, names] of [
    ["rmt-task041", ["treasury-rehearsal.mjs", "RejectingTreasury.sol", "safe-rehearsal.mjs"]],
    ["rmt-task042", ["4663-treasury-review-manifest.json"]],
    ["rmt-task043", ["fork-rotation-authority.mjs", "observe-governance.mjs"]],
  ]) {
    for (const name of names) {
      const sourceFile = join(evidence, "..", task, name);
      const outputFile = join(scripts, name);
      if (name.endsWith(".mjs")) {
        writeFileSync(outputFile, readFileSync(sourceFile, "utf8").replaceAll("\r\n", "\n"));
      } else {
        copyFileSync(sourceFile, outputFile);
      }
    }
  }
  for (const [index, sourcePatch] of [
    "../rmt-task042/fork/reanchor.patch", "../rmt-task043/rotation-rehearsal.patch", "../rmt-task044/platform-safe-rehearsal.patch", "shared-owner-safe-rehearsal.patch",
  ].entries()) {
    const patch = join(scratch, `overlay-${index}.patch`);
    writeFileSync(patch, readFileSync(join(evidence, sourcePatch), "utf8").replaceAll("\r\n", "\n"));
    execFileSync("git", ["-C", scratch, "apply", ...(index ? ["--unidiff-zero"] : []), patch]);
  }
  const raw = execFileSync(process.execPath, [join(scripts, "treasury-rehearsal.mjs"),
    "--checkout", checkout, "--rotation-compiler", join(evidence, "../rmt-task043/compile-rotation-profile.mjs"),
    "--solc", resolve(values.solc), "--anvil", resolve(values.anvil), "--archive", values.archive, "--platform-safes",
    ...(values.lib ? ["--lib", resolve(values.lib)] : []),
  ], { cwd: scratch, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  const output = JSON.parse(raw);
  assert.equal(output.report.execution.host, "127.0.0.1");
  assert.equal(output.report.execution.chainId, 4663);
  assert.equal(output.report.archiveBoundary.blockedWriteProbe, "HTTP 403");
  assert.equal(output.compiler.inputSha256, "90122536b22c847aebc0182d75290b9ba281399481d90daffc8b0f66ed92f65b");
  const [operations, reserve] = output.platformSafes;
  assert.deepEqual([operations.role, operations.threshold, reserve.role, reserve.threshold], ["operations", "2", "reserve", "2"]);
  assert.deepEqual(operations.ownerAddresses, reserve.ownerAddresses);
  assert.deepEqual([operations.saltNonce, reserve.saltNonce], ["1", "2"]);
  assert.equal(operations.initializerHash, reserve.initializerHash);
  assert.notEqual(operations.proxy, reserve.proxy);
  for (const safe of output.platformSafes) assert.equal(safe.proxy.toLowerCase(), safe.predictedProxy.toLowerCase());
  assert.equal(output.creationFeeClaim.recipient, operations.proxy);
  assert.equal(output.creationFeeClaim.reserveUnaffected, true);
  assert.equal(output.cases.length, 1);
  const proof = output.cases[0];
  assert.deepEqual(proof.recipients.slice(2), [operations.proxy, reserve.proxy]);
  for (const { proxy } of output.platformSafes) {
    assert.deepEqual(proof.lp.claims.filter(({ beneficiary }) => beneficiary === proxy).map(({ mode }) => mode),
      ["combined", "native", "token"]);
  }
  assert.deepEqual(proof.platformDomainIsolation.map(({ sourceRole, targetRole }) => [sourceRole, targetRole]),
    [["reserve", "operations"], ["operations", "reserve"]]);
  for (const replay of proof.platformDomainIsolation) {
    assert.equal(replay.signedNonce, "0");
    assert.equal(replay.rejected.reason, "GS026");
    assert.equal(replay.balancesAndCreditsUnchanged, true);
    assert.notEqual(replay.sourceDigest, replay.targetDigest);
  }
  assert.deepEqual(proof.platformRotations.map(({ role }) => role), ["operations", "reserve"]);
  for (const rotation of proof.platformRotations) {
    assert.equal(rotation.afterRotation.threshold, "2");
    assert.equal(rotation.formerOwnerRejected.reason, "GS026");
    assert.equal(rotation.otherSafeUnchanged, true);
    assert.equal(rotation.treasuryBalancesAndPrincipalUnchanged, true);
    assert.equal(BigInt(rotation.afterRehearsal.nonce) - BigInt(rotation.before.nonce), 2n);
  }
  assert.notEqual(proof.platformRotations[0].incoming, proof.platformRotations[1].incoming);
  const reference = JSON.parse(readFileSync(join(evidence, "../rmt-task041/4663-treasury-matrix.json"), "utf8"));
  const baseline = reference.cases.find(({ percent, treasuryKind }) => percent === 0 && treasuryKind === "none");
  assert.deepEqual(economicOutcome(proof), economicOutcome(baseline), "Changing fixture recipient types affected economics");
  output.localReportSha256Lf = createHash("sha256").update(raw.replaceAll("\r\n", "\n")).digest("hex");
  console.log(JSON.stringify(output, (_, value) => {
    if (value && typeof value === "object" && Object.hasOwn(value, "token")) {
      const { token: projectAsset, ...rest } = value;
      return { projectAsset, ...rest };
    }
    return value;
  }, 2));
} finally {
  assert.equal(dirname(realpathSync(scratch)), scratchRoot, "Disposable rehearsal must stay inside the temporary directory");
  if (existsSync(linkedModules)) {
    assert.ok(lstatSync(linkedModules).isSymbolicLink(), "Expected a disposable dependency link");
    unlinkSync(linkedModules);
  }
  rmSync(scratch, { recursive: true, force: true });
}
