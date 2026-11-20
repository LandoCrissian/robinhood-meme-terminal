import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";
import {verifyHistoryPublicData} from "./public-source-checksums.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const proofPath = "docs/evidence/rmt-task090/history-adjudication/exact-public-identities.json";
const proofSha256 = "770f8156c47173de1fcdb926b6be0d4fd146179283012e600d05b2b7372f20bd";
const sourceCommit = "b6d094d1fc446fd84ab162e546a487a5304b8b4d";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const blobSha1 = bytes => createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
const git = (commit, path) => execFileSync("git", ["show", `${commit}:${path}`],
  {cwd: repository, windowsHide: true, maxBuffer: 32 * 1024 * 1024});
const graduation = "docs/evidence/rmt-task090/graduation/";
const harvest = "docs/evidence/rmt-task090/harvest/";
const exactLocations = new Map([
  [graduation + "exact-conservation-and-graph.json:50", "graduation"],
  [graduation + "final-conservation-and-graph.json:50", "graduation"],
  [graduation + "manifest.json:135", "graduation"],
  ...[231, 833, 1488, 2342, 2893, 3470, 4108].map(line => [harvest + "proof-results.json:" + line, "harvest"]),
]);
const descriptor = row => ({fingerprint: typeof row?.Fingerprint === "string" ? row.Fingerprint.slice(0, 400) : "invalid",
  ruleId: typeof row?.RuleID === "string" ? row.RuleID.slice(0, 80) : "invalid"});
const sourceLine = (bytes, line) => bytes.toString().split(/(?<=\n)/)[line - 1];

function receiptValues(proofs, read) {
  const artifact = (row, path) => {
    assert.equal(row.commit, sourceCommit); assert.equal(row.path, path);
    const bytes = read(row.commit, row.path);
    assert.equal(blobSha1(bytes), row.gitBlobSha1); assert.equal(sha(bytes), row.contentDigest.hex);
    return bytes;
  };
  const g = proofs.graduation;
  assert.equal(g.kind, "LOCAL_FACTORY_TEXT_CREATE_AND_CURVECREATED_RECEIPT");
  assert.equal(g.contractType, "RMTLaunchCurveTokenV2");
  const trace = artifact(g.artifact, graduation + "canonical-full-trace.txt");
  const lines = [g.creation, g.registration, g.receipt].map(row => {
    const line = sourceLine(trace, row.line); assert.equal(sha(line), row.contentDigest.hex); return line;
  });
  const address = lines[0].match(/new RMTLaunchCurveTokenV2@(0x[0-9a-f]{40})/i)?.[1];
  assert.ok(address); assert.equal(sha(address.toLowerCase()), g.publicValueDigest.hex);
  assert.ok(lines[1].includes("emit ProjectRegistered(token: RMTLaunchCurveTokenV2: [" + address + "]"));
  assert.ok(lines[2].includes("emit CurveCreated(token: RMTLaunchCurveTokenV2: [" + address + "]"));
  assert.ok(lines[2].includes("supply: 1000000000000000000000000000"));
  assert.ok(lines[2].includes('name: "Task090 graduation proof"'));

  const h = proofs.harvest;
  assert.equal(h.kind, "LOCAL_FACTORY_CREATE2_WITH_CANONICAL_RETURNED_RUNTIME");
  assert.equal(h.contractType, "RMTLaunchCurveTokenV2");
  const expanded = gunzipSync(artifact(h.artifact, harvest + "foundry-full-traces-final.json.gz"), {maxOutputLength: 32 * 1024 * 1024});
  assert.equal(expanded.length, h.expandedBytes); assert.equal(sha(expanded), h.expandedContentDigest.hex);
  const suites = JSON.parse(expanded);
  const compilation = JSON.parse(gunzipSync(artifact(h.canonicalCompilation,
    "docs/evidence/rmt-task090/migration/canonical-compilation.json.gz"), {maxOutputLength: 2 * 1024 * 1024}));
  assert.equal(compilation.manifest.inputSha256, h.canonicalInputSha256);
  assert.equal(h.canonicalInputSha256, "66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10");
  const canonical = compilation.artifacts.RMTLaunchCurveTokenV2;
  assert.equal(h.receipts.length, 5);
  const seen = new Set(), values = new Set();
  for (const receipt of h.receipts) {
    assert.equal(receipt.suite, "test/Task090HarvestProof.t.sol:Task090HarvestProofTest");
    assert.ok(!seen.has(receipt.test)); seen.add(receipt.test);
    const result = suites[receipt.suite].test_results[receipt.test]; assert.equal(result.status, "Success");
    const phases = result.traces.filter(([phase]) => phase === receipt.phase); assert.equal(phases.length, 1);
    assert.equal(receipt.phase, "Setup");
    const arena = phases[0][1].arena, frame = arena[receipt.frame], parent = arena[receipt.parent];
    assert.equal(frame.idx, receipt.frame); assert.equal(frame.parent, receipt.parent);
    assert.equal(frame.trace.kind, "CREATE2"); assert.equal(frame.trace.success, true); assert.equal(frame.trace.status, "Return");
    assert.match(frame.trace.address, /^0x[0-9a-f]{40}$/i);
    assert.equal(sha(frame.trace.address.toLowerCase()), receipt.createdAddressDigest.hex);
    assert.equal(frame.trace.caller.toLowerCase(), receipt.factoryAddress.toLowerCase());
    assert.equal(parent.trace.address.toLowerCase(), receipt.factoryAddress.toLowerCase());
    assert.equal(parent.trace.kind, "CALL"); assert.equal(parent.trace.success, true);
    assert.equal(receipt.factoryCreateSelector, "0x71c51865");
    assert.equal(parent.trace.data.slice(0, 10), receipt.factoryCreateSelector);
    assert.equal(parent.trace.output.slice(2, 26), "0".repeat(24));
    assert.equal("0x" + parent.trace.output.slice(26, 66), frame.trace.address.toLowerCase());
    assert.ok(frame.trace.data.startsWith(canonical.bytecode));
    assert.equal(frame.trace.output, canonical.runtime);
    assert.equal(sha(Buffer.from(frame.trace.output.slice(2), "hex")), receipt.returnedRuntimeContentDigest.hex);
    values.add(receipt.createdAddressDigest.hex);
  }
  assert.equal(values.size, 1);
  return {graduation: g.publicValueDigest.hex, harvest: [...values][0]};
}

