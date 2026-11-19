import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync,writeFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {join} from "node:path";
import {receiptEvidence,transact} from "../../packages/contracts/scripts/deploy-fixed-supply-fixture.mjs";
import {buildReclaimEligibility} from "../../packages/launchpad-common/reclaim-runtime.mjs";

const require=createRequire(new URL("../../apps/launch-website/package.json",import.meta.url));
const{encodeAbiParameters,encodeFunctionData,decodeFunctionResult,erc20Abi,hashTypedData,keccak256,parseAbi,parseEventLogs,stringToHex,toHex,zeroAddress}=require("viem");
const{generatePrivateKey,privateKeyToAccount}=require("viem/accounts");
const json=v=>JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x,2)+"\n";
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const safeTypes={SafeTx:[{name:"to",type:"address"},{name:"value",type:"uint256"},{name:"data",type:"bytes"},{name:"operation",type:"uint8"},
  {name:"safeTxGas",type:"uint256"},{name:"baseGas",type:"uint256"},{name:"gasPrice",type:"uint256"},{name:"gasToken",type:"address"},{name:"refundReceiver",type:"address"},{name:"nonce",type:"uint256"}]};
const factoryAbi=parseAbi(["function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns(address proxy)","event ProxyCreation(address indexed proxy,address singleton)"]);
const safeAbi=parseAbi(["function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
  "function VERSION() view returns(string)","function masterCopy() view returns(address)","function getOwners() view returns(address[])","function getThreshold() view returns(uint256)","function nonce() view returns(uint256)",
  "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns(bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)"]);

/** Genuine SafeL2 1.4.1 execution using fresh synthetic test-owner keys. No
 * impersonated Safe/owner, production signer, signature upload or live RPC. */
