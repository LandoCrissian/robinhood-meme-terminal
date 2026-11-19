import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {gzipSync,gunzipSync} from "node:zlib";
import {parseArgs} from "node:util";

const directory=fileURLToPath(new URL("./",import.meta.url));
const repository=fileURLToPath(new URL("../../../../",import.meta.url));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const json=bytes=>JSON.parse(bytes.toString("utf8"));
const read=name=>readFileSync(resolve(directory,name));
const normalizeDescription=value=>value.replace(/\b(?:TMP|REF)_\d+\b/g,"<slither-temporary>");
const section=(description,start,end)=>description.includes(start)?description.split(start)[1].split(end)[0].trim():null;
const testFile=name=>"packages/contracts/seaport-acquisition/test/"+name+".t.sol";
const test=(file,name)=>({source:testFile(file),name});
const mutableGuard="guarded rejects entered!=1 before dependency reads, verifies constructor-pinned identity through static view calls, sets entered=2 before any mutable external effect and resets only on success. All financial/policy/notice mutations use guarded. Receiver exceptions admit exactly one expected Seaport ERC1155 delivery while entered==2; ERC721 safe callbacks and ERC1155 batches always revert.";
const uncertainty="Internal finite-path assessment, not an independent audit or security clearance. Exact runtime hashes identify code but cannot establish honest token/NFT balance semantics, proxy implementation/admin policy, current listing provenance or finality. Native and NFT recipients that forward immediately fail exact endpoint checks as an explicit liveness restriction. Forced/unaccounted gifts confer no withdrawal right. Production acquisition remains NO-GO; every High and strict scanner failure remains unresolved.";

