import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {gunzipSync} from "node:zlib";
import {test} from "node:test";
import {materializeReclaimRuntime,reclaimFactorySignatures,reclaimCampaignSignatures} from "../../../packages/launchpad-common/reclaim-v2-runtime.mjs";

const require=createRequire(new URL("../../../apps/indexer/package.json",import.meta.url));
const {concatHex,decodeFunctionData,encodeAbiParameters,erc20Abi,getCreate2Address,hashTypedData,keccak256,parseAbi,parseEventLogs,recoverTypedDataAddress,stringToHex,zeroAddress}=require("viem");
const {devices}=require("playwright");
const factoryAbi=parseAbi(reclaimFactorySignatures),campaignAbi=parseAbi(reclaimCampaignSignatures);
const nftAbi=parseAbi(["event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)","event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)","event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)"]);
const safeAbi=parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)","event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)","event ExecutionFailure(bytes32 indexed txHash,uint256 payment)"]);
const safeTypes={SafeTx:[{name:"to",type:"address"},{name:"value",type:"uint256"},{name:"data",type:"bytes"},{name:"operation",type:"uint8"},{name:"safeTxGas",type:"uint256"},{name:"baseGas",type:"uint256"},{name:"gasPrice",type:"uint256"},{name:"gasToken",type:"address"},{name:"refundReceiver",type:"address"},{name:"nonce",type:"uint256"}]};
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const norm=value=>typeof value==="bigint"?value.toString():typeof value==="string"&&/^0x[0-9a-f]+$/i.test(value)?value.toLowerCase():Array.isArray(value)?value.map(norm):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,norm(v)])):value;
const digest=value=>keccak256(stringToHex(JSON.stringify((function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)])):v;})(value))));
function boundDigest(value,key){const{[key]:expected,...body}=value;assert.equal(digest(body),expected,key+" exact canonical digest");}
const inner=send=>send.review.proposal?.innerReview??send.review;
const key=receipt=>receipt.transactionHash.toLowerCase();
const readArchive=path=>{const bytes=readFileSync(new URL(path,import.meta.url));assert.ok(bytes.length<=512*1024,"Bound compressed evidence input");return JSON.parse(gunzipSync(bytes,{maxOutputLength:4*1024*1024}).toString("utf8"));};
const read=(engine,name)=>readArchive(`browser/${engine}/${name}.json.gz`);
function loaded(engine){return{a:read(engine,"reclaim-acceptance"),b:read(engine,"reclaim-browser-evidence"),budget:read(engine,"budget-browser--reclaim-browser-evidence"),m:read(engine,"reclaim-deployment"),setup:read(engine,"reclaim-setup")};}
function publicData(value){
  if(Array.isArray(value)){for(const item of value)publicData(item);return;}
  if(value&&typeof value==="object")for(const[k,v]of Object.entries(value)){
    assert.doesNotMatch(k,/^(?:privateKey|secretKey|mnemonic|seedPhrase|password|passphrase|apiKey|rpcKey|bearerToken|accessToken|refreshToken|DATABASE_URL|PGPASSWORD|readKey|indexReadKey)$/i,"No private key or infrastructure credential field belongs in evidence");publicData(v);
  }
  else if(typeof value==="string"&&/^[a-z][a-z0-9+.-]*:\/\//i.test(value)){
    const url=new URL(value);assert.equal(url.username,"");assert.equal(url.password,"");for(const name of url.searchParams.keys())assert.doesNotMatch(name,/key|token|secret|password|auth/i);
  }
}
function receiptLogs(receipt,address,abi,eventName){return parseEventLogs({abi,...(eventName&&{eventName}),logs:receipt.logs.filter(log=>same(log.address,address)),strict:true});}
function pngDimensions(engine,file){
  assert.match(file,/^[a-z0-9-]+\.png$/,"Only a named archived local screenshot is permitted");
  const image=readFileSync(new URL(`browser/${engine}/${file}`,import.meta.url));assert.ok(image.length>32);
  assert.equal(image.subarray(0,8).toString("hex"),"89504e470d0a1a0a");assert.equal(image.readUInt32BE(8),13);assert.equal(image.subarray(12,16).toString("ascii"),"IHDR");
  assert.equal(image.subarray(-12).toString("hex"),"0000000049454e44ae426082");
  return{width:image.readUInt32BE(16),height:image.readUInt32BE(20)};
}
function verifiedReviewImages({a,b},engine){
  // Direct reviews precede layouts() and use the pinned device viewport.
  // Safe reviews follow layouts(), which explicitly restores390×844.
  const device=devices["iPhone 13"];assert.deepEqual(device.viewport,{width:390,height:664});assert.equal(device.deviceScaleFactor,3);
  assert.equal(b.reviewScreenshots.length,4,"Direct/Safe × native burn/permanent sink reviews required");
  const kinds=new Set(),images=new Set();
  for(const capture of b.reviewScreenshots){
    const send=b.sends.find(send=>send.review.reviewHash===capture.reviewHash);assert.ok(send,"Screenshot must identify the exact actually signed test review");
    const r=inner(send),kind=send.review.proposal?"safe-outer":"direct";assert.equal(r.operation,"redeem");assert.notEqual(key(send.receipt),a.reorg.orphanHash.toLowerCase());
    assert.equal(capture.retirementMode,r.nft.retirementMode);assert.ok(same(capture.destination,r.nft.destination));
    assert.equal(capture.maximumSyntheticNetworkFeeWei,send.review.maximumNetworkFeeWei);assert.equal(BigInt(capture.maximumSyntheticNetworkFeeWei),BigInt(send.request.gas)*BigInt(send.request.maxFeePerGas));
    assert.ok(BigInt(capture.maximumSyntheticNetworkFeeWei)>0n);assert.equal(capture.beforeWalletConfirmation,true);assert.equal(capture.walletActionsDuringCapture,0);assert.equal(capture.irreversibleTermsVisible,true);
    assert.equal(capture.captureKind,"document-scroll-viewport-not-element-crop");assert.equal(capture.region,kind==="direct"?"Reviewed Reclaim transaction":"Reviewed Safe outer transaction");
    const mode=r.nft.retirementMode===1?"native-burn":"permanent-sink",prefix=`reclaim-${kind}-review-${mode}`;
    assert.deepEqual(capture.screenshots,[`${prefix}-top-viewport.png`,`${prefix}-cost-viewport.png`]);
    kinds.add(`${kind}/${r.nft.retirementMode}`);
    const viewport=kind==="direct"?device.viewport:{width:390,height:844};
    for(const file of capture.screenshots){assert.ok(!images.has(file));images.add(file);assert.ok(b.screenshots.includes(file));assert.deepEqual(pngDimensions(engine,file),{width:viewport.width*device.deviceScaleFactor,height:viewport.height*device.deviceScaleFactor},"Actual source-stage DPR3 viewport, not an element crop");}
  }
  assert.deepEqual(kinds,new Set(["direct/1","direct/2","safe-outer/1","safe-outer/2"]));assert.equal(images.size,8);
  for(const[file,width,height]of[["reclaim-permanent-active-portrait.png",1170,2532],["reclaim-permanent-active-landscape.png",2532,1170],["reclaim-standard-desktop.png",1440,900]]){
    assert.ok(b.screenshots.includes(file)||file==="reclaim-standard-desktop.png");assert.deepEqual(pngDimensions(engine,file),{width,height});
  }
  // These checks establish file format, viewport dimensions and review/receipt
  // identity. They are deliberately not claimed as semantic image inspection.
}

