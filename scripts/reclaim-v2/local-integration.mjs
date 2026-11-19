import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {writeFileSync,readFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";
import {localFixtureClient} from "../../packages/contracts/scripts/deploy-fixed-supply-fixture.mjs";
import {createReclaimBrowserSession} from "./browser-integration.mjs";
const require=createRequire(new URL("../../apps/launch-website/package.json",import.meta.url));
const {erc20Abi,keccak256,parseEventLogs,zeroAddress}=require("viem");
const json=value=>JSON.stringify(value,(_,v)=>typeof v==="bigint"?v.toString():v,2)+"\n";
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const units=n=>(BigInt(n)*10n**18n).toString();

/** Actual corrected website -> reviewed calldata -> synthetic signatures ->
 * receipts -> the existing single PostgreSQL writer. No real wallet is used. */
export async function testReclaimJourney({browserEngine,rpcUrl,rpc,reclaimCompilation,reclaimDeployment,creatorAccount,
 sourceIdentity,site,workerOrigin,indexReadKey,out,pg,waitFor,mine,ready,restart,hideReceipt}){
 const client=await localFixtureClient(rpcUrl,31337),m=reclaimDeployment.module,creator=creatorAccount.address;
 assert.equal(await client.getChainId(),31337);assert.equal(new URL(site).hostname,"127.0.0.1");
 const campaignAbi=reclaimCompilation.artifacts.RMTReclaimCampaignV2.abi,factoryAbi=reclaimCompilation.artifacts.RMTReclaimFactoryV2.abi;
 const [burn721,burn1155,sink721,sink1155]=m.collections;
 const read=(address,abi,functionName,args=[])=>client.readContract({address,abi,functionName,args});
 const nftAbi=nft=>reclaimDeployment.assetArtifacts[nft.standard===1?(nft.retirementMode===1?"ReclaimBurn721Fixture":"ReclaimSink721Fixture"):(nft.retirementMode===1?"ReclaimBurn1155Fixture":"ReclaimSink1155Fixture")].abi;
 const send=(from,request)=>{const account=reclaimDeployment.signers.get(from.toLowerCase());assert.ok(account,"Fresh synthetic test key only");return reclaimDeployment.send(request,"success",account);};
 const signTypedData=(from,data)=>{const account=reclaimDeployment.signers.get(from.toLowerCase());assert.ok(account);return account.signTypedData(data);};
 const evidence={schemaVersion:2,profile:"rmt-reclaim-permanent-integrated-v2",scope:"LOCAL_SYNTHETIC_31337_NOT_PRODUCTION_OR_PHYSICAL_PHONE",status:"incomplete",
  chainId:31337,sourceIdentity,compiler:reclaimCompilation.manifest,deployment:m,checks:{},canonicalReceipts:[],retirements:[],safeExecutions:[],
  economics:{rewardUnits:"5 synthetic RMT per unit",reserve:"2000 synthetic RMT",liveUsdReference:false,approvedLiveCollections:0,syntheticProfileOnly:true}};
 const save=()=>writeFileSync(join(out,"reclaim-acceptance.json"),json(evidence));
 const post=async body=>{const r=await fetch(site+"/api/launchpad/test-reclaim",{method:"POST",headers:{Origin:site,"Content-Type":"application/json"},body:json(body),signal:AbortSignal.timeout(30_000)});return{status:r.status,body:await r.json()};};
 const worker=async()=>{const r=await fetch(workerOrigin+"/reclaim-campaigns?campaign="+campaign,{headers:{"X-RMT-Fixture-Key":indexReadKey},signal:AbortSignal.timeout(10_000)});return{status:r.status,body:await r.json()};};
 const advance=async()=>{await rpc("evm_increaseTime",[2*86400+1]);await mine();await ready();};
 const newSession=target=>createReclaimBrowserSession({browserEngine,site,out:target,rpc,client,creator,send,signTypedData,mine,ready,hideReceipt});
 let session=await newSession(out),campaign;
 const record=async(operation,submission,review,verified)=>{const receipt=await client.getTransactionReceipt({hash:submission.receipt.transactionHash});
  evidence.canonicalReceipts.push({operation,reviewHash:review.reviewHash,...submission.receipt,effectiveGasPrice:receipt.effectiveGasPrice.toString(),syntheticCostWei:(receipt.gasUsed*receipt.effectiveGasPrice).toString(),productionCostQuote:false});
  if(operation==="redeem"){assert.equal(verified.settlement.kind,"permanent-surrender");evidence.retirements.push(verified.settlement);}save();};
 async function complete(operation,fields={},decision="normal"){
  const {review}=await session.action(operation,fields),submission=await session.confirm(decision);
  if(decision==="reject")return{review,submission};
  await mine();await ready();const verified=await session.verify({review,hash:submission.receipt.transactionHash,indexed:true});
  await record(operation,submission,review,verified);return{review,submission,verified};
 }
 async function safeComplete(operation,fields={},decision="normal"){
  await session.configureSafe(reclaimDeployment.safe,creator);const inner=await session.action(operation,fields);assert.equal(inner.review.status,"needs-safe-approvals");assert.equal(inner.review.request,null);
  const proposal=await session.safePropose(),owners=proposal.owners;
  await session.safeApprove(owners[0]);
  assert.equal(await session.page.getByRole("button",{name:"Review Safe execution costs",exact:true}).isEnabled(),false,"One owner cannot execute");
  await session.safeApprove(owners[1]);const outer=await session.safePrepare(),submission=await session.safeConfirm(decision);
  if(decision==="reject")return{review:outer,submission};
  await mine();
  if(decision==="lose"){
   const pending=await session.safeVerify({review:outer,status:"pending"});assert.equal(pending.status,"pending");assert.notEqual(pending.indexed,true);
   hideReceipt(undefined);await ready();
  }else await ready();
  const verified=await session.safeVerify({review:outer,...(decision!=="lose"&&{hash:submission.receipt.transactionHash}),indexed:true});
  assert.equal(verified.transactionHash,submission.receipt.transactionHash);assert.ok(same(verified.safe,reclaimDeployment.safe));
  await record(operation,submission,outer,verified);evidence.safeExecutions.push({operation,proposalHash:proposal.proposalHash,digest:proposal.digest,safeNonce:proposal.safeNonce,
   gasPayer:creator,owners:owners.slice(0,2),receipt:submission.receipt,result:verified,missingHashRecovered:decision==="lose"});save();return{review:outer,submission,verified};
 }
 try{
  await session.connect();await session.action("create-campaign",{controller:creator,rewardPerUnit:units(5),walletCap:"30"});await session.confirm("reject");
  evidence.checks.walletRejectionNoSubmission=true;
  const created=await complete("create-campaign",{controller:creator,rewardPerUnit:units(5),walletCap:"30"});campaign=created.review.campaign;evidence.campaign=campaign;
  const birth=parseEventLogs({abi:factoryAbi,eventName:"CampaignCreated",strict:true,logs:created.submission.receipt.logs.filter(l=>same(l.address,m.reclaimFactory))});assert.equal(birth.length,1);assert.ok(same(birth[0].args.campaign,campaign));
  assert.equal(await read(campaign,campaignAbi,"paused"),true);assert.equal(await read(campaign,campaignAbi,"reserve"),0n);await session.lookup(campaign);
  await complete("approve-funding",{amountWei:units(2000)});await complete("fund",{amountWei:units(2000)});
  for(const nft of m.collections){await complete("propose-collection",{collection:nft.address,collectionCap:"40",collectionWalletCap:"30"});
   const early=await post({action:"prepare",operation:"execute-collection",account:creator,campaign,fields:{}});assert.equal(early.body.status,"unavailable");await advance();await complete("execute-collection");}
  await complete("resume");
  for(const nft of m.collections){
   const ids=nft.standard===1?["1"]:["101","102"],quantities=nft.standard===1?["1"]:["2","3"];
   const supplyBefore=await read(nft.address,nftAbi(nft),"totalSupply",nft.standard===1?[]:[101n]);
   await complete(nft.standard===1?"approve-721":"approve-1155",{collection:nft.address,...(nft.standard===1?{tokenId:"1"}:{})});
   const before=await read(m.rewardToken,erc20Abi,"balanceOf",[creator]);
   const accepted=await complete("redeem",{collection:nft.address,tokenIds:ids,quantities});
   assert.equal(await read(m.rewardToken,erc20Abi,"balanceOf",[creator]),before+BigInt(units(nft.standard===1?5:25)));
   const supplyAfter=await read(nft.address,nftAbi(nft),"totalSupply",nft.standard===1?[]:[101n]);
   assert.equal(supplyAfter,supplyBefore-(nft.retirementMode===1?(nft.standard===1?1n:2n):0n));
   if(nft.standard===1){if(nft.retirementMode===1)assert.equal(await read(nft.address,nftAbi(nft),"exists",[1n]),false);else assert.ok(same(await read(nft.address,nftAbi(nft),"ownerOf",[1n]),m.permanentSink));}
   assert.equal(accepted.verified.settlement.retirementMode,nft.retirementMode);
   assert.ok(same(accepted.verified.settlement.destination,nft.retirementMode===1?zeroAddress:m.permanentSink));
   if(nft.standard===2)await complete("revoke-1155",{collection:nft.address});
  }
  evidence.checks.native721And1155BurnAndSink721And1155AllAtomic=true;
  await session.layouts("reclaim-permanent-active");await session.desktopRead(campaign);
  // Legacy return operations and unreviewed collections are never admitted.
  const submissionsBeforeLegacy=session.evidence.sends.length;
  for(const operation of["return","approve-return"]){const denied=await post({action:"prepare",operation,account:creator,campaign,fields:{receiptId:"1"}});assert.equal(denied.status,200);assert.equal(denied.body.status,"unavailable");assert.equal(denied.body.executionEnabled,false);}
  assert.equal(session.evidence.sends.length,submissionsBeforeLegacy);
  const denied=await post({action:"prepare",operation:"propose-collection",account:creator,campaign,fields:{collection:reclaimDeployment.negative[0].address,collectionCap:"1",collectionWalletCap:"1",expiresAt:((await client.getBlock()).timestamp+3n*86400n).toString()}});assert.equal(denied.body.status,"unavailable");
  evidence.checks.unsupportedCollectionsAndAllOldReturnOperationsRejected=true;
  // Keep the original receipt and reward immutable through a future rate notice.
  await complete("pause");await complete("propose-rate",{rewardPerUnit:units(7)});await advance();await complete("execute-rate");
  assert.equal((await read(campaign,campaignAbi,"tradeIns",[1n]))[4],BigInt(units(5)));await complete("resume");
  await session.selectCollection(burn721.address);const lost=await session.action("approve-721",{collection:burn721.address,tokenId:"2"}),missing=await session.confirm("lose");await mine();
  await session.verify({review:lost.review,status:"pending"});hideReceipt(undefined);await ready();const recovered=await session.verify({review:lost.review,indexed:true});assert.equal(recovered.transactionHash,missing.receipt.transactionHash);
  evidence.checks.missingHashNoDuplicate=true;
  const beforeRestart=await worker();assert.equal(beforeRestart.status,200);const countBefore=(await pg.query("SELECT count(*)::int AS count FROM rmt_reclaim_v2_fixture_events")).rows[0].count;
  await restart();await session.page.reload();await session.page.locator('[data-reclaim-ready="true"]').waitFor();await session.connect();await session.lookup(campaign);
  assert.equal((await worker()).status,200);const countAfter=(await pg.query("SELECT count(*)::int AS count FROM rmt_reclaim_v2_fixture_events")).rows[0].count;assert.equal(countBefore,countAfter);evidence.restart={before:countBefore,after:countAfter,unchanged:true};
  // Separate bounded journal/context for budget exhaustion and dust closeout.
  const primary=session,primaryCampaign=campaign,budgetOut=join(out,"budget-browser");mkdirSync(budgetOut);session=await newSession(budgetOut);await session.connect();
  const small=await complete("create-campaign",{controller:creator,rewardPerUnit:units(5),walletCap:"30"});campaign=small.review.campaign;await session.lookup(campaign);
  await complete("approve-funding",{amountWei:units(6)});await complete("fund",{amountWei:units(6)});
  await complete("propose-collection",{collection:burn721.address,collectionCap:"40",collectionWalletCap:"30"});await advance();await complete("execute-collection");await complete("resume");
  await complete("approve-721",{collection:burn721.address,tokenId:"3"});await complete("redeem",{collection:burn721.address,tokenIds:["3"],quantities:["1"]});
  await session.fill("Exact token IDs","4");await session.reviewRejected("Review permanent NFT surrender",200,"unavailable");assert.ok(same(await read(burn721.address,nftAbi(burn721),"ownerOf",[4n]),creator));
  await session.capture("reclaim-insufficient-funded-reward");await complete("pause");await complete("propose-close");await advance();await complete("execute-close");
  await complete("propose-recovery",{amountWei:units(1)});await advance();const closed=await complete("execute-recovery");assert.equal(closed.verified.snapshot.reserve.availableWei,"0");assert.equal(closed.verified.snapshot.reserve.recoveredWei,units(1));
  assert.equal(await read(burn721.address,nftAbi(burn721),"exists",[3n]),false);evidence.budget={funded:units(6),paid:units(5),dustRecovered:units(1),nftPermanentlyRetired:true,unfundedNextSurrenderRejected:true,noticesEnforced:true};await session.capture("reclaim-closed-dust-recovered");await session.close();
  session=primary;campaign=primaryCampaign;await session.lookup(campaign);
  // 7702 code is installed on local Anvil only, never a live delegation change.
  const delegate=JSON.parse(gunzipSync(readFileSync(new URL("../../apps/launch-website/lib/server/claim-delegate-runtime.test.json.gz",import.meta.url)))).delegate;
  assert.equal(keccak256(delegate.code),delegate.runtimeHash);await rpc("anvil_setCode",[delegate.address,delegate.code]);await rpc("anvil_setCode",[creator,"0xef0100"+delegate.address.slice(2).toLowerCase()]);await mine();await ready();await session.lookup(campaign);
  const delegated=await complete("redeem",{collection:burn721.address,tokenIds:["2"],quantities:["1"]});assert.equal(delegated.review.kind,"metamask-7702");evidence.delegatedWallet={stateFixtureOnly:true,actualPermanentBurnAndExactReward:true};
  await rpc("anvil_setCode",[creator,"0x"]);await mine();await ready();
  // Same website, genuine 2-of-3 test-key signatures, actual Safe outer execution.
  await complete("propose-controller",{next:reclaimDeployment.safe});await advance();
  await safeComplete("accept-controller");await safeComplete("pause");await safeComplete("resume");
  await safeComplete("approve-funding",{amountWei:units(50)});await safeComplete("fund",{amountWei:units(50)});
  await safeComplete("approve-721",{collection:burn721.address,tokenId:"11"});
  const safeBefore=await read(m.rewardToken,erc20Abi,"balanceOf",[reclaimDeployment.safe]);
  const safeBurn=await safeComplete("redeem",{collection:burn721.address,tokenIds:["11"],quantities:["1"]},"lose");assert.equal(await read(m.rewardToken,erc20Abi,"balanceOf",[reclaimDeployment.safe]),safeBefore+BigInt(units(7)));assert.equal(await read(burn721.address,nftAbi(burn721),"exists",[11n]),false);
  await safeComplete("approve-721",{collection:sink721.address,tokenId:"11"});await safeComplete("redeem",{collection:sink721.address,tokenIds:["11"],quantities:["1"]});assert.ok(same(await read(sink721.address,nftAbi(sink721),"ownerOf",[11n]),m.permanentSink));
  await session.lookup(campaign);await session.layouts("reclaim-safe-permanent-complete");
  await restart();await session.page.reload();await session.page.locator('[data-reclaim-ready="true"]').waitFor();await session.connect();await session.lookup(campaign);await session.safeVerify({review:safeBurn.review,hash:safeBurn.submission.receipt.transactionHash,indexed:true});evidence.checks.safeJournalRestartNoNewSignatureOrDuplicate=true;
  // Reorg is last: preserve the orphaned original identity; never automatically retry it.
  await safeComplete("approve-1155",{collection:sink1155.address});
  const snapshot=await rpc("evm_snapshot"),dbBefore=(await pg.query("SELECT count(*)::int AS count FROM rmt_reclaim_v2_fixture_events")).rows[0].count,
   reserveBefore=await read(campaign,campaignAbi,"reserve"),tokenBefore=await read(m.rewardToken,erc20Abi,"balanceOf",[reclaimDeployment.safe]),supplyBefore=await read(sink1155.address,nftAbi(sink1155),"balanceOf",[reclaimDeployment.safe,103n]);
  const orphan=await safeComplete("redeem",{collection:sink1155.address,tokenIds:["103"],quantities:["1"]});const hash=orphan.submission.receipt.transactionHash;
  assert.equal(await rpc("evm_revert",[snapshot]),true);await mine();await ready();
  await waitFor("Permanent Reclaim canonical rollback",async()=> (await pg.query("SELECT count(*)::int AS count FROM rmt_reclaim_v2_fixture_events WHERE transaction_hash=$1",[hash.toLowerCase()])).rows[0].count===0);
  assert.equal((await pg.query("SELECT count(*)::int AS count FROM rmt_reclaim_v2_fixture_events")).rows[0].count,dbBefore);assert.equal(await read(campaign,campaignAbi,"reserve"),reserveBefore);assert.equal(await read(m.rewardToken,erc20Abi,"balanceOf",[reclaimDeployment.safe]),tokenBefore);assert.equal(await read(sink1155.address,nftAbi(sink1155),"balanceOf",[reclaimDeployment.safe,103n]),supplyBefore);
  const invalidated=await session.safeVerify({review:orphan.review,hash,status:"unavailable"});evidence.reorg={orphanHash:hash,canonicalRowsRemoved:true,allAssetAndReserveStateRolledBack:true,originalHashRetained:true,recoveryStatus:invalidated.status,noAutomaticRetry:true};
  evidence.unauthorizedReads=[];for(const headers of[{}, {"X-RMT-Fixture-Key":"00".repeat(32)}]){const r=await fetch(workerOrigin+"/reclaim-campaigns?campaign="+campaign,{headers});assert.equal(r.status,404);const b=await r.json();assert.equal(b.status,"unavailable");assert.equal(b.events,undefined);assert.match(r.headers.get("cache-control")??"",/private, no-store/);evidence.unauthorizedReads.push({status:r.status,noRecords:true});}
  evidence.database={campaigns:(await pg.query("SELECT payload FROM rmt_reclaim_v2_fixture_campaigns")).rows,events:(await pg.query("SELECT payload FROM rmt_reclaim_v2_fixture_events ORDER BY block_number,log_index")).rows,checkpoints:(await pg.query("SELECT block_number,block_hash FROM rmt_curve_fixture_checkpoints ORDER BY block_number DESC LIMIT 3")).rows};
  evidence.status="passed";save();await session.close();return evidence;
 }catch(error){evidence.failure=error instanceof Error?error.stack:String(error);save();await session.diagnose(error);await session.context.close();throw error;}
}
