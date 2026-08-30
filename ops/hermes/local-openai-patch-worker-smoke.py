#!/usr/bin/env python3
"""Deterministic protocol/path smoke for the local patch-only adapter."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile


HERE = Path(__file__).resolve().parent
ADAPTER = HERE / "workers" / "local-openai-patch-worker.py"
SPEC = importlib.util.spec_from_file_location("rmt_local_patch_worker", ADAPTER)
assert SPEC and SPEC.loader
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def fail(message: str) -> None:
    raise AssertionError(message)


def expect_rejected(label: str, function) -> None:
    try:
        function()
    except worker.PatchProtocolError:
        print(f"PASS: {label}")
        return
    fail(f"{label} should be rejected")


def edit(path: str, operation: str, expected, content: str) -> dict:
    return {
        "path": path,
        "operation": operation,
        "expectedSha256": expected,
        "content": content,
    }


def document(edits: list[dict], decision: str = "edit") -> dict:
    return {
        "schemaVersion": 1,
        "decision": decision,
        "reason": "bounded smoke",
        "edits": edits,
    }


def validate(root: Path, payload: dict, allowed=None):
    return worker.validate_edit_batch(
        payload,
        worktree=root,
        allowed_paths=allowed or ["ops/hermes/canary/"],
        forbidden_paths=[root.parent / "task.md", root.parent / "validator.sh", ADAPTER],
        git_common_dir=root / ".git",
    )


with tempfile.TemporaryDirectory(prefix="rmt-patch-smoke-") as temporary:
    sandbox = Path(temporary)
    root = sandbox / "repo"
    root.mkdir()
    (root / ".git").mkdir()
    (sandbox / "task.md").write_text("task\n", encoding="utf-8")
    (sandbox / "validator.sh").write_text("validator\n", encoding="utf-8")
    canary = root / "ops" / "hermes" / "canary"
    canary.mkdir(parents=True)
    existing = canary / "existing.txt"
    existing.write_text("before\n", encoding="utf-8")
    existing_sha = hashlib.sha256(existing.read_bytes()).hexdigest()

    parsed = worker.parse_complete_json(json.dumps(document([edit(
        "ops/hermes/canary/new.txt", "create", None, "created\n"
    )])))
    _, prepared = validate(root, parsed)
    worker.apply_prepared_edits(prepared)
    assert (canary / "new.txt").read_text(encoding="utf-8") == "created\n"
    print("PASS: strict JSON valid create")

    _, prepared = validate(root, document([edit(
        "ops/hermes/canary/existing.txt", "replace", existing_sha, "after\n"
    )]))
    worker.apply_prepared_edits(prepared)
    assert existing.read_text(encoding="utf-8") == "after\n"
    print("PASS: exact SHA replace")

    expect_rejected("malformed JSON", lambda: worker.parse_complete_json("{bad"))
    expect_rejected(
        "Markdown-wrapped JSON",
        lambda: worker.parse_complete_json("```json\n{}\n```"),
    )
    expect_rejected(
        "prose outside JSON",
        lambda: worker.parse_complete_json("{} trailing"),
    )
    expect_rejected(
        "too many edits",
        lambda: validate(root, document([
            edit(f"ops/hermes/canary/{index}.txt", "create", None, "x")
            for index in range(5)
        ])),
    )
    expect_rejected(
        "oversized content",
        lambda: validate(root, document([
            edit("ops/hermes/canary/large.txt", "create", None, "x" * (64 * 1024 + 1))
        ])),
    )
    expect_rejected(
        "absolute path",
        lambda: validate(root, document([edit("C:/outside.txt", "create", None, "x")]), ["C:/"]),
    )
    expect_rejected(
        "parent traversal",
        lambda: validate(root, document([edit("ops/../outside.txt", "create", None, "x")]), ["ops/"]),
    )
    expect_rejected(
        ".git path",
        lambda: validate(root, document([edit(".git/config", "replace", "0" * 64, "x")]), [".git/"]),
    )
    expect_rejected(
        "out-of-scope path",
        lambda: validate(root, document([edit("FORBIDDEN.txt", "create", None, "x")]), ["ops/"]),
    )
    expect_rejected(
        "stale expected SHA",
        lambda: validate(root, document([edit(
            "ops/hermes/canary/existing.txt", "replace", "0" * 64, "x"
        )])),
    )
    expect_rejected(
        "create over existing",
        lambda: validate(root, document([edit(
            "ops/hermes/canary/existing.txt", "create", None, "x"
        )])),
    )
    expect_rejected(
        "replace missing",
        lambda: validate(root, document([edit(
            "ops/hermes/canary/missing.txt", "replace", "0" * 64, "x"
        )])),
    )

    atomic_target = canary / "atomic-valid.txt"
    invalid_batch = document([
        edit("ops/hermes/canary/atomic-valid.txt", "create", None, "must-not-apply"),
        edit("outside.txt", "create", None, "invalid"),
    ])
    expect_rejected("one invalid edit rejects batch", lambda: validate(root, invalid_batch))
    assert not atomic_target.exists(), "invalid batch changed a file"
    print("PASS: invalid batch applies zero edits")

    outside = sandbox / "outside"
    outside.mkdir()
    symlink = canary / "linked"
    try:
        symlink.symlink_to(outside, target_is_directory=True)
    except OSError:
        if os.name != "nt":
            raise
        subprocess.run(
            ["cmd.exe", "/d", "/c", "mklink", "/J", str(symlink), str(outside)],
            check=True,
            capture_output=True,
        )
    expect_rejected(
        "symlink parent",
        lambda: validate(root, document([edit(
            "ops/hermes/canary/linked/escape.txt", "create", None, "x"
        )])),
    )

    null_context = root / "NULL.txt"
    null_context.write_bytes(b"text\x00binary")
    expect_rejected("null-byte context", lambda: worker.load_contexts(root, ["NULL.txt"]))
    non_utf8 = root / "NONUTF8.txt"
    non_utf8.write_bytes(b"\xff\xfe")
    expect_rejected("non-UTF-8 context", lambda: worker.load_contexts(root, ["NONUTF8.txt"]))
    expect_rejected(
        "too many context files",
        lambda: worker.load_contexts(root, ["ops/hermes/canary/existing.txt"] * 9),
    )
    expect_rejected(
        "non-loopback endpoint",
        lambda: worker.require_loopback_endpoint("http://0.0.0.0:8080/v1"),
    )
    expect_rejected(
        "remote endpoint",
        lambda: worker.require_loopback_endpoint("https://example.com/v1"),
    )
    assert worker.require_loopback_endpoint("http://127.0.0.1:8080/v1")
    print("PASS: loopback endpoint")

print("RMT_LOCAL_PATCH_PROTOCOL_SMOKE=PASS")
