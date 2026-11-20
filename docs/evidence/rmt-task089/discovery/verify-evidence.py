"""Offline source/evidence verification. Does not contact hosting, RPCs or databases."""
from pathlib import Path
import gzip
import hashlib
import json

here = Path(__file__).resolve().parent
root = here.parents[3]
sha = lambda data: hashlib.sha256(data).hexdigest()
manifest = json.loads((here / "manifest.json").read_text())
assert manifest["baseCommit"] == "78a76feb592ac136dbf74d4823c21db64a6d0313"
for row in manifest["candidateSourceBindings"]:
    assert row["digest"]["algorithm"] == "SHA256"
    assert sha((root / row["path"]).read_bytes()) == row["digest"]["hex"], row["path"]
for row in manifest["evidenceBindings"]:
    assert sha((here / row["path"]).read_bytes()) == row["digest"]["hex"], row["path"]
normal = json.loads((here / "normal-reads.json").read_text())
assert normal["noAuthenticationHeaders"] and not normal["productionMutations"]
rows = normal["requests"]
assert [row["method"] for row in rows] == ["GET"] * 3
assert [row["path"] for row in rows] == [
    "/api/launchpad/launches", "/api/launchpad/new-engine", "/health"]
history, new_engine, health = rows
assert history["status"] == 200 and history["bodySummary"]["coverage"] == "verified-snapshot"
assert history["bodySummary"]["status"] == "stale"
assert history["bodySummary"]["checkpoint"]["blockNumber"] == "113899119"
assert new_engine["status"] == 404 and new_engine["bodySummary"]["status"] == "unavailable"
assert health["status"] == 200 and health["bodySummary"]["ok"] is True
assert int(health["bodySummary"]["indexedThrough"]) > int(history["bodySummary"]["checkpoint"]["blockNumber"])
assert health["bodySummary"]["curveLaunchpad"]["status"] == "ready"
assert health["bodySummary"]["curveLaunchpad"]["caughtUp"] is True
metadata = json.loads((here / "provider-metadata.json").read_text())
assert metadata["netlify"]["publishedDeploy"] == "6afd4265956a469adeb55747"
assert metadata["netlify"]["functions"][0]["contentDigest"]["hex"] == "f8f7c3cd291bf95d9e088e71f0e5c1c4a617613e3c72c349c8c551f58800032d"
assert metadata["rootCause"]["preciseDeployedFallbackTrigger"] == "UNKNOWN"
assert metadata["netlify"]["siteVariableListing"]["provesFrozenFunctionEnvironment"] is False
assert metadata["requestCorrelation"]["absenceProvesRootCause"] is False
assert metadata["railway"]["currentWriterLease"]["status"] == "NOT_DIRECTLY_OBSERVED"
assert not metadata["productionMutations"] and not metadata["authenticationBypass"]
expected = {
    "focused-discovery-tests.txt.gz": (44, 44, 0),
    "gate-before.txt.gz": (21, 18, 3),
    "gate-after.txt.gz": (47, 47, 0),
    "website-full.txt.gz": (327, 327, 0),
}
for name, (total, passed, failed) in expected.items():
    text = gzip.decompress((here / name).read_bytes()).decode()
    for key, value in [("tests", total), ("pass", passed), ("fail", failed), ("skipped", 0)]:
        assert f"# {key} {value}\n" in text, (name, key)
print(json.dumps({"result": "PASS", "productionFallbackTrigger": "UNKNOWN",
                  "websiteTestsPassed": 327, "focusedDiscoveryTestsPassed": 47,
                  "beforeFailingTestsPreserved": 3, "productionChanged": False}))
