import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("website_bundle", Path(__file__).with_name("website-bundle.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BundleRestoration(unittest.TestCase):
    def fixture(self, directory, corrupt=False):
        archive_name = "apps/launch-website/.netlify/functions/___netlify-server-handler.zip"
        manifest_name = "apps/launch-website/.netlify/functions/manifest.json"
        payload = b"synthetic-Linux-archive-bytes"
        files = {archive_name: payload, manifest_name: json.dumps({"timestamp": 0, "functions": [{
            "path": "/review/" + archive_name,
            "mainFile": "/review/apps/launch-website/.netlify/functions-internal/handler.mjs"}]}).encode()}
        manifest = {"sourceCommit": "a" * 40, "sourceWorkspace": "/review", "functionArchiveSha256": module.sha(payload),
                    "publication": "BLOCKED_OWNER_APPROVAL", "execution": "BLOCKED_NO_BROADCAST",
                    "files": {name: {"sha256": module.sha(data), "bytes": len(data)} for name, data in files.items()}}
        bundle = directory / "bundle.zip"
        with zipfile.ZipFile(bundle, "w") as archive:
            archive.writestr("bundle-manifest.json", json.dumps(manifest))
            archive.writestr("linux-verification.json", "{}")
            for name, data in files.items():
                archive.writestr(name, data + b"corrupt" if corrupt and name == archive_name else data)
        return bundle, archive_name, payload

    def test_relocation_changes_only_metadata_and_retains_guarded_status(self):
        with tempfile.TemporaryDirectory(prefix="rmt-bundle-test-") as temporary:
            directory = Path(temporary).resolve()
            bundle, name, payload = self.fixture(directory)
            destination = directory / "staging"
            report = module.restore(bundle, destination, "a" * 40)
            self.assertFalse(report["archiveBytesChanged"])
            self.assertEqual((destination / name).read_bytes(), payload)
            self.assertEqual(report["execution"], "BLOCKED_NO_BROADCAST")
            changed = json.loads((destination / module.ARTIFACTS / "functions/manifest.json").read_text())
            self.assertTrue(changed["functions"][0]["path"].startswith(str(destination)))
            self.assertGreater(changed["timestamp"], 0)

    def test_wrong_candidate_tampering_and_existing_directory_fail_without_writes(self):
        with tempfile.TemporaryDirectory(prefix="rmt-bundle-test-") as temporary:
            directory = Path(temporary).resolve()
            bundle, _, _ = self.fixture(directory)
            destination = directory / "wrong"
            with self.assertRaises(AssertionError):
                module.restore(bundle, destination, "b" * 40)
            self.assertFalse(destination.exists())
            bundle, _, _ = self.fixture(directory, corrupt=True)
            with self.assertRaises(AssertionError):
                module.restore(bundle, destination, "a" * 40)
            self.assertFalse(destination.exists())
            destination.mkdir()
            (destination / "existing").write_text("preserve")
            with self.assertRaises(AssertionError):
                module.restore(bundle, destination, "a" * 40)
            self.assertEqual((destination / "existing").read_text(), "preserve")


if __name__ == "__main__":
    unittest.main()
