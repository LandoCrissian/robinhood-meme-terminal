import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

export const pg18Version="18.6-1.pgdg24.04+2";
export const pgdgFingerprint="B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8";
export const pg18Packages=[
  {name:"libpq5",filename:"pool/main/p/postgresql-18/libpq5_18.6-1.pgdg24.04+2_amd64.deb",size:264072,sha256:"b487c5ed2ceb9244c6a9d6ae65818ed6707c3c44a2e14488394ae4194c52c53b"},
  {name:"postgresql-18",filename:"pool/main/p/postgresql-18/postgresql-18_18.6-1.pgdg24.04+2_amd64.deb",size:7576708,sha256:"c0773357df8769abb70e92722196d9b53422d71c0f29a4f39c834b94276cfa3d"},
  {name:"postgresql-client-18",filename:"pool/main/p/postgresql-18/postgresql-client-18_18.6-1.pgdg24.04+2_amd64.deb",size:2114236,sha256:"b9d10d99a73bf7aa375be2fe36626c40499cfdf553d0ad174674a88a1b256b43"},
];
const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
function verifyPackageIndex(release,gzip,origin,suite,pins,version){
  assert.ok(Buffer.byteLength(release)<=4*1024*1024&&gzip.length<=16*1024*1024,"PGDG metadata exceeds its bound");
  assert.ok(release.split("\n").includes("Origin: "+origin));assert.ok(release.split("\n").includes("Suite: "+suite));
  const section=release.split(/^SHA256:\s*$/m);assert.equal(section.length,2,"One signed SHA256 section required");
  const lines=section[1].split(/\n(?=\S)/)[0].split("\n").map(line=>line.trim().split(/\s+/));
  const rows=lines.filter(row=>row[2]==="main/binary-amd64/Packages.gz");assert.equal(rows.length,1);
  assert.equal(rows[0][0],sha256(gzip),"Package index must match verified InRelease SHA256");assert.equal(Number(rows[0][1]),gzip.length);
  const index=gunzipSync(gzip,{maxOutputLength:128*1024*1024}).toString("utf8"),records=[];
  for(const block of index.split("\n\n")){
    const record={};for(const line of block.split("\n"))if(line&&!/^\s/.test(line)){const at=line.indexOf(": ");if(at!==-1){const key=line.slice(0,at);assert.ok(!Object.hasOwn(record,key),"Duplicate package field");record[key]=line.slice(at+2);}}
    if(pins.some(p=>p.name===record.Package)&&record.Version===version&&record.Architecture==="amd64")records.push(record);
  }
  assert.equal(records.length,pins.length,"Exact pinned noble packages unavailable; never substitute latest");
  for(const pin of pins){const matches=records.filter(r=>r.Package===pin.name);assert.equal(matches.length,1);
    assert.equal(matches[0].Filename,pin.filename);assert.equal(matches[0].SHA256,pin.sha256);assert.equal(Number(matches[0].Size),pin.size);}
}
export function verifyPg18Index(release,gzip){
  verifyPackageIndex(release,gzip,"apt.postgresql.org","noble-pgdg",pg18Packages,pg18Version);
  return{schemaVersion:1,scope:"ISOLATED_CI_BINARIES_ONLY_NOT_PRODUCTION",mode:"PGDG_SIGNED_INDEX_AND_PINNED_DEBS",version:pg18Version,
    repository:"https://apt.postgresql.org/pub/repos/apt",suite:"noble-pgdg",architecture:"amd64",signingFingerprint:pgdgFingerprint,
    verifiedReleaseSha256:sha256(release),packagesGzipSha256:sha256(gzip),packages:pg18Packages};
}
export const ubuntuLiburing={name:"liburing2",filename:"pool/main/libu/liburing/liburing2_2.5-1build1_amd64.deb",size:21092,sha256:"c2aef62accee92a06263c3ad4ef46132c13e409b54296c44792a20491830a7b0"};
export function verifyUbuntuLiburingIndex(release,gzip){
  verifyPackageIndex(release,gzip,"Ubuntu","noble",[ubuntuLiburing],"2.5-1build1");
  return{schemaVersion:1,scope:"ISOLATED_CI_BINARIES_ONLY_NOT_PRODUCTION",mode:"UBUNTU_SIGNED_INDEX_AND_PINNED_RUNTIME",version:"2.5-1build1",
    repository:"https://archive.ubuntu.com/ubuntu",suite:"noble",architecture:"amd64",signingFingerprint:"F6ECB3762474EDA9D21B7022871920D1991BC93C",
    verifiedReleaseSha256:sha256(release),packagesGzipSha256:sha256(gzip),packages:[ubuntuLiburing]};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  assert.ok(process.argv.length===5||process.argv.length===6&&process.argv[5]==="ubuntu-liburing","Use verified Release, Packages.gz and fresh manifest paths");
  const result=(process.argv[5]==="ubuntu-liburing"?verifyUbuntuLiburingIndex:verifyPg18Index)(readFileSync(process.argv[2],"utf8"),readFileSync(process.argv[3]));
  writeFileSync(process.argv[4],JSON.stringify(result,null,2)+"\n",{flag:"wx"});
  for(const p of result.packages)console.log([p.name,p.filename,p.size,p.sha256].join("\t"));
}
