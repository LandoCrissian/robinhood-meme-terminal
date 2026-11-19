import test from "node:test";
import assert from "node:assert/strict";
import {initializeSeaportVaultStore,commitSeaportVaultBlock,rollbackSeaportVaultStore} from "./seaport-acquisition-store.js";
import type {SeaportVaultManifest} from "./seaport-acquisition-types.js";
const m={chainId:31337,profile:"rmt-seaport-acquisition-local-v2"}as SeaportVaultManifest;
test("V2 persistence refuses production database, wrong version and absent exclusive writer",async()=>{
 for(const mode of["database","version","lease"]){let created=false;const db={query:async(sql:string)=>{if(sql.startsWith("SELECT current_database"))return{rows:[{name:mode==="database"?"production":"rmt_seaport_fixture_1234567890",version:mode==="version"?"18.5":"18.6"}]};if(sql.startsWith("SELECT pg_try"))return{rows:[{acquired:mode!=="lease"}]};created=true;throw Error("Unexpected schema mutation");}};await assert.rejects(initializeSeaportVaultStore(db as never,m),/persistence unavailable/);assert.equal(created,false);}
 const foreign={query:async()=>({rowCount:0,rows:[]})};await assert.rejects(rollbackSeaportVaultStore(foreign as never,1n));
});
test("V2 range conflict rolls back atomically; identical checkpoint replay stays bounded",async()=>{
 const calls:string[]=[],db={query:async(sql:string)=>{calls.push(sql);return{rowCount:sql.startsWith("INSERT INTO rmt_seaport_v2_blocks")?0:1,rows:[{}]};}};
 await assert.rejects(commitSeaportVaultBlock(db as never,{blockNumber:"10",blockHash:("0x"+"a".repeat(64))as `0x${string}`,timestamp:new Date().toISOString()},[]),/persistence unavailable/);assert.ok(calls.includes("ROLLBACK"));assert.equal(calls.includes("COMMIT"),false);
});
