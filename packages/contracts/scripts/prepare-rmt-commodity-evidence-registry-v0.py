#!/usr/bin/env python3
"""Hardened entrypoint for the synthetic registry release-preparation utility.

The implementation is kept in a sibling module so this entrypoint can enforce the
reviewed synthetic attestor key and bind both files into every prepared record.
Neither file accepts a production key or exposes a remote broadcast path.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ENTRYPOINT = Path(__file__).resolve()
IMPLEMENTATION = ENTRYPOINT.with_name("_prepare-rmt-commodity-evidence-registry-v0-impl.py")
EXPECTED_IMPLEMENTATION_GIT_BLOB = "85f9f994c4e8ba85f1acedb198bd2a0faf028925"
SYNTHETIC_ATTESTOR_KEY = "0xC0DE"
LEGACY_SYNTHETIC_ATTESTOR_KEY = "0xC4DE"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _git_blob_sha(path: Path) -> str:
    result = subprocess.run(
        ["git", "hash-object", str(path)],
        cwd=ENTRYPOINT.parent,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "git hash-object failed")
    return result.stdout.strip()


def _load_implementation() -> Any:
    if not IMPLEMENTATION.is_file():
        raise RuntimeError(f"release-preparation implementation is missing: {IMPLEMENTATION}")
    actual_blob = _git_blob_sha(IMPLEMENTATION)
    if actual_blob != EXPECTED_IMPLEMENTATION_GIT_BLOB:
        raise RuntimeError(
            "release-preparation implementation blob mismatch: "
            f"expected {EXPECTED_IMPLEMENTATION_GIT_BLOB}, received {actual_blob}"
        )
    spec = importlib.util.spec_from_file_location("rmt_commodity_evidence_release_impl", IMPLEMENTATION)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load release-preparation implementation")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


impl = _load_implementation()
_original_address_from_test_key = impl.address_from_test_key
_original_git_state = impl.git_state
_original_release_material = impl.release_material
_original_verify = impl.verify


def _reviewed_address_from_test_key(contracts: Path, key: str) -> str:
    # The original isolated implementation used a transposed fixture key. Route
    # that legacy literal to the canonical public attestor key used everywhere
    # else in the contract, tests, signing utility, and postflight verifier.
    if key.lower() == LEGACY_SYNTHETIC_ATTESTOR_KEY.lower():
        key = SYNTHETIC_ATTESTOR_KEY
    return _original_address_from_test_key(contracts, key)


def _clean_git_state(repo: Path) -> tuple[str, str]:
    commit, branch = _original_git_state(repo)
    tracked = [
        str(ENTRYPOINT.relative_to(repo)),
        str(IMPLEMENTATION.relative_to(repo)),
        "packages/contracts/scripts/install-v4-deps.sh",
    ]
    for cached in (False, True):
        command = ["git", "diff"] + (["--cached"] if cached else []) + [
            "--quiet",
            "--",
            *tracked,
        ]
        if subprocess.run(command, cwd=repo, check=False).returncode:
            raise impl.Stop("release entrypoint, implementation, or dependency installer has uncommitted changes")
    return commit, branch


def _hardened_release_material(admin: str, rpc: str) -> tuple[dict[str, Any], str]:
    record, deployment_data = _original_release_material(admin, rpc)
    _, contracts = impl.roots()
    expected_attestor = _original_address_from_test_key(contracts, SYNTHETIC_ATTESTOR_KEY)
    actual_attestor = record["syntheticParties"]["attestor"]["signingAddress"]
    if actual_attestor.lower() != expected_attestor.lower():
        raise impl.Stop(
            f"synthetic attestor mismatch: expected {expected_attestor}, received {actual_attestor}"
        )

    source = record.setdefault("source", {})
    source["preparationEntrypointPath"] = str(ENTRYPOINT.relative_to(impl.roots()[0]))
    source["preparationEntrypointSha256"] = _sha256(ENTRYPOINT)
    source["preparationImplementationPath"] = str(IMPLEMENTATION.relative_to(impl.roots()[0]))
    source["preparationImplementationSha256"] = _sha256(IMPLEMENTATION)
    source["preparationImplementationGitBlob"] = _git_blob_sha(IMPLEMENTATION)
    install_script = contracts / "scripts/install-v4-deps.sh"
    source["installScriptSha256"] = _sha256(install_script)
    source["canonicalSyntheticAttestorKeyLabel"] = SYNTHETIC_ATTESTOR_KEY
    return record, deployment_data


def _hardened_verify(record_path: Path, calldata_path: Path, rpc: str) -> None:
    record = json.loads(record_path.read_text(encoding="utf-8"))
    source = record.get("source", {})
    expected = {
        "preparationEntrypointSha256": _sha256(ENTRYPOINT),
        "preparationImplementationSha256": _sha256(IMPLEMENTATION),
        "preparationImplementationGitBlob": _git_blob_sha(IMPLEMENTATION),
        "canonicalSyntheticAttestorKeyLabel": SYNTHETIC_ATTESTOR_KEY,
    }
    for key, value in expected.items():
        if source.get(key) != value:
            raise impl.Stop(f"prepared record mismatch at source.{key}")
    _original_verify(record_path, calldata_path, rpc)


impl.address_from_test_key = _reviewed_address_from_test_key
impl.git_state = _clean_git_state
impl.release_material = _hardened_release_material
impl.verify = _hardened_verify


if __name__ == "__main__":
    try:
        raise SystemExit(impl.main())
    except RuntimeError as exc:
        print(f"Commodity evidence registry release stopped: {exc}", file=sys.stderr)
        raise SystemExit(1)
