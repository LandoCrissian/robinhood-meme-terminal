import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,mkdirSync,writeFileSync,readdirSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";
import {parseArgs} from "node:util";

export const INPUT="3fbc55312a027e5f69b16fb927c8549efcc6674bab509c792efdc0104083c5f5";
const repository=fileURLToPath(new URL("../../../../",import.meta.url));
const read=path=>readFileSync(resolve(repository,path));
const text=path=>read(path).toString("utf8").replaceAll("\r\n","\n");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const security="docs/evidence/rmt-task083/security/";
export const baseline=JSON.parse(read(security+"findings.json"));
export const baselineReport=JSON.parse(gunzipSync(read(security+"windows-slither.json.gz"),{maxOutputLength:4*1024*1024}));
const manifest=JSON.parse(read(security+"compiler-manifest.json"));
const input=gunzipSync(read(security+"compiler-input.json.gz"),{maxOutputLength:1024*1024});
const vaultPath="packages/contracts/seaport-acquisition/src/RMTSeaportAcquisitionVaultV2.sol";
const testPath="packages/contracts/seaport-acquisition/test/SeaportTask084Security.t.sol";
const sorted=items=>[...items].sort();
function comparableAst(value){
 if(Array.isArray(value))return value.map(comparableAst);
 if(!value||typeof value!=="object")return value;
 const copy={};for(const[key,item]of Object.entries(value)){
  if(key==="filename_relative"){assert.equal(typeof item,"string");assert.equal(typeof value.filename_short,"string");assert.ok(item.endsWith("/"+value.filename_short),"Unexpected reported source suffix");copy[key]="<temporary-analyzer-workspace>/"+value.filename_short;}
  else copy[key]=comparableAst(item);
 }return copy;
}
const expectedMutations=sorted(["fundNative","fundToken","configurePolicy","disablePurchases","configureFeeRecipient","configureCollection","purchase","scheduleAssetWithdrawal","scheduleNftWithdrawal","cancelWithdrawal","executeWithdrawal","proposeController","acceptController","cancelController"]);
const groups={
 funding:{funds:"Only the current controller's deliberately approved payment tokens and this vault's accounted credit; no core reserves, fee ledger or LP position is callable.",tests:["testTask084FundingCallbackCannotMutateAnyPublicGuardedRoute"],trust:"Pinned, independently admitted immutable standard ERC20; balanceOf is STATICCALL, transferFrom may callback but every vault mutation is locked. Dishonest token state remains an asset-admission risk."},
 purchase:{funds:"Only this vault's previously funded unreserved consideration and the selected NFT; bounded by currency/collection/ID/quantity, price/lifetime/UTC-day limits, cooldown, signed order, deadline and epochs.",tests:["testTask084ApprovalFulfillmentAndRevokeCallbacksKeepAllBaselines","testTask084NativeFeeAndWithdrawalCallbacksCannotCrossTheLock","testTask084AuthorizedSafeCallbackCannotBurnPreparedDisableNonce"],trust:"Exact independently reviewed Seaport1.6 runtime, immutable helper, current signed FULL_OPEN/static/full-fill/zero-zone/conduit order, honest admitted payment/NFT implementation. Controller knowingly enables standing bounded permissionless authority."},
 withdrawal:{funds:"Only the exact previously accounted amount or credited NFT quantity reserved by the current controller's two-day notice; fixed recipient, current epoch, bounded window. No core reserve or permanently locked LP withdrawal exists.",tests:["testTask084TokenWithdrawalCallbacksCannotConsumeAnotherNotice","testTask084NativeFeeAndWithdrawalCallbacksCannotCrossTheLock","testTask084721And1155WithdrawalCallbacksCannotCrossTheLock"],trust:"Current supported controller authored the exact notice. Currency/NFT implementation must have independently admitted semantics; arbitrary hostile recipients may revert or forward, causing atomic rollback rather than partial settlement."}
};
export function reviewHighs(report,{origin="RETAINED_BASELINE_NOT_FRESH_ANALYSIS",vaultSource=text(vaultPath)}={}){
 assert.equal(sha(input),INPUT);assert.equal(baseline.productionInputSha256,INPUT);assert.equal(manifest.inputSha256,INPUT);
 assert.equal(report.tool,"Slither 0.11.5");assert.equal(report.cryticCompile,"0.3.11");assert.equal(report.inputSha256,INPUT);assert.equal(report.analysisInputSha256,baseline.analysisInputSha256);assert.equal(report.detectorCount,101);assert.equal(report.sources,4);
 assert.ok(["537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67","d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef"].includes(report.compilerSha256));
 const high=report.detectors.filter(row=>row.impact==="High");
 assert.equal(report.detectors.length,48);assert.equal(high.length,23);assert.deepEqual(sorted(high.map(row=>row.id)),sorted(baseline.rows.map(row=>row.id)));
 assert.equal(high.filter(row=>row.check==="reentrancy-balance").length,22);assert.equal(high.filter(row=>row.check==="arbitrary-send-eth").length,1);
 assert.deepEqual(baseline.detectorFilters,[]);assert.deepEqual(baseline.sourceFilters,[]);assert.deepEqual(baseline.severityOverrides,[]);assert.equal(baseline.strictExit,1);
 const sourceHash=manifest.sourceSha256.find(([path])=>path==="seaport-acquisition/src/RMTSeaportAcquisitionVaultV2.sol")[1];
 assert.equal(sha(vaultSource),sourceHash,"A source revision needs its own complete fresh disposition; do not silently apply this baseline");
 const currentRoots=[];for(const folder of["seaport-acquisition/src","seaport-acquisition/interfaces"]){const directory=resolve(repository,"packages/contracts",folder);if(existsSync(directory))currentRoots.push(...readdirSync(directory,{recursive:true}).filter(name=>name.endsWith(".sol")).map(name=>folder+"/"+name.replaceAll("\\","/")));}assert.deepEqual(sorted(currentRoots),sorted(manifest.roots),"Production root inclusion changed");
 for(const[path,expected]of manifest.sourceSha256)assert.equal(sha(path==="seaport-acquisition/src/RMTSeaportAcquisitionVaultV2.sol"?vaultSource:text("packages/contracts/"+path)),expected,"Current source closure differs: "+path);

 const declared=sorted([...vaultSource.matchAll(/function\s+(\w+)\([^)]*\)[^{;]*\bguarded\b/g)].map(match=>match[1]));
 assert.deepEqual(declared,expectedMutations);
 const rows=baseline.rows.map(row=>{
  const raw=high.find(found=>found.id===row.id),original=baselineReport.detectors.find(found=>found.id===row.id);assert.equal(raw.check,row.detector);assert.equal(raw.impact,row.impact);assert.equal(raw.confidence,row.confidence);assert.equal(raw.description,row.rawDescription);assert.deepEqual(comparableAst(raw.elements),comparableAst(original.elements),"Changed AST/source evidence");
  const group=groups[row.function==="fundToken"?"funding":row.function==="executeWithdrawal"?"withdrawal":"purchase"];
  const pinned=row.detector==="arbitrary-send-eth";
  const callKind=row.externalCall.includes("approve(seaport,0)")?"EXACT_ALLOWANCE_REVOCATION":row.externalCall.includes("approve(seaport,s.total)")?"EXACT_ALLOWANCE_GRANT":row.externalCall.includes("fulfillAdvancedOrder")?"PINNED_TYPED_SEAPORT_FULFILLMENT":row.externalCall.includes("IAcquisition721")?"ERC721_NOTICED_SAFE_DELIVERY":row.externalCall.includes("IAcquisition1155")?"ERC1155_NOTICED_SAFE_DELIVERY":row.externalCall.includes("w.recipient).call")?"NOTICED_NATIVE_PAYOUT":row.function==="fundToken"?"CONTROLLER_TOKEN_FUNDING":"NOTICED_ERC20_PAYOUT";
  return{
   id:row.id,detector:row.detector,rawImpact:row.impact,rawConfidence:row.confidence,source:row.source,sourceSha256:sourceHash,
   astElements:raw.elements.map(element=>({type:element.type,name:element.name,sourceMapping:element.source_mapping})),
   function:row.function,externalCall:row.externalCall,callKind,balanceBaseline:row.observedBalance,postconditions:row.postconditions,
   rawEvidence:{archive:security+"windows-slither.json.gz",id:row.id,exactDescription:row.rawDescription},
   internalDisposition:pinned?"PINNED_TYPED_DESTINATION_WARNING_CONDITIONAL_ON_SOURCE_ADMISSION":"GUARDED_EXACT_DELTA_WARNING_CONDITIONAL_ON_ASSET_ADMISSION",
   confirmedDefect:false,reachableLossDemonstrated:false,strictHighRetained:true,releaseClearance:false,independentAudit:false,
   rootCause:pinned?"The detector sees native value flow through a parameterized external call. The destination is constructor-immutable, runtime-checked pinned Seaport; the selector, receiver and value are typed and bounded, not arbitrary caller execution.":"The detector labels a pre-call balance stale when used after a mutable external interaction. Here it is intentionally an exact settlement delta baseline, while all financial/policy/notice mutation is guarded and accounting effects precede external calls.",
   assetAndAmountAtRisk:group.funds,trustAssumptions:group.trust,preconditions:row.preconditions,
   guard:row.guard,transitionsAndAtomicChecks:row.stateBeforeExternalEffectAndAtomicPostconditions,
   applicableExistingRegressions:row.applicableRegressionTests,
   newRegressions:group.tests.map(name=>({source:testPath,name,executionStatus:"REQUIRES_SEPARATE_ACTUAL_CI_EVIDENCE"})),
   remainingUncertainty:[
    "Finite adversarial tests are not independent or exhaustive clearance; the strict detector result remains High.",
    "A deliberately dishonest admitted token/NFT can lie about its own ledger. Proxy/runtime hash alone does not prove immutable implementation or authorization policy; production asset admission is separate.",
    "Immediate forwarding by a native/NFT recipient is deliberately unsupported and must revert, preserving all assets and notices.",
    "Safe owners may legitimately change through their external wallet. Vault policy epochs do not freeze that external owner set; browser review and receipt verification must reject unreviewed or same-block authority drift."
   ],
   remediation:"No confirmed loss path justified removing exact deltas or weakening custody. Keep source and checks unchanged, add targeted real-contract callback/rollback coverage, and retain the source/payment/authority admission holds."
  };
 });
 return{schemaVersion:1,scope:"TASK084_INTERNAL_FINDING_DISPOSITION_NOT_INDEPENDENT_CLEARANCE",status:"BLOCKED_NO_BROADCAST",productionInputSha256:INPUT,reportOrigin:origin,
 reportSha256:sha(JSON.stringify(report)),astComparison:"Only the temporary analyzer workspace prefix in filename_relative is normalized for correspondence. Original AST paths, offsets, lines, IDs and raw reports remain unchanged.",detectorCount:101,sourceCount:4,observations:48,highCount:23,counts:{balanceBaseline:22,pinnedNativeFulfillment:1},
 strictExit:1,detectorFilters:[],sourceFilters:[],severityOverrides:[],confirmedDefects:0,highsCleared:0,productionSourceChanged:false,
 guardedMutableEntryPoints:expectedMutations,receiverException:"Only the single expected Seaport ERC1155 callback may set received during purchase. ERC721 transferFrom needs no callback; its exact owner/balance postconditions remain mandatory.",
 safeAdminRequirement:"CALL-only, zero safeTxGas/baseGas/gasPrice/gasToken/refundReceiver. A failed inner operation must GS013-revert without consuming the Safe nonce. Exact current owner set/threshold/nonce is separately bound by dashboard and receipts.",
 historicalScopes:{acquisitionV1:22,coreAndDependencies:22,treasuryV1:6,activeReclaimV2:7,rejectedHistoricalReclaimV1:4},rows,
 executionEvidence:null,executionWarning:"Named tests are required checks, not a predeclared pass. Attach the actual new Foundry/fork/CI results separately.",productionPurchasesApproved:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{report:{type:"string"},output:{type:"string"}}});assert.ok(values.output,"Use a fresh isolated evidence output directory");
 const raw=values.report?readFileSync(resolve(values.report)):null,report=raw?JSON.parse(raw):baselineReport;
 const result=reviewHighs(report,{origin:raw?"SUPPLIED_FRESH_ANALYZER_REPORT_REQUIRES_CI_PROVENANCE":"RETAINED_BASELINE_NOT_FRESH_ANALYSIS"});
 if(raw)result.rawReportSha256=sha(raw);
 mkdirSync(resolve(values.output),{recursive:false});writeFileSync(resolve(values.output,"dispositions.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx"});
 console.log(JSON.stringify({highs:23,cleared:0,confirmedDefects:0,strictExit:1,productionSourceChanged:false,output:resolve(values.output)}));
}