function retiredSend(send,m){
  const r=inner(send),receipt=send.receipt;assert.equal(r.operation,"redeem");assert.equal(r.fields.permanentConsent,true);
  const decoded=decodeFunctionData({abi:campaignAbi,data:r.innerCall.data});assert.equal(decoded.functionName,"redeem");
  const [collection,ids,quantities,maximums,proofs,epoch,reward,nonce,deadline]=decoded.args;
  assert.ok(same(collection,r.fields.collection));assert.deepEqual(ids.map(String),r.fields.tokenIds);assert.deepEqual(quantities.map(String),r.fields.quantities);
  assert.equal(maximums.length,ids.length);assert.equal(proofs.length,ids.length);assert.equal(epoch,BigInt(r.policyEpoch));assert.equal(reward,BigInt(r.rewardWei));assert.equal(BigInt(deadline),BigInt(r.expiresAt));
  assert.equal(r.nft.retirementMode,m.collections.find(c=>same(c.address,collection)).retirementMode);
  const accepted=receiptLogs(receipt,r.campaign,campaignAbi,"TradeInAccepted"),retired=receiptLogs(receipt,r.campaign,campaignAbi,"NFTPermanentlyRetired");
  assert.equal(accepted.length,1);assert.equal(retired.length,1);const event=accepted[0].args,proof=retired[0].args;
  assert.ok(same(event.claimant,r.actor)&&same(event.collection,collection));assert.deepEqual(event.ids,ids);assert.deepEqual(event.quantities,quantities);
  assert.equal(event.reward,reward);assert.equal(event.policyEpoch,epoch);assert.equal(event.claimantNonce,nonce);
  assert.equal(event.retirementMode,r.nft.retirementMode);assert.ok(same(event.destination,r.nft.destination));
  assert.equal(proof.receiptId,event.receiptId);assert.ok(same(proof.collection,collection));assert.equal(proof.standard,event.standard);
  assert.equal(proof.retirementMode,event.retirementMode);assert.ok(same(proof.destination,event.destination));assert.deepEqual(proof.ids,ids);assert.deepEqual(proof.quantities,quantities);
  assert.equal(proof.supplyBefore.length,ids.length);assert.equal(proof.supplyAfter.length,ids.length);
  const expectedTo=event.retirementMode===1?zeroAddress:m.permanentSink;assert.ok(same(event.destination,expectedTo));
  const transfers=receiptLogs(receipt,collection,nftAbi),actual=[];
  for(const transfer of transfers){const x=transfer.args;
    assert.ok(same(x.from,r.actor)&&same(x.to,expectedTo));
    if(transfer.eventName==="Transfer")actual.push({id:x.tokenId,quantity:1n});
    else{assert.ok(same(x.operator,r.campaign));if(transfer.eventName==="TransferSingle")actual.push({id:x.id,quantity:x.value});
      else{assert.equal(transfer.eventName,"TransferBatch");assert.equal(x.ids.length,x.values.length);for(let i=0;i<x.ids.length;i++)actual.push({id:x.ids[i],quantity:x.values[i]});}}
  }
  assert.deepEqual(actual,ids.map((id,i)=>({id,quantity:quantities[i]})));
  for(let i=0;i<ids.length;i++){
    assert.equal(proof.supplyBefore[i]-proof.supplyAfter[i],event.retirementMode===1?quantities[i]:0n);
    if(event.standard===1){assert.equal(quantities[i],1n);if(i>0&&event.retirementMode===1)assert.equal(proof.supplyBefore[i],proof.supplyAfter[i-1]);}
  }
  const rewards=receiptLogs(receipt,m.rewardToken,erc20Abi,"Transfer");assert.equal(rewards.length,1);assert.ok(same(rewards[0].args.from,r.campaign)&&same(rewards[0].args.to,r.actor));assert.equal(rewards[0].args.value,reward);
  return{r,receipt,event,proof,units:quantities.reduce((sum,n)=>sum+n,0n),reward};
}