function assessment(finding){
 const functionElement=finding.elements.find(x=>x.type==="function");assert.ok(functionElement);
 const name=functionElement.name,description=finding.description;
 const call=section(description,"External call allowing reentrancy:","Balance read before the call:")??section(description,"Dangerous calls:","\u0000");
 const balance=section(description,"Balance read before the call:","Possible stale balance used after the call in a condition:");
 let asset,preconditions,state,tests;
 if(name==="fundToken"){
  asset="Deliberately transferred controller ERC20 funding, with exact controller debit and segregated vault credit.";
  preconditions="Current supported controller deliberately calls fundToken with positive amount and source, and approves only this vault. The immutable admitted payment token executes transferFrom and could attempt callbacks or falsify transfer semantics.";
  state="Funding/accountedHeld are incremented under the active lock before transferFrom. Both token endpoints must change by exactly amount and transfer must return true. Failure rolls back funding and allowance effects; no fee entitlement or external treasury credit is pulled.";
  tests=[test("SeaportAcquisition","testFundingAndConfigurationOnlyCurrentController"),test("SeaportAcquisitionHostile","testTokenApprovalAndEveryPaymentCallbackCannotExecuteMatureWithdrawal"),test("SeaportAcquisitionInvariant","invariantFundedConservationBudgetAllowanceAndExactAcquiredCustody")];
 }else if(name==="purchase"){
  asset="Settled unreserved native/ERC20 consideration; exact seller/fee/royalty endpoint deltas and ERC721/ERC1155 custody credited only to this project vault.";
  preconditions="Controller explicitly enables a current-epoch standing policy. A permissionless caller supplies a current canonical seller signature over the exact Seaport FULL_OPEN static single-NFT order, current counter/hash/status, admitted collection/ID/quantity/currency, every recipient and exact ERC2981 royalty. All price/lifetime/day/cooldown/reserve limits and deadline must hold.";
  state="Before mutable calls: orderConsumed=true, accountedHeld decreases, lifetime/day spend and cooldown increase, and the exact ERC1155 expected receive window is installed. Only immutable pinned Seaport.fulfillAdvancedOrder can spend, with exact native value or finite ERC20 approval, zero zone/conduits/criteria/extraData/tips and receiver=this vault. Approval is explicitly zeroed afterwards. Full 1/1 status, counter, signatures, authority/epochs, code, royalty, all recipient payment deltas, seller NFT debit, vault credit and ERC721 ownerOf are checked before inventory credit. Every failure atomically rolls back all state and transfers.";
  tests=[test("SeaportAcquisition","testGenuineNative721CustodyWithoutSafeReceiverCallback"),test("SeaportAcquisition","testGenuineToken1155AtomicCustody"),test("SeaportAcquisition","testMinedDisableInvalidatesOldEpochAndLeavesFundsAndNft"),test("SeaportAcquisitionHostile","testNativeFeeCallbackCannotExecuteMatureWithdrawal"),test("SeaportAcquisitionHostile","testTokenApprovalAndEveryPaymentCallbackCannotExecuteMatureWithdrawal"),test("SeaportAcquisitionHostile","testNftCallbackCannotExecuteMatureWithdrawalOrReenter"),test("SeaportAcquisitionHostile","testNativeForwardingFeeRecipientIsExplicitlyRejectedAtomically"),test("SeaportAcquisitionHostile","testNftMutatingRoyaltyAfterTransferRollsBackEveryAssetAndState"),test("SeaportAcquisitionInvariant","invariantFundedConservationBudgetAllowanceAndExactAcquiredCustody")];
 }else{
  assert.equal(name,"executeWithdrawal");asset="Previously accounted capital or purchased NFT custody under an exact current-epoch asset/ID/quantity/recipient notice.";
  preconditions="The current supported controller previously scheduled this exact withdrawal, reserving only accounted assets or credited NFT inventory. Its real two-day notice has matured and bounded execution window has not expired. Any caller may execute those fixed terms; no recipient substitution is possible.";
  state="The lock is active before any transfer. The exact notice is marked executed and its reservation released before the external call; native/ERC20 held accounting or purchased NFT inventory is decremented. Exact vault debit and recipient credit are required, plus ownerOf for ERC721, followed by dependency binding. Callback failure, immediate forwarding, wrong final ownership or unsupported token behavior reverts notice/reservation/accounting and all transfers.";
  tests=[test("SeaportAcquisition","testReservedFundsCannotBeSpentAndNoticeCannotExecuteEarly"),test("SeaportAcquisition","testPurchased721And1155OnlyLeaveAfterBoundedNotice"),test("SeaportAcquisition","testControllerRotationDisablesPolicyAndInvalidatesOldNotices"),test("SeaportAcquisitionHostile","testNativeWithdrawalCallbackCannotConsumeSecondMatureNotice"),test("SeaportAcquisitionHostile","testNoticed721And1155ForwardingRollbackCustodyAndReservations"),test("SeaportAcquisitionHostile","testTokenWithdrawalRejectsFalseReturnFeeAndOverpullWithoutLosingNotice")];
 }
 const mapping=functionElement.source_mapping;
 return {id:finding.id,detector:finding.check,impact:finding.impact,confidence:finding.confidence,
  source:{path:"packages/contracts/"+mapping.filename_short,start:mapping.start,length:mapping.length,firstLine:Math.min(...mapping.lines),lastLine:Math.max(...mapping.lines)},
  function:name,rawDescription:description,externalCall:call,observedBalance:balance,postconditions:section(description,"Possible stale balance used after the call in a condition:","\u0000"),assetOrAuthorityAtRisk:asset,preconditions,
  potentialPath:"Admitted payment/NFT/payee external call -> callback attempts another purchase, mature withdrawal, funding, policy or controller mutation; or supplies dishonest final balance/owner/status evidence. A loss would require defeating the lock/exact settlement checks or an unresolved source/implementation/authority assumption.",
  guard:mutableGuard,stateBeforeExternalEffectAndAtomicPostconditions:state,applicableRegressionTests:tests,testsExecutedLocally:false,
  localEvidence:"Pinned solc ABI/AST/bytecode compilation is recorded separately as PASS_NOT_EXECUTED. Actual Foundry/Anvil/CI execution must be corroborated separately.",
  disposition:"HIGH_RETAINED_UNCLEARED_INTERNAL_PATH_ASSESSMENT",severityOverridden:false,independentAudit:false,confirmedReachableLossDemonstrated:false,
  mitigation:"Retain guard, exact source/asset/authority pins, finite approval, before/after balance/ownership assertions and bounded standing/notice authority. Exercise hostile callbacks and atomic rollback. No balance check or detector is suppressed.",remainingUncertainty:uncertainty};
}

