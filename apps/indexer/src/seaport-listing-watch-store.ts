import type {Client} from "pg";
import {assertSeaportVaultWriter} from "./seaport-acquisition-store.js";
import type {SeaportVaultManifest} from "./seaport-acquisition-types.js";
type WatchState={bindingHash:string;revision:number;lastPollAtMs:number;records:Array<Record<string,unknown>>};
const need=(v:unknown)=>{if(!v)throw Error("Private Seaport watcher store unavailable or conflicting");};
export async function createSeaportListingWatchStore(db:Client,m:SeaportVaultManifest,bindingHash:string){
 need(m.profile==="rmt-seaport-acquisition-local-v2"&&m.chainId===31337&&/^0x[a-f0-9]{64}$/i.test(bindingHash));
 const identity=await db.query("SELECT current_database() AS name,current_setting('server_version') AS version");
 need(/^rmt_seaport_fixture_[a-f0-9]{10}$/.test(identity.rows[0]?.name)&&/^18\.6(?:\D|$)/.test(identity.rows[0]?.version));
 await assertSeaportVaultWriter(db);
 need((await db.query("SELECT 1 FROM rmt_seaport_v2_binding WHERE id=1 AND identity=$1::jsonb",[JSON.stringify(m)])).rowCount===1);
 await db.query("CREATE TABLE IF NOT EXISTS rmt_seaport_v2_listing_watch (id integer PRIMARY KEY CHECK(id=1),binding_hash text NOT NULL,revision bigint NOT NULL CHECK(revision>=0),payload jsonb NOT NULL)");
 const initial:WatchState={bindingHash,revision:0,lastPollAtMs:0,records:[]};
 await db.query("INSERT INTO rmt_seaport_v2_listing_watch VALUES(1,$1,0,$2) ON CONFLICT(id) DO NOTHING",[bindingHash,JSON.stringify(initial)]);
 const rows=await db.query("SELECT binding_hash FROM rmt_seaport_v2_listing_watch WHERE id=1");need(rows.rowCount===1&&rows.rows[0].binding_hash===bindingHash);
 return{
  async load(expected:string):Promise<WatchState>{
   await assertSeaportVaultWriter(db);need(expected===bindingHash);
   const r=await db.query("SELECT binding_hash,revision,payload FROM rmt_seaport_v2_listing_watch WHERE id=1");need(r.rowCount===1&&r.rows[0].binding_hash===expected);
   const state=r.rows[0].payload as WatchState;need(state.bindingHash===expected&&Number.isSafeInteger(state.revision)&&String(state.revision)===String(r.rows[0].revision)&&Array.isArray(state.records)&&state.records.length<=64&&Buffer.byteLength(JSON.stringify(state))<=524288);return state;
  },
  async commit(revision:number,state:WatchState):Promise<boolean>{
   await assertSeaportVaultWriter(db);need(Number.isSafeInteger(revision)&&revision>=0&&state.bindingHash===bindingHash&&state.revision===revision+1&&Number.isSafeInteger(state.lastPollAtMs)&&state.lastPollAtMs>0&&Array.isArray(state.records)&&state.records.length<=64);
   const raw=JSON.stringify(state);need(Buffer.byteLength(raw)<=524288);
   return(await db.query("UPDATE rmt_seaport_v2_listing_watch SET revision=$1,payload=$2 WHERE id=1 AND binding_hash=$3 AND revision=$4 RETURNING id",[state.revision,raw,bindingHash,revision])).rowCount===1;
  }
 };
}
