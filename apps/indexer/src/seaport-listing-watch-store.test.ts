import test from "node:test";
import assert from "node:assert/strict";
import type {Client} from "pg";
import {createSeaportListingWatchStore} from "./seaport-listing-watch-store.js";
import type {SeaportVaultManifest} from "./seaport-acquisition-types.js";
const h="0x"+"12".repeat(32),m={profile:"rmt-seaport-acquisition-local-v2",chainId:31337}as SeaportVaultManifest;
function mock(){
 let payload:unknown,revision="0";const calls:string[]=[],config={name:"rmt_seaport_fixture_abcdef0123",version:"18.6",lease:true,bound:true};
 const db={async query(sql:string,args:unknown[]=[]){calls.push(sql);
  if(sql.includes("current_database"))return{rows:[{name:config.name,version:config.version}],rowCount:1};
  if(sql.includes("pg_locks"))return{rows:config.lease?[{}]:[],rowCount:config.lease?1:0};
  if(sql.startsWith("SELECT 1 FROM rmt_seaport_v2_binding"))return{rows:config.bound?[{}]:[],rowCount:config.bound?1:0};
  if(sql.startsWith("CREATE"))return{rows:[],rowCount:0};
  if(sql.startsWith("INSERT")){payload??=JSON.parse(String(args[1]));return{rows:[],rowCount:0};}
  if(sql.startsWith("SELECT binding_hash"))return{rows:[{binding_hash:h,revision,payload}],rowCount:1};
  if(sql.startsWith("UPDATE")){if(String(args[3])!==revision)return{rows:[],rowCount:0};revision=String(args[0]);payload=JSON.parse(String(args[1]));return{rows:[{id:1}],rowCount:1};}
  throw Error("Unexpected query");
 }};
 return{db:db as unknown as Client,config,calls};
}
test("watch persistence rejects production name, version, lease and deployment mismatch before CREATE",async()=>{
 for(const change of[{name:"production"},{version:"17.7"},{lease:false},{bound:false}]){const f=mock();Object.assign(f.config,change);await assert.rejects(createSeaportListingWatchStore(f.db,m,h));assert.equal(f.calls.some(s=>s.startsWith("CREATE")),false);}
});
test("one private writer persists exact watch identity and atomically rejects a stale revision",async()=>{
 const f=mock(),store=await createSeaportListingWatchStore(f.db,m,h),first=await store.load(h);assert.equal(first.revision,0);assert.deepEqual(first.records,[]);
 const next={...first,revision:1,lastPollAtMs:1,records:[{orderHash:"0x"+"34".repeat(32),status:"PREPARED"}]};assert.equal(await store.commit(0,next),true);assert.equal(await store.commit(0,next),false);assert.deepEqual(await store.load(h),next);
 await assert.rejects(store.load("0x"+"99".repeat(32)));f.config.lease=false;await assert.rejects(store.load(h));
});
