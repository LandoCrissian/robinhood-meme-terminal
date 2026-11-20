import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync,lstatSync,mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename,dirname,join,resolve} from "node:path";

const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const oid=/^[0-9a-f]{40}$/,sha256=/^[0-9a-f]{64}$/;
const limit=1024*1024;
const paths=["browser-safe-admin.mjs","browser-safe-diagnostics.mjs","browser-safe-diagnostics.test.mjs","task086-collection-acceptance.mjs","browser-run.mjs","compiler.mjs"].map(name=>"scripts/seaport-acquisition/"+name).sort();
const treePaths=["","scripts","scripts/seaport-acquisition"];
const objectHash=(type,bytes)=>createHash("sha1").update(type+" "+bytes.length+"\0").update(bytes).digest("hex");

/** The retained pack contains exactly one historical commit, its three path
 * trees and six public source blobs. No parent history, refs, hooks, remotes,
 * working-tree substitution or network fetch is used by evidence replay. */
export function withArchivedSourcePack({pack,source,sourceFiles,sourcePack},consume){
 assert.ok(Buffer.isBuffer(pack)&&pack.length>12&&pack.length<=limit,"SOURCE_PACK_BYTES_BOUND");
 assert.ok(oid.test(source??""));assert.equal(sourcePack?.schemaVersion,1);assert.equal(sourcePack.path,"source-1be772c8.pack");assert.equal(sourcePack.objectFormat,"sha1");assert.equal(sourcePack.commit,source,"SOURCE_PACK_COMMIT_MISMATCH");
 assert.equal(sourcePack.bytes,pack.length,"SOURCE_PACK_SIZE_MISMATCH");assert.ok(sha256.test(sourcePack.sha256??""));assert.equal(sha(pack),sourcePack.sha256,"SOURCE_PACK_SHA256_MISMATCH");
 assert.equal(pack.subarray(0,4).toString("ascii"),"PACK");assert.equal(pack.readUInt32BE(4),2);assert.equal(pack.readUInt32BE(8),10,"SOURCE_PACK_OBJECT_COUNT");
 assert.ok(Array.isArray(sourceFiles));assert.deepEqual(sourceFiles.map(file=>file.path).sort(),paths,"SOURCE_PACK_PATH_CLOSURE");
 for(const file of sourceFiles)assert.ok(sha256.test(file.gitBlobSha256??""));
 const objects=sourcePack.objects;assert.ok(Array.isArray(objects)&&objects.length===10,"SOURCE_PACK_OBJECT_COUNT");
 assert.equal(new Set(objects.map(object=>object.oid)).size,10);
 for(const object of objects){assert.ok(oid.test(object.oid??"")&&sha256.test(object.sha256??"")&&Number.isSafeInteger(object.bytes)&&object.bytes>0&&object.bytes<=limit,"SOURCE_PACK_OBJECT_IDENTITY");assert.ok(["commit","tree","blob"].includes(object.type));}
 assert.ok(objects.reduce((sum,object)=>sum+object.bytes,0)<=limit,"SOURCE_PACK_UNCOMPRESSED_BOUND");
 const commits=objects.filter(object=>object.type==="commit"),trees=objects.filter(object=>object.type==="tree"),blobs=objects.filter(object=>object.type==="blob");
 assert.equal(commits.length,1);assert.equal(commits[0].oid,source,"SOURCE_PACK_COMMIT_MISMATCH");
 assert.deepEqual(trees.map(object=>object.path).sort(),treePaths);assert.deepEqual(blobs.map(object=>object.path).sort(),paths);
 for(const file of sourceFiles)assert.equal(blobs.find(object=>object.path===file.path).sha256,file.gitBlobSha256,"SOURCE_PACK_BLOB_SHA256_MISMATCH");
 const scan=sourcePack.scanner;assert.equal(scan?.name,"Gitleaks");assert.equal(scan.version,"8.30.1");assert.ok(sha256.test(scan.executableSha256??""));assert.equal(scan.configurationSha256,sha(readFileSync(new URL("../../../../.gitleaks.toml",import.meta.url))));assert.equal(scan.scope,"TEN_UNCOMPRESSED_PUBLIC_GIT_OBJECTS_BEFORE_PACK_RETENTION");assert.equal(scan.objectSetSha256,sha(Buffer.from(JSON.stringify(objects))));assert.equal(scan.exitCode,0);assert.equal(scan.findings,0);assert.equal(scan.suppressionsAdded,false);assert.ok(typeof scan.reportUtf8==="string"&&Buffer.byteLength(scan.reportUtf8)<=65536);assert.equal(sha(Buffer.from(scan.reportUtf8)),scan.reportSha256);assert.deepEqual(JSON.parse(scan.reportUtf8),[]);
 const temporaryRoot=realpathSync(tmpdir()),temporary=mkdtempSync(join(temporaryRoot,"rmt-task086-source-pack-")),created=realpathSync(temporary);
 assert.equal(dirname(created),temporaryRoot);assert.ok(/^rmt-task086-source-pack-[A-Za-z0-9]+$/.test(basename(created)));
 const repository=join(created,"repository.git"),template=join(created,"empty-template"),config=join(created,"empty-config");
 // Ignore inherited Git configuration/alternates. The only allowed protocol is
 // none; imports operate solely on the already hash-checked local pack bytes.
 const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^GIT_/i.test(name)));
 Object.assign(env,{GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:config,GIT_TERMINAL_PROMPT:"0",GIT_NO_REPLACE_OBJECTS:"1",GIT_NO_LAZY_FETCH:"1",GIT_ALLOW_PROTOCOL:"",GIT_OPTIONAL_LOCKS:"0"});
 mkdirSync(template);writeFileSync(config,"");
 const run=(args,input)=>execFileSync("git",["-c","core.hooksPath="+template,"-c","core.fsmonitor=false","-c","protocol.allow=never","--git-dir="+repository,...args],{cwd:created,env,input,windowsHide:true,timeout:10000,maxBuffer:2*limit,stdio:["pipe","pipe","pipe"]});
 try{
  run(["init","--bare","--template="+template,repository]);
  assert.equal(existsSync(join(repository,"hooks")),false);assert.doesNotMatch(readFileSync(join(repository,"config"),"utf8"),/\[remote\b|\[include\b|\[includeIf\b/i);
  assert.equal(run(["cat-file","--batch-all-objects","--batch-check=%(objectname)"]).length,0,"SOURCE_PACK_REPOSITORY_MUST_START_EMPTY");assert.equal(existsSync(join(repository,"objects","info","alternates")),false);
  run(["index-pack","--stdin"],pack);
  const inventory=run(["cat-file","--batch-all-objects","--batch-check=%(objectname) %(objecttype) %(objectsize)"]).toString("utf8").trim().split("\n").filter(Boolean).map(line=>{const match=line.trim().match(/^([0-9a-f]{40}) (commit|tree|blob) ([0-9]+)$/);assert.ok(match,"SOURCE_PACK_IMPORTED_OBJECT");return{oid:match[1],type:match[2],bytes:Number(match[3])};});
  assert.deepEqual(inventory.sort((a,b)=>a.oid.localeCompare(b.oid)),objects.map(({oid,type,bytes})=>({oid,type,bytes})).sort((a,b)=>a.oid.localeCompare(b.oid)),"SOURCE_PACK_EXACT_OBJECT_CLOSURE");
  for(const object of objects){const bytes=run(["cat-file",object.type,object.oid]);assert.equal(bytes.length,object.bytes);assert.equal(sha(bytes),object.sha256,"SOURCE_PACK_OBJECT_SHA256");assert.equal(objectHash(object.type,bytes),object.oid,"SOURCE_PACK_GIT_OBJECT_HASH");}
  for(const tree of trees){const actual=run(["rev-parse",tree.path?source+":"+tree.path:source+"^{tree}"]).toString("utf8").trim();assert.equal(actual,tree.oid,"SOURCE_PACK_TREE_BINDING");}
  for(const blob of blobs){const entry=run(["ls-tree","-z",source,"--",blob.path]).toString("utf8");assert.equal(entry,"100644 blob "+blob.oid+"\t"+blob.path+"\0","SOURCE_PACK_BLOB_TREE_BINDING");}
  const readSource=path=>{assert.ok(paths.includes(path),"SOURCE_PACK_PATH_CLOSURE");return run(["show",source+":"+path]);};
  const result=consume(readSource,{repository,temporary:created,objects:inventory});assert.ok(!result||typeof result.then!=="function","SOURCE_PACK_SYNCHRONOUS_CONSUMER_REQUIRED");return result;
 }finally{
  // Delete only this freshly created, verified immediate child of OS Temp.
  assert.equal(lstatSync(created).isSymbolicLink(),false);assert.equal(realpathSync(created),created);assert.equal(dirname(created),temporaryRoot);assert.equal(resolve(temporary),created);
  rmSync(created,{recursive:true,force:true});
 }
}
