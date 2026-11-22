"""Bind the current reader and all retained Task089 evidence to their reviewed bytes."""
from pathlib import Path
import hashlib
import json
import subprocess

root = Path(__file__).resolve().parents[3]
here = root / "docs/evidence/rmt-task089/discovery"
sha = lambda data: hashlib.sha256(data).hexdigest()
manifest = json.loads((here / "manifest.json").read_bytes())
historical = "27f19787ed0a2d904ba4508d2adfab1773e82e67"
# The current reader includes the deployed 503 retry and the checked empty
# token response. Preserve every original binding and verify the current files
# separately; an edit outside these two reviewed files still fails.
current_reader = {
    "apps/launch-website/lib/server/production-discovery.ts": "411eef7e32a493b23af04c49f7e633bc9ce965b0b0038a31915fd6632a06bd8f",
    "apps/launch-website/lib/server/production-discovery.test.ts": "399034150c035273bed4885ae9806f097e7b0c7985a55f56a3b2106cedd1245d",
}
for row in manifest["candidateSourceBindings"]:
    assert row["digest"]["algorithm"] == "SHA256"
    path = row["path"]
    original = subprocess.check_output(["git", "show", historical + ":" + path], cwd=root)
    assert sha(original) == row["digest"]["hex"], path
    assert sha((root / path).read_bytes()) == current_reader.get(path, row["digest"]["hex"]), path
for row in manifest["evidenceBindings"]:
    assert sha((here / row["path"]).read_bytes()) == row["digest"]["hex"], row["path"]
