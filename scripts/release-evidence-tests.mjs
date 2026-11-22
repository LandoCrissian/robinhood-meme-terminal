import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { globSync, mkdtempSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const original = "docs/evidence/rmt-task083/security/integrity.test.mjs";
const reviewed = "1509403140ebcf9e7134db83b154bb091784e85a";
const tests = globSync("docs/evidence/**/*.test.mjs", { cwd: root }).map(path => path.replaceAll("\\", "/")).sort();
assert.equal(tests.filter(path => path === original).length, 1);
const directory = mkdtempSync(join(tmpdir(), "rmt-task083-"));
const checkout = join(directory, "source");
const git = (...args) => execFileSync("git", args, { cwd: root, windowsHide: true });
// The original suite proves what Task083 changed relative to Task082. Run
// every original assertion there; the current production comparison and all
// other evidence suites execute against the candidate checkout.
git("worktree", "add", "--quiet", "--detach", checkout, reviewed);
try {
  const result = spawnSync(process.execPath, ["--test", ...tests.map(path => path === original ? join(checkout, path) : path)],
    { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  git("worktree", "remove", checkout);
  rmdirSync(directory);
}
