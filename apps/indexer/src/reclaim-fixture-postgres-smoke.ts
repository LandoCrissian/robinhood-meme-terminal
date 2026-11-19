import assert from "node:assert/strict";
import type {Client} from "pg";
import {keccak256,type Address,type Hash} from "viem";
import {commitCurveFixtureRange,curveScope,rollbackCurveFixture} from "./curve-fixture-store.js";
import type {BlockEvidence,CurveFixtureBinding} from "./curve-launch-evidence.js";
import type {ReclaimFixtureModule,ReclaimFixtureBirth,ReclaimFixtureEvent,ReclaimFixtureSnapshot} from "./reclaim-fixture-types.js";
import {initializeReclaimFixtureStore,commitReclaimFixtureRange,readReclaimFixture} from "./reclaim-fixture-store.js";

const a=(n:number)=>`0x${((1n<<156n)+BigInt(n)).toString(16).padStart(40,"0")}` as Address;
const h=(n:number)=>`0x${n.toString(16).padStart(64,"0")}` as Hash;
/** Persistence-shaped synthetic data only; real receipt/custody execution is
 * exercised separately by the isolated full browser lifecycle. */
export async function testReclaimFixturePostgres(writer:Client,competing:Client,binding:CurveFixtureBinding,checkpoint:BlockEvidence){
  const scope=curveScope(binding),height=BigInt(checkpoint.blockNumber)+1n;
  const point={blockNumber:height.toString(),blockHash:h(978100),timestamp:new Date(Date.parse(checkpoint.timestamp)+1000).toISOString()};
  const module:ReclaimFixtureModule={schemaVersion:1,profile:"rmt-reclaim-v1",chainId:31337,
    reclaimFactory:a(978001),factoryRuntimeHash:h(978002),coreFactory:binding.factory,coreFactoryRuntimeHash:binding.factoryRuntimeHash,
    rewardToken:a(978003),rewardTokenRuntimeHash:h(978004),campaignCreationCode:"0x6000",campaignCreationCodeHash:keccak256("0x6000"),
    campaignRuntimeTemplate:"0x6000",campaignImmutableReferences:{},campaignImmutableNames:{},collections:[],compilerInputSha256:"a".repeat(64),
    deployment:{transactionHash:h(978005),blockNumber:checkpoint.blockNumber,blockHash:checkpoint.blockHash}};
  await initializeReclaimFixtureStore(writer,scope,module);
  await assert.rejects(initializeReclaimFixtureStore(competing,scope,module),/database_writer_conflict/);
  const birth:ReclaimFixtureBirth={campaign:a(978010),creator:a(978011),controller:a(978011),intentId:h(978012),
    rewardToken:module.rewardToken,rewardTokenRuntimeHash:module.rewardTokenRuntimeHash,runtimeHash:h(978013),initialRewardPerUnit:"5",walletCap:4,
    deployment:{...point,transactionHash:h(978014),logIndex:0}};
  const event:ReclaimFixtureEvent={...point,campaign:birth.campaign,transactionHash:h(978015),logIndex:1,eventName:"TradeInAccepted",
    args:{receiptId:"1",claimant:a(978020),collection:a(978021),standard:1,ids:["42"],quantities:["1"],reward:"5",policyEpoch:"3",claimantNonce:"0"},
    settlement:{kind:"trade-in",rewardToken:module.rewardToken,from:birth.campaign,to:a(978020),amount:"5",receiptId:"1",claimant:a(978020),
      collection:a(978021),standard:1,tokenIds:["42"],quantities:["1"],evidence:"exact-receipt-transfer-and-single-transaction-block-deltas"}};
  const state:ReclaimFixtureSnapshot={...point,campaign:birth.campaign,controller:birth.controller,controllerEpoch:"1",policyEpoch:"3",rewardPerUnit:"5",walletCap:4,
    paused:false,closed:false,reserve:"995",funded:"1000",paid:"5",repaid:"0",recovered:"0",unsolicited:"0",outstandingLiability:"0",rewardBalance:"995",tradeInNonce:"1",collections:[]};
  const empty={blocks:[],launches:[],trades:[],graduations:[],postEvents:[],states:[]};
  const range={...empty,blocks:[point]};
  await writer.query("ALTER TABLE rmt_reclaim_fixture_events ADD CONSTRAINT task078_atomic_module_interruption CHECK(log_index<>99)");
  try{await assert.rejects(commitCurveFixtureRange(writer,scope,range,db=>commitReclaimFixtureRange(db,scope,module,
    {births:[birth],events:[event,{...event,transactionHash:h(978016),logIndex:99}],states:[state]})),/task078_atomic_module_interruption/);
  }finally{await writer.query("ALTER TABLE rmt_reclaim_fixture_events DROP CONSTRAINT task078_atomic_module_interruption");}
  const count=async(table:string)=>(await writer.query<{n:number}>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;
  assert.equal((await writer.query("SELECT count(*)::int AS n FROM rmt_curve_fixture_checkpoints WHERE block_number=$1",[height.toString()])).rows[0]?.n,0);
  for(const table of ["rmt_reclaim_fixture_campaigns","rmt_reclaim_fixture_events","rmt_reclaim_fixture_states"])assert.equal(await count(table),0);
  await commitCurveFixtureRange(writer,scope,range,db=>commitReclaimFixtureRange(db,scope,module,{births:[birth],events:[event],states:[state]}));
  await commitCurveFixtureRange(writer,scope,empty,db=>commitReclaimFixtureRange(db,scope,module,{births:[birth],events:[event,event],states:[state]}));
  for(const table of ["rmt_reclaim_fixture_campaigns","rmt_reclaim_fixture_events","rmt_reclaim_fixture_states"])assert.equal(await count(table),1);
  await assert.rejects(commitCurveFixtureRange(writer,scope,empty,db=>commitReclaimFixtureRange(db,scope,module,
    {births:[],events:[{...event,args:{...event.args,reward:"999"}}],states:[]})),/evidence/);
  await assert.rejects(commitCurveFixtureRange(writer,scope,empty,db=>commitReclaimFixtureRange(db,scope,module,
    {births:[],events:[],states:[{...state,reserve:"999"}]})),/evidence/);
  const observed=await readReclaimFixture(writer,scope,module,point,{campaign:birth.campaign});
  assert.equal(observed.campaigns.length,1);assert.equal(observed.states[0]?.reserve,"995");assert.equal(observed.events[0]?.settlement?.amount,"5");
  const activity=await readReclaimFixture(writer,scope,module,point,{transaction:event.transactionHash});assert.equal(activity.events.length,1);
  await rollbackCurveFixture(writer,scope,BigInt(checkpoint.blockNumber));
  for(const table of ["rmt_reclaim_fixture_campaigns","rmt_reclaim_fixture_events","rmt_reclaim_fixture_states"])assert.equal(await count(table),0);
  await assert.rejects(readReclaimFixture(writer,scope,module,point,{campaign:birth.campaign}),/evidence/);
  console.info("Reclaim PostgreSQL shared checkpoint atomic rollback, lease, duplicate/conflict and reorg cascade passed.");
}
