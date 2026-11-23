import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyMarketHistoryPublicData } from "./public-market-identities.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence = file => JSON.parse(readFileSync(join(root, "docs/evidence", file)));
const rows = evidence("token-market/redacted-public-address-rows.json");
const prior = evidence("rmt-task092/history-adjudication/exact-public-identities.json");
const history = [...JSON.parse(evidence("rmt-task091/history-adjudication/derived-report-proof.json").actualCiRawReportUtf8),
  ...prior.records.map(record => record.finding)];
const cache = new Map();
function readGit(commit, file) {
  const ref = commit + ":" + file;
  if (!cache.has(ref)) cache.set(ref, execFileSync("git", ["show", ref], { cwd: root, maxBuffer: 32 * 1024 * 1024 }));
  return cache.get(ref);
}
const verify = additions => verifyMarketHistoryPublicData([...history, ...evidence("token-trading-experience/css-scan-rows.json"), ...additions], { readGit });

test("all 39 lines independently resolve to their fork-created addresses from canonical compiler inputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "rmt-address-proof-"));
  try {
    const raw = join(dir, "rows.json"), classification = join(dir, "review.json");
    writeFileSync(raw, JSON.stringify(rows));
    writeFileSync(classification, JSON.stringify({ rawFindingCount: rows.length,
      unclassified: rows.map(row => ({ fingerprint: row.Fingerprint })) }));
    const proof = JSON.parse(execFileSync(process.execPath, ["scripts/economics/verify-public-market-addresses.mjs", raw, classification], { cwd: root }));
    assert.deepEqual(Object.values(proof.reproducedPublicContractAddresses).sort((a,b) => a-b), [1, 38]);
    const result = verify(rows);
    assert.equal(result.classified.length, 365);
    assert.equal(result.rawScanPassed, false);
    assert.equal(result.status, "PASSED_EXACT_PUBLIC_DATA_ONLY");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("missing, duplicate, mutated, and unrelated findings keep the release gate closed", () => {
  for (const altered of [rows.slice(1), [...rows, rows[0]], [{ ...rows[0], StartColumn: 2 }, ...rows.slice(1)],
    [...rows, ...JSON.parse(prior.actualCanaryReportUtf8)]]) {
    assert.equal(verify(altered).status, "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");
  }
});