/** Cross-checks archived real synthetic receipts and SQL payloads. It does not
 * fetch chain state or manufacture historical balance/finality evidence. */
async function verifyCrossLayer({a,b,budget,m,setup},engine){
  assert.equal(a.status,"passed");assert.equal(b.status,"passed");assert.equal(budget.status,"passed");
  assert.equal(a.chainId,31337);assert.equal(m.chainId,31337);assert.equal(setup.chainId,31337);assert.equal(setup.production,false);
  assert.equal(a.sourceIdentity.browser,engine);assert.match(a.sourceIdentity.commit,/^[0-9a-f]{40}$/);
  assert.equal(a.profile,"rmt-reclaim-permanent-integrated-v2");assert.equal(m.profile,"rmt-reclaim-v2-permanent");assert.deepEqual(a.deployment,m);
  assert.equal(a.economics.liveUsdReference,false);assert.equal(a.economics.approvedLiveCollections,0);assert.equal(a.economics.syntheticProfileOnly,true);
  assert.equal(a.compiler.inputSha256,m.compilerInputSha256);assert.equal(setup.compiler.inputSha256,m.compilerInputSha256);assert.equal(a.compiler.broadcastAuthorized,false);
  assert.equal(a.sourceIdentity.coreCompiler.terms.fixedSupplyWei,(1_000_000_000n*10n**18n).toString());
  assert.equal(a.sourceIdentity.coreCompiler.terms.curveInventoryWei,(600_000_000n*10n**18n).toString());assert.equal(a.sourceIdentity.coreCompiler.terms.initialLiquidityInventoryWei,(400_000_000n*10n**18n).toString());
  assert.equal(a.sourceIdentity.coreCompiler.terms.projectBps,9000);assert.equal(a.sourceIdentity.coreCompiler.terms.operationsBps,500);assert.equal(a.sourceIdentity.coreCompiler.terms.reserveBps,500);
  assert.ok(same(setup.rewardToken,m.rewardToken));assert.equal(keccak256(m.campaignCreationCode),m.campaignCreationCodeHash);
  const bytes=m.campaignCreationCode.slice(2),half=Math.floor(bytes.length/4)*2;
  assert.equal(keccak256("0x00"+bytes.slice(0,half)),m.creationPart1RuntimeHash);assert.equal(keccak256("0x00"+bytes.slice(half)),m.creationPart2RuntimeHash);
  assert.deepEqual(new Set(m.collections.map(c=>`${c.standard}/${c.retirementMode}`)),new Set(["1/1","1/2","2/1","2/2"]));
  assert.equal(m.collections.length,4);for(const c of m.collections)assert.ok(m.retirementProfiles.some(p=>same(p.runtimeHash,c.runtimeHash)&&p.standard===c.standard&&p.mode===c.retirementMode&&same(p.policyHash,c.policyHash)));
  for(const object of [a,b,budget,m,setup])publicData(object);
  const sends=[...b.sends,...budget.sends],byHash=new Map(sends.map(send=>[key(send.receipt),send]));assert.equal(byHash.size,sends.length,"No duplicate observed broadcast");
  assert.equal(new Set(sends.map(send=>send.request.from.toLowerCase()+":"+BigInt(send.request.nonce))).size,sends.length,"No duplicate payer nonce across browser contexts");
  const allowed=new Set(["create-campaign","approve-funding","fund","propose-collection","execute-collection","approve-721","approve-1155","revoke-1155","redeem","pause","resume","propose-rate","execute-rate","propose-close","execute-close","propose-recovery","execute-recovery","propose-controller","accept-controller"]);
  for(const send of sends){const r=inner(send);assert.ok(allowed.has(r.operation));assert.equal(r.chainId,31337);assert.equal(r.executionEnabled,false);assert.equal(r.profile,m.profile);assert.equal(r.custody,"permanent-retirement");
    boundDigest(r,"reviewHash");assert.deepEqual(send.request,send.review.request);assert.equal(send.request.chainId,"0x7a69");assert.equal(send.request.value,"0x0");assert.equal(send.receipt.status,"success");
    assert.ok(BigInt(send.receipt.gasUsed)<=BigInt(send.request.gas));assert.equal(BigInt(send.request.gas)*BigInt(send.request.maxFeePerGas),BigInt(send.review.maximumNetworkFeeWei));
    for(const log of send.receipt.logs){assert.equal(log.blockNumber,send.receipt.blockNumber);assert.ok(same(log.transactionHash,send.receipt.transactionHash)&&same(log.blockHash,send.receipt.blockHash));assert.equal(log.removed,false);}
  }
  for(const cost of a.canonicalReceipts){const send=byHash.get(cost.transactionHash.toLowerCase());assert.ok(send);assert.equal(cost.productionCostQuote,false);assert.equal(cost.reviewHash,send.review.reviewHash);assert.equal(cost.operation,inner(send).operation);
    assert.ok(same(cost.blockHash,send.receipt.blockHash));assert.equal(cost.gasUsed,send.receipt.gasUsed);const actual=BigInt(cost.gasUsed)*BigInt(cost.effectiveGasPrice);assert.equal(actual,BigInt(cost.syntheticCostWei));assert.ok(actual<=BigInt(send.review.maximumNetworkFeeWei));}
  const births=a.database.campaigns.map(row=>row.payload);assert.equal(births.length,2);
  for(const birth of births){const send=byHash.get(birth.deployment.transactionHash.toLowerCase());assert.ok(send);const r=inner(send);assert.equal(r.operation,"create-campaign");
    const event=receiptLogs(send.receipt,m.reclaimFactory,factoryAbi,"CampaignCreated");assert.equal(event.length,1);assert.ok(same(event[0].args.creator,birth.creator)&&same(event[0].args.campaign,birth.campaign));assert.equal(event[0].args.intent.toLowerCase(),birth.intentId.toLowerCase());
    const args=decodeFunctionData({abi:factoryAbi,data:send.request.data});assert.equal(args.functionName,"create");assert.ok(same(args.args[0],birth.intentId)&&same(args.args[1],birth.controller));assert.equal(args.args[2],BigInt(birth.initialRewardPerUnit));assert.equal(args.args[3],birth.walletCap);
    const salt=keccak256(encodeAbiParameters([{type:"uint256"},{type:"address"},{type:"bytes32"}],[31337n,birth.creator,birth.intentId]));
    const constructor=encodeAbiParameters([{type:"address"},{type:"address"},{type:"address"},{type:"bytes32"},{type:"uint128"},{type:"uint32"},{type:"address"},{type:"address"}],[birth.creator,birth.controller,m.rewardToken,m.rewardTokenRuntimeHash,BigInt(birth.initialRewardPerUnit),birth.walletCap,m.reclaimFactory,m.permanentSink]);
    assert.ok(same(getCreate2Address({from:m.campaignDeployer,salt,bytecode:concatHex([m.campaignCreationCode,constructor])}),birth.campaign));
    assert.equal(keccak256(materializeReclaimRuntime(m.campaignRuntimeTemplate,m.campaignImmutableReferences,m.campaignImmutableNames,{creator:birth.creator,rewardToken:m.rewardToken,rewardRuntimeHash:m.rewardTokenRuntimeHash,deploymentChainId:31337,deploymentFactory:m.reclaimFactory,permanentSink:m.permanentSink,sinkRuntimeHash:m.sinkRuntimeHash})),birth.runtimeHash);
  }
  const observed=sends.filter(send=>inner(send).operation==="redeem").map(send=>retiredSend(send,m));assert.equal(observed.length,9);assert.equal(a.retirements.length,9);
  const orphan=a.reorg.orphanHash.toLowerCase();assert.ok(byHash.has(orphan));assert.equal(observed.filter(x=>key(x.receipt)===orphan).length,1);
  for(const value of observed){const record=a.retirements.find(r=>same(r.transactionHash,value.receipt.transactionHash));assert.ok(record);assert.equal(record.kind,"permanent-surrender");assert.equal(record.custody,"permanent-retirement");assert.equal(record.receiptId,value.event.receiptId.toString());assert.equal(record.rewardWei,value.reward.toString());assert.deepEqual(record.tokenIds,value.r.fields.tokenIds);assert.deepEqual(record.quantities,value.r.fields.quantities);assert.ok(same(record.claimant,value.r.actor)&&same(record.destination,value.event.destination));}
  const rows=a.database.events.map(row=>row.payload),ids=new Set();for(const row of rows){
    assert.notEqual(row.transactionHash.toLowerCase(),orphan,"Orphaned evidence must be absent from canonical SQL");const send=byHash.get(row.transactionHash.toLowerCase());assert.ok(send);
    const identity=row.transactionHash.toLowerCase()+":"+row.logIndex;assert.ok(!ids.has(identity));ids.add(identity);
    const log=send.receipt.logs.filter(log=>log.logIndex===row.logIndex&&same(log.address,row.campaign));assert.equal(log.length,1);
    const parsed=parseEventLogs({abi:campaignAbi,logs:log,strict:true});assert.equal(parsed.length,1);assert.equal(parsed[0].eventName,row.eventName);assert.deepEqual(norm(parsed[0].args),norm(row.args));
    assert.ok(same(row.blockHash,send.receipt.blockHash));assert.equal(row.blockNumber,send.receipt.blockNumber);
    if(log[0].blockTimestamp!==undefined)assert.equal(new Date(Number(log[0].blockTimestamp)*1000).toISOString(),row.timestamp);
  }
  const canonical=rows.filter(row=>row.eventName==="TradeInAccepted");assert.equal(canonical.length,8);
  let units=0n,rewards=0n;const origins=new Set(),modes=new Set();
  for(const row of canonical){const observedOne=observed.find(x=>same(x.receipt.transactionHash,row.transactionHash));assert.ok(observedOne);
    const s=row.settlement;assert.equal(s.kind,"permanent-surrender");assert.equal(s.receiptId,row.args.receiptId);assert.equal(BigInt(s.amount),observedOne.reward);assert.equal(s.rewardToken.toLowerCase(),m.rewardToken.toLowerCase());
    assert.deepEqual(s.supplyBefore,observedOne.proof.supplyBefore.map(String));assert.deepEqual(s.supplyAfter,observedOne.proof.supplyAfter.map(String));assert.deepEqual(s.tokenIds,observedOne.r.fields.tokenIds);assert.deepEqual(s.quantities,observedOne.r.fields.quantities);
    assert.ok(same(s.from,row.campaign)&&same(s.to,observedOne.r.actor)&&same(s.origin.actor,s.to));assert.equal(s.disposition,s.retirementMode===1?"native-burn":"permanent-sink");
    origins.add(s.origin.profile);modes.add(`${s.standard}/${s.retirementMode}`);units+=observedOne.units;rewards+=observedOne.reward;
  }
  assert.equal(units,16n);assert.equal(rewards,86n*10n**18n);assert.deepEqual(origins,new Set(["eoa","metamask-7702","safe-1.4.1"]));assert.deepEqual(modes,new Set(["1/1","1/2","2/1","2/2"]));
  const balances=new Map(births.map(birth=>[birth.campaign.toLowerCase(),0n]));
  for(const row of rows){let change=0n;if(row.eventName==="Funded"||row.eventName==="SurplusReconciled")change=BigInt(row.args.amount);else if(row.eventName==="TradeInAccepted")change=-BigInt(row.args.reward);else if(row.eventName==="ReserveRecovered")change=-BigInt(row.args.amount);
    const address=row.campaign.toLowerCase();balances.set(address,balances.get(address)+change);assert.ok(balances.get(address)>=0n,"Every canonical payout remains funded");}
  assert.deepEqual([...balances.values()].sort((a,b)=>a<b?-1:a>b?1:0),[0n,1969n*10n**18n]);
  assert.equal(BigInt(a.budget.funded),BigInt(a.budget.paid)+BigInt(a.budget.dustRecovered));assert.equal(a.budget.unfundedNextSurrenderRejected,true);
  const safeSends=sends.filter(send=>send.review.proposal);assert.equal(safeSends.length,11);assert.equal(a.safeExecutions.length,11);
  let lastSafe=-1n,lastPayer=null;for(const send of safeSends){const outer=send.review,p=outer.proposal;boundDigest(outer,"reviewHash");boundDigest(p,"proposalHash");
    assert.equal(p.chainId,31337);assert.ok(same(p.safe,setup.safe.address));assert.equal(p.threshold,2);assert.equal(setup.safe.threshold,2);
    assert.deepEqual([...p.owners].map(x=>x.toLowerCase()).sort(),[...setup.safe.owners].map(x=>x.toLowerCase()).sort());assert.equal(new Set(p.owners.map(x=>x.toLowerCase())).size,3);
    assert.equal(BigInt(p.safeNonce),lastSafe+1n);lastSafe=BigInt(p.safeNonce);if(lastPayer!==null)assert.equal(BigInt(p.gasPayerNonce),lastPayer+1n);lastPayer=BigInt(p.gasPayerNonce);
    assert.equal(BigInt(send.request.nonce),lastPayer);assert.ok(same(send.request.from,p.gasPayer)&&same(send.request.to,p.safe));assert.equal(p.safeTx.nonce,p.safeNonce);
    const typed={domain:{chainId:31337,verifyingContract:p.safe},types:safeTypes,primaryType:"SafeTx",message:p.safeTx};assert.ok(same(hashTypedData(typed),p.digest));assert.notEqual(hashTypedData({...typed,domain:{...typed.domain,chainId:4663}}),p.digest);
    assert.equal(outer.approvals.length,2);let previous=0n;for(const approval of outer.approvals){assert.ok(BigInt(approval.signer)>previous);previous=BigInt(approval.signer);assert.ok(p.owners.some(owner=>same(owner,approval.signer)));assert.ok(same(await recoverTypedDataAddress({...typed,signature:approval.signature}),approval.signer));}
    const decoded=decodeFunctionData({abi:safeAbi,data:send.request.data});assert.equal(decoded.functionName,"execTransaction");assert.deepEqual(norm(decoded.args),norm([p.safeTx.to,0n,p.safeTx.data,0,0n,0n,0n,zeroAddress,zeroAddress,concatHex(outer.approvals.map(a=>a.signature))]));
    const outcomes=receiptLogs(send.receipt,p.safe,safeAbi).filter(event=>event.eventName==="ExecutionSuccess"||event.eventName==="ExecutionFailure");assert.equal(outcomes.length,1);assert.equal(outcomes[0].eventName,"ExecutionSuccess");assert.ok(same(outcomes[0].args.txHash,p.digest));assert.equal(outcomes[0].args.payment,0n);
  }
  assert.equal(safeSends.filter(send=>key(send.receipt)!==orphan).length,10);
  const recoveries=[...b.recoveries,...budget.recoveries];assert.ok(recoveries.every(x=>x.noSubmission===true));assert.ok(b.safeRecoveries.every(x=>x.noSignatureOrSubmission===true));
  for(const recovery of [...recoveries,...b.safeRecoveries]){const result=recovery.result;assert.equal(result.chainId,31337);assert.equal(result.executionEnabled,false);assert.equal(result.finality,"synthetic-local-not-production");
    if(result.snapshot){assert.equal(result.snapshot.scope,"isolated-local");assert.equal(result.snapshot.executionEnabled,false);const checkpoint=result.snapshot.history.checkpoint;if(checkpoint){assert.equal(checkpoint.finality,"local-synthetic");assert.equal(checkpoint.l1Finality,"not-applicable");assert.equal(checkpoint.confirmations,2);}}}
  assert.equal(b.rejectedWallet.noSubmission,true);
  // Rejection may be followed by an explicit confirmation of the identical
  // still-current review. Count wallet attempts and actual receipts separately.
  assert.equal(b.walletMethods.filter(method=>method==="eth_sendTransaction").length,b.sends.length+2,"Only the deliberate direct and Safe outer wallet rejections add attempts without receipts");
  assert.equal(budget.walletMethods.filter(method=>method==="eth_sendTransaction").length,budget.sends.length);
  assert.ok(b.sends.filter(send=>send.review.reviewHash===b.rejectedWallet.reviewHash).length<=1);
  assert.equal(b.safeApprovals.filter(approval=>approval.status==="wallet-rejected").length,1);assert.equal(b.walletMethods.filter(method=>method==="eth_signTypedData_v4").length,b.safeApprovals.length);
  assert.equal(b.safeApprovals.filter(approval=>approval.status==="approved").length,safeSends.length*2);
  assert.ok(recoveries.some(x=>x.hashEntered===null&&x.result.status==="pending"));assert.ok(recoveries.some(x=>x.hashEntered===null&&x.result.status==="confirmed"&&x.result.transactionHash));
  assert.ok(b.safeRecoveries.some(x=>x.result.status==="pending"));assert.ok(b.safeRecoveries.some(x=>same(x.result.transactionHash,orphan)&&x.result.status==="unavailable"));
  assert.equal(a.manualHashRecovery.length,2);assert.deepEqual(new Set(a.manualHashRecovery.map(row=>row.kind)),new Set(["direct","safe"]));
  for(const row of a.manualHashRecovery){
    const original=b.sends.find(send=>send.review.reviewHash===row.originalReviewHash),candidate=byHash.get(row.candidateHash.toLowerCase());assert.ok(original&&candidate,"Both actual and unrelated candidate hashes identify real observed receipts");
    assert.ok(same(original.receipt.transactionHash,row.actualTransactionHash)&&same(row.resolvedJournalHash,row.actualTransactionHash));assert.ok(!same(row.candidateHash,row.actualTransactionHash));
    assert.ok(same(candidate.request.from,original.request.from));assert.notEqual(BigInt(candidate.request.nonce),BigInt(original.request.nonce));assert.notEqual(candidate.request.data,original.request.data);
    const journal=row.unboundJournal;assert.equal(journal.stage,"unavailable");assert.equal(journal.transactionHash,null);assert.equal(journal.result.status,"unavailable");assert.equal(Object.hasOwn(journal.result,"transactionHash"),false);
    assert.equal(journal.result.reviewHash,row.originalReviewHash);assert.equal(journal.result.chainId,31337);assert.equal(journal.result.executionEnabled,false);
    const history=row.kind==="direct"?b.recoveries:b.safeRecoveries;
    if(row.kind==="direct"){assert.equal(journal.reviewHash,row.originalReviewHash);assert.equal(original.review.proposal,undefined);}
    else{assert.ok(original.review.proposal);assert.equal(journal.proposalHash,original.review.proposal.proposalHash);assert.equal(journal.result.proposalHash,journal.proposalHash);}
    assert.ok(history.some(item=>item.reviewHash===row.originalReviewHash&&item.result.status==="unavailable"&&same(item.result.transactionHash,row.candidateHash)),"A rejected unrelated candidate cannot become the journal identity");
    assert.ok(history.some(item=>item.reviewHash===row.originalReviewHash&&item.result.status==="pending"&&item.result.indexed!==true));
    const resolved=history.find(item=>item.reviewHash===row.originalReviewHash&&item.result.status==="confirmed"&&same(item.result.transactionHash,row.actualTransactionHash));assert.ok(resolved);assert.equal(resolved.result.indexed,true);
    assert.ok(same(resolved.result.canonical.blockHash,original.receipt.blockHash));assert.equal(resolved.result.canonical.blockNumber,original.receipt.blockNumber);
    assert.equal(b.sends.filter(send=>same(send.receipt.transactionHash,row.actualTransactionHash)).length,1,"Manual hash correction reconciles one original receipt without a second broadcast");
  }
  assert.equal(a.restart.before,a.restart.after);assert.ok(a.restart.after>0);assert.equal(a.checks.safeJournalRestartNoNewSignatureOrDuplicate,true);
  for(const browser of [b,budget]){assert.deepEqual(browser.pageErrors,[]);assert.deepEqual(browser.externalRequests,[]);assert.deepEqual(browser.forbiddenRequests,[]);}
  for(const layout of ["portrait","landscape","desktop-viewport","standard-desktop-context"])assert.ok(b.layouts.some(x=>x.layout===layout),layout+" recorded");
  assert.equal(b.desktopRead.walletRequests,0);assert.equal(b.desktopRead.walletInjected,false);assert.deepEqual(b.desktopRead.errors,[]);
  assert.equal(a.reorg.recoveryStatus,"unavailable");assert.equal(a.reorg.noAutomaticRetry,true);assert.equal(a.unauthorizedReads.length,2);assert.ok(a.unauthorizedReads.every(x=>x.status===404&&x.noRecords));
  return{observedRetirements:observed.length,canonicalRetirements:canonical.length,canonicalUnits:units.toString(),canonicalRewardWei:rewards.toString(),observedSafeExecutions:safeSends.length,canonicalSafeExecutions:safeSends.filter(send=>key(send.receipt)!==orphan).length};
}

