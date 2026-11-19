import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {writeFileSync,readFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";
import {localFixtureClient,transact,receiptEvidence} from "../../packages/contracts/scripts/deploy-fixed-supply-fixture.mjs";
import {createReclaimBrowserSession} from "./browser-integration.mjs";

const require=createRequire(new URL("../../apps/launch-website/package.json",import.meta.url));
const{erc20Abi,keccak256,parseEventLogs,toHex}=require("viem");
const json=v=>JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x,2)+"\n";
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();

/** Acceptance uses the new /reclaim page, its actual reviewed calldata, real
 * synthetic-chain receipts and the existing single PostgreSQL checkpoint writer.
 * Fork time changes are local notice tests, never a production timelock bypass. */
export async function testReclaimJourney({browserEngine,rpcUrl,rpc,reclaimCompilation,reclaimDeployment,creatorAccount,
  sourceIdentity,site,workerOrigin,indexReadKey,out,pg,waitFor,mine,ready,restart,hideReceipt}){
  const client=await localFixtureClient(rpcUrl,31337),m=reclaimDeployment.module,creator=creatorAccount.address;
  assert.equal(await client.getChainId(),31337);assert.equal(new URL(site).hostname,"127.0.0.1");
  const campaignAbi=reclaimCompilation.artifacts.RMTReclaimCampaignV1.abi;
  const factoryAbi=reclaimCompilation.artifacts.RMTReclaimFactoryV1.abi;
  const [nft721,nft1155]=m.collections;
  const read=(address,abi,functionName,args=[])=>client.readContract({address,abi,functionName,args});
  const send=async(from,request,expected="success")=>{
    assert.ok(same(from,creator));return reclaimDeployment.send(request,expected,creatorAccount);
  };
  const evidence={schemaVersion:1,profile:"rmt-reclaim-integrated-acceptance-v1",scope:"LOCAL_SYNTHETIC_31337_NOT_PRODUCTION_OR_PHYSICAL_PHONE",
    status:"incomplete",chainId:31337,sourceIdentity,compiler:reclaimCompilation.manifest,deployment:m,
    nominalModel:{liveUsdReference:false,assumedSyntheticTokenUsd:"0.01",illustrativeUsdReserve:"20",illustrativeUsdReward:"0.05",
      actualReserveUnits:"2000",actualRewardPerUnit:"5",modelOnly:true},checks:{},canonicalReceipts:[]};
  const save=()=>writeFileSync(join(out,"reclaim-acceptance.json"),json(evidence));
  const post=async body=>{const r=await fetch(site+"/api/launchpad/test-reclaim",{method:"POST",headers:{Origin:site,"Content-Type":"application/json"},body:json(body),signal:AbortSignal.timeout(15_000)});return{status:r.status,body:await r.json()};};
  const worker=async(path)=>{const r=await fetch(workerOrigin+path,{headers:{"X-RMT-Fixture-Key":indexReadKey},signal:AbortSignal.timeout(10_000)});return{status:r.status,body:await r.json()};};
  const event=(receipt,address,abi,name)=>{const logs=parseEventLogs({abi,eventName:name,strict:true,logs:receipt.logs.filter(l=>same(l.address,address))});assert.equal(logs.length,1,name);return logs[0].args;};
  const advance=async()=>{await rpc("evm_increaseTime",[2*86400+1]);await mine();await ready();};
  let session=await createReclaimBrowserSession({browserEngine,site,out,rpc,client,creator,send,mine,ready,hideReceipt});
  let campaign;
  async function complete(operation,fields={},decision="normal"){
    const {review}=await session.action(operation,fields),submission=await session.confirm(decision);
    if(decision==="reject")return{review,submission};
    await mine();await ready();const verified=await session.verify({review,hash:submission.receipt.transactionHash,indexed:true});
    const receipt=await client.getTransactionReceipt({hash:submission.receipt.transactionHash});
    evidence.canonicalReceipts.push({operation,reviewHash:review.reviewHash,...submission.receipt,
      effectiveGasPrice:receipt.effectiveGasPrice.toString(),syntheticExecutionCostWei:(receipt.gasUsed*receipt.effectiveGasPrice).toString(),
      productionCostQuote:false,l1DataCost:"not-applicable-to-local-31337"});save();return{review,submission,verified};
  }
  try{
    await session.connect();
    const first=await session.action("create-campaign",{controller:creator,rewardPerUnit:(5n*10n**18n).toString(),walletCap:"20"});
    assert.equal(first.review.request.value,"0x0");assert.equal(first.review.fields.rewardPerUnit,(5n*10n**18n).toString());
    await session.confirm("reject");assert.equal(session.evidence.sends.length,0);evidence.checks.walletRejectionNoSubmission=true;
    const created=await complete("create-campaign",{controller:creator,rewardPerUnit:(5n*10n**18n).toString(),walletCap:"20"});
    campaign=created.review.campaign;evidence.campaign=campaign;
    const creationReceipt=await client.getTransactionReceipt({hash:created.submission.receipt.transactionHash});
    const birth=event(creationReceipt,m.reclaimFactory,factoryAbi,"CampaignCreated");assert.ok(same(birth.campaign,campaign));
    assert.equal(await read(campaign,campaignAbi,"paused"),true);assert.equal(await read(campaign,campaignAbi,"reserve"),0n);
    await session.lookup(campaign);
    await complete("approve-funding",{amountWei:(2000n*10n**18n).toString()});
    const funded=await complete("fund",{amountWei:(2000n*10n**18n).toString()});
    assert.equal(funded.verified.snapshot.reserve.availableWei,(2000n*10n**18n).toString());
    for(const nft of[nft721,nft1155]){
      await session.selectCollection(nft.address);
      await complete("propose-collection",{collection:nft.address,collectionCap:"30",collectionWalletCap:"20"});
      const early=await post({action:"prepare",operation:"execute-collection",account:creator,campaign,fields:{}});
      assert.notEqual(early.body.status,"prepared");await advance();
      await complete("execute-collection");
    }
    await complete("resume");
    await session.selectCollection(nft721.address);await session.fill("Exact token IDs","1");await session.fill("Quantities in matching order","1");
    await complete("approve-721",{collection:nft721.address,tokenId:"1"});
    const beforeToken=await read(m.rewardToken,erc20Abi,"balanceOf",[creator]);
    const accepted=await complete("redeem",{collection:nft721.address,tokenIds:["1"],quantities:["1"]});
    assert.equal(await read(m.rewardToken,erc20Abi,"balanceOf",[creator]),beforeToken+5n*10n**18n);
    assert.equal(accepted.verified.settlement.rewardWei,(5n*10n**18n).toString());
    const receiptId=accepted.verified.settlement.receiptId??"1";assert.equal(receiptId,"1");
    evidence.checks.atomic721RewardAndEscrow=true;
    await session.selectCollection(nft1155.address);await session.fill("Exact token IDs","101, 102");await session.fill("Quantities in matching order","2, 3");
    await complete("approve-1155",{collection:nft1155.address});
    const batch=await complete("redeem",{collection:nft1155.address,tokenIds:["101","102"],quantities:["2","3"]});
    assert.equal(batch.verified.settlement.rewardWei,(25n*10n**18n).toString());
    await complete("revoke-1155",{collection:nft1155.address});evidence.checks.atomic1155BatchAndExplicitRevocation=true;
    await session.layouts("reclaim-active");await session.desktopRead(campaign);
    await complete("pause");
    await complete("propose-rate",{rewardPerUnit:(7n*10n**18n).toString()});await advance();await complete("execute-rate");
    await complete("approve-return",{receiptId:"1"});
    const returned=await complete("return",{receiptId:"1"});assert.equal(returned.verified.settlement.rewardWei,(5n*10n**18n).toString());
    assert.equal(Number(await read(campaign,campaignAbi,"walletClaimed",[creator])),6);evidence.checks.originalRewardReturnAfterRateChangeAndCapsNeverReset=true;
    await complete("resume");
    await session.selectCollection(nft721.address);await session.fill("Exact token IDs","2");await session.fill("Quantities in matching order","1");
    const lost=await session.action("approve-721",{collection:nft721.address,tokenId:"2"});
    const missing=await session.confirm("lose");await mine();
    const pending=await session.verify({review:lost.review,status:"pending"});assert.ok(!pending.indexed);
    hideReceipt(undefined);await ready();
    const recovered=await session.verify({review:lost.review,indexed:true});assert.equal(recovered.transactionHash,missing.receipt.transactionHash);
    evidence.checks.missingHashAndReceiptRecoveredWithoutDuplicate=true;
    const beforeRestart=await worker("/reclaim-campaigns?campaign="+campaign);assert.equal(beforeRestart.status,200);
    const dbBefore=(await pg.query("SELECT count(*)::int AS count FROM rmt_reclaim_fixture_events")).rows[0].count;
    await restart();await session.page.reload();await session.page.locator('[data-reclaim-ready="true"]').waitFor();await session.connect();await session.lookup(campaign);
    const afterRestart=await worker("/reclaim-campaigns?campaign="+campaign);assert.equal(afterRestart.status,200);
    const dbAfter=(await pg.query("SELECT count(*)::int AS count FROM rmt_reclaim_fixture_events")).rows[0].count;
    assert.equal(dbBefore,dbAfter);evidence.restart={before:dbBefore,after:dbAfter,unchanged:true};
    // Keep the first browser's original bounded recovery journal intact. A
    // second independent browser session tests a deliberately tiny campaign;
    // both use the same real application and canonical database, not API mocks.
    const primaryCampaign=campaign,primarySession=session,budgetOut=join(out,"budget-browser");mkdirSync(budgetOut);
    session=await createReclaimBrowserSession({browserEngine,site,out:budgetOut,rpc,client,creator,send,mine,ready,hideReceipt});await session.connect();
    const budgetCreated=await complete("create-campaign",{controller:creator,rewardPerUnit:(5n*10n**18n).toString(),walletCap:"20"});
    campaign=budgetCreated.review.campaign;assert.ok(!same(campaign,primaryCampaign));await session.lookup(campaign);
    await complete("approve-funding",{amountWei:(5n*10n**18n).toString()});await complete("fund",{amountWei:(5n*10n**18n).toString()});
    await session.selectCollection(nft721.address);await complete("propose-collection",{collection:nft721.address,collectionCap:"30",collectionWalletCap:"20"});
    await advance();await complete("execute-collection");await complete("resume");
    await complete("approve-721",{collection:nft721.address,tokenId:"1"});
    const exhausted=await complete("redeem",{collection:nft721.address,tokenIds:["1"],quantities:["1"]});
    assert.equal(exhausted.verified.snapshot.reserve.availableWei,"0");
    await session.capture("reclaim-budget-exhausted");
    await session.fill("Exact token IDs","3");await session.fill("Quantities in matching order","1");
    await session.reviewRejected("Review NFT trade-in",200,"unavailable");
    const denied=await post({action:"prepare",operation:"propose-collection",account:creator,campaign,fields:{collection:reclaimDeployment.hostile721,collectionCap:"1",collectionWalletCap:"1",expiresAt:((await client.getBlock()).timestamp+3n*86400n).toString()}});
    assert.equal(denied.body.status,"unavailable");
    evidence.budgetExhaustion={campaign,fundedWei:(5n*10n**18n).toString(),paidWei:(5n*10n**18n).toString(),remainingWei:"0",nextTradeRejected:true,unsupportedCollectionRejected:true};
    await complete("pause");await complete("propose-close");await advance();await complete("execute-close");
    await complete("approve-return",{receiptId:"1"});await complete("return",{receiptId:"1"});
    await complete("propose-recovery",{amountWei:(5n*10n**18n).toString()});await advance();
    const closeout=await complete("execute-recovery");
    assert.equal(closeout.verified.snapshot.reserve.availableWei,"0");assert.equal(closeout.verified.snapshot.reserve.recoveredWei,(5n*10n**18n).toString());
    evidence.budgetExhaustion.closeout={returnedOriginalNFT:true,repaidWei:(5n*10n**18n).toString(),recoveredWei:(5n*10n**18n).toString(),noticesEnforced:true};
    await session.capture("reclaim-closed-reserve-recovered");
    await session.ownerOpen();const journalCount=await session.page.evaluate(()=>JSON.parse(localStorage.getItem("rmt.reclaim.pending.v1:index")??"[]").length);
    await session.page.getByRole("button",{name:"Start another campaign",exact:true}).click();
    assert.equal(await session.page.evaluate(()=>JSON.parse(localStorage.getItem("rmt.reclaim.pending.v1:index")??"[]").length),journalCount);
    evidence.budgetExhaustion.explicitNewIntentPreservesJournals=true;await session.close();
    session=primarySession;campaign=primaryCampaign;await session.lookup(campaign);
    // Delegation is test state only. It does not authorize a live delegation change.
    const delegate=JSON.parse(gunzipSync(readFileSync(new URL("../../apps/launch-website/lib/server/claim-delegate-runtime.test.json.gz",import.meta.url)))).delegate;
    assert.equal(keccak256(delegate.code),delegate.runtimeHash);await rpc("anvil_setCode",[delegate.address,delegate.code]);
    await rpc("anvil_setCode",[creator,"0xef0100"+delegate.address.slice(2).toLowerCase()]);await mine();await ready();
    await session.lookup(campaign);
    const delegated=await complete("pause");assert.equal(delegated.review.kind,"metamask-7702");
    evidence.delegatedWallet={profile:"pinned-metamask-7702",stateFixtureOnly:true,administrativeCallVerified:true,nftReceiverAcceptance:"not-yet-observed"};
    // No wallet capability is inferred from code installation. Record the actual
    // collection receiver response without substituting an EOA fallback.
    await complete("approve-return",{receiptId:"2"});
    const nftReturn=await post({action:"prepare",operation:"return",account:creator,campaign,fields:{receiptId:"2"}});
    evidence.delegatedWallet.batchReturnPreparation={status:nftReturn.status,result:nftReturn.body.status};
    if(nftReturn.body.status==="prepared"){
      const actual=await complete("return",{receiptId:"2"});assert.equal(actual.verified.settlement.receiptId,"2");
      evidence.delegatedWallet.nftReceiverAcceptance="actual-ERC1155-batch-return-confirmed";
    }else{
      assert.equal(nftReturn.body.status,"unavailable");
      evidence.delegatedWallet.nftReceiverAcceptance="unsupported-by-exact-return-simulation-no-submission";
    }
    await rpc("anvil_setCode",[creator,"0x"]);await mine();await ready();
    await restart();await session.lookup(campaign);
    const {testReclaimSafe}=await import("./safe-integration.mjs");
    evidence.safe=await testReclaimSafe({client,rpc,send,creatorAccount,campaign,module:m,compilation:reclaimCompilation,assets:reclaimDeployment.assetArtifacts,
      mine,ready,workerOrigin,indexReadKey,out,waitFor});
    await session.lookup(campaign);await session.layouts("reclaim-complete");
    // Keep an unresolved original transaction intact. Its recovery guard must
    // block later submissions, so perform this final state transition only
    // after the normal wallet/Safe journeys and their screenshots are complete.
    const orphanSnapshot=await rpc("evm_snapshot"),beforeReorg=(await pg.query("SELECT count(*)::int AS count FROM rmt_reclaim_fixture_events")).rows[0].count;
    const reserveBeforeReorg=await read(campaign,campaignAbi,"reserve"),tokenBeforeReorg=await read(m.rewardToken,erc20Abi,"balanceOf",[creator]);
    const orphan=await complete("redeem",{collection:nft721.address,tokenIds:["2"],quantities:["1"]});
    const orphanHash=orphan.submission.receipt.transactionHash;
    assert.equal(await rpc("evm_revert",[orphanSnapshot]),true);await mine();await ready();
    await waitFor("Reclaim canonical rollback",async()=>{const r=await pg.query("SELECT count(*)::int AS count FROM rmt_reclaim_fixture_events WHERE transaction_hash=$1",[orphanHash.toLowerCase()]);return r.rows[0].count===0;});
    assert.equal((await pg.query("SELECT count(*)::int AS count FROM rmt_reclaim_fixture_events")).rows[0].count,beforeReorg);
    assert.equal(await read(campaign,campaignAbi,"reserve"),reserveBeforeReorg);assert.equal(await read(m.rewardToken,erc20Abi,"balanceOf",[creator]),tokenBeforeReorg);
    assert.ok(same(await read(nft721.address,reclaimDeployment.assetArtifacts.Reclaim721Fixture.abi,"ownerOf",[2n]),creator));
    const invalidated=await session.verify({review:orphan.review,hash:orphanHash,status:"unavailable"});
    evidence.reorg={orphanHash,removed:true,recoveryStatus:invalidated.status,originalJournalRetained:true,noAutomaticSubmission:true,
      limitation:"A disappeared transaction alone cannot independently prove a reorg; the journal stays unavailable while the canonical index rolls back"};
    const deniedReads=[];
    for(const headers of[{}, {"X-RMT-Fixture-Key":"00".repeat(32)}]){
      const auth=await fetch(workerOrigin+"/reclaim-campaigns?campaign="+campaign,{headers});
      assert.equal(auth.status,404,"Existing fixture API deliberately conceals unauthenticated routes");
      const body=await auth.json();assert.equal(body.status,"unavailable");assert.deepEqual(body.launches,[]);
      assert.equal(body.campaigns,undefined);assert.equal(body.events,undefined);assert.match(auth.headers.get("cache-control")??"",/private, no-store/);
      deniedReads.push({status:auth.status,unavailable:true,noRecords:true});
    }
    evidence.checks.authenticatedHistory=true;evidence.unauthorizedReads=deniedReads;
    evidence.database={campaigns:(await pg.query("SELECT payload FROM rmt_reclaim_fixture_campaigns")).rows,events:(await pg.query("SELECT payload FROM rmt_reclaim_fixture_events ORDER BY block_number,log_index")).rows,
      checkpoints:(await pg.query("SELECT block_number,block_hash FROM rmt_curve_fixture_checkpoints ORDER BY block_number DESC LIMIT 3")).rows};
    evidence.status="passed";save();await session.close();return evidence;
  }catch(error){evidence.failure=error instanceof Error?error.stack:String(error);save();await session.diagnose(error);await session.context.close();throw error;}
}
