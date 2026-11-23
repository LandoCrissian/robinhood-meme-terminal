import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verifyTask092HistoryPublicData } from "./public-task092-identities.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const report = new URL("../../docs/evidence/token-market/redacted-public-address-rows.json", import.meta.url);
const sha = value => createHash("sha256").update(value).digest("hex");
// Both contract addresses are independently re-derived from CREATE2 compiler
// inputs in the adapter job. The history scanner runs without npm dependencies.
const addresses = new Map([
  ["docs/evidence/graduation-economics/measurements.json", "0xac1d3e4a3e40126f0a2c357c814d7198c68fd253"],
  ["docs/evidence/token-market/market-replay.json", "0x868027fe14ab2447646e3cce561def4e66ff3c96"],
]);

export function verifyMarketHistoryPublicData(findings, options = {}) {
  assert.ok(Array.isArray(findings) && findings.length <= 1024);
  const bytes = readFileSync(report, "utf8").replaceAll("\r\n", "\n");
  assert.equal(sha(bytes), "50e77b110f4cce64d654375e49e435743489b194473f0d5f75dbf9f8b60d9914");
  const expected = new Map(JSON.parse(bytes).map(row => [row.Fingerprint, row]));
  assert.equal(expected.size, 39);
  // Four historical scanner hits are digests of published stylesheets in the two
  // browser reports. Bind the entire redacted finding and reproduce the digest
  // from the CSS blob in that same immutable Git tree.
  const cssRows = JSON.parse(readFileSync(new URL("../../docs/evidence/token-trading-experience/css-scan-rows.json",import.meta.url),"utf8"));
  assert.equal(sha(JSON.stringify(cssRows)), "96ed71f42dcff0af9005070db090b1947bb2b18fcc279d9672ca076b931805aa");
  const css = new Map(cssRows.map(row => [row.Fingerprint,row]));
  const result = verifyTask092HistoryPublicData(findings.filter(row => !expected.has(row?.Fingerprint) && !css.has(row?.Fingerprint)), options);
  const files = new Map(), seen = new Set();
  for (const row of findings) {
    const cssRow = css.get(row?.Fingerprint);
    if (cssRow) {
      if (seen.has(row.Fingerprint) || !Object.keys(cssRow).every(key => cssRow[key] === row[key])) {
        result.unclassified.push({fingerprint:row.Fingerprint,ruleId:row.RuleID});continue;
      }
      const blob = file => execFileSync("git", ["show", row.Commit + ":" + file], {cwd:root,windowsHide:true});
      const line = blob(row.File).toString("utf8").split("\n")[row.StartLine-1];
      const match = /^\s*"(apps\/launch-website\/app\/(?:styles\/token-detail|token-page)\.css)": "([a-f0-9]{64})",?$/u.exec(line);
      assert.ok(match && sha(blob(match[1])) === match[2]);
      seen.add(row.Fingerprint);
      result.classified.push({fingerprint:row.Fingerprint,kind:"PUBLIC_STYLESHEET_SHA256",commit:row.Commit,lineSha256:sha(line),publicValueSha256:sha(match[2])});
      continue;
    }
    const original = expected.get(row?.Fingerprint);
    if (!original) continue;
    if (seen.has(row.Fingerprint) || !Object.keys(original).every(key => original[key] === row[key])) {
      result.unclassified.push({ fingerprint: original.Fingerprint, ruleId: original.RuleID });
      continue;
    }
    const path = row.Commit + ":" + row.File;
    if (!files.has(path)) {
      const source = options.readGit ? options.readGit(row.Commit, row.File) :
        execFileSync("git", ["show", path], { cwd: root, maxBuffer: 4_000_000, windowsHide: true });
      files.set(path, source.toString("utf8").split("\n"));
    }
    const line = files.get(path)[row.StartLine - 1];
    const match = /^\s*"token": "(0x[0-9a-fA-F]{40})",?\s*$/.exec(line);
    assert.ok(match && match[1].toLowerCase() === addresses.get(row.File));
    assert.equal(line.slice(row.StartColumn - 2, row.EndColumn - 1), row.Match.replace("REDACTED", match[1]));
    seen.add(row.Fingerprint);
    result.classified.push({ fingerprint: row.Fingerprint, kind: "FORK_CREATE2_CONTRACT_ADDRESS",
      commit: row.Commit, lineSha256: sha(line), publicValueSha256: sha(match[1]) });
  }
  result.missing.push(...[...expected.keys(),...css.keys()].filter(key => !seen.has(key)));
  return { ...result, rawFindingCount: findings.length, rawScanPassed: findings.length === 0,
    status: result.unclassified.length || result.missing.length ? "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING" : "PASSED_EXACT_PUBLIC_DATA_ONLY" };
}
