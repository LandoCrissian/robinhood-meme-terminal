import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync,readFileSync,readdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";
import {parseArgs} from "node:util";

export const BASE="50e278401ef6e0e66a5f38045295b97cf6b5d930";
export const directory=fileURLToPath(new URL("./",import.meta.url));
const repository=fileURLToPath(new URL("../../../../",import.meta.url));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const normalized=bytes=>Buffer.from(bytes.toString("utf8").replaceAll("\r\n","\n"));
const git=(...args)=>execFileSync("git",args,{cwd:repository,windowsHide:true,maxBuffer:32*1024*1024});
const load=name=>readFileSync(resolve(directory,name));
const json=bytes=>JSON.parse(bytes.toString("utf8"));
const tree=ref=>new Map(git("ls-tree","-rz",ref).toString("utf8").split("\0").filter(Boolean).map(line=>{const [,mode,type,blob,path]=line.match(/^(\d+) (\w+) ([0-9a-f]{40})\t([\s\S]+)$/);return[path,{mode,type,blob}];}));

export function assertPreserved(paths,base,current){
 return paths.map(path=>{assert.ok(current.has(path),"Preserved file deleted: "+path);assert.equal(current.get(path).blob,base.get(path).blob,"Preserved blob changed: "+path);assert.equal(current.get(path).mode,base.get(path).mode,"Preserved file mode changed: "+path);return{path,baseBlob:base.get(path).blob,currentBlob:current.get(path).blob,unchanged:true};});
}
export function assertRootCoverage(actualRoots,recordedRoots){assert.deepEqual([...actualRoots].sort(),[...recordedRoots].sort(),"Every current new production root must be in the exact compiler/analysis input");}
export function assertArchiveIntegrity(buffers,manifest){
 for(const f of manifest.files){const raw=buffers.get(f.path);assert.ok(raw,"Missing evidence artifact: "+f.path);const b=f.textNormalization==="LF"?normalized(raw):raw;assert.equal(b.length,f.bytes,"Evidence byte count: "+f.path);assert.equal(sha(b),f.sha256,"Evidence SHA256: "+f.path);if(f.uncompressedSha256){const uncompressed=gunzipSync(b);assert.equal(uncompressed.length,f.uncompressedBytes);assert.equal(sha(uncompressed),f.uncompressedSha256);}}
}
export function assertCompilerInput(inputBytes,manifest,readSource){
 assert.equal(sha(inputBytes),manifest.inputSha256,"Exact production compiler input digest");const input=json(inputBytes);
 assert.equal(Object.keys(input.sources).length,manifest.sourceCount);
 assert.deepEqual(Object.keys(input.sources).sort(),manifest.sourceSha256.map(([p])=>p).sort());
 for(const[path,pin]of manifest.sourceSha256){assert.equal(sha(input.sources[path].content),pin,"Archived source digest: "+path);assert.equal(sha(normalized(readSource(path))),pin,"Current source digest: "+path);}
 for(const root of manifest.roots)assert.ok(Object.hasOwn(input.sources,root));
 assert.deepEqual(input.settings.optimizer,{enabled:true,runs:200});assert.equal(input.settings.evmVersion,"cancun");assert.equal(input.settings.viaIR,true);
 return input;
}

