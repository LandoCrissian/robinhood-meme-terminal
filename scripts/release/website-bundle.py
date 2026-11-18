"""Collect/restore reviewed Linux build bytes; never deploy or initialize credentials."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import zipfile

APP = Path("apps/launch-website")
ARTIFACTS = APP / ".netlify"
GENERATED = ("functions", "edge-functions", "edge-functions-dist", "static", "v1", "deploy", "deploy-config")
SOURCE = ("package.json", "pnpm-workspace.yaml", "netlify.toml", "apps/launch-website/package.json", "apps/launch-website/next.config.mjs")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def allowed(name):
    path = Path(name)
    return name in SOURCE or name == (ARTIFACTS / "netlify.toml").as_posix() or name == (ARTIFACTS / "edge-functions-import-map.json").as_posix() or any(
        name.startswith((ARTIFACTS / directory).as_posix() + "/") for directory in GENERATED)


def collect(workspace, output, report_path, tools_path):
    workspace = workspace.resolve()
    report = json.loads(report_path.read_text())
    source = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=workspace, text=True).strip()
    assert report["sourceCommit"] == source and report["source"]["verification"] == "passed"
    assert report["artifacts"]["functions"]["platform"] == "linux"
    paths = {workspace / name for name in SOURCE}
    for name in ("netlify.toml", "edge-functions-import-map.json"):
        path = workspace / ARTIFACTS / name
        if path.is_file():
            paths.add(path)
    for name in GENERATED:
        directory = workspace / ARTIFACTS / name
        if directory.is_dir():
            paths.update(path for path in directory.rglob("*") if path.is_file())
    files = {}
    for path in sorted(paths):
        assert not path.is_symlink() and path.resolve().is_relative_to(workspace), "Unexpected artifact link"
        name = path.relative_to(workspace).as_posix()
        assert allowed(name)
        files[name] = path.read_bytes()
    assert len(files) <= 10000
    function = (ARTIFACTS / "functions/___netlify-server-handler.zip").as_posix()
    assert sha(files[function]) == report["artifacts"]["archive"]["sha256"]
    manifest = {"schemaVersion": 1, "sourceCommit": source, "sourceWorkspace": workspace.as_posix(),
                "functionArchiveSha256": sha(files[function]), "buildTools": json.loads(tools_path.read_text()),
                "publication": "BLOCKED_OWNER_APPROVAL", "execution": "BLOCKED_NO_BROADCAST",
                "files": {name: {"sha256": sha(data), "bytes": len(data)} for name, data in files.items()}}
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("bundle-manifest.json", json.dumps(manifest, indent=2) + "\n")
        archive.writestr("linux-verification.json", json.dumps(report, indent=2) + "\n")
        for name, data in files.items():
            archive.writestr(name, data)
    return {"sourceCommit": source, "bundleSha256": sha(output.read_bytes()), "bytes": output.stat().st_size,
            "functionArchiveSha256": manifest["functionArchiveSha256"], "files": len(files), "deployed": False}


def restore(bundle, destination, expected_source):
    destination = destination.resolve()
    assert not destination.exists() or not any(destination.iterdir()), "Restore only into a fresh, empty staging directory"
    with zipfile.ZipFile(bundle) as archive:
        infos = archive.infolist()
        assert len({item.filename for item in infos}) == len(infos) <= 10002
        assert sum(item.file_size for item in infos) < 400 * 1024 * 1024
        manifest = json.loads(archive.read("bundle-manifest.json"))
        assert manifest["sourceCommit"] == expected_source, "Different review candidate"
        assert manifest["publication"] == "BLOCKED_OWNER_APPROVAL" and manifest["execution"] == "BLOCKED_NO_BROADCAST"
        assert set(archive.namelist()) == set(manifest["files"]) | {"bundle-manifest.json", "linux-verification.json"}
        verified = []
        for name, evidence in manifest["files"].items():
            path = Path(name)
            assert allowed(name) and not path.is_absolute() and "\\" not in name and ":" not in name and ".." not in path.parts
            assert ((archive.getinfo(name).external_attr >> 16) & 0o170000) != 0o120000, "Container links forbidden"
            data = archive.read(name)
            assert len(data) == evidence["bytes"] and sha(data) == evidence["sha256"], "Artifact checksum mismatch"
            target = destination / path
            # `netlify deploy --no-build` still rebundles edges when source
            # directories exist. Keep review sources outside those input paths;
            # upload the unchanged, already verified edge-functions-dist bytes.
            edge_source = (ARTIFACTS / "edge-functions").as_posix() + "/"
            framework_source = (ARTIFACTS / "v1/edge-functions").as_posix() + "/"
            if name.startswith(edge_source) or name.startswith(framework_source):
                target = destination / ARTIFACTS / "review-source" / path.relative_to(ARTIFACTS)
            assert target.resolve().is_relative_to(destination)
            verified.append((target, data))
    # No files are written until every candidate/path/checksum has passed.
    for path, data in verified:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    function_manifest_path = destination / ARTIFACTS / "functions/manifest.json"
    functions = json.loads(function_manifest_path.read_text())
    origin = manifest["sourceWorkspace"]
    for function in functions["functions"]:
        for field in ("path", "mainFile"):
            value = function.get(field)
            if value:
                assert value.startswith(origin + "/"), "Unbound function metadata path"
                target = destination / value[len(origin) + 1:]
                assert target.resolve().is_relative_to(destination)
                function[field] = str(target)
    # Netlify CLI 27.14.2 uses a two-minute packaging cache. Refresh metadata
    # only, after validating immutable archive bytes; do not repackage the ZIP.
    functions["timestamp"] = int(time.time() * 1000)
    function_manifest_path.write_text(json.dumps(functions), encoding="utf8")
    generated_config = destination / ARTIFACTS / "netlify.toml"
    if generated_config.exists():
        generated_config.write_text(generated_config.read_text().replace(origin, destination.as_posix()), encoding="utf8")
    function = destination / ARTIFACTS / "functions/___netlify-server-handler.zip"
    assert sha(function.read_bytes()) == manifest["functionArchiveSha256"]
    return {"sourceCommit": expected_source, "functionArchiveSha256": manifest["functionArchiveSha256"],
            "metadataChanges": ["functions[].path/mainFile relocation", "function packaging-cache timestamp", "generated config path relocation", "edge review sources retained outside automatic rebundling inputs"],
            "archiveBytesChanged": False, "publication": "BLOCKED_OWNER_APPROVAL", "execution": "BLOCKED_NO_BROADCAST"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("collect", "restore"))
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--tools", type=Path)
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--expected-source")
    args = parser.parse_args()
    if args.mode == "collect":
        result = collect(args.workspace, args.output, args.report, args.tools)
    else:
        assert args.expected_source
        result = restore(args.bundle, args.destination, args.expected_source)
    print(json.dumps(result, indent=2))
