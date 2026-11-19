import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {createRequire} from "node:module";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
const require=createRequire(new URL("../../apps/indexer/package.json",import.meta.url)),{keccak256}=require("viem"),sha=b=>createHash("sha256").update(b).digest("hex");

/** Preserve raw bytes and every scanner observation. The only admitted finding
 * is an exact independently compiled/public onchain runtime hash, bound to its
 * source response and both actual providers. No detector or history changes. */
export function archiveMarketplace({source,report,output}){
 const proofBytes=readFileSync(join(source,"marketplace-qualification.json")),proof=JSON.parse(proofBytes),scanBytes=readFileSync(report),findings=JSON.parse(scanBytes);
 assert.equal(proof.status,"BLOCKED_NO_BROADCAST");assert.equal(proof.freshVenue.allSourceRuntimeHashesMatch,true);assert.equal(proof.currentOrderIndependentlyVerified,false);
 const classifications=findings.map(f=>{
  assert.equal(f.RuleID,"generic-api-key");assert.ok(f.File.replaceAll("\\","/").endsWith("/marketplace-qualification.json"));
  const line=proofBytes.toString().split(/\r?\n/)[f.StartLine-1],match=line.match(/^\s*"sourceApiOnchainRuntimeHash": "(0x[0-9a-f]{64})",?$/);assert.ok(match,"Unclassified scanner observation");const value=match[1];
  const name=["implementation","admin"].find(n=>proof.assets.wrappedNative.sourceRecords[n].sourceApiOnchainRuntimeHash===value);assert.ok(name);
  const raw=readFileSync(join(source,`weth-${name}-source.json`)),record=JSON.parse(raw);assert.equal(sha(raw),proof.assets.wrappedNative.sourceRecords[name].sha256);assert.equal(keccak256(record.runtimeBytecode.onchainBytecode),value);
  assert.equal(proof.assets.wrappedNative.sourceRecords[name].reproduction.actualRuntimeHash,value);
  for(const p of Object.values(proof.proxy.providers))assert.equal(p[name+"RuntimeHash"],value);
  return{ruleId:f.RuleID,sourceFile:"marketplace-qualification.json",line:f.StartLine,lineSha256:sha(line),publicValueSha256:sha(value),publicValue:value,sourceResponse:`weth-${name}-source.json`,sourceResponseSha256:sha(raw),disposition:`PUBLIC_4663_WETH_${name.toUpperCase()}_RUNTIME_HASH_INDEPENDENTLY_COMPILED_AND_BOTH_RPC_CORROBORATED`};
 });
 assert.equal(classifications.length,2,"Preserve and independently review any changed scan set");mkdirSync(output,{recursive:true});
 const archives={};for(const file of["marketplace-qualification.json","weth-implementation-source.json","weth-admin-source.json"]){const raw=readFileSync(join(source,file));writeFileSync(join(output,file+".gz"),gzipSync(raw,{level:9}));archives[file]={bytes:raw.length,sha256:sha(raw)};}
 writeFileSync(join(output,"raw-gitleaks-report.json.gz"),gzipSync(scanBytes,{level:9}));
 const result={schemaVersion:1,status:"BLOCKED_NO_BROADCAST",observedAt:proof.observedAt,freshVenueObservedAt:proof.freshVenueObservedAt,anchorBlock:proof.proxy.anchor,rawScanner:{name:"Gitleaks",version:"8.30.1",configurationSha256:sha(readFileSync(new URL("../../.gitleaks.toml",import.meta.url))),reportSha256:sha(scanBytes),exitCode:1,findings:findings.length,unclassified:0,suppressionsAdded:false,historyRewritten:false},archives,classifications,currentOrderIndependentlyVerified:false,productionPaymentAdmitted:false,executionApproved:false,broadcast:false};
 writeFileSync(join(output,"manifest.json"),JSON.stringify(result,null,2)+"\n");return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const{values}=parseArgs({options:{source:{type:"string"},report:{type:"string"},output:{type:"string"}}});assert.ok(values.source&&values.report&&values.output);const r=archiveMarketplace({source:resolve(values.source),report:resolve(values.report),output:resolve(values.output)});console.log(JSON.stringify({findings:r.rawScanner.findings,unclassified:r.rawScanner.unclassified,status:r.status}));}
