import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Prove explicit rejection handling, even when Node's unhandled-rejection exit is disabled. */
export function assertPublicAuthorizationHarnessFailure() {
  const result = spawnSync(process.execPath, [
    "--unhandled-rejections=none", "--import", "tsx",
    fileURLToPath(new URL("./public-execution-provider-scope-smoke.ts", import.meta.url)),
    "--inject-negative-smoke-failure"
  ], { encoding: "utf8", timeout: 30_000, maxBuffer: 1_000_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1, "The entry point must explicitly fail on its awaited smoke rejection");
  assert.match(result.stderr, /INJECTED_ASYNC_NEGATIVE_SMOKE_FAILURE_AFTER_32_CASES/);
  assert.doesNotMatch(result.stderr, /UnhandledPromiseRejection|triggerUncaughtException/);
  assert.doesNotMatch(result.stdout, /smoke checks passed after/);
  console.log("Async smoke rejection propagation PASS: 32 child route cases, explicit exit 1, no unhandled promise.");
}
