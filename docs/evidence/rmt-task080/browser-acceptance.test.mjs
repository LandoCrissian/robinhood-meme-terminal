import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {gunzipSync} from "node:zlib";
import {test} from "node:test";
import {reclaimCampaignSignatures} from "../../../packages/launchpad-common/reclaim-v2-runtime.mjs";

const require=createRequire(new URL("../../../apps/indexer/package.json",import.meta.url));
const {decodeFunctionData,erc20Abi,hashTypedData,parseAbi,parseEventLogs,recoverTypedDataAddress,zeroAddress}=require("viem");
const manifest=JSON.parse(readFileSync(new URL("browser-acceptance-manifest.json",import.meta.url)));
const campaignAbi=parseAbi(reclaimCampaignSignatures),safeAbi=parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)","event ExecutionFailure(bytes32 indexed txHash,uint256 payment)"]);
const safeTypes={SafeTx:[{name:"to",type:"address"},{name:"value",type:"uint256"},{name:"data",type:"bytes"},{name:"operation",type:"uint8"},{name:"safeTxGas",type:"uint256"},{name:"baseGas",type:"uint256"},{name:"gasPrice",type:"uint256"},{name:"gasToken",type:"address"},{name:"refundReceiver",type:"address"},{name:"nonce",type:"uint256"}]};
const sha=bytes=>createHash("sha256").update(bytes).digest("hex"),same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const norm=value=>typeof value==="bigint"?value.toString():typeof value==="string"&&/^0x[0-9a-f]+$/i.test(value)?value.toLowerCase():Array.isArray(value)?value.map(norm):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,norm(v)])):value;
const inner=send=>send.review.proposal?.innerReview??send.review;
const logs=(receipt,address,abi,eventName)=>parseEventLogs({abi,...(eventName&&{eventName}),strict:true,logs:receipt.logs.filter(log=>same(log.address,address))});
function bytes(path){assert.match(path,/^docs\/evidence\/rmt-task080\/browser\/(?:chromium|webkit)\/[a-z0-9-]+\.(?:json(?:\.gz)?|png)$/);return readFileSync(new URL("../../../"+path,import.meta.url));}
function load(engine,name){return JSON.parse(gunzipSync(bytes(`docs/evidence/rmt-task080/browser/${engine}/${name}.json.gz`),{maxOutputLength:4*1024*1024}));}
function data(engine){return{a:load(engine,"reclaim-acceptance"),b:load(engine,"reclaim-browser-evidence"),m:load(engine,"reclaim-deployment"),setup:load(engine,"reclaim-setup"),policy:load(engine,"reclaim-administration-policy"),compiler:load(engine,"reclaim-compiler-manifest"),budget:load(engine,"budget-browser--reclaim-browser-evidence")};}

test("archived browser evidence binds the actual current implementation without granting production or physical-wallet approval",()=>{
  assert.equal(manifest.productionAuthorization,false);assert.equal(manifest.physicalIPhoneAcceptance,false);assert.equal(manifest.verifiedSourceFiles.length,20);assert.equal(new Set(manifest.verifiedSourceFiles.map(row=>row.path)).size,20);
  for(const row of manifest.verifiedSourceFiles){assert.equal(row.normalization,"canonical-lf");assert.ok(!row.path.includes("..")&&!row.path.includes("\\")&&!row.path.startsWith("/"));const actual=Buffer.from(readFileSync(new URL("../../../"+row.path,import.meta.url),"utf8").replaceAll("\r\n","\n"));assert.equal(actual.length,row.bytes);assert.equal(sha(actual),row.sha256);}
  assert.equal(manifest.ciChecks.filter(row=>row.state==="FAILURE").length,5,"Retain five strict analysis failures independently of passing browser checks");
});

