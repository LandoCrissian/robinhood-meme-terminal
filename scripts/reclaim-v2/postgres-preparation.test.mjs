import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {gzipSync} from "node:zlib";
import test from "node:test";
import {pg18Packages,pg18Version,verifyPg18Index,ubuntuLiburing,verifyUbuntuLiburingIndex} from "../../.github/scripts/postgres-18-packages.mjs";

// Parser tests use synthetic metadata. Actual package trust still requires the
// shell's pinned PGDG key, gpgv verification and downloaded package SHA256 checks.
function fixture(change=()=>{}){
  const entries=pg18Packages.map(p=>({Package:p.name,Version:pg18Version,Architecture:"amd64",Filename:p.filename,Size:String(p.size),SHA256:p.sha256}));change(entries);
  const text=entries.map(e=>Object.entries(e).map(([k,v])=>k+": "+v).join("\n")).join("\n\n")+"\n\n",gzip=gzipSync(text);
  const release="Origin: apt.postgresql.org\nSuite: noble-pgdg\nSHA256:\n "+createHash("sha256").update(gzip).digest("hex")+" "+gzip.length+" main/binary-amd64/Packages.gz\nSHA512:\n ignored\n";
  return{release,gzip};
}
test("PGDG index parser binds exact 18.6 package versions, file paths, hashes, sizes and signed index digest",()=>{
  const{release,gzip}=fixture(),proof=verifyPg18Index(release,gzip);assert.equal(proof.version,pg18Version);assert.deepEqual(proof.packages,pg18Packages);
  assert.equal(proof.scope,"ISOLATED_CI_BINARIES_ONLY_NOT_PRODUCTION");
  assert.throws(()=>verifyPg18Index(release,Buffer.from("different package index")),/SHA256/);
  assert.throws(()=>verifyPg18Index(release.replace("noble-pgdg","jammy-pgdg"),gzip));
  for(const change of[rows=>{rows[0].Version="18.7-1.pgdg24.04+2";},rows=>{rows[0].SHA256="a".repeat(64);},rows=>{rows[0].Filename="../../unsafe.deb";},
    rows=>{rows[0].Size="1";},rows=>{rows.pop();},rows=>{rows.push(rows[0]);},rows=>{rows[0].Architecture="arm64";}]){
    const altered=fixture(change);assert.throws(()=>verifyPg18Index(altered.release,altered.gzip));
  }
});
test("PostgreSQL binary preparation never installs packages or starts services and all four browser suites use its exact path",()=>{
  const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
  const script=read(".github/scripts/prepare-postgres-18.sh"),workflow=read(".github/workflows/launch-website-review.yml");
  assert.match(script,/gpgv .*--keyring .*--output/);assert.match(script,/B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8/);
  assert.match(script,/sha256sum --check --strict/);assert.match(script,/dpkg-deb --extract/);assert.match(script,/exact_version "\$pg_bin"/);
  assert.match(script,/ubuntu-archive-keyring\.gpg/);assert.match(script,/VALIDSIG F6ECB3762474EDA9D21B7022871920D1991BC93C/);
  assert.doesNotMatch(script,/^\s*(?:sudo|apt(?:-get)?\s+install|systemctl|service|pg_ctl.*start)/m);
  assert.equal([...workflow.matchAll(/--pg-bin "\$RMT_PG18_BIN"/g)].length,4);assert.doesNotMatch(workflow,/--pg-bin "\$\(pg_config/);
  assert.match(workflow,/bash \.github\/scripts\/prepare-postgres-18\.sh/);assert.match(workflow,/RMT_PG18_EVIDENCE.*versions-and-runtime\.txt/);
});
test("missing liburing is admitted only as the exact signed Noble runtime and remains separate from PostgreSQL pins",()=>{
  const pkg={Package:ubuntuLiburing.name,Version:"2.5-1build1",Architecture:"amd64",Filename:ubuntuLiburing.filename,Size:String(ubuntuLiburing.size),SHA256:ubuntuLiburing.sha256};
  const fixture=record=>{const gz=gzipSync(Object.entries(record).map(([k,v])=>k+": "+v).join("\n")+"\n\n");return{gz,release:"Origin: Ubuntu\nSuite: noble\nSHA256:\n "+createHash("sha256").update(gz).digest("hex")+" "+gz.length+" main/binary-amd64/Packages.gz\n"};};
  const actual=fixture(pkg);assert.deepEqual(verifyUbuntuLiburingIndex(actual.release,actual.gz).packages,[ubuntuLiburing]);
  for(const change of[{Version:"2.6-1"},{SHA256:"f".repeat(64)},{Filename:"pool/other.deb"},{Architecture:"arm64"},{Size:"1"}]){
    const wrong=fixture({...pkg,...change});assert.throws(()=>verifyUbuntuLiburingIndex(wrong.release,wrong.gz));
  }
  assert.throws(()=>verifyPg18Index(actual.release,actual.gz));
});
