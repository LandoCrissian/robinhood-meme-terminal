import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const { values: args } = parseArgs({ options: { input: { type: "string" }, output: { type: "string" }, final: { type: "string", default: "19" } } });
assert.ok(args.input && args.output, "Supply the raw attempt directory and an output directory");
const count = Number(args.final); assert.ok(Number.isSafeInteger(count) && count > 0 && count < 100);
const out = resolve(args.output); await mkdir(out, { recursive: true });
const attempts = []; let final, finalBytes;
for (let number = 1; number <= count; number++) {
  const name = `task092-production-adapter-evm-${number}.json`, bytes = await readFile(resolve(args.input, name)), report = JSON.parse(bytes);
  assert.equal(report.scope, "ISOLATED_ANVIL_4663_PRODUCTION_ADAPTER_CONTINUOUS_EVM_ACCEPTANCE");
  assert.equal(report.restrictions.productionWrites, false); assert.equal(report.restrictions.governanceExecution, false);
  attempts.push({ attempt: number, name, sha256: createHash("sha256").update(bytes).digest("hex"), status: report.status,
    startedAt: report.startedAt, finishedAt: report.finishedAt, steps: report.steps.length,
    ...(report.failure && { failure: report.failure.message.slice(0, 1200) }) });
  if (number === count) { final = report; finalBytes = bytes; }
}
assert.equal(final.status, "passed");
const operations = new Set(final.steps.map(step => step.operation));
for (const operation of ["buy", "sell", "approve", "graduate", "v4-buy", "v4-sell", "v4-token-approve", "v4-permit2-approve",
  "curve-claim", "creation-fees", "lp-collect", "lp-claim", "lp-claim-native", "lp-claim-token"]) assert.ok(operations.has(operation), operation);
assert.ok(final.recovery.restart.identicalDurableEvents && final.recovery.restart.competingWriterRejected);
assert.equal(final.recovery.reorg.orphanedRows, 0); assert.equal(final.recovery.reorg.verification.status, "unavailable");
assert.ok(final.projectBirthRecovery.sourceBoundProofPassed);
assert.equal(final.indexerColdStartup.manualCursorSeedBeforeStartup, false); assert.equal(final.indexerColdStartup.passes.length, 2);
assert.equal(final.indexerColdStartup.fullHistoricalCatchupObserved, false);
assert.ok(final.steps.some(step => step.humanReview?.canonicalBlocksElapsed > 4 && step.humanReview.requestUnchanged && step.humanReview.feeCeilingNotIncreased));
assert.ok(final.steps.filter(step => step.quote).every(step => step.quote.feeEvidence === "verified-nitro-zero-poster"));
assert.ok(final.steps.filter(step => step.review).every(step => step.review.fees.status === "verified-nitro-zero-poster"));
const initial = new Map(final.source.files.map(file => [file.path, file.sha256]));
const changed = final.sourceAtCompletion.files.filter(file => initial.get(file.path) !== file.sha256).map(file => file.path);
assert.ok(changed.every(path => path === "scripts/production-adapters/browser.ts"), "Runtime source changed during the accepted run");
assert.equal(final.sourceStableDuringRun, true, "The final complete rehearsal must bind unchanged source files");
const archive = gzipSync(finalBytes, { level: 9 });
await writeFile(resolve(out, "evm-acceptance.json.gz"), archive);
await writeFile(resolve(out, "evm-attempts.json"), JSON.stringify({ schemaVersion: 1, scope: final.scope,
  finalAttempt: count, finalRawSha256: attempts.at(-1).sha256, archiveSha256: createHash("sha256").update(archive).digest("hex"),
  source: { commit: final.source.commit, committedTree: final.source.committedTree, allSourceStableDuringRun: final.sourceStableDuringRun,
    runtimeSourceStableDuringRun: true, changedUnloadedFiles: changed, evidence: "Exact initial/completion per-file hashes remain in the unmodified compressed raw report" },
  attempts, rawRetention: "Every original JSON remains outside the checkout in the task workspace; none was overwritten or removed",
  limitations: final.limitations }, null, 2) + "\n");
console.log(JSON.stringify({ status: "archived", finalAttempt: count, attempts: attempts.length, output: out }));
