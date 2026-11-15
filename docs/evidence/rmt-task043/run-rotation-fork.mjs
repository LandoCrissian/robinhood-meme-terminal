import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync,
  writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  checkout: { type: "string" }, anvil: { type: "string" }, solc: { type: "string" }, lib: { type: "string" },
  archive: { type: "string", default: "pinax" }, "safe-only": { type: "boolean", default: false },
  checkpoint: { type: "string" }, "project-share": { type: "string" },
} });
assert.ok(values.checkout && values.anvil && values.solc, "Use --checkout, --anvil and --solc for the pinned local fork rehearsal");
assert.ok(values["project-share"] === undefined ||
  (!values["safe-only"] && ["0", "25", "50", "100"].includes(values["project-share"])), "Invalid project-share selection");
const checkout = realpathSync(values.checkout);
const source = "8dca5773cbd4dc98f52a45616f420bce96b000f0";
assert.equal(execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), source);
const evidence = dirname(fileURLToPath(import.meta.url));
const dependencies = realpathSync(join(checkout, "apps", "web", "node_modules"));
if (values.checkpoint) writeFileSync(resolve(values.checkpoint), "", { flag: "wx" });
const scratchRoot = realpathSync(tmpdir());
const scratch = mkdtempSync(join(scratchRoot, "rmt-task043-fork-"));
const copiedModules = join(scratch, "apps", "web", "node_modules");
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
  const earlierScripts = [
    "build-launch-4663-review.mjs", "launch-4663-review-inputs.json", "robinhood-4663-fork-environment.mjs",
    "validate-curve-graduation-4663.mjs",
  ];
  execFileSync("git", ["-C", checkout, "archive", "--format=tar", "--output=" + archive, source,
    "apps/web/package.json", "packages/contracts/test/fixtures/rmt-v4-deployment-identities.json",
    ...earlierScripts.map((name) => scriptsPath + "/" + name)]);
  execFileSync("tar", ["-xf", archive, "-C", scratch]);
  symlinkSync(dependencies, copiedModules, process.platform === "win32" ? "junction" : "dir");
  const scripts = join(scratch, scriptsPath);
  for (const name of ["treasury-rehearsal.mjs", "RejectingTreasury.sol", "safe-rehearsal.mjs"]) {
    copyFileSync(join(evidence, "../rmt-task041", name), join(scripts, name), constants.COPYFILE_EXCL);
  }
  for (const name of ["fork-rotation-authority.mjs", "observe-governance.mjs"]) {
    copyFileSync(join(evidence, name), join(scripts, name), constants.COPYFILE_EXCL);
  }
  copyFileSync(join(evidence, "../rmt-task042/4663-treasury-review-manifest.json"),
    join(scripts, "4663-treasury-review-manifest.json"), constants.COPYFILE_EXCL);
  execFileSync("git", ["-C", scratch, "apply", join(evidence, "../rmt-task042/fork/reanchor.patch")]);
  execFileSync("git", ["-C", scratch, "apply", "--unidiff-zero", join(evidence, "rotation-rehearsal.patch")]);
  const raw = execFileSync(process.execPath, [join(scripts, "treasury-rehearsal.mjs"),
    "--checkout", checkout, "--rotation-compiler", join(evidence, "compile-rotation-profile.mjs"),
    "--solc", resolve(values.solc), "--anvil", resolve(values.anvil), "--archive", values.archive,
    ...(values.lib ? ["--lib", resolve(values.lib)] : []), ...(values["safe-only"] ? ["--safe", "--safe-only"] : []),
    ...(values.checkpoint ? ["--checkpoint", resolve(values.checkpoint)] : []),
    ...(values["project-share"] === undefined ? [] : ["--project-share", values["project-share"]]),
  ], { cwd: scratch, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  const output = JSON.parse(raw);
  assert.equal(output.report.execution.host, "127.0.0.1");
  assert.equal(output.report.execution.chainId, 4663);
  assert.equal(output.report.archiveBoundary.blockedWriteProbe, "HTTP 403");
  const referenceFile = values["safe-only"] ? "4663-safe-claims.json" : "4663-treasury-matrix.json";
  const reference = JSON.parse(readFileSync(join(evidence, "../rmt-task041", referenceFile), "utf8"));
  for (const item of output.cases) {
    const previous = reference.cases.find(({ percent, treasuryKind }) => percent === item.percent && treasuryKind === item.treasuryKind);
    assert.ok(previous, "Unrecognized treasury proof scenario");
    assert.deepEqual(economicOutcome(item), economicOutcome(previous), "Economic outcome differs from #614");
  }
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
  if (existsSync(copiedModules)) {
    assert.ok(lstatSync(copiedModules).isSymbolicLink(), "Expected a disposable dependency link");
    unlinkSync(copiedModules);
  }
  rmSync(scratch, { recursive: true, force: true });
}
