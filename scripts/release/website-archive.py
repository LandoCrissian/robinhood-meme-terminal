"""Inspect the actual Linux Netlify archive, without changing or publishing it."""
import hashlib
import json
import os
from pathlib import Path
import posixpath
import stat
import subprocess
import sys
import tempfile
import zipfile


def inspect_entries(entries):
    names = {item.filename for item, _ in entries}
    assert len(names) == len(entries), "Duplicate archive path"
    links = []
    for item, data in entries:
        name = item.filename
        assert name and not name.startswith("/") and "\\" not in name and ":" not in name
        assert posixpath.normpath(name.rstrip("/")) == name.rstrip("/") and ".." not in name.split("/")
        if stat.S_ISLNK(item.external_attr >> 16):
            target = data.decode("utf8")
            assert not target.startswith("/") and "\\" not in target and ":" not in target, "Nonportable archive link"
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
            assert not resolved.startswith("../") and resolved not in ("..", "."), "Archive link escapes root"
            assert resolved in names or any(path.startswith(resolved.rstrip("/") + "/") for path in names), "Dangling archive link"
            links.append((name, target))
    return links


def inspect(archive):
    with zipfile.ZipFile(archive) as handle:
        assert handle.testzip() is None, "Corrupt archive"
        items = handle.infolist()
        assert 0 < len(items) <= 50000, "Archive entry limit"
        assert sum(item.file_size for item in items) <= 350 * 1024 * 1024, "Uncompressed archive limit"
        entries = [(item, handle.read(item)) for item in handle.infolist()]
    links = inspect_entries(entries)
    bootstrap = next(data for item, data in entries if item.filename == "___netlify-server-handler.mjs")
    assert b"'/var/task/apps/launch-website'" in bootstrap and b"\\" not in bootstrap, "Nonportable generated bootstrap"
    with tempfile.TemporaryDirectory(prefix="rmt-linux-artifact-") as temporary:
        destination = Path(temporary).resolve()
        for item, data in entries:
            path = destination / item.filename
            assert path.resolve().is_relative_to(destination)
            if stat.S_ISLNK(item.external_attr >> 16):
                continue
            if item.is_dir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
        for name, target in links:
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True)
            os.symlink(target, path)
        for name, _ in links:
            assert (destination / name).resolve().is_relative_to(destination), "Transitive link escapes archive"
        checked = subprocess.run(["node", "--check", str(destination / "___netlify-server-handler.mjs")], capture_output=True, text=True, timeout=20)
        assert checked.returncode == 0, "Generated bootstrap does not parse: " + checked.stderr[:500]
        # Reject accidental network initialization during module imports. No app,
        # service account, hosted project or credential is initialized here.
        probe = destination / "verify-local-modules.cjs"
        probe.write_text("""
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const deny = () => { throw Error('Network access is forbidden in packaged-module acceptance'); };
for (const name of ['http','https']) { const module = require('node:' + name); module.request=deny; module.get=deny; }
require('node:net').connect=deny; require('node:net').createConnection=deny; require('node:net').Socket.prototype.connect=deny;
require('node:tls').connect=deny; globalThis.fetch=deny;
for(const key of ['lookup','resolve','resolve4','resolve6','reverse']) require('node:dns')[key]=deny;
const app = createRequire(path.join(__dirname,'apps/launch-website/package.json'));
(async () => {
  const sharp=app('sharp');
  const image=await sharp({create:{width:1,height:1,channels:4,background:'#000'}}).webp().toBuffer();
  assert.equal((await sharp(image).metadata()).width,1);
  const admin=app('firebase-admin/app'); app('firebase-admin/auth'); app('firebase-admin/firestore');
  assert.equal(admin.getApps().length,0);
  console.log(JSON.stringify({sharp:'native encode/decode passed',firebaseAdmin:'modules loaded; zero initialized apps',network:'passive imports with HTTP/TCP/DNS APIs blocked'}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
""", encoding="utf8")
        imported = subprocess.run(["node", str(probe)], capture_output=True, text=True, timeout=30)
        assert imported.returncode == 0, "Packaged native/Admin modules failed: " + imported.stderr[:500]
        modules = json.loads(imported.stdout)
    data = Path(archive).read_bytes()
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "entries": len(entries),
            "relativeLinks": len(links), "bootstrap": "parsed without path rewriting", "modules": modules}


if __name__ == "__main__":
    print(json.dumps(inspect(Path(sys.argv[1]).resolve())))
