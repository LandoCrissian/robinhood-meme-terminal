import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";
import test from "node:test";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const record=JSON.parse(readFileSync(new URL("verification-policy.json",import.meta.url),"utf8"));
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const normalized=bytes=>Buffer.from(bytes.toString("utf8").replaceAll("\r\n","\n"),"utf8");
const logBytes=entry=>gunzipSync(readFileSync(new URL(entry.log,import.meta.url)));
test("Task080 envelope evidence binds original/current source and actual failed-before/passed-after logs",()=>{
  const original=execFileSync("git",["show",record.baseCommit+":"+record.source],{cwd:root,windowsHide:true});
  const current=readFileSync(new URL("../../../"+record.source,import.meta.url));
  assert.equal(hash(normalized(original)),record.beforeSourceSha256Lf);
  assert.equal(hash(normalized(current)),record.afterSourceSha256Lf);
  assert.notEqual(record.beforeSourceSha256Lf,record.afterSourceSha256Lf);
  for(const entry of[record.before,record.after,record.permanentProof]){
    assert.match(entry.log,/^[a-z-]+\.log\.gz$/);
    const raw=logBytes(entry);assert.equal(hash(raw),entry.sha256);assert.equal(entry.sha256AppliesTo,"uncompressed original bytes");
    if(entry===record.before)assert.match(raw.toString("utf8"),/AssertionError[\s\S]*Missing expected rejection: delegation-format/);
    else assert.equal(entry.exit,0);
  }
  assert.match(logBytes(record.after).toString("utf8"),/actual ECDSA owner signatures.*rejection smoke passed/);
  assert.match(logBytes(record.permanentProof).toString("utf8"),/native-burn\/sink ERC721\/1155 canonical retirement.*smoke passed/);
  assert.equal(record.highFindingsCleared,0);assert.equal(record.solidityChanged,false);assert.equal(record.broadcastAuthorized,false);
});

test("Task080 source/log hash checks reject altered evidence instead of clearing a static gate",()=>{
  const raw=logBytes(record.before);
  assert.notEqual(hash(Buffer.concat([raw,Buffer.from("changed")])),record.before.sha256);
  assert.notEqual(hash(normalized(Buffer.concat([readFileSync(new URL("../../../"+record.source,import.meta.url)),Buffer.from("\nchanged")]))),record.afterSourceSha256Lf);
  assert.equal(record.status,"VERIFICATION_POLICY_FIXED_STATIC_GATES_REMAIN_FAILED");
});
