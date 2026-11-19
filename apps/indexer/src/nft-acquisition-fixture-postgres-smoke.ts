import assert from "node:assert/strict";
import type {Client} from "pg";
import type {Address,Hash} from "viem";
import {commitCurveFixtureRange,curveScope,rollbackCurveFixture} from "./curve-fixture-store.js";
import type {BlockEvidence,CurveFixtureBinding} from "./curve-launch-evidence.js";
import {initializeNftAcquisitionStore,commitNftAcquisitionRange,readNftAcquisitionStore,nftAcquisitionTables} from "./nft-acquisition-fixture-store.js";
import type {NftAcquisitionModule,NftAcquisitionEvent,NftAcquisitionState} from "./nft-acquisition-fixture-types.js";

const a=(n:number)=>`0x${((1n<<156n)+BigInt(n)).toString(16).padStart(40,"0")}` as Address;
const h=(n:number)=>`0x${n.toString(16).padStart(64,"0")}` as Hash;
/** The caller must first establish its existing isolated DB marker and held
 * writer lease. Synthetic persistence rows are not blockchain execution proof. */
export async function testNftAcquisitionPostgres(writer:Client,competing:Client,binding:CurveFixtureBinding,checkpoint:BlockEvidence){
 const scope=curveScope(binding),height=BigInt(checkpoint.blockNumber)+1n,point={blockNumber:height.toString(),blockHash:h(981001),timestamp:new Date(Date.parse(checkpoint.timestamp)+1000).toISOString()};
 const module:NftAcquisitionModule={schemaVersion:1,profile:"rmt-nft-acquisition-local-v1",chainId:31337,coreFactory:binding.factory,coreFactoryRuntimeHash:binding.factoryRuntimeHash,
  factory:a(981002),factoryRuntimeHash:h(981003),venue:a(981004),venueRuntimeHash:h(981005),paymentToken:a(981006),paymentTokenRuntimeHash:h(981007),projectToken:a(981008),creator:a(981009),vault:a(981010),vaultRuntimeHash:h(981011),collections:[{address:a(981012),standard:721,runtimeHash:h(981013),sourceInputSha256:h(981014),name:"Synthetic persistence collection"}],deployment:{...checkpoint,transactionHash:h(981015)},compilerInputSha256:"a".repeat(64)};
 await assert.rejects(initializeNftAcquisitionStore(writer,[4663,scope[1],scope[2]],module),/Fixture NFT acquisition persistence unavailable or conflicting/);
 await assert.rejects(initializeNftAcquisitionStore(writer,[31337,a(981099),scope[2]],module),/Fixture NFT acquisition persistence unavailable or conflicting/);
 await initializeNftAcquisitionStore(writer,scope,module);await initializeNftAcquisitionStore(writer,scope,module);
 await assert.rejects(initializeNftAcquisitionStore(competing,scope,module),/database_writer_conflict/);
 await assert.rejects(initializeNftAcquisitionStore(writer,scope,{...module,venueRuntimeHash:h(981099)}),/Fixture NFT acquisition persistence unavailable or conflicting/);
 const event:NftAcquisitionEvent={...point,vault:module.vault,projectToken:module.projectToken,transactionHash:h(981020),logIndex:1,eventName:"PurchaseExecuted",args:{orderHash:h(981021),quantity:"1",totalCost:"10"},settlement:{kind:"purchase",evidence:"canonical-receipt-and-exact-local-call-trace",orderHash:h(981021),collection:module.collections[0]!.address,tokenId:"42",quantity:"1",currency:module.paymentToken,totalCost:"10",custody:module.vault}};
 const state:NftAcquisitionState={...point,vault:module.vault,projectToken:module.projectToken,controller:module.creator,controllerEpoch:"1",policyEpoch:"2",enabled:false,policy:{currency:module.paymentToken,perNftCap:"10",totalBudget:"20",periodBudget:"20",cooldownSeconds:5},nativeBalance:"0",paymentBalance:"10"};
 const empty={blocks:[],launches:[],trades:[],graduations:[],postEvents:[],states:[]},range={...empty,blocks:[point]};
 const count=async(table:typeof nftAcquisitionTables[number])=>(await writer.query<{n:number}>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;
 await writer.query("ALTER TABLE rmt_nft_acquisition_fixture_events ADD CONSTRAINT task081_atomic_module_interruption CHECK(log_index<>99)");
 try{await assert.rejects(commitCurveFixtureRange(writer,scope,range,db=>commitNftAcquisitionRange(db,scope,module,{events:[event,{...event,transactionHash:h(981022),logIndex:99}],states:[state]})),/task081_atomic_module_interruption/);}finally{await writer.query("ALTER TABLE rmt_nft_acquisition_fixture_events DROP CONSTRAINT task081_atomic_module_interruption");}
 assert.equal((await writer.query("SELECT count(*)::int AS n FROM rmt_curve_fixture_checkpoints WHERE block_number=$1",[height.toString()])).rows[0]?.n,0);assert.equal(await count(nftAcquisitionTables[1]),0);assert.equal(await count(nftAcquisitionTables[2]),0);
 await commitCurveFixtureRange(writer,scope,range,db=>commitNftAcquisitionRange(db,scope,module,{events:[event],states:[state]}));
 await commitCurveFixtureRange(writer,scope,empty,db=>commitNftAcquisitionRange(db,scope,module,{events:[event,event],states:[state]}));assert.equal(await count(nftAcquisitionTables[1]),1);assert.equal(await count(nftAcquisitionTables[2]),1);
 for(const invalid of[{...event,args:{...event.args,totalCost:"999"}},{...event,vault:a(981099)},{...event,projectToken:a(981099)}])await assert.rejects(commitCurveFixtureRange(writer,scope,empty,db=>commitNftAcquisitionRange(db,scope,module,{events:[invalid],states:[]})),/Fixture NFT acquisition persistence unavailable or conflicting/);
 await assert.rejects(commitCurveFixtureRange(writer,scope,empty,db=>commitNftAcquisitionRange(db,scope,module,{events:[],states:[{...state,paymentBalance:"999"}]})),/Fixture NFT acquisition persistence unavailable or conflicting/);
 await assert.rejects(commitCurveFixtureRange(writer,scope,empty,db=>commitNftAcquisitionRange(db,scope,module,{events:Array(513).fill(event),states:[]})),/Fixture NFT acquisition persistence unavailable or conflicting/);
 await assert.rejects(commitCurveFixtureRange(writer,scope,empty,db=>commitNftAcquisitionRange(db,scope,module,{events:[],states:[state,state]})),/Fixture NFT acquisition persistence unavailable or conflicting/);
 const observed=await readNftAcquisitionStore(competing,scope,module,point,{vault:module.vault});assert.equal(observed.events.length,1);assert.equal(observed.states[0].paymentBalance,"10");assert.equal(observed.productionExecution,false);assert.equal(observed.checkpoint.l1Finality,"not-applicable");
 assert.equal((await readNftAcquisitionStore(writer,scope,module,point,{transaction:event.transactionHash})).events.length,1);
 assert.equal((await readNftAcquisitionStore(writer,scope,module,point,{transaction:h(981099)})).events.length,0);
 await assert.rejects(readNftAcquisitionStore(writer,scope,module,point,{vault:module.vault,transaction:event.transactionHash}),/Fixture NFT acquisition persistence unavailable or conflicting/);
 await assert.rejects(readNftAcquisitionStore(writer,scope,module,point,{vault:a(981099)}),/Fixture NFT acquisition persistence unavailable or conflicting/);
 await assert.rejects(readNftAcquisitionStore(writer,[scope[0],scope[1],h(981099)],module,point,{}),/Fixture NFT acquisition persistence unavailable or conflicting/);
 await assert.rejects(readNftAcquisitionStore(writer,scope,module,{...point,blockHash:h(981099)},{}),/Fixture NFT acquisition persistence unavailable or conflicting/);
 await rollbackCurveFixture(writer,scope,BigInt(checkpoint.blockNumber));assert.equal(await count(nftAcquisitionTables[1]),0);assert.equal(await count(nftAcquisitionTables[2]),0);assert.equal(await count(nftAcquisitionTables[0]),1,"Immutable fixture identity survives canonical rollback");
 await assert.rejects(readNftAcquisitionStore(writer,scope,module,point,{}),/Fixture NFT acquisition persistence unavailable or conflicting/);
 const replacement={...point,blockHash:h(981100)};await commitCurveFixtureRange(writer,scope,{...range,blocks:[replacement]},db=>commitNftAcquisitionRange(db,scope,module,{events:[{...event,blockHash:replacement.blockHash}],states:[{...state,blockHash:replacement.blockHash}]}));
 assert.equal((await readNftAcquisitionStore(competing,scope,module,replacement,{})).events[0].blockHash,replacement.blockHash);
 await rollbackCurveFixture(writer,scope,BigInt(checkpoint.blockNumber));
 console.info("NFT acquisition PostgreSQL: actual duplicate/conflict, exclusive lease, shared transaction rollback, reconnect reads, scope rejection and reorg checkpoint cascade passed (synthetic persistence rows only).");
}