export function buildRegister(){
 const inputBytes=gunzipSync(read("compiler-input.json.gz")),manifest=json(read("compiler-manifest.json"));
 const input=json(inputBytes),report=json(gunzipSync(read("windows-slither.json.gz"))),preliminary=json(gunzipSync(read("preliminary-slither.json.gz")));
 assert.equal(sha(inputBytes),manifest.inputSha256);assert.equal(report.inputSha256,manifest.inputSha256);assert.equal(report.detectorCount,101);assert.equal(report.sources,4);
 assert.equal(manifest.roots.length,3);assert.equal(Object.keys(input.sources).length,4);
 for(const[file,pin]of manifest.sourceSha256){assert.equal(sha(input.sources[file].content),pin);assert.equal(sha(readFileSync(resolve(repository,"packages/contracts",file),"utf8").replaceAll("\r\n","\n")),pin);}
 const highs=report.detectors.filter(x=>x.impact==="High"),oldHighs=preliminary.detectors.filter(x=>x.impact==="High");assert.equal(highs.length,23);assert.equal(oldHighs.length,23);
 const preliminaryMapping=highs.map(current=>{const matches=oldHighs.filter(old=>normalizeDescription(old.description)===normalizeDescription(current.description));assert.equal(matches.length,1);return{preliminaryId:matches[0].id,finalId:current.id,identicalId:matches[0].id===current.id,basis:matches[0].id===current.id?"EXACT_ID_AND_DESCRIPTION":"Same exact function/source/call/balance and postconditions; only Slither TMP/REF variable suffixes change after creator-only constructor AST insertion. Not eliminated or cleared."};});
 const prior=json(readFileSync(resolve(repository,"docs/evidence/rmt-task082/security/findings.json")));
 assert.equal(prior.currentHighs,22);assert.equal(prior.originalRows,23);
 const rows=highs.map(assessment);
 for(const row of rows)for(const t of row.applicableRegressionTests)assert.ok(readFileSync(resolve(repository,t.source),"utf8").includes("function "+t.name+"("),"Missing named regression "+t.name);
 const ci=existsSync(resolve(directory,"ci-execution.json"))?json(read("ci-execution.json")):null;
 if(ci){const linux=json(gunzipSync(read("linux-slither.json.gz")));assert.equal(linux.inputSha256,manifest.inputSha256);assert.equal(linux.detectorCount,101);assert.equal(linux.sources,4);assert.deepEqual(linux.detectors.filter(x=>x.impact==="High").map(x=>x.id).sort(),highs.map(x=>x.id).sort());assert.equal(ci.tests.passed,48);assert.equal(ci.tests.failed,0);assert.equal(ci.tests.skipped,0);}
 const register={schemaVersion:1,status:"BLOCKED_NO_BROADCAST",sourceCommit:"f66154eff50a0c7956452a22a8b3d4dc27c6f16d",productionInputSha256:manifest.inputSha256,analysisInputSha256:report.analysisInputSha256,
  tool:report.tool,cryticCompile:report.cryticCompile,detectorCount:101,detectorFilters:[],sourceFilters:[],severityOverrides:[],strictExit:1,
  counts:report.detectors.reduce((r,x)=>(r[x.impact]=(r[x.impact]??0)+1,r),{}),highRows:rows.length,independentAudit:false,actualCiExecution:ci,
  preliminary:{inputSha256:preliminary.inputSha256,highs:23,exactIdsUnchanged:preliminaryMapping.filter(x=>x.identicalId).length,relocatedTemporaryIds:preliminaryMapping.filter(x=>!x.identicalId).length,removed:0,cleared:0,mapping:preliminaryMapping},
  distinctHistoricalScope:{task082InputSha256:prior.afterInputSha256,task082CurrentHighs:22,task081OriginalRows:23,retainedOriginalIds:prior.rows.map(x=>x.originalId),task082CurrentIds:prior.rows.filter(x=>x.currentObservation).map(x=>x.currentObservation.id),
   relation:"V2 is a separate source/ABI/custody implementation. Its 23 Highs are not an in-place rescan or remediation of V1's 22 remaining Highs. No old ID or gate is removed, reclassified or cleared. Broad balance/route categories are analogous; independent exact source registers remain authoritative.",otherUnchangedHighScopes:{core:22,treasuryV1:6,activeReclaimV2:7,rejectedHistoricalReclaimV1:4}},rows};
 writeFileSync(resolve(directory,"findings.json"),JSON.stringify(register,null,2)+"\n");
 const table=["# Task 083 exact High register","","**All 23 High observations remain uncleared. Strict scanner exit 1.** Internal path assessment; no independent audit or release clearance. Exact descriptions, source/AST offsets, calls, balance baselines, preconditions, guard/CEI, regression names and uncertainty are retained per row in [findings.json](findings.json).","","| Exact ID | Detector / function | Observed baseline | Disposition |","| --- | --- | --- | --- |",...rows.map(r=>`| \`${r.id}\` | ${r.detector} / ${r.function} | ${(r.observedBalance??"Fixed typed Seaport native-value call").split("\n")[0].replaceAll("|","/")} | High retained, uncleared |`),"","The final Windows run covers all three new production roots and unchanged Accounts import: 101 detectors, 48 observations, 23 High, six Medium, 13 Low and six Informational. The constructor-only source revision changes twelve purchase temporary-variable IDs; all are mapped to the preliminary scan, with zero removals or clearances. Task 082's separate 22 remaining Highs and original 23 IDs are preserved without reclassification.",""];
 writeFileSync(resolve(directory,"FINDINGS.md"),table.join("\n"));return register;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const{values}=parseArgs({options:{input:{type:"string"},manifest:{type:"string"},slither:{type:"string"},preliminary:{type:"string"}}});
 if(values.input){for(const key of["input","manifest","slither","preliminary"])assert.ok(values[key]);for(const[key,destination]of[["input","compiler-input.json.gz"],["slither","windows-slither.json.gz"],["preliminary","preliminary-slither.json.gz"]])writeFileSync(resolve(directory,destination),gzipSync(readFileSync(resolve(values[key])),{level:9}));writeFileSync(resolve(directory,"compiler-manifest.json"),readFileSync(resolve(values.manifest)));}
 const r=buildRegister();console.log(JSON.stringify({status:r.status,highRows:r.highRows,counts:r.counts,detectorCount:r.detectorCount,productionInputSha256:r.productionInputSha256}));
}
