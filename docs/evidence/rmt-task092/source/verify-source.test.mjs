import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {verifySavedSources,verifySource} from "./verify-source.mjs";
const require=createRequire(new URL("../../../../apps/launch-website/package.json",import.meta.url));const{keccak256}=require("viem");
test("replay actual HTTP-200 metadata hashes and original compiler/constructor/runtime pins",()=>{
 const rows=verifySavedSources();assert.equal(rows.length,4);assert.equal(rows.filter(row=>row.fullyVerified).length,3);
 assert.equal(rows.find(row=>!row.fullyVerified).id,"RMTLaunchCurveDeploymentV2");
});
test("fresh checksum-pinned native compiler artifact reproduces the original bootstrap constructor input",()=>{
 const report=JSON.parse(readFileSync(new URL("bootstrap-native-reproduction.json",import.meta.url)));
 const bytes=readFileSync(new URL(report.artifact.file,import.meta.url));
 assert.equal(createHash("sha256").update(bytes).digest("hex"),report.artifact.sha256);
 const {file,name,artifact}=JSON.parse(gunzipSync(bytes));
 const request=JSON.parse(gunzipSync(readFileSync(new URL("../../rmt-task091/governance/source-publication/RMTLaunchCurveDeploymentV2.request.json.gz",import.meta.url))));
 assert.equal(file+":"+name,request.fullyQualifiedName);
 assert.equal(report.compilerInputSha256,request.compilerInputSha256);
 assert.equal(report.compiler.executableSha256,"537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67");
 assert.equal(keccak256("0x"+artifact.evm.bytecode.object+request.fields.constructorArguments),request.initcodeHash);
 assert.equal(report.originalRuntimeHash,request.runtimeHash);assert.equal(report.shortNameMatches,1);
 assert.equal(report.networkRequests,0);assert.equal(report.contractDeployment,false);
});
test("reject changed source, constructor, runtime, compiler or compiler input",()=>{
 const id="RMTV4CurveGraduationV1";
 const metadata=()=>JSON.parse(gunzipSync(readFileSync(new URL(`current-tail/${id}.metadata.json.gz`,import.meta.url))));
 const request=()=>JSON.parse(gunzipSync(readFileSync(new URL(`../../rmt-task091/governance/source-publication/${id}.request.json.gz`,import.meta.url))));
 for(const mutate of [m=>m.source_code+="\n",m=>m.constructor_args="0x",m=>m.deployed_bytecode="0x6000",m=>m.compiler_version="v0.8.25",m=>m.compiler_settings.viaIR=false]){const m=metadata();mutate(m);assert.throws(()=>verifySource(m,request()));}
 const p=request();p.fields.sourceCode+=" ";assert.throws(()=>verifySource(metadata(),p));
});
