"""Seal only completed, independently identified Task081 synthetic browser runs.

No deployment, wallet, database or credential API is used. Raw JSON is scanned
before compression; an unclassified scanner finding aborts without sealing.
Run from the repository root. Existing output evidence is never overwritten.
"""
import argparse
import collections
import gzip
import hashlib
import io
import json
import pathlib
import re
import subprocess
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = ROOT / "docs/evidence/rmt-task081/browser"
BASE = "c7e75623ff1163d8c36fd110fc7cf5188b814db1"
JSON_NAMES = ["nft-acquisition-" + name + ".json" for name in
              ["acceptance", "browser-evidence", "compiler-manifest", "deployment", "setup"]]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def gh(endpoint):
    return subprocess.check_output(["gh", "api", "repos/LandoCrissian/robinhood-meme-terminal/" + endpoint], cwd=ROOT)


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8", newline="\n")


def seal(args):
    assert re.fullmatch(r"[a-f0-9]{40}", args.source)
    args.raw = args.raw.resolve()
    assert args.raw.is_dir() and not args.raw.is_relative_to(ROOT), "Raw evidence must remain outside the Git worktree"
    run = json.loads(gh("actions/runs/" + str(args.run)))
    assert run["head_sha"] == args.source and run["status"] == "completed"
    jobs = json.loads(gh("actions/runs/" + str(args.run) + "/jobs?per_page=100"))["jobs"]
    source_tree = json.loads(gh("git/commits/" + args.source))["tree"]["sha"]
    assert not (OUT / "manifest.json").exists(), "Do not overwrite sealed evidence"
    result = {"schemaVersion": 1, "status": "BLOCKED_NO_BROADCAST",
              "scope": "LOCAL_SYNTHETIC_NFT_ACQUISITION_NOT_PRODUCTION_OR_PHYSICAL_PHONE",
              "productionAuthorization": False, "physicalIPhoneAcceptance": False,
              "securityClearance": False,
              "sourceCommit": args.source, "identicalSourceTree": source_tree,
              "baselineCommit": BASE, "runId": str(args.run), "runUrl": run["html_url"],
              "baselineSolidity": [], "verifiedSourceFiles": [], "browsers": {}}
    security_job = next(row for row in jobs if row["name"] == "nft-acquisition-strict-security")
    result["strictSecurityJob"] = {"jobId": str(security_job["id"]), "conclusion": security_job["conclusion"]}
    for path in git("ls-tree", "-r", "--name-only", BASE).decode().splitlines():
        if path.endswith(".sol"):
            raw = git("show", BASE + ":" + path)
            assert git("show", args.source + ":" + path) == raw
            result["baselineSolidity"].append({"path": path, "sha256": sha(raw)})
    assert len(result["baselineSolidity"]) == 63
    changed = git("diff", "--name-only", BASE, args.source).decode().splitlines()
    for path in changed:
        if not path.startswith("docs/") and pathlib.PurePosixPath(path).suffix in {".mjs", ".mts", ".ts", ".tsx", ".sol", ".yml", ".json"}:
            raw = git("show", args.source + ":" + path)
            assert b"\r\n" not in raw, "Git source must already use canonical LF"
            result["verifiedSourceFiles"].append({"path": path, "normalization": "canonical-lf", "bytes": len(raw), "sha256": sha(raw)})
    for engine in ["chromium", "webkit"]:
        artifact_id = str(getattr(args, engine))
        info = json.loads(gh("actions/artifacts/" + artifact_id))
        assert info["workflow_run"]["head_sha"] == args.source and not info["expired"]
        assert info["name"] == f"nft-acquisition-browser-{engine}-{args.source}"
        job = next(row for row in jobs if row["name"] == f"nft-acquisition-browser ({engine})")
        assert job["status"] == "completed" and job["conclusion"] == "success", "A failed browser job cannot be sealed"
        archive = gh("actions/artifacts/" + artifact_id + "/zip")
        assert len(archive) < 50 * 1024 * 1024
        z = zipfile.ZipFile(io.BytesIO(archive))
        selected = {}
        for name in JSON_NAMES:
            selected[name] = z.read("rmt-nft-acquisition/" + name)
            assert len(selected[name]) <= 4 * 1024 * 1024
        a = json.loads(selected["nft-acquisition-acceptance.json"])
        b = json.loads(selected["nft-acquisition-browser-evidence.json"])
        m = json.loads(selected["nft-acquisition-deployment.json"])
        assert a["status"] == "passed" and b["status"] == "PASS"
        assert a["chainId"] == 31337 and a["productionExecution"] is False
        checkout = a["sourceIdentity"]["commit"]
        assert json.loads(gh("git/commits/" + checkout))["tree"]["sha"] == source_tree
        assert a["postgresql"]["serverVersion"].startswith("18.6") and a["postgresql"]["encoding"] == "UTF8"
        screenshots = {row["screenshot"] for row in b["layouts"]}
        screenshots.update(name for row in b["reviewScreenshots"] for name in row["screenshots"])
        for name in sorted(screenshots):
            assert re.fullmatch(r"[a-z0-9-]+\.png", name)
            selected[name] = z.read("rmt-nft-acquisition/" + name)
            assert len(selected[name]) < 4 * 1024 * 1024 and selected[name][:8] == bytes.fromhex("89504e470d0a1a0a")
        raw_dir = args.raw / (engine + "-" + artifact_id)
        raw_dir.mkdir(parents=True, exist_ok=False)
        for name, raw in selected.items():
            (raw_dir / name).write_bytes(raw)
        scanner_report = args.raw / (engine + "-" + artifact_id + "-gitleaks.json")
        scan = subprocess.run([str(args.gitleaks), "dir", str(raw_dir), "--config", str(ROOT / ".gitleaks.toml"),
                               "--redact=100", "--report-format", "json", "--report-path", str(scanner_report), "--no-banner"],
                              cwd=ROOT, capture_output=True)
        assert scan.returncode in {0, 1}, "Scanner execution failed"
        findings = json.loads(scanner_report.read_text(encoding="utf-8"))
        classified = []
        for finding in findings:
            name = pathlib.Path(finding["File"]).name
            assert name in JSON_NAMES and finding["RuleID"] == "generic-api-key"
            assert finding["StartLine"] == finding["EndLine"]
            line = selected[name].decode().splitlines()[finding["StartLine"] - 1]
            match = re.fullmatch(r'\s*"([A-Za-z0-9_]+)": "(0x[0-9a-fA-F]+)"\s*,?', line)
            assert match and match[1] in {"projectToken", "paymentToken", "paymentTokenRuntimeHash"}, "Unclassified finding: stop before archiving"
            assert match[2].lower() == m[match[1]].lower(), "Public identifier does not match this artifact's canonical module"
            classified.append({"sourceFile": name, "line": finding["StartLine"], "ruleId": finding["RuleID"],
                               "field": match[1], "lineSha256": sha(line.encode()), "publicValueSha256": sha(match[2].encode()),
                               "disposition": "EXACT_PUBLIC_SYNTHETIC_MODULE_IDENTIFIER_NOT_A_CREDENTIAL"})
        classification = {"schemaVersion": 1, "scope": "RAW_JSON_AND_PNG_BEFORE_COMPRESSION",
                          "scanner": "gitleaks", "version": subprocess.check_output([str(args.gitleaks), "version"]).decode().strip(),
                          "configurationPath": ".gitleaks.toml", "configurationSha256": sha((ROOT / ".gitleaks.toml").read_bytes()),
                          "exitCode": scan.returncode, "findingCount": len(findings), "classifiedCount": len(classified),
                          "countsByField": dict(collections.Counter(row["field"] for row in classified)),
                          "findingsSuppressed": False, "historyGateCleared": False,
                          "rawFiles": [{"path": name, "bytes": len(raw), "sha256": sha(raw)} for name, raw in sorted(selected.items())],
                          "classifications": classified}
        destination = OUT / engine
        destination.mkdir(exist_ok=False)
        records = []
        for name, raw in sorted(selected.items()):
            target = destination / (name + ".gz" if name.endswith(".json") else name)
            data = gzip.compress(raw, mtime=0) if name.endswith(".json") else raw
            target.write_bytes(data)
            records.append({"path": target.relative_to(ROOT).as_posix(), "bytes": len(data), "sha256": sha(data),
                            **({"uncompressedBytes": len(raw), "uncompressedSha256": sha(raw)} if name.endswith(".json") else {})})
        for name, raw in [("raw-gitleaks-report.json.gz", scanner_report.read_bytes()),
                          ("public-data-classification.json", (json.dumps(classification, indent=2) + "\n").encode())]:
            target = destination / name
            data = gzip.compress(raw, mtime=0) if name.endswith(".gz") else raw
            target.write_bytes(data)
            records.append({"path": target.relative_to(ROOT).as_posix(), "bytes": len(data), "sha256": sha(data),
                            **({"uncompressedBytes": len(raw), "uncompressedSha256": sha(raw)} if name.endswith(".gz") else {})})
        result["browsers"][engine] = {"artifactId": artifact_id, "jobId": str(job["id"]), "conclusion": "success",
                                        "checkoutCommit": checkout, "archiveSha256": sha(archive), "archiveBytes": len(archive),
                                        "files": sorted(records, key=lambda row: row["path"])}
    write_json(OUT / "manifest.json", result)
    print(json.dumps({"status": result["status"], "sourceCommit": args.source,
                      "artifacts": {engine: row["artifactId"] for engine, row in result["browsers"].items()}}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, type=int)
    parser.add_argument("--source", required=True)
    parser.add_argument("--chromium", required=True, type=int)
    parser.add_argument("--webkit", required=True, type=int)
    parser.add_argument("--raw", required=True, type=pathlib.Path, help="Existing owner-controlled evidence directory outside Git")
    parser.add_argument("--gitleaks", required=True, type=pathlib.Path)
    seal(parser.parse_args())
