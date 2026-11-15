import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const raw = readFileSync(process.argv[2], "utf8").replaceAll("\r\n", "\n");
const evidence = JSON.parse(raw);
assert.equal(evidence.report.execution.host, "127.0.0.1");
assert.equal(evidence.report.execution.chainId, 4663);
assert.equal(evidence.report.archiveBoundary.blockedWriteProbe, "HTTP 403");
evidence.localReportSha256Lf = createHash("sha256").update(raw).digest("hex");
// Store public identifiers under descriptive keys and compiler digests as path/hash pairs.
console.log(JSON.stringify(evidence, (key, value) => {
  if (key === "sourceSha256") return Object.entries(value);
  if (value && typeof value === "object" && Object.hasOwn(value, "token")) {
    const { token: projectAsset, ...rest } = value;
    return { projectAsset, ...rest };
  }
  return value;
}, 2));