export async function testReclaimSafe({client,rpc,send,creatorAccount,campaign,module:m,compilation,assets,mine,ready,workerOrigin,indexReadKey,out,waitFor}){
  assert.equal(await client.getChainId(),31337);assert.equal(new URL(client.transport.url).hostname,"127.0.0.1");assert.equal(new URL(workerOrigin).hostname,"127.0.0.1");
  const archive=JSON.parse(readFileSync(new URL("../../packages/contracts/test/fixtures/safe-1.4.1/runtime.json",import.meta.url),"utf8"));
  const proxyArchive=JSON.parse(gunzipSync(readFileSync(new URL("../../docs/evidence/mobile-signing/safe-runtime-4663.json.gz",import.meta.url))));
  for(const entry of Object.values(archive.contracts)){
    assert.equal(keccak256(entry.code),entry.runtimeKeccak256);
    const code=await client.getCode({address:entry.address});if(!code||code==="0x")await rpc("anvil_setCode",[entry.address,entry.code]);
    assert.equal(keccak256(await client.getCode({address:entry.address})),entry.runtimeKeccak256);
  }
  const singleton=archive.contracts.safe_l2.address,handler=archive.contracts.compatibility_fallback_handler.address,factory=archive.contracts.safe_proxy_factory.address;
  const owners=[0,1,2].map(()=>privateKeyToAccount(generatePrivateKey())),relayer=privateKeyToAccount(generatePrivateKey());
  await rpc("anvil_setBalance",[relayer.address,toHex(2n*10n**18n)]);
  const receipts=[],evidence={schemaVersion:1,scope:"LOCAL_SYNTHETIC_31337_SAFE_TEST_KEYS_ONLY",profile:"SafeL2-1.4.1",status:"incomplete",owners:owners.map(a=>a.address),threshold:2,gasPayer:relayer.address,
    pinProvenance:"Existing pinned archived runtime installed only where absent in the isolated chain",productionActivation:false,checks:{},receipts};
  const save=()=>writeFileSync(join(out,"reclaim-safe-acceptance.json"),json(evidence));
  const read=(address,abi,functionName,args=[])=>client.readContract({address,abi,functionName,args});
  async function relayerSend(request,expected="success"){
    const nonce=await client.getTransactionCount({address:relayer.address,blockTag:"pending"}),head=await client.getBlock();
    const gas=expected==="reverted"?8_000_000n:(await client.estimateGas({account:relayer.address,...request}))*125n/100n;
    const signed=await relayer.signTransaction({chainId:31337,type:"eip1559",to:request.to,data:request.data,value:0n,nonce,gas,maxFeePerGas:(head.baseFeePerGas??1n)*2n+1n,maxPriorityFeePerGas:0n});
    const hash=keccak256(signed);assert.equal(await rpc("eth_sendRawTransaction",[signed]),hash);
    const receipt=await client.waitForTransactionReceipt({hash,timeout:30_000,pollingInterval:100,checkReplacement:false});assert.equal(receipt.status,expected);
    assert.equal((await client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash);return receipt;
  }
  const initializer=encodeFunctionData({abi:safeAbi,functionName:"setup",args:[owners.map(a=>a.address),2n,zeroAddress,"0x",handler,zeroAddress,0n,zeroAddress]});
  const salt=BigInt(keccak256(stringToHex("rmt-reclaim-safe-synthetic:"+campaign.toLowerCase())));
  const creation={to:factory,data:encodeFunctionData({abi:factoryAbi,functionName:"createProxyWithNonce",args:[singleton,initializer,salt]})};
  const simulated=await client.call({account:relayer.address,...creation});const predicted=decodeFunctionResult({abi:factoryAbi,functionName:"createProxyWithNonce",data:simulated.data});
  assert.ok(!await client.getCode({address:predicted}));
  const created=await relayerSend(creation),createdEvent=parseEventLogs({abi:factoryAbi,eventName:"ProxyCreation",strict:true,logs:created.logs.filter(l=>same(l.address,factory))});
  assert.equal(createdEvent.length,1);const safe=createdEvent[0].args.proxy;assert.ok(same(safe,predicted));assert.equal(keccak256(await client.getCode({address:safe})),keccak256(proxyArchive.proxyRuntimeCode));
  assert.equal(await read(safe,safeAbi,"VERSION"),"1.4.1");assert.ok(same(await read(safe,safeAbi,"masterCopy"),singleton));assert.equal(await read(safe,safeAbi,"getThreshold"),2n);
  assert.deepEqual(new Set((await read(safe,safeAbi,"getOwners")).map(a=>a.toLowerCase())),new Set(owners.map(a=>a.address.toLowerCase())));
  evidence.safe=safe;evidence.creation={...receiptEvidence(created),initializerHash:keccak256(initializer),salt: salt.toString(),owners:owners.map(a=>a.address),threshold:2};save();
  const campaignAbi=compilation.artifacts.RMTReclaimCampaignV1.abi,nft=m.collections.find(a=>a.standard===1),nftAbi=assets.Reclaim721Fixture.abi;
  assert.ok(nft);assert.ok(same(await read(campaign,campaignAbi,"controller"),creatorAccount.address));
  const safeExec=async(to,data,label,{count=2,expected="success"}={})=>{
    const nonce=await read(safe,safeAbi,"nonce"),message={to,value:0n,data,operation:0,safeTxGas:0n,baseGas:0n,gasPrice:0n,gasToken:zeroAddress,refundReceiver:zeroAddress,nonce};
    const digest=hashTypedData({domain:{chainId:31337,verifyingContract:safe},types:safeTypes,primaryType:"SafeTx",message});
    assert.equal(await read(safe,safeAbi,"getTransactionHash",[to,0n,data,0,0n,0n,0n,zeroAddress,zeroAddress,nonce]),digest);
    const signatures=await Promise.all(owners.slice(0,count).map(async a=>({address:a.address,signature:await a.sign({hash:digest})})));
    const combined="0x"+signatures.sort((a,b)=>BigInt(a.address)<BigInt(b.address)?-1:1).map(s=>s.signature.slice(2)).join("");
    const request={to:safe,data:encodeFunctionData({abi:safeAbi,functionName:"execTransaction",args:[to,0n,data,0,0n,0n,0n,zeroAddress,zeroAddress,combined]})};
    const receipt=await relayerSend(request,expected);assert.equal(await read(safe,safeAbi,"nonce"),expected==="success"?nonce+1n:nonce);
    if(expected==="success"){const success=parseEventLogs({abi:safeAbi,eventName:"ExecutionSuccess",strict:true,logs:receipt.logs.filter(l=>same(l.address,safe))});assert.equal(success.length,1);assert.equal(success[0].args.txHash,digest);assert.equal(success[0].args.payment,0n);}
    receipts.push({label,safeNonce:nonce.toString(),safeTransactionHash:digest,innerTo:to,innerCalldataHash:keccak256(data),signers:signatures.map(s=>s.address),...receiptEvidence(receipt)});save();
    await mine();await ready();return{receipt,request,nonce,digest};
  };
  const expires=(await client.getBlock()).timestamp+7n*86400n;
  const proposed=await send(creatorAccount.address,transact(campaign,campaignAbi,"proposeController",[safe,expires]));receipts.push({label:"controller-notice",...receiptEvidence(proposed)});
  await safeExec(campaign,encodeFunctionData({abi:campaignAbi,functionName:"acceptController"}),"early-controller-acceptance-rejected",{expected:"reverted"});
  await rpc("evm_increaseTime",[2*86400+1]);await mine();await ready();
  const acceptance=await safeExec(campaign,encodeFunctionData({abi:campaignAbi,functionName:"acceptController"}),"controller-accepted-after-notice");
  assert.ok(same(await read(campaign,campaignAbi,"controller"),safe));evidence.checks.twoDayNoticeAndGenuineSafeIncomingAcceptance=true;
  const replay=await relayerSend(acceptance.request,"reverted");assert.equal(await read(safe,safeAbi,"nonce"),acceptance.nonce+1n);receipts.push({label:"accepted-safe-authorization-replay-rejected",...receiptEvidence(replay)});await mine();await ready();
  const pause=encodeFunctionData({abi:campaignAbi,functionName:"pause"});
  await safeExec(campaign,pause,"one-signature-rejected",{count:1,expected:"reverted"});evidence.checks.insufficientSignaturesAndReplayRejected=true;
  await safeExec(campaign,encodeFunctionData({abi:campaignAbi,functionName:"resume"}),"safe-controller-resume");
  const reserveBefore=await read(campaign,campaignAbi,"reserve"),manualFunding=100n*10n**18n;
  const gift=await send(creatorAccount.address,transact(m.rewardToken,erc20Abi,"transfer",[safe,manualFunding]));receipts.push({label:"manual-synthetic-owner-funding",...receiptEvidence(gift)});
  await safeExec(m.rewardToken,encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[campaign,manualFunding]}),"safe-bounded-funding-approval");
  const funded=await safeExec(campaign,encodeFunctionData({abi:campaignAbi,functionName:"fund",args:[manualFunding]}),"safe-manual-campaign-funding");
  assert.equal(await read(campaign,campaignAbi,"reserve"),reserveBefore+manualFunding);assert.equal(await read(m.rewardToken,erc20Abi,"allowance",[safe,campaign]),0n);
  const nftId=11n;assert.ok(same(await read(nft.address,nftAbi,"ownerOf",[nftId]),creatorAccount.address));
  const received=await send(creatorAccount.address,transact(nft.address,nftAbi,"safeTransferFrom",[creatorAccount.address,safe,nftId,"0x"]));receipts.push({label:"erc721-safe-handler-receive",...receiptEvidence(received)});await mine();await ready();
  assert.ok(same(await read(nft.address,nftAbi,"ownerOf",[nftId]),safe));
  await safeExec(nft.address,encodeFunctionData({abi:nftAbi,functionName:"approve",args:[campaign,nftId]}),"safe-exact-nft-approval");
  const eligible=buildReclaimEligibility({chainId:31337,campaign,collection:nft.address,runtimeHash:nft.runtimeHash,standard:1,items:nft.items},{keccak256,encodeAbiParameters});
  const item=eligible.items.find(i=>i.tokenId===nftId.toString());assert.ok(item);
  const expectedReward=await read(campaign,campaignAbi,"rewardPerUnit"),policy=await read(campaign,campaignAbi,"policyEpoch"),claimantNonce=await read(campaign,campaignAbi,"claimantNonces",[safe]);
  const beforeClaim=await read(m.rewardToken,erc20Abi,"balanceOf",[safe]);
  const accepted=await safeExec(campaign,encodeFunctionData({abi:campaignAbi,functionName:"redeem",args:[nft.address,[nftId],[1n],[BigInt(item.maxQuantity)],[item.proof],policy,expectedReward,claimantNonce,(await client.getBlock()).timestamp+180n]}),"safe-owned-nft-redeemed");
  assert.equal(await read(m.rewardToken,erc20Abi,"balanceOf",[safe]),beforeClaim+expectedReward);assert.ok(same(await read(nft.address,nftAbi,"ownerOf",[nftId]),campaign));
  const acceptedEvents=parseEventLogs({abi:campaignAbi,eventName:"TradeInAccepted",strict:true,logs:accepted.receipt.logs.filter(l=>same(l.address,campaign))});assert.equal(acceptedEvents.length,1);
  const receiptId=acceptedEvents[0].args.receiptId;assert.ok(same(acceptedEvents[0].args.claimant,safe));
  await safeExec(m.rewardToken,encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[campaign,expectedReward]}),"safe-original-reward-return-approval");
  const returned=await safeExec(campaign,encodeFunctionData({abi:campaignAbi,functionName:"returnTradeIn",args:[receiptId,(await client.getBlock()).timestamp+180n]}),"safe-original-nft-returned");
  assert.equal(await read(m.rewardToken,erc20Abi,"balanceOf",[safe]),beforeClaim);assert.ok(same(await read(nft.address,nftAbi,"ownerOf",[nftId]),safe));
  assert.equal(await read(m.rewardToken,erc20Abi,"allowance",[safe,campaign]),0n);assert.equal(await read(campaign,campaignAbi,"walletClaimed",[safe]),1);assert.equal(await read(campaign,campaignAbi,"outstandingLiability"),0n);
  evidence.checks.safeBeneficiaryRemainsSafeAndReturnRequiresExactReward=true;evidence.checks.immutablePrincipalAndNoIOU=true;
  const indexed=await waitFor("Reclaim Safe canonical indexed events",async()=>{
    const r=await fetch(workerOrigin+"/reclaim-campaigns?campaign="+campaign,{headers:{"X-RMT-Fixture-Key":indexReadKey},signal:AbortSignal.timeout(5000)});if(r.status!==200)return false;
    const body=await r.json();return [funded,accepted,returned].every(t=>body.events.some(e=>same(e.transactionHash,t.receipt.transactionHash)&&e.settlement?.origin?.profile==="safe-1.4.1"))?body:false;
  });
  assert.ok(indexed&&typeof indexed==="object","waitFor must return the verified payload");
  evidence.indexed=[funded,accepted,returned].map(t=>{const event=indexed.events.find(e=>same(e.transactionHash,t.receipt.transactionHash)&&e.settlement);assert.ok(event);assert.ok(same(event.settlement.origin.actor,safe));assert.ok(same(event.settlement.origin.gasPayer,relayer.address));assert.equal(event.settlement.origin.signers.length,2);return event;});
  evidence.checks.authenticatedDurableSafeActorEvidence=true;evidence.final={campaignController:await read(campaign,campaignAbi,"controller"),safeNonce:(await read(safe,safeAbi,"nonce")).toString(),safeTokenBalance:(await read(m.rewardToken,erc20Abi,"balanceOf",[safe])).toString(),nftOwner:await read(nft.address,nftAbi,"ownerOf",[nftId]),rewardReturned:expectedReward.toString(),reserve:(await read(campaign,campaignAbi,"reserve")).toString(),outstandingLiability:"0"};
  evidence.status="passed";save();return evidence;
}