export async function verifyArtifacts({solc}={}){
 const integrity=json(load("integrity.json"));assertArchiveIntegrity(new Map(integrity.files.map(f=>[f.path,load(f.path)])),integrity);
 const observedHead=git("rev-parse","HEAD").toString().trim(),base=tree(BASE),current=tree("HEAD");
 const oldSolidity=[...base.keys()].filter(p=>p.endsWith(".sol")).sort();assert.ok(oldSolidity.length>0);
 const oldSourceInventory=assertPreserved(oldSolidity,base,current);
 const workingChanges=git("diff","--name-only",BASE,"--","*.sol").toString("utf8").trim().split("\n").filter(Boolean);
 assert.deepEqual(workingChanges.filter(p=>base.has(p)),[],"Uncommitted preserved Solidity change");
 const packagePaths=[...base.keys()].filter(p=>/(?:^|\/)package\.json$/.test(p)||/(?:^|\/)(?:pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|yarn\.lock)$/.test(p)).sort();
 const packages=assertPreserved(packagePaths,base,current);
 const gatePaths=[...base.keys()].filter(p=>p===".gitleaks.toml"||p===".gitleaksignore"||p.startsWith("scripts/release/")||p==="docs/evidence/rmt-task043/analyze-rotation.py"
  ||p.startsWith("docs/evidence/rmt-task080/security/")||p.startsWith("docs/evidence/rmt-task081/security/")||p.startsWith("docs/evidence/rmt-task082/security/")
  ||p.startsWith("docs/evidence/fixed-supply-security/")||p.startsWith("docs/evidence/rmt-task082/history/")
  ||p.startsWith(".github/workflows/")&&!['.github/workflows/launch-website-review.yml','.github/workflows/reclaim-v2-security.yml','.github/workflows/ci.yml'].includes(p)).sort();
 const gates=assertPreserved(gatePaths,base,current);
 const changedTracked=git("diff","--name-only",BASE).toString("utf8").trim().split("\n").filter(Boolean);assert.deepEqual(changedTracked.filter(p=>packagePaths.includes(p)||gatePaths.includes(p)),[],"Uncommitted dependency or retained gate change");
 const baselineWebsite=git("show",BASE+":.github/workflows/launch-website-review.yml").toString("utf8"),currentWebsite=readFileSync(resolve(repository,".github/workflows/launch-website-review.yml"),"utf8").replaceAll("\r\n","\n");
 const addedPublicCheck='            node scripts/seaport-acquisition/public-check.mjs --url http://127.0.0.1:3205/ \\\n              --browser "$engine" --output "$RMT_WEBSITE_PREVIEW_ARTIFACTS/$engine/seaport-acquisition"\n';
 assert.equal(currentWebsite.split(addedPublicCheck).length,2,"Exact additional public-route check expected");assert.equal(currentWebsite.replace(addedPublicCheck,""),baselineWebsite,"Existing website workflow changed beyond additional public negative check");
 const reclaimPath=".github/workflows/reclaim-v2-security.yml",baselineReclaim=git("show",BASE+":"+reclaimPath).toString("utf8"),currentReclaim=readFileSync(resolve(repository,reclaimPath),"utf8").replaceAll("\r\n","\n");
 const addedReclaimTriggers='      # Retain the frozen trial\'s strict regression beside the separate V2 vault.\n      - "packages/contracts/seaport-acquisition/**"\n      - "packages/launchpad-common/seaport-vault-*"\n      - "scripts/seaport-acquisition/**"\n      - "apps/indexer/src/seaport-acquisition*"\n      - "apps/launch-website/**"\n';
 assert.equal(currentReclaim.split(addedReclaimTriggers).length,2,"Exact trigger-only frozen Reclaim regression extension expected");assert.equal(currentReclaim.replace(addedReclaimTriggers,""),baselineReclaim,"Reclaim source/test/analyzer/strict commands must remain unchanged");
 const ciPath=".github/workflows/ci.yml",baselineCi=git("show",BASE+":"+ciPath).toString("utf8"),currentCi=readFileSync(resolve(repository,ciPath),"utf8").replaceAll("\r\n","\n");
 const addedBaseFetch='          git fetch --no-tags --depth=1 origin '+BASE+'\n';assert.ok(currentCi.split(addedBaseFetch).length<=2);assert.equal(currentCi.replace(addedBaseFetch,""),baselineCi,"Existing CI commands changed beyond fetching the exact preservation base");
 if(currentCi.includes(addedBaseFetch))assert.ok(currentCi.indexOf(addedBaseFetch)<currentCi.indexOf('      - run: pnpm test:release-evidence'),"Exact preservation base must be fetched before evidence tests");
 const manifest=json(load("compiler-manifest.json")),inputBytes=gunzipSync(load("compiler-input.json.gz"));
 const input=assertCompilerInput(inputBytes,manifest,path=>readFileSync(resolve(repository,"packages/contracts",path)));
 const actualRoots=[];for(const folder of["src","interfaces"]){const path=resolve(repository,"packages/contracts/seaport-acquisition",folder);if(existsSync(path))actualRoots.push(...readdirSync(path,{recursive:true}).filter(p=>p.endsWith(".sol")).map(p=>"seaport-acquisition/"+folder+"/"+p.replaceAll("\\","/")));}assertRootCoverage(actualRoots,manifest.roots);
 const report=json(gunzipSync(load("windows-slither.json.gz"))),linux=json(gunzipSync(load("linux-slither.json.gz"))),register=json(load("findings.json"));
 for(const raw of[report,linux]){assert.equal(raw.inputSha256,manifest.inputSha256);assert.equal(raw.sources,manifest.sourceCount);assert.equal(raw.detectorCount,101);assert.equal(raw.detectors.filter(f=>f.impact==="High").length,23);}
 assert.deepEqual(report.detectors.filter(f=>f.impact==="High").map(f=>f.id).sort(),linux.detectors.filter(f=>f.impact==="High").map(f=>f.id).sort());
 assert.equal(register.strictExit,1);assert.deepEqual(register.detectorFilters,[]);assert.deepEqual(register.sourceFilters,[]);assert.deepEqual(register.severityOverrides,[]);assert.equal(register.distinctHistoricalScope.task082CurrentHighs,22);
 const newWorkflowPath=".github/workflows/seaport-acquisition.yml",newWorkflow=readFileSync(resolve(repository,newWorkflowPath),"utf8").replaceAll("\r\n","\n"),strictSection=newWorkflow.split("  seaport-vault-strict-security:")[1]?.split("  seaport-vault-robinhood-fork:")[0];
 assert.ok(strictSection?.includes('python docs/evidence/rmt-task043/analyze-rotation.py "$RUNNER_TEMP/seaport-acquisition.json"'));assert.ok(!/continue-on-error|\|\|\s*(?:true|:)/.test(strictSection),"New strict gate must not swallow failures");
 const sourceByPath=manifest.sourceSha256.map(([path,sourceSha256])=>({path,sourceSha256,isNewProductionRoot:manifest.roots.includes(path),preservedImport:base.has("packages/contracts/"+path)}));
 const compilerPath="scripts/seaport-acquisition/compiler.mjs",compilerBlob=git("hash-object","--path",compilerPath,compilerPath).toString().trim();
 let recompiled=null;
 if(solc){const{compileSeaportAcquisition}=await import("../../../../scripts/seaport-acquisition/compiler.mjs");const fresh=compileSeaportAcquisition({solc});assert.equal(fresh.input,inputBytes.toString("utf8"));assert.deepEqual(fresh.manifest.templates,manifest.templates);assert.deepEqual(fresh.manifest.roots,manifest.roots);recompiled={performed:true,compilerExecutableSha256:fresh.manifest.executableSha256,productionInputSha256:fresh.manifest.inputSha256,templatesExactlyMatched:true};}
 return{schemaVersion:1,status:"BLOCKED_NO_BROADCAST",base:BASE,observedHead,gitBlobMeaning:"Exact repository source bytes, independent of checkout LF/CRLF conversion; working-tree old-source differences also rejected.",
  preservation:{oldSolidityFiles:oldSourceInventory.length,changed:0,deleted:0,rows:oldSourceInventory},dependencies:{files:packages,changed:0,newPaidServicesAuthorized:false},
  retainedSecurityGates:{files:gates,changed:0,changedCountScope:"Exact-byte retained inventory only; three explicitly bounded additive workflow extensions are recorded separately.",existingWebsiteWorkflow:{change:"Exactly one additional Seaport public negative check, no removed or modified baseline lines",baselineBlob:base.get(".github/workflows/launch-website-review.yml").blob,currentBlob:current.get(".github/workflows/launch-website-review.yml").blob},existingReclaimWorkflow:{path:reclaimPath,change:"Exactly five added trigger paths and their explanatory comment; existing source/test/analyzer/strict commands unchanged",baselineBlob:base.get(reclaimPath).blob,currentBlob:current.get(reclaimPath).blob,strictCommandsUnchanged:true},existingCiWorkflow:{path:ciPath,change:"Only exact read-only Task082 base fetch may be added before release-evidence tests; every baseline command remains identical",baseFetchAdded:currentCi.includes(addedBaseFetch),baselineBlob:base.get(ciPath).blob,currentBlob:current.get(ciPath).blob,strictCommandsUnchanged:true},newStrictWorkflow:{path:newWorkflowPath,normalizedSha256:sha(normalized(Buffer.from(newWorkflow))),failuresSwallowed:false},newHighs:23,priorAcquisitionHighs:22,otherRetainedHighs:{core:22,treasuryV1:6,activeReclaimV2:7,rejectedHistoricalReclaimV1:4},allDetectors:101,strictExit:1,noWaivers:true},
  candidate:{productionInputSha256:manifest.inputSha256,roots:manifest.roots,sourceClosureCount:manifest.sourceCount,sources:sourceByPath,compilerScript:{path:compilerPath,gitBlob:compilerBlob,normalizedSha256:sha(normalized(readFileSync(resolve(repository,compilerPath))))},settings:input.settings,templates:manifest.templates,recompiled},
  production:{liveStateObserved:false,scope:"Repository/source integrity only; no live production configuration, deployed state or balances are certified by this check.",deploymentAuthorized:false,fundingAuthorized:false,sourceCandidateProductionExecutionAvailable:false,preservedSourceEconomics:{feesChanged:false,tokenSupplyChanged:false}}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const{values}=parseArgs({options:{solc:{type:"string"},output:{type:"string"}}});const proof=await verifyArtifacts({solc:values.solc});
 if(values.output)writeFileSync(resolve(values.output),JSON.stringify(proof,null,2)+"\n");
 console.log(JSON.stringify({oldSolidityFiles:proof.preservation.oldSolidityFiles,oldSolidityChanged:0,dependencyFiles:proof.dependencies.files.length,retainedGateFiles:proof.retainedSecurityGates.files.length,productionInputSha256:proof.candidate.productionInputSha256,allDetectors:101,strictExit:1,recompiled:proof.candidate.recompiled?.performed??false}));
}
