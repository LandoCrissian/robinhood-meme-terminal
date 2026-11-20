"""Verify Task088B source bindings and retained failing-gate evidence offline."""
import gzip
import hashlib
import json
from pathlib import Path
import re

here = Path(__file__).resolve().parent
root = here.parents[3]
read_json = lambda path: json.loads(path.read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()
manifest = read_json(here / "reproduction-manifest.json")
profile = read_json(root / "docs/evidence/fixed-supply-security/4663-profile.json")
old = json.loads(gzip.decompress((root / "docs/evidence/fixed-supply-security/slither-4663.json.gz").read_bytes()))
new = json.loads(gzip.decompress((here / "slither-4663.json.gz").read_bytes()))
matrix = read_json(here / "finding-matrix.json")
input_bytes = gzip.decompress((here / "fixed-supply-4663.json.gz").read_bytes())
compiler_input = json.loads(input_bytes)
assert sha(input_bytes) == profile["inputSha256"] == new["inputSha256"] == manifest["scanner"]["inputSha256"]
assert new["analysisInputSha256"] == old["analysisInputSha256"]
assert len(compiler_input["sources"]) == 66
for path, digest in profile["sourceSha256"]:
    assert sha(compiler_input["sources"][path]["content"].encode()) == digest, path
for path, digest in profile["originalSourceSha256"]:
    current = (root / "packages/contracts" / path).read_text().replace("\r\n", "\n")
    assert sha(current.encode()) == digest, "current first-party source changed: " + path
assert manifest["actualSolcSha256"] == "d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef"
assert manifest["solcExecutionWrapperSha256"] == new["compilerSha256"]
assert sha((root / "docs/evidence/rmt-task043/analyze-rotation.py").read_bytes()) == manifest["analyzerScriptSha256"]
assert sha((root / "packages/contracts/scripts/fixed-supply-profile.mjs").read_bytes()) == manifest["retainedProfileHelperSha256"]
for binding in manifest["localTestSourceBindings"]:
    assert binding["contentDigest"]["algorithm"] == "SHA-256"
    assert sha((root / binding["relativePath"]).read_bytes()) == binding["contentDigest"]["hex"], binding["relativePath"]
assert new["tool"] == "Slither 0.11.5" and new["cryticCompile"] == "0.3.11"
assert new["detectorCount"] == 101 and len(new["detectors"]) == 233
assert {r["id"] for r in old["detectors"]} == {r["id"] for r in new["detectors"]}
highs = {r["id"] for r in new["detectors"] if r["impact"] == "High"}
assert len(highs) == 22 == len(matrix["findings"])
assert highs == {r["id"] for r in matrix["findings"]}
assert (here / "slither-exit.txt").read_text().strip() == "1"
assert manifest["scanner"]["strictExit"] == 1 and manifest["findingsCleared"] == 0
assert all(r["newDisposition"] == "REPRODUCED_HIGH_STRICT_GATE_UNCLEARED" for r in matrix["findings"])
assert (here / "foundry-exit.txt").read_text().strip() == "0"
log = (here / "foundry.log").read_text()
summary = re.search(r"Ran (\d+) test suites.*?: (\d+) tests passed, (\d+) failed, (\d+) skipped", log)
assert summary and tuple(map(int, summary.groups())) == (14, 112, 0, 0)
passed = set(re.findall(r"\[PASS\] (test\w+)\(", log))
for finding in matrix["findings"]:
    assert set(finding["existingSyntheticTestNames"]) <= passed, finding["id"]
assert not manifest["contractChanges"] and not manifest["scannerPolicyChanges"] and not manifest["productionChanges"]
for binding in manifest["evidenceBindings"]:
    assert binding["contentDigest"]["algorithm"] == "SHA-256"
    assert sha((here / binding["relativePath"]).read_bytes()) == binding["contentDigest"]["hex"], binding["relativePath"]
print(json.dumps({"result": "PASS", "sources": 66, "unchangedFirstPartySources": 16,
                  "allFindingIds": 233, "unclearedHighIds": 22, "detectors": 101,
                  "strictScannerExit": 1, "foundry": {"suites": 14, "passed": 112, "failed": 0, "skipped": 0},
                  "financialActivationAuthorized": False}))
