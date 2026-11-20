"""Reconstruct the retained review input from exact checked-out source bytes.

This validates every source hash and transformation and the complete Standard
JSON digest. It does not compile, connect to a chain or relax compiler policy.
"""
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[4]
manifest = json.loads((root / "docs/evidence/fixed-supply-security/4663-profile.json").read_text())
source_root = root / "packages/contracts"
sources = {}
def sha(data):
    return hashlib.sha256(data).hexdigest()
for name, expected in manifest["sourceSha256"]:
    text = (source_root / name).read_text(encoding="utf-8").replace("\r\n", "\n")
    sources[name] = {"content": text}
for name, expected in manifest["originalSourceSha256"]:
    assert sha(sources[name]["content"].encode()) == expected, "original source mismatch " + name
for change in manifest["transformations"]:
    text = sources[change["file"]]["content"]
    assert text.count(change["from"]) == change["occurrences"], "transformation mismatch"
    sources[change["file"]]["content"] = text.replace(change["from"], change["to"])
for name, expected in manifest["sourceSha256"]:
    assert sha(sources[name]["content"].encode()) == expected, "review source mismatch " + name
selection = {name: {"*": ["abi", "evm.bytecode.object", "evm.deployedBytecode"]}
             for name, _ in manifest["originalSourceSha256"]}
data = {"language": "Solidity", "sources": sources,
        "settings": {**manifest["compilerSettings"], "outputSelection": selection}}
encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
assert sha(encoded) == manifest["inputSha256"], "complete Standard JSON digest mismatch"
output = Path(sys.argv[1])
assert not output.exists(), "fresh output path required"
output.write_bytes(encoded)
print(json.dumps({"sources": len(sources), "originalSources": len(selection),
                  "inputSha256": sha(encoded), "output": str(output)}))