for(const engine of ["chromium","webkit"])test(`Task079 ${engine}: real receipt, reviewed calldata, SQL and Safe authorization closure on PostgreSQL18.6`,async()=>{
  const records=loaded(engine);
  assert.match(records.a.postgresql.serverVersion,/^18\.6(?:\D|$)/,"Actual PostgreSQL18.6 server version required");assert.equal(records.a.postgresql.encoding,"UTF8");assert.equal(records.a.postgresql.isolatedTestDatabase,true);
  await verifyCrossLayer(records,engine);
});

for(const engine of ["chromium","webkit"])test(`Task079 ${engine}: archived evidence cross-check rejects altered retirement, settlement and Safe approval`,async()=>{
  const original=loaded(engine);
  const redirected=structuredClone(original),send=redirected.b.sends.find(send=>inner(send).operation==="redeem"),r=inner(send);
  const nftTransfer=send.receipt.logs.find(log=>same(log.address,r.nft.collection)&&log.topics.length===4);
  assert.ok(nftTransfer);nftTransfer.topics[2]="0x"+r.actor.slice(2).toLowerCase().padStart(64,"0");
  await assert.rejects(verifyCrossLayer(redirected,engine));
  const accounting=structuredClone(original),row=accounting.a.database.events.find(row=>row.payload.eventName==="TradeInAccepted");
  row.payload.settlement.amount=(BigInt(row.payload.settlement.amount)+1n).toString();await assert.rejects(verifyCrossLayer(accounting,engine));
  const signature=structuredClone(original),outer=signature.b.sends.find(send=>send.review.proposal).review;
  const old=outer.approvals[0].signature;outer.approvals[0].signature="0x"+(old.slice(2,4)==="ff"?"fe":"ff")+old.slice(4);
  const{reviewHash:_ignored,...body}=outer;outer.reviewHash=digest(body);
  await assert.rejects(verifyCrossLayer(signature,engine));
});

