#!/usr/bin/env python3
"""Deterministic protocol/path smoke for the local patch-only adapter."""

from __future__ import annotations

import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from threading import Thread
from urllib.error import HTTPError


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


def expect_http_rejected(label: str, function) -> None:
    try:
        function()
    except HTTPError:
        print(f"PASS: {label}")
        return
    fail(f"{label} should reject the HTTP redirect")


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
    for nested_git in ("ops/.git/config", "ops/hermes/canary/.GIT/config"):
        expect_rejected(
            f"nested .git component {nested_git}",
            lambda nested_git=nested_git: validate(
                root,
                document([edit(nested_git, "create", None, "x")]),
                ["ops/"],
            ),
        )
    for reserved_path in (
        "ops/hermes/canary/CON",
        "ops/hermes/canary/PRN.txt",
        "ops/hermes/canary/AUX.json",
        "ops/hermes/canary/NUL.log",
        "ops/hermes/canary/COM1.txt",
        "ops/hermes/canary/COM9",
        "ops/hermes/canary/LPT1.txt",
        "ops/hermes/canary/LPT9",
    ):
        expect_rejected(
            f"Windows reserved name {reserved_path}",
            lambda reserved_path=reserved_path: validate(
                root, document([edit(reserved_path, "create", None, "x")])
            ),
        )
    for ambiguous_windows_path in (
        "ops/hermes/canary/trailing.",
        "ops/hermes/canary/trailing ",
        "ops/hermes/canary/control\x1f.txt",
        "ops/hermes/canary/delete\x7f.txt",
    ):
        expect_rejected(
            f"Windows ambiguous path {ambiguous_windows_path!r}",
            lambda ambiguous_windows_path=ambiguous_windows_path: validate(
                root, document([edit(ambiguous_windows_path, "create", None, "x")])
            ),
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

    rollback_existing = canary / "rollback-existing.txt"
    rollback_existing.write_text("original\n", encoding="utf-8")
    rollback_sha = hashlib.sha256(rollback_existing.read_bytes()).hexdigest()
    rollback_created = canary / "rollback-created.txt"
    _, rollback_prepared = validate(
        root,
        document(
            [
                edit(
                    "ops/hermes/canary/rollback-existing.txt",
                    "replace",
                    rollback_sha,
                    "changed\n",
                ),
                edit(
                    "ops/hermes/canary/rollback-created.txt",
                    "create",
                    None,
                    "created\n",
                ),
            ]
        ),
    )
    replacement_count = {"value": 0}

    def fail_second_replacement(source: Path, target: Path) -> None:
        replacement_count["value"] += 1
        if replacement_count["value"] == 2:
            raise OSError("deterministic second-file failure")
        os.replace(source, target)

    expect_rejected(
        "second-file failure triggers rollback",
        lambda: worker.apply_prepared_edits(
            rollback_prepared, replace_file=fail_second_replacement
        ),
    )
    assert rollback_existing.read_text(encoding="utf-8") == "original\n"
    assert not rollback_created.exists()
    print("PASS: previously applied file restored after batch failure")

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
        "localhost hostname",
        lambda: worker.require_loopback_endpoint("http://localhost:8080/v1"),
    )
    expect_rejected(
        "IPv6 loopback",
        lambda: worker.require_loopback_endpoint("http://[::1]:8080/v1"),
    )
    expect_rejected(
        "credentials in endpoint",
        lambda: worker.require_loopback_endpoint("http://user:pass@127.0.0.1:8080/v1"),
    )
    expect_rejected(
        "query in endpoint",
        lambda: worker.require_loopback_endpoint("http://127.0.0.1:8080/v1?x=1"),
    )
    expect_rejected(
        "fragment in endpoint",
        lambda: worker.require_loopback_endpoint("http://127.0.0.1:8080/v1#x"),
    )
    expect_rejected(
        "trailing slash in endpoint",
        lambda: worker.require_loopback_endpoint("http://127.0.0.1:8080/v1/"),
    )
    expect_rejected(
        "out-of-range endpoint port",
        lambda: worker.require_loopback_endpoint("http://127.0.0.1:65536/v1"),
    )
    expect_rejected(
        "remote endpoint",
        lambda: worker.require_loopback_endpoint("https://example.com/v1"),
    )
    assert worker.require_loopback_endpoint("http://127.0.0.1:8080/v1")
    print("PASS: loopback endpoint")

    destination_contacts = {"value": 0}

    class DestinationHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            destination_contacts["value"] += 1
            self.send_response(200)
            self.end_headers()

        def log_message(self, format, *args):  # noqa: A002
            return

    destination = ThreadingHTTPServer(("127.0.0.1", 0), DestinationHandler)

    redirect_status = {"value": 302}

    class RedirectHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.send_response(redirect_status["value"])
            self.send_header(
                "Location",
                f"http://127.0.0.1:{destination.server_port}/v1/chat/completions",
            )
            self.end_headers()

        def log_message(self, format, *args):  # noqa: A002
            return

    redirect = ThreadingHTTPServer(("127.0.0.1", 0), RedirectHandler)
    threads = [
        Thread(target=destination.serve_forever, daemon=True),
        Thread(target=redirect.serve_forever, daemon=True),
    ]
    for thread in threads:
        thread.start()
    try:
        for status_code in (301, 302, 303, 307, 308):
            redirect_status["value"] = status_code
            expect_http_rejected(
                f"HTTP {status_code} redirect rejected",
                lambda: worker.request_model(
                    f"http://127.0.0.1:{redirect.server_port}/v1",
                    "redirect-smoke",
                    [{"role": "user", "content": "redirect must fail"}],
                ),
            )
        assert destination_contacts["value"] == 0
        print("PASS: redirect destination not contacted")
    finally:
        redirect.shutdown()
        destination.shutdown()
        redirect.server_close()
        destination.server_close()

print("RMT_LOCAL_PATCH_PROTOCOL_SMOKE=PASS")