/** Ten immutable public-address records AFTER the unchanged raw scan. The prior
 * seven-record verifier, detector policy, ignore file and runtime canary remain
 * binding. No generic address/path exception or future record is admitted. */
export function verifyTask090HistoryPublicData(findings, options = {}) {
  try {
    assert.ok(Array.isArray(findings) && findings.length <= 1024);
    const {proofBytes = readFileSync(new URL("../../" + proofPath, import.meta.url)), ...legacyOptions} = options;
    assert.equal(sha(Buffer.from(proofBytes).toString().replaceAll("\r\n", "\n")), proofSha256);
    const policy = JSON.parse(proofBytes); assert.equal(policy.schemaVersion, 1); assert.equal(policy.sourceCommit, sourceCommit);
    assert.equal(policy.records.length, 10);
    const readGit = options.readGit ?? git, cache = new Map();
    const read = (commit, path) => {
      const key = commit + ":" + path;
      if (!cache.has(key)) {
        const bytes = readGit(commit, path); assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 32 * 1024 * 1024);
        cache.set(key, bytes);
      }
      return cache.get(key);
    };
    const values = receiptValues(policy.receiptProofs, read), proof = new Map();
    for (const record of policy.records) {
      assert.equal(record.commit, sourceCommit); assert.equal(record.ruleId, "generic-api-key");
      assert.equal(record.publicKind, "PUBLIC_SYNTHETIC_ERC20_ADDRESS");
      assert.equal(exactLocations.get(record.path + ":" + record.line), record.receiptProof);
      assert.equal(record.fingerprint, `${sourceCommit}:${record.path}:generic-api-key:${record.line}`);
      const bytes = read(record.commit, record.path); assert.ok(bytes.length <= 1024 * 1024);
      assert.equal(blobSha1(bytes), record.gitBlobSha1); assert.equal(sha(bytes), record.blobContentDigest.hex);
      const line = sourceLine(bytes, record.line); assert.equal(sha(line), record.lineContentDigest.hex);
      const document = JSON.parse(bytes), value = record.jsonPointer.reduce((item, key) => item[key], document);
      assert.equal(record.jsonPointer.at(-1), "token"); assert.match(value, /^0x[0-9a-f]{40}$/i);
      assert.ok(line.includes(`"token": "${value}"`));
      assert.equal(sha(value.toLowerCase()), record.publicValueDigest.hex);
      assert.equal(record.publicValueDigest.hex, values[record.receiptProof]);
      if (record.receiptProof === "harvest") assert.equal(record.jsonPointer.slice(0, -1).reduce((item, key) => item[key], document).success, true);
      assert.ok(!proof.has(record.fingerprint)); proof.set(record.fingerprint, record);
    }
    assert.equal(proof.size, 10);
    const supplementalRows = [], legacyRows = [];
    for (const row of findings) (proof.has(row?.Fingerprint) ? supplementalRows : legacyRows).push(row);
    const legacy = verifyHistoryPublicData(legacyRows, {...legacyOptions, readGit: read});
    const classified = [...legacy.classified], unclassified = [...legacy.unclassified], seen = new Set();
    for (const row of supplementalRows) {
      const record = proof.get(row.Fingerprint);
      const valid = !seen.has(row.Fingerprint) && row.RuleID === record.ruleId && row.Commit === record.commit
        && row.File === record.path && row.StartLine === record.line && row.EndLine === record.line
        && row.StartColumn === record.startColumn && row.EndColumn === record.endColumn
        && row.Secret === "REDACTED" && typeof row.Match === "string" && sha(row.Match) === record.redactedMatchContentDigest.hex;
      if (valid) {
        seen.add(row.Fingerprint);
        classified.push({fingerprint: record.fingerprint, kind: record.publicKind, commit: record.commit,
          gitBlobSha1: record.gitBlobSha1, lineContentDigest: record.lineContentDigest,
          publicValueDigest: record.publicValueDigest, receiptProof: record.receiptProof});
      } else unclassified.push(descriptor(row));
    }
    const missing = [...legacy.missing, ...[...proof.keys()].filter(key => !seen.has(key))];
    return {...legacy, rawFindingCount: findings.length, classified, unclassified, missing,
      status: unclassified.length || missing.length ? "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING" : "PASSED_EXACT_PUBLIC_DATA_ONLY",
      rawScanPassed: findings.length === 0, detectorsChanged: false, ignoreAdded: false,
      financialSecurityClearance: false, productionAuthorization: false,
      task090Proof: "ten-exact-b6d094d1-synthetic-erc20-identities-v1"};
  } catch {
    throw Error("Exact Task090 public Git identity proof is unavailable or changed");
  }
}