for(const engine of ["chromium","webkit"])test(`Task079 ${engine}: pre-confirmation viewport captures bind exact signed retirement terms and network costs`,()=>{
  verifiedReviewImages(loaded(engine),engine);
});

for(const engine of ["chromium","webkit"])test(`Task079 ${engine}: public website remains read-only with no wallet or private-route requests`,()=>{
  const reclaim=readArchive(`public/${engine}--reclaim--reclaim-public.json.gz`),website=readArchive(`public/${engine}--website-preview-checks.json.gz`);
  assert.equal(reclaim.schemaVersion,2);assert.equal(reclaim.profile,"rmt-reclaim-public-acceptance-v2-permanent");assert.equal(reclaim.status,"PASS");assert.equal(reclaim.engine,engine);assert.equal(reclaim.scope,"actual-loopback-read-only-build");
  for(const flag of ["physicalIPhoneAcceptance","productionFinancialExecution","liveCampaignAssigned","liveTokenAssigned","liveUsdReferenceAssigned","fabricatedReserve"])assert.equal(reclaim[flag],false);
  assert.deepEqual(reclaim.denied,[{action:"prepare",operation:"redeem",status:404},{action:"revalidate",status:404},{action:"verify",status:404},{action:"prepare",operation:"fund",status:404},...['safe-propose','safe-approve','safe-prepare','safe-revalidate','safe-verify'].map(action=>({action,status:404})),{action:"prepare",operation:"return",status:404},{action:"prepare",operation:"approve-return",status:404}]);
  assert.equal(reclaim.layouts.length,3);assert.deepEqual(new Set(reclaim.layouts.map(layout=>layout.name)),new Set(["desktop","portrait","landscape"]));
  for(const layout of reclaim.layouts){assert.equal(layout.walletRequests,0);assert.equal(layout.externalRequests,0);assert.equal(layout.financialRequests,0);assert.deepEqual(layout.errors,[]);assert.equal(layout.noOverflow,true);assert.equal(layout.keyboardAccessible,true);assert.equal(layout.capturePreservesEmulation,true);
    assert.equal(layout.media.coarse,layout.name!=="desktop");assert.ok(layout.fields.length>=3);for(const field of layout.fields){assert.ok(field.height>=44);if(field.editable&&layout.name!=="desktop")assert.ok(field.font>=16);}}
  assert.equal(website.environment,"loopback");assert.equal(new URL(website.url).hostname,"127.0.0.1");assert.equal(website.engine,engine);assert.equal(website.config,"disabled");assert.equal(website.rsc,"passed");assert.equal(website.privateMarkerCheck,true);
  assert.equal(website.checked.length,3);for(const layout of website.checked){assert.equal(layout.walletCalls,0);assert.equal(layout.outsideRequests,0);assert.equal(layout.operationalRequests,0);assert.ok(layout.scripts>0);}
  assert.equal(website.chain.status,"stale");assert.equal(website.chain.coverage,"verified-snapshot");assert.equal(website.chain.launches,4);assert.match(website.chain.checkpoint.blockNumber,/^[0-9]+$/);assert.ok(Number.isFinite(Date.parse(website.chain.checkpoint.timestamp)));
  for(const route of["/admin","/deploy-mainnet","/api/launchpad/test-creation","/api/launchpad/test-lifecycle","/api/launchpad/production-creation","/api/trade/rmt-v4","/mcp","/.env","/.git/config"])for(const method of["GET","HEAD","POST"])assert.ok(website.denied.includes(method+" "+route));
  for(const route of["/","/create-token","/my-launches","/wallet","/account/profile"])assert.ok(website.ssr.includes(route));
  publicData(reclaim);publicData(website);
});

test("Task079 public creator-polish evidence preserves both engines and explicit emulation boundaries",()=>{
  const report=readArchive("public/polish--after-report.json.gz");assert.equal(report.status,"passed");assert.equal(report.mode,"after");assert.match(report.candidate.commit,/^[0-9a-f]{40}$/);assert.ok(report.reports.length>=6);
  assert.deepEqual(new Set(report.reports.map(row=>row.engine)),new Set(["chromium","webkit"]));
  for(const row of report.reports){assert.deepEqual(row.operations,[]);assert.deepEqual(row.pageErrors,[]);assert.deepEqual(row.walletCalls,[]);assert.match(row.physicalAcceptance,/Not performed/);assert.match(row.fixture,/synthetic registrations/);}
  publicData(report);
});
