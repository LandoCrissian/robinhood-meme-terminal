import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {withArchivedSourcePack} from "./source-pack.mjs";

const root=new URL("1be772c8/",import.meta.url),manifest=JSON.parse(readFileSync(new URL("integrity-manifest.json",root))),pack=readFileSync(new URL("source-1be772c8.pack",root));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const input=()=>({pack,source:manifest.source,sourceFiles:structuredClone(manifest.sourceFiles),sourcePack:structuredClone(manifest.sourcePack)});
test("ten retained objects supply all six exact historical blobs from an empty offline bare repository",()=>{
 let directory;withArchivedSourcePack(input(),(readSource,info)=>{directory=info.temporary;assert.equal(info.objects.length,10);assert.equal(existsSync(join(info.repository,"hooks")),false);assert.equal(existsSync(join(info.repository,"objects","info","alternates")),false);assert.doesNotMatch(readFileSync(join(info.repository,"config"),"utf8"),/\[remote\b/i);for(const file of manifest.sourceFiles)assert.equal(sha(readSource(file.path)),file.gitBlobSha256);assert.throws(()=>readSource("package.json"),/SOURCE_PACK_PATH_CLOSURE/);});assert.equal(existsSync(directory),false);
 let failureDirectory;assert.throws(()=>withArchivedSourcePack(input(),(_readSource,info)=>{failureDirectory=info.temporary;throw Error("EXPECTED_CONSUMER_FAILURE");}),/EXPECTED_CONSUMER_FAILURE/);assert.equal(existsSync(failureDirectory),false);
});
test("tampered/oversized pack, wrong commit and changed scanner provenance fail before source use",()=>{
 const altered=input();altered.pack=Buffer.from(pack);altered.pack[20]^=1;assert.throws(()=>withArchivedSourcePack(altered,()=>assert.fail("must not consume")),/SOURCE_PACK_SHA256_MISMATCH/);
 assert.throws(()=>withArchivedSourcePack({...input(),pack:Buffer.alloc(1024*1024+1)},()=>{}),/SOURCE_PACK_BYTES_BOUND/);
 assert.throws(()=>withArchivedSourcePack({...input(),source:"0".repeat(40)},()=>{}),/SOURCE_PACK_COMMIT_MISMATCH/);
 for(const change of[data=>data.sourcePack.scanner.configurationSha256="0".repeat(64),data=>data.sourcePack.scanner.exitCode=1,data=>data.sourcePack.scanner.objectSetSha256="0".repeat(64)]){const data=input();change(data);assert.throws(()=>withArchivedSourcePack(data,()=>assert.fail("must not consume")));}
});
test("valid ten-object pack missing one required source blob cannot use ambient repository objects",()=>{
 let missing;withArchivedSourcePack(input(),(_readSource,info)=>{
  const git=(args,body)=>execFileSync("git",["-c","protocol.allow=never","--git-dir="+info.repository,...args],{input:body,windowsHide:true,maxBuffer:1024*1024,stdio:["pipe","pipe","pipe"]});
  const extra=git(["hash-object","-w","--stdin"],Buffer.from("public missing-blob negative fixture\n")).toString("utf8").trim(),omitted=manifest.sourcePack.objects.find(object=>object.type==="blob").oid;
  missing=git(["pack-objects","--stdout","--no-reuse-delta","--no-reuse-object","--window=0","--depth=0","--threads=1"],manifest.sourcePack.objects.filter(object=>object.oid!==omitted).map(object=>object.oid).concat(extra).join("\n")+"\n");
 });
 assert.equal(missing.readUInt32BE(8),10);const data=input();data.pack=missing;data.sourcePack.bytes=missing.length;data.sourcePack.sha256=sha(missing);assert.throws(()=>withArchivedSourcePack(data,()=>assert.fail("must not consume missing blob")),/SOURCE_PACK_EXACT_OBJECT_CLOSURE/);
});
test("tree labels cannot be swapped while keeping the authentic object bytes",()=>{
 const data=input(),trees=data.sourcePack.objects.filter(object=>object.type==="tree");[trees[0].path,trees[1].path]=[trees[1].path,trees[0].path];data.sourcePack.scanner.objectSetSha256=sha(Buffer.from(JSON.stringify(data.sourcePack.objects)));assert.throws(()=>withArchivedSourcePack(data,()=>assert.fail("must not consume wrong tree")),/SOURCE_PACK_TREE_BINDING/);
});
