import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";
import {pg18Packages,pg18Version,verifyPg18ArchiveIndex,verifyPg18Index} from "./postgres-18-packages.mjs";

const hash = b => createHash("sha256").update(b).digest("hex");
function fixture(change = () => {}) {
  const entries = pg18Packages.map(p => ({Package:p.name,Version:pg18Version,Architecture:"amd64",Filename:p.filename,Size:String(p.size),SHA256:p.sha256}));
  change(entries);
  const index = Buffer.from(entries.map(e => Object.entries(e).map(([k,v]) => k+": "+v).join("\n")).join("\n\n")+"\n\n");
  const release = "Origin: apt-archive.postgresql.org\nSuite: noble-pgdg-archive\nSHA256:\n "+hash(index)+" "+index.length+" main/binary-amd64/Packages\nSHA512:\n ignored\n";
  return {index,release};
}

test("official historical index accepts only the same three exact 18.6 package bytes", () => {
  const {index,release} = fixture(), proof = verifyPg18ArchiveIndex(release,index);
  assert.equal(proof.version,"18.6-1.pgdg24.04+2");
  assert.equal(proof.repository,"https://apt-archive.postgresql.org/pub/repos/apt");
  assert.equal(proof.mode,"PGDG_SIGNED_ARCHIVE_AND_PINNED_DEBS");
  assert.deepEqual(proof.packages,pg18Packages);
  assert.equal(proof.packagesIndexSha256,hash(index));
  assert.equal(proof.scope,"ISOLATED_CI_BINARIES_ONLY_NOT_PRODUCTION");
});

test("archive origin, distribution and signed exact index path cannot be substituted", () => {
  const {index,release} = fixture();
  for (const wrong of [release.replace("apt-archive.postgresql.org","apt.postgresql.org"),
    release.replace("noble-pgdg-archive","noble-pgdg"),release.replace("binary-amd64/Packages","binary-arm64/Packages"),
    release.replace("binary-amd64/Packages","binary-amd64/Packages.gz")]) assert.throws(() => verifyPg18ArchiveIndex(wrong,index));
  assert.throws(() => verifyPg18Index(release,index));
});

test("missing or changed signed digest and size fail closed before parsing packages", () => {
  const {index,release} = fixture();
  for (const wrong of [release.replace(hash(index),"0".repeat(64)),release.replace(String(index.length),String(index.length+1)),
    release.replace("SHA256:","NO_SHA256:"),release.replace("SHA512:"," "+hash(index)+" "+index.length+" main/binary-amd64/Packages\nSHA512:")]) {
    assert.throws(() => verifyPg18ArchiveIndex(wrong,index));
  }
  assert.throws(() => verifyPg18ArchiveIndex(release,Buffer.concat([index,Buffer.from("\n")])));
});

test("missing pins, duplicate pins, newer versions, architectures, paths, sizes and hashes remain refused", () => {
  for (const change of [rows=>rows.pop(),rows=>rows.push({...rows[0]}),rows=>{rows[0].Version="18.7-1.pgdg24.04+5";},
    rows=>{rows[0].Architecture="arm64";},rows=>{rows[0].Filename="../../untrusted.deb";},
    rows=>{rows[0].Size="1";},rows=>{rows[0].SHA256="f".repeat(64);},rows=>{rows[0].Package="libpq6";}]) {
    const {index,release} = fixture(change); assert.throws(() => verifyPg18ArchiveIndex(release,index));
  }
});

test("an archive may list newer versions without selecting them over the exact original pins", () => {
  const {index,release} = fixture(rows=>rows.push({...rows[0],Version:"18.7-1.pgdg24.04+5",SHA256:"f".repeat(64)}));
  assert.deepEqual(verifyPg18ArchiveIndex(release,index).packages,pg18Packages);
});

test("the installer verifies the same pinned key, archive signature and package hashes without system installation", () => {
  const text = readFileSync(new URL("./prepare-postgres-18.sh",import.meta.url),"utf8");
  assert.match(text,/repository=https:\/\/apt-archive\.postgresql\.org\/pub\/repos\/apt/);
  assert.match(text,/gpgv .*--keyring .*--output/);
  assert.match(text,/B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8/);
  assert.match(text,/"\$pg_home\/provenance\.json" pgdg-archive/);
  assert.match(text,/sha256sum --check --strict/);
  assert.match(text,/Version\)" == 18\.6-1\.pgdg24\.04\+2/);
  assert.doesNotMatch(text,/^\s*(?:sudo|apt(?:-get)?\s+install|systemctl|service|pg_ctl.*start)/m);
});
