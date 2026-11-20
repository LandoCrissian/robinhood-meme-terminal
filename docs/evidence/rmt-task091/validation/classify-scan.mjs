import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync, realpathSync} from "node:fs";
import {resolve, relative, isAbsolute, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {gunzipSync} from "node:zlib";
import {parseArgs} from "node:util";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const base = "27f19787ed0a2d904ba4508d2adfab1773e82e67";
const inputSha = "66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10";
const indexPath = "docs/evidence/rmt-task091/journey/evidence-index.json";
const indexSha = "88b945fe88728ad3b6663cb86de8a5e9050e1dc5e7271c8cce9bc584a18a5b7e";
const attemptPath = "docs/evidence/rmt-task091/governance/current/source-publication-attempt.json";
const attemptSha = "abe752a65bd44b912917f1d4c6c42058182176a1711e0cefeb2862b0ea83e15f";
const sourcePath = "docs/evidence/rmt-task091/governance/source-publication/solc-standard-input-4663.json.gz";
const producerPath = "docs/evidence/rmt-task091/validation/classify-scan.mjs";
const hash = b => createHash("sha256").update(b).digest("hex");
const read = p => readFileSync(resolve(root, p));
const json = b => JSON.parse(b);
const unpack = b => gunzipSync(b, {maxOutputLength: 32 * 1024 * 1024});
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// This adjudicates exact public records AFTER the unchanged raw scan. It does
// not suppress a rule, alter a raw result, or admit arbitrary address-shaped text.
export function classifyScan(directory) {
  const scan = resolve(directory), manifestBytes = readFileSync(resolve(scan, "scan-manifest.json"));
  const m = json(manifestBytes), reportBytes = readFileSync(resolve(scan, "gitleaks-redacted.json"));
  const includesProducer = m.inventory.some(entry => entry.path === producerPath);
  const expectedRawCount = includesProducer ? 288 : 287;
  assert.equal(m.base, base); assert.equal(m.rawExit, 1); assert.equal(m.rawFindingCount, expectedRawCount);
  assert.equal(hash(reportBytes), m.reportSha256); assert.equal(readFileSync(resolve(scan, "raw-exit-code.txt"), "utf8").trim(), "1");
  assert.equal(m.scanner.version, "8.30.1");
  assert.equal(m.scanner.executableSha256, "17157e2ee8b76fc8b1d8bee607a250e34b8a8023c8bc81822d4b5ee4d78fcb7c");
  for (const [p, h] of Object.entries(m.unchangedPolicyDigests)) assert.equal(hash(read(p)), h, "Policy drift");
  const contents = new Map(), pathRows = new Map();
  for (const entry of m.inventory) {
    assert.ok(!isAbsolute(entry.path) && !entry.path.split(/[\\/]/).includes(".."));
    const real = realpathSync(resolve(root, entry.path)), rel = relative(realpathSync(root), real);
    assert.ok(rel && !rel.startsWith(".." + sep) && !isAbsolute(rel));
    const bytes = read(entry.path);
    assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.contentDigest.hex, "Frozen source drift: " + entry.path);
    assert.ok(!contents.has(entry.scanPath)); contents.set(entry.scanPath, bytes); pathRows.set(entry.path, entry);
    if (entry.gzip) {
      const raw = unpack(bytes); assert.equal(raw.length, entry.gzip.bytes); assert.equal(hash(raw), entry.gzip.contentDigest.hex);
      assert.ok(!contents.has(entry.gzip.scanPath)); contents.set(entry.gzip.scanPath, raw);
    }
  }
  assert.equal(m.sourceFileCount, m.inventory.length);
  assert.equal(m.expandedGzipCount, m.inventory.filter(e => e.gzip).length);
  assert.equal(hash(read(indexPath)), indexSha, "CI index is not the exact verified base report index");
  const index = json(read(indexPath)); assert.equal(index.head, base); assert.equal(index.reports.length, 11);
  assert.equal(index.sourceAuditSha256, "bd586b2cb3c2f8f28d2f6c496a1668ba0238191b20c6b2fa0c65df4595c9562b");
  const reports = new Map(), tokens = new Map();
  const admit = (token, receipt, origin) => {
    assert.match(token, /^0x[0-9a-fA-F]{40}$/); assert.equal(receipt.status, "success");
    assert.match(receipt.transactionHash, /^0x[0-9a-fA-F]{64}$/); assert.match(receipt.blockHash, /^0x[0-9a-fA-F]{64}$/);
    assert.ok(BigInt(receipt.blockNumber) > 0n);
    assert.ok(!tokens.has(token.toLowerCase()), "Duplicate token origin"); tokens.set(token.toLowerCase(), {token, origin, creation: receipt});
  };
  for (const e of index.reports) {
    const packed = read(e.path); assert.equal(hash(packed), e.gzipSha256 || e.rawSha256);
    const raw = e.gzipSha256 ? unpack(packed) : packed; assert.equal(hash(raw), e.rawSha256);
    assert.equal(e.status, "PASS"); assert.ok(pathRows.has(e.path)); reports.set(e.path.replace(/\.gz$/, ""), {entry: e, report: json(raw)});
    const r = json(raw);
    if (e.kind === "creator") {
      assert.equal(r.candidateCommit, base); assert.equal(r.chainId, 31337); assert.equal(r.receipt.status, "0x1");
      assert.equal(r.indexed.status, "created"); assert.equal(r.indexed.chainId, 31337);
      assert.equal(r.indexed.creation.transactionHash, r.receipt.hash); assert.equal(r.indexed.creation.blockHash, r.receipt.blockHash);
      assert.equal(BigInt(r.indexed.creation.blockNumber), BigInt(r.receipt.blockNumber));
      admit(r.indexed.token, {...r.indexed.creation, status: "success"}, e.path + "#indexed.creation+receipt");
      assert.equal(r.successorEarnings.synthetic, true); assert.equal(r.successorEarnings.chainId, 31337);
      assert.equal(r.successorEarnings.status, "passed");
      assert.ok(r.successorEarnings.receipts.some(x => x.transactionHash === r.successorEarnings.creation.transactionHash && x.status === "success"));
      admit(r.successorEarnings.token, r.successorEarnings.creation, e.path + "#successorEarnings.creation");
    } else if (e.kind === "wallet-claim-wallet-acceptance") {
      assert.equal(r.chainId, 31337); assert.equal(r.productionExecution, false); assert.equal(r.status, "passed");
      assert.equal(r.projects.length, 3);
      for (const p of r.projects) {
        assert.ok(r.receipts.some(receipt => receipt.transactionHash === p.creation.transactionHash
          && receipt.blockHash === p.creation.blockHash && receipt.blockNumber === p.creation.blockNumber
          && receipt.status === "success"), "Wallet creation must be an actual successful retained receipt");
        admit(p.token, p.creation, e.path + "#projects[].creation");
      }
    }
  }
  assert.equal(tokens.size, 14, "Only the fourteen independently created synthetic tokens are public-classified");
  const input = unpack(read(sourcePath)); assert.equal(hash(input), inputSha);
  const sources = json(input).sources;
  const expression = "mapping(address token => RMTLaunchCurveLpFeeLedgerV1 ledger) public lpFeeLedger;";
  assert.equal(sources["src/RMTV4CurveGraduationV1.sol"].content.split("\n")[113].trim(), expression);
  assert.equal(hash(read(attemptPath)), attemptSha, "Public explorer response capture drift");
  const attempts = json(read(attemptPath)); assert.equal(attempts.requests.length, 4); assert.equal(attempts.apiKeyUsed, false);
  const guids = new Map(), sourceReports = new Set([sourcePath.replace(/\.gz$/, "")]);
  for (const req of attempts.requests) {
    assert.equal(req.compilerInputSha256, inputSha); assert.equal(req.httpStatus, 200);
    assert.equal(hash(Buffer.from(req.responseBody)), req.responseBodySha256);
    const response = json(req.responseBody); assert.equal(response.status, "1"); assert.equal(response.result, req.apiResult);
    assert.equal(response.message, req.apiMessage); assert.ok(response.result.startsWith(req.address.slice(2).toLowerCase()));
    const payloadPath = "docs/evidence/rmt-task091/governance/source-publication/" + req.id + ".request.json.gz";
    const payload = read(payloadPath); assert.equal(hash(payload), req.payloadGzipSha256);
    const p = json(unpack(payload)); assert.ok(same(p.address, req.address)); assert.ok(same(p.fields.contractaddress, req.address));
    assert.equal(p.compilerInputSha256, inputSha); assert.equal(hash(Buffer.from(p.fields.sourceCode)), inputSha);
    assert.equal(p.fields.sourceCode, input.toString()); sourceReports.add(payloadPath.replace(/\.gz$/, ""));
    guids.set(response.result, {id: req.id, address: req.address, responseBodySha256: req.responseBodySha256, payloadGzipSha256: req.payloadGzipSha256});
  }
  function identify(row) {
    assert.equal(row.RuleID, "generic-api-key"); assert.equal(row.Secret, "REDACTED"); assert.equal(row.StartLine, row.EndLine);
    const marker = "/snapshot/", file = row.File.replaceAll("\\", "/"); assert.equal(file.split(marker).length, 2);
    const scanPath = file.split(marker)[1], bytes = contents.get(scanPath); assert.ok(bytes, "Finding outside frozen inventory");
    const line = bytes.toString().split(/\r?\n/)[row.StartLine - 1]; assert.equal(typeof line, "string");
    const path = scanPath.replace(/^(source|expanded)\//, "");
    let options = [];
    if (scanPath.startsWith("expanded/") && reports.has(path) && row.Match === 'token": "REDACTED"')
      options = [...tokens.values()].flatMap(t => [...new Set([t.token, t.token.toLowerCase()])]
        .map(value => ({value, category: "PUBLIC_SYNTHETIC_TOKEN_CREATION", proof: t})));
    else if (scanPath === "source/" + attemptPath && row.Match === 'apiResult": "REDACTED"')
      options = [...guids].map(([value, proof]) => ({value, category: "PUBLIC_EXPLORER_VERIFICATION_JOB", proof}));
    else if (((scanPath.startsWith("expanded/") && sourceReports.has(path))
      || (includesProducer && scanPath === "source/" + producerPath)) && row.Match === "token => REDACTED ")
      options = [{value: "RMTLaunchCurveLpFeeLedgerV1", category: "PUBLIC_PINNED_SOLIDITY_TYPE", proof: {compilerInputSha256: inputSha, source: "src/RMTV4CurveGraduationV1.sol", line: 114}}];
    for (const option of options) {
      const expected = row.Match.replace("REDACTED", option.value), length = row.EndColumn - row.StartColumn + 1;
      if (length !== expected.length) continue;
      for (const shift of [1, 2]) {
        const at = row.StartColumn - shift;
        if (at >= 0 && line.slice(at, at + length) === expected)
          return {scanPath, line: row.StartLine, startColumn: row.StartColumn, endColumn: row.EndColumn, coordinateShift: shift, ...option};
      }
    }
    throw new Error("UNKNOWN_FINDING_REFUSED: " + scanPath + ":" + row.StartLine);
  }
  const raw = json(reportBytes); assert.equal(raw.length, expectedRawCount);
  const classified = raw.map(identify), counts = {};
  for (const x of classified) counts[x.category] = (counts[x.category] || 0) + 1;
  assert.equal(counts.PUBLIC_EXPLORER_VERIFICATION_JOB, 4);
  assert.equal(counts.PUBLIC_PINNED_SOLIDITY_TYPE, includesProducer ? 6 : 5);
  assert.equal(counts.PUBLIC_SYNTHETIC_TOKEN_CREATION, 278); assert.equal(Object.keys(counts).length, 3);
  // Negative control retains the exact valid path/shape/coordinates and inserts
  // an unrecognized token in only the in-memory frozen line. No scan is weakened.
  const canary = structuredClone(raw.find(r => r.Match === 'token": "REDACTED"'));
  const key = canary.File.replaceAll("\\", "/").split("/snapshot/")[1], prior = contents.get(key);
  const lines = prior.toString().split(/\r?\n/), original = lines[canary.StartLine - 1];
  const found = identify(canary); lines[canary.StartLine - 1] = original.replace(found.value, "0x1212121212121212121212121212121212121212");
  contents.set(key, Buffer.from(lines.join("\n")));
  assert.throws(() => identify(canary), /UNKNOWN_FINDING_REFUSED/); contents.set(key, prior);
  return {schemaVersion: 1, status: "ALL_EXACT_PUBLIC_MATCHES_CLASSIFIED_RAW_FAILURE_PRESERVED", base,
    manifestSha256: hash(manifestBytes), reportSha256: hash(reportBytes), rawExit: 1, rawFindings: expectedRawCount,
    unknownFindings: 0, classificationCounts: counts, admittedSyntheticTokenCount: tokens.size,
    indexSha256: indexSha, compilerInputSha256: inputSha, unknownTokenCanary: "REJECTED",
    detectorOrIgnoreChanges: false, rawGateCleared: false, financialActivationAuthorized: false, findings: classified};
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const {values} = parseArgs({options: {scan: {type: "string"}, output: {type: "string"}}});
  assert.ok(values.scan && values.output, "--scan and --output external directory required");
  const outside = relative(resolve(root), resolve(values.output));
  assert.ok(outside.startsWith(".." + sep) || isAbsolute(outside), "Derived classification must be written outside the repository");
  const result = classifyScan(values.scan); writeFileSync(resolve(values.output, "public-classification.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({status: result.status, rawExit: result.rawExit, rawFindings: result.rawFindings, unknownFindings: result.unknownFindings, classificationCounts: result.classificationCounts, canary: result.unknownTokenCanary}));
}