for(const engine of["chromium","webkit"]){
  test(`${engine}: actual artifact bytes bind current source, unchanged compiler and local-only trial`,()=>{
    assert.equal(manifest.schemaVersion,1);assert.equal(manifest.status,"BLOCKED_NO_BROADCAST");assert.equal(manifest.sourceCommit,"c1ae53179c7e8ad91c637af0471a20a2f2c67b3c");
    const evidence=manifest.browsers[engine];assert.match(String(evidence.artifactId),/^[0-9]+$/);assert.match(evidence.checkoutCommit,/^[a-f0-9]{40}$/);
    assert.equal(evidence.files.length,23);assert.equal(new Set(evidence.files.map(file=>file.path)).size,23);
    assert.equal(evidence.files.filter(file=>file.path.endsWith(".png")).length,13);assert.equal(evidence.files.filter(file=>file.uncompressedSha256).length,8);
    for(const file of evidence.files){assert.ok(file.path.startsWith(`docs/evidence/rmt-task080/browser/${engine}/`));const raw=bytes(file.path);assert.equal(raw.length,file.bytes);assert.equal(sha(raw),file.sha256);
      if(file.uncompressedSha256){const unpacked=gunzipSync(raw,{maxOutputLength:4*1024*1024});assert.equal(unpacked.length,file.uncompressedBytes);assert.equal(sha(unpacked),file.uncompressedSha256);}
      else if(file.path.endsWith(".png")){assert.equal(raw.subarray(0,8).toString("hex"),"89504e470d0a1a0a");assert.equal(raw.subarray(12,16).toString("ascii"),"IHDR");assert.ok(raw.readUInt32BE(16)>0&&raw.readUInt32BE(20)>0);}}
    const classification=JSON.parse(bytes(`docs/evidence/rmt-task080/browser/${engine}/public-data-classification.json`)),scan=gunzipSync(bytes(`docs/evidence/rmt-task080/browser/${engine}/raw-gitleaks-report.json.gz`));
    assert.equal(sha(scan),classification.scan.sha256);assert.equal(JSON.parse(scan).length,240);assert.equal(classification.scan.findingCount,240);assert.equal(classification.scan.scannerSuppressed,false);assert.equal(classification.scan.scannerConfigurationModified,false);
    const{a,b,m,setup,compiler,budget}=data(engine);assert.equal(a.status,"passed");assert.equal(b.status,"passed");assert.equal(a.sourceIdentity.commit,evidence.checkoutCommit);assert.equal(a.sourceIdentity.browser,engine);
    assert.equal(a.chainId,31337);assert.equal(b.chainId,31337);assert.equal(m.chainId,31337);assert.equal(setup.production,false);assert.equal(a.scope,"LOCAL_SYNTHETIC_31337_NOT_PRODUCTION_OR_PHYSICAL_PHONE");
    assert.match(a.postgresql.serverVersion,/^18\.6\b/);assert.equal(a.postgresql.encoding,"UTF8");assert.equal(a.postgresql.isolatedTestDatabase,true);
    assert.equal(compiler.inputSha256,"fece6e205ff52f8369c732cbddaa663a0d19530062b7539dc4b4467099a08cdc");assert.equal(m.compilerInputSha256,compiler.inputSha256);assert.deepEqual(a.compiler,compiler);assert.deepEqual(compiler.transformations,[]);assert.equal(compiler.broadcastAuthorized,false);assert.equal(compiler.coreModified,false);
    assert.equal(a.economics.approvedLiveCollections,0);assert.equal(a.economics.liveUsdReference,false);assert.equal(a.economics.syntheticProfileOnly,true);
    for(const browser of[b,budget]){assert.deepEqual(browser.pageErrors,[]);assert.deepEqual(browser.externalRequests,[]);assert.deepEqual(browser.forbiddenRequests,[]);for(const send of browser.sends){assert.equal(inner(send).executionEnabled,false);assert.equal(inner(send).scope,"isolated-local");assert.equal(send.request.type,"0x2");assert.equal(send.request.chainId,"0x7a69");assert.ok(!("authorizationList"in send.request));}}
  });

  test(`${engine}: explicit controller policy matches canonical two-day handoff and current Safe authority`,()=>{
    const{a,b,m,setup,policy}=data(engine),events=a.database.events.map(row=>row.payload),admin=a.administration;
    assert.equal(policy.profile,"rmt-reclaim-administration-policy-v1");assert.equal(policy.scope,"isolated-local");assert.equal(policy.chainId,31337);assert.ok(same(policy.reclaimFactory,m.reclaimFactory));assert.ok(same(policy.factoryRuntimeHash,m.factoryRuntimeHash));assert.equal(policy.authorizedControllers.length,2);
    const proposal=b.sends.find(send=>inner(send).operation==="propose-controller"),accept=b.sends.find(send=>inner(send).operation==="accept-controller");assert.ok(proposal&&accept);
    const scheduled=logs(proposal.receipt,a.campaign,campaignAbi,"ControllerScheduled"),changed=logs(accept.receipt,a.campaign,campaignAbi,"ControllerChanged");assert.equal(scheduled.length,1);assert.equal(changed.length,1);
    const notice=scheduled[0].args,transition=changed[0].args;assert.ok(same(notice.previous,inner(proposal).actor));assert.ok(same(notice.next,setup.safe.address));assert.ok(same(transition.previous,notice.previous)&&same(transition.next,notice.next));assert.equal(BigInt(transition.controllerEpoch),BigInt(inner(proposal).controllerEpoch)+1n);
    assert.ok(BigInt(accept.receipt.logs[0].blockTimestamp)>=BigInt(notice.validAfter));assert.ok(BigInt(accept.receipt.logs[0].blockTimestamp)<=BigInt(notice.expiresAt));assert.ok(BigInt(notice.validAfter)>=BigInt(proposal.receipt.logs[0].blockTimestamp)+2n*86400n);
    for(const send of[proposal,accept])assert.equal(events.filter(event=>same(event.transactionHash,send.receipt.transactionHash)&&["ControllerScheduled","ControllerChanged"].includes(event.eventName)).length,1);
    for(const address of[inner(proposal).actor,setup.safe.address])assert.ok(policy.authorizedControllers.some(entry=>same(entry.address,address)));
    assert.equal(policy.authorizedControllers.some(entry=>same(entry.address,admin.unrelatedWallet)),false);assert.equal(admin.productionControllerAssigned,false);assert.equal(admin.permissionlessContractSimulation,"0x");
    for(const flag of["dashboardPreparationDenied","unrelatedAdminControlsAbsent","participantPreparationWithoutPolicy","malformedPolicyBlocksRevalidation","canonicalRecoveryWithoutPolicy","noWalletSubmission","runtimeMismatchBlocksAdmin","restoredRuntimeRequiresFreshOnchainSnapshot","incomingControllerBlockedBeforeNotice","formerControllerBlockedAfterHandoff","safeOwnerDistinctFromGasPayer"])assert.equal(admin[flag],true,flag);
    assert.equal(b.sends.some(send=>same(inner(send).actor,admin.unrelatedWallet)),false,"Denied outsider preparation did not become a signed transaction");
    const accepted=b.safeRecoveries.find(row=>row.result.operation==="accept-controller"&&row.result.status==="confirmed").result.snapshot;
    assert.ok(same(accepted.controller,setup.safe.address));assert.equal(accepted.administration.status,"verified");assert.equal(accepted.administration.controller.kind,"safe-1.4.1");assert.deepEqual(accepted.administration.controller.owners,setup.safe.owners);
    for(const name of["reclaim-unauthorized-administration.png","reclaim-admin-policy-unassigned.png"])assert.ok(b.screenshots.includes(name));
  });

  test(`${engine}: actual retirement logs and exact reward transfers survive canonical SQL, restart and reorg`,()=>{
    const{a,b,m,budget}=data(engine),all=[...b.sends,...budget.sends],events=a.database.events.map(row=>row.payload),canonical=events.filter(row=>row.eventName==="TradeInAccepted");
    assert.equal(a.database.campaigns.length,2);assert.equal(events.length,45);assert.equal(new Set(events.map(row=>`${row.transactionHash.toLowerCase()}:${row.logIndex}`)).size,45);assert.equal(canonical.length,8);assert.equal(a.retirements.length,9);
    assert.equal(a.restart.before,22);assert.equal(a.restart.after,22);assert.equal(a.restart.unchanged,true);assert.equal(events.some(row=>same(row.transactionHash,a.reorg.orphanHash)),false);
    const observed=all.filter(send=>inner(send).operation==="redeem");assert.equal(observed.length,9);const modes=new Set();let totalUnits=0n,totalRewards=0n;
    for(const send of observed){const r=inner(send),decoded=decodeFunctionData({abi:campaignAbi,data:r.innerCall.data}),accepted=logs(send.receipt,r.campaign,campaignAbi,"TradeInAccepted"),retired=logs(send.receipt,r.campaign,campaignAbi,"NFTPermanentlyRetired");assert.equal(decoded.functionName,"redeem");assert.equal(accepted.length,1);assert.equal(retired.length,1);
      const claim=accepted[0].args,proof=retired[0].args;assert.ok(same(claim.claimant,r.actor)&&same(claim.collection,decoded.args[0]));assert.deepEqual(claim.ids,decoded.args[1]);assert.deepEqual(claim.quantities,decoded.args[2]);assert.equal(claim.reward,BigInt(r.rewardWei));assert.equal(claim.retirementMode,r.nft.retirementMode);assert.ok(same(claim.destination,r.nft.destination));assert.equal(proof.receiptId,claim.receiptId);assert.deepEqual(proof.ids,claim.ids);assert.deepEqual(proof.quantities,claim.quantities);assert.equal(proof.retirementMode,claim.retirementMode);
      const payouts=logs(send.receipt,m.rewardToken,erc20Abi,"Transfer");assert.equal(payouts.length,1);assert.ok(same(payouts[0].args.from,r.campaign)&&same(payouts[0].args.to,r.actor));assert.equal(payouts[0].args.value,claim.reward);
      const sql=canonical.filter(row=>same(row.transactionHash,send.receipt.transactionHash));if(same(send.receipt.transactionHash,a.reorg.orphanHash)){assert.equal(sql.length,0);continue;}assert.equal(sql.length,1);assert.deepEqual(norm(sql[0].args),norm(claim));assert.equal(sql[0].blockHash,send.receipt.blockHash);assert.equal(sql[0].blockNumber,send.receipt.blockNumber);
      const settlement=sql[0].settlement;assert.equal(settlement.kind,"permanent-surrender");assert.deepEqual(settlement.supplyBefore,proof.supplyBefore.map(String));assert.deepEqual(settlement.supplyAfter,proof.supplyAfter.map(String));assert.equal(settlement.amount,claim.reward.toString());assert.ok(same(settlement.rewardToken,m.rewardToken));assert.ok(same(settlement.policyHash,r.nft.policyHash));assert.equal(settlement.evidence,"exact-receipt-transfer-and-single-transaction-block-deltas");
      for(let i=0;i<claim.ids.length;i++)assert.equal(proof.supplyBefore[i]-proof.supplyAfter[i],claim.retirementMode===1?claim.quantities[i]:0n);
      assert.ok(same(claim.destination,claim.retirementMode===1?zeroAddress:m.permanentSink));modes.add(`${claim.standard}/${claim.retirementMode}`);totalUnits+=claim.quantities.reduce((sum,n)=>sum+n,0n);totalRewards+=claim.reward;
    }
    assert.deepEqual(modes,new Set(["1/1","2/1","1/2","2/2"]));assert.equal(totalUnits,16n);assert.equal(totalRewards,86n*10n**18n);assert.equal(a.reorg.recoveryStatus,"unavailable");assert.equal(a.reorg.noAutomaticRetry,true);assert.ok(events.every(row=>!["TradeInReturned","TradeInRepaid"].includes(row.eventName)));
    for(const recovery of a.manualHashRecovery){assert.notEqual(recovery.candidateHash,recovery.actualTransactionHash);assert.equal(recovery.unboundJournal.transactionHash,null);assert.equal(recovery.unboundJournal.result.transactionHash,undefined);assert.equal(recovery.resolvedJournalHash,recovery.actualTransactionHash);assert.equal(all.filter(send=>same(send.receipt.transactionHash,recovery.actualTransactionHash)&&send.review.reviewHash===recovery.originalReviewHash).length,1);}
  });

  test(`${engine}: all11 actual Safe executions cryptographically bind two owners, separate payer and exact inner calls`,async()=>{
    const{a,b,setup}=data(engine),sends=b.sends.filter(send=>send.review.proposal),canonical=a.safeExecutions.filter(row=>!same(row.receipt.transactionHash,a.reorg.orphanHash));assert.equal(sends.length,11);assert.equal(canonical.length,10);assert.deepEqual(a.safeExecutions.map(row=>row.safeNonce),Array.from({length:11},(_,i)=>String(i)));
    for(const send of sends){const outer=send.review,p=outer.proposal,r=p.innerReview;assert.deepEqual(send.request,outer.request);assert.equal(p.threshold,2);assert.deepEqual(p.owners,setup.safe.owners);assert.equal(p.owners.some(owner=>same(owner,p.gasPayer)),false);assert.ok(same(p.safe,setup.safe.address));assert.ok(same(send.request.from,p.gasPayer)&&same(send.request.to,p.safe));assert.equal(BigInt(send.request.nonce),BigInt(p.gasPayerNonce));
      const typed={domain:{chainId:31337,verifyingContract:p.safe},types:safeTypes,primaryType:"SafeTx",message:Object.fromEntries(Object.entries(p.safeTx).map(([key,value])=>[key,["value","safeTxGas","baseGas","gasPrice","nonce"].includes(key)?BigInt(value):value]))};assert.equal(hashTypedData(typed),p.digest);assert.equal(outer.approvals.length,2);
      for(let i=0;i<2;i++){const approval=outer.approvals[i],who=await recoverTypedDataAddress({...typed,signature:approval.signature});assert.ok(same(who,approval.signer));assert.ok(p.owners.some(owner=>same(owner,who)));if(i)assert.ok(BigInt(who)>BigInt(outer.approvals[i-1].signer));}
      const decoded=decodeFunctionData({abi:safeAbi,data:send.request.data});assert.equal(decoded.functionName,"execTransaction");assert.deepEqual(norm(decoded.args.slice(0,9)),norm([p.safeTx.to,p.safeTx.value,p.safeTx.data,p.safeTx.operation,p.safeTx.safeTxGas,p.safeTx.baseGas,p.safeTx.gasPrice,p.safeTx.gasToken,p.safeTx.refundReceiver]));assert.equal(decoded.args[9],"0x"+outer.approvals.map(x=>x.signature.slice(2)).join(""));assert.ok(same(p.safeTx.data,r.innerCall.data)&&same(p.safeTx.to,r.innerCall.to));
      const result=logs(send.receipt,p.safe,safeAbi);assert.equal(result.length,1);assert.equal(result[0].eventName,"ExecutionSuccess");assert.equal(result[0].args.txHash,p.digest);assert.equal(result[0].args.payment,0n);assert.equal(send.receipt.status,"success");
      const record=a.safeExecutions.find(row=>same(row.receipt.transactionHash,send.receipt.transactionHash));assert.ok(record);assert.equal(record.digest,p.digest);assert.equal(record.safeNonce,p.safeNonce);assert.equal(record.operation,r.operation);
      // The execution summary preserves wallet approval order. The encoded
      // signature bytes above must independently retain Safe's sorted order.
      assert.deepEqual(record.owners.map(owner=>owner.toLowerCase()).sort(),outer.approvals.map(x=>x.signer.toLowerCase()).sort());
      for(const event of a.database.events.filter(row=>same(row.payload.transactionHash,send.receipt.transactionHash)&&row.payload.settlement)){const origin=event.payload.settlement.origin;assert.equal(origin.profile,"safe-1.4.1");assert.ok(same(origin.actor,p.safe)&&same(origin.gasPayer,p.gasPayer));assert.equal(origin.safeTransactionHash,p.digest);assert.equal(origin.safeNonce,p.safeNonce);}
    }
  });
}
