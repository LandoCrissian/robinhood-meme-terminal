// Independent evidence for a reviewer. This script never edits the detector or its release decision.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(
  new URL("../../apps/launch-website/package.json", import.meta.url),
);
const {
  keccak256,
  stringToHex,
  encodeAbiParameters,
  encodeDeployData,
  getContractAddress,
} = require("viem");
const template = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        "../../docs/evidence/rmt-task090/migration/canonical-compilation.json.gz",
        import.meta.url,
      ),
    ),
  ),
).artifacts.RMTLaunchCurveTokenV2;
const factory = "0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3";
const bindings = new Map([
  [
    "docs/evidence/graduation-economics/measurements.json",
    [
      "0x0000000000000000000000000000000000ec0123",
      "isolated economics rehearsal",
      "Economics rehearsal",
    ],
  ],
  [
    "docs/evidence/token-market/market-replay.json",
    [
      "0x0000000000000000000000000000000000ec0190",
      "isolated market lifecycle",
      "Market rehearsal",
    ],
  ],
]);
const [findings, review] = process.argv
  .slice(2)
  .map((p) => JSON.parse(readFileSync(p, "utf8")));
const rows = new Map(findings.map((f) => [f.Fingerprint, f]));
assert.equal(rows.size, findings.length);
assert.equal(review.rawFindingCount, findings.length);
assert.ok(review.unclassified.length);
const counts = new Map();
for (const f of review.unclassified) {
  const row = rows.get(f.fingerprint);
  assert.ok(
    row && row.RuleID === "generic-api-key" && row.Secret === "REDACTED",
  );
  assert.ok(
    /^[0-9a-f]{40}$/.test(row.Commit) &&
      bindings.has(row.File) &&
      row.StartLine === row.EndLine,
  );
  const [from, intent, name] = bindings.get(row.File);
  const salt = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [from, keccak256(stringToHex(intent))],
    ),
  );
  const pub = getContractAddress({
    opcode: "CREATE2",
    from: factory,
    salt,
    bytecode: encodeDeployData({
      abi: template.abi,
      bytecode: template.bytecode,
      args: [name, "ECON"],
    }),
  });
  const file = execFileSync("git", ["show", row.Commit + ":" + row.File], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4000000,
  });
  const line = file.split("\n")[row.StartLine - 1];
  const match = /^\s*"token": "(0x[0-9a-fA-F]{40})",?\s*$/.exec(line);
  assert.ok(
    match &&
      match[1].toLowerCase() === pub.toLowerCase() &&
      row.Match === 'token": "REDACTED"',
  );
  counts.set(row.File, (counts.get(row.File) ?? 0) + 1);
}
console.log(
  JSON.stringify({
    rawFindings: findings.length,
    unclassified: review.unclassified.length,
    reproducedPublicContractAddresses: Object.fromEntries(counts),
    automatedDecision: review.status,
  }),
);
