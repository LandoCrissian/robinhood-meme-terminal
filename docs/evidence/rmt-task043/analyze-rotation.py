"""Run Slither 0.11.5 with every detector against the exact 4663 compiler closure."""

import argparse
import hashlib
from importlib.metadata import version
import json
import logging
import os
from pathlib import Path

from crytic_compile import CryticCompile
from crytic_compile.platform.solc_standard_json import SolcStandardJson
from slither import Slither
from slither.__main__ import get_detectors_and_printers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("standard_json", type=Path)
    parser.add_argument("solc", type=Path, help="Pinned compiler, named solc/solc.exe for Crytic Compile")
    parser.add_argument("source_dir", type=Path, help="Fresh directory for exact source bytes")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    assert version("slither-analyzer") == "0.11.5"
    compiler = args.solc.resolve(strict=True)
    root = args.source_dir.resolve()
    assert not root.exists()
    assert not args.output.exists()
    compiler_input = args.standard_json.read_bytes()
    data = json.loads(compiler_input)
    # This requests required AST/source maps from every contract. It leaves all
    # sources, remappings, optimizer settings and transformations intact.
    data["settings"]["outputSelection"] = {
        "*": {"": ["ast"], "*": ["abi", "devdoc", "userdoc", "evm.bytecode", "evm.deployedBytecode"]}
    }
    for path, unit in data["sources"].items():
        filename = (root / path).resolve()
        assert filename.is_relative_to(root) and filename.suffix == ".sol"
        assert "content" in unit
        filename.parent.mkdir(parents=True, exist_ok=True)
        filename.write_bytes(unit["content"].encode("utf-8"))
    # Crytic Compile resolves the actual standard-json executor via PATH.
    assert compiler.name in ("solc", "solc.exe")
    os.environ["PATH"] = str(compiler.parent) + os.pathsep + os.environ["PATH"]
    logging.basicConfig(level=logging.INFO)
    target = SolcStandardJson(data)
    compiled = CryticCompile(target, solc=str(compiler), solc_working_dir=str(root))
    analysis_input = json.dumps(target.to_dict()).encode("utf-8")
    slither = Slither(compiled)
    detectors, _ = get_detectors_and_printers()
    for detector in sorted(detectors, key=lambda detector: detector.IMPACT):
        slither.register_detector(detector)
    findings = [finding for result in slither.run_detectors() for finding in result]
    report = {
        "tool": "Slither " + version("slither-analyzer"),
        "cryticCompile": version("crytic-compile"),
        "inputSha256": hashlib.sha256(compiler_input).hexdigest(),
        "analysisInputSha256": hashlib.sha256(analysis_input).hexdigest(),
        "compilerSha256": hashlib.sha256(compiler.read_bytes()).hexdigest(),
        "sources": len(data["sources"]),
        "detectorCount": len(detectors),
        "detectors": findings,
    }
    encoded = json.dumps(report, ensure_ascii=False, indent=2).replace(root.as_posix(), "<source-root>")
    encoded = encoded.replace(str(root).replace("\\", "\\\\"), "<source-root>")
    args.output.write_text(encoded + "\n", encoding="utf-8", newline="\n")
    high = sum(finding["impact"] == "High" for finding in findings)
    print(f"{len(detectors)} detectors, {len(findings)} findings, {high} high", flush=True)
    return 1 if high else 0


if __name__ == "__main__":
    raise SystemExit(main())
