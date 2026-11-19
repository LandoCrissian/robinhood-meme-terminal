import type {Client} from "pg";
import type {SeaportVaultManifest,SeaportVaultPoint,SeaportVaultSettlement} from "./seaport-acquisition-types.js";
import type {SeaportSafeAdminReceipt} from "./seaport-acquisition-safe-admin.js";
type Db=Pick<Client,"query">;
const need=(v:unknown)=>{if(!v)throw Error("Isolated Seaport V2 persistence unavailable or conflicting");};
const json=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x);
const lease=841083;
export async function initializeSeaportVaultStore(db:Db,m:SeaportVaultManifest){
  const identity=await db.query("SELECT current_database() AS name,current_setting('server_version') AS version");
  need(/^rmt_seaport_fixture_[a-f0-9]{10}$/.test(identity.rows[0]?.name)&&/^18\.6(?:\D|$)/.test(identity.rows[0]?.version)&&m.chainId===31337&&m.profile==="rmt-seaport-acquisition-local-v2");
  need((await db.query("SELECT pg_try_advisory_lock($1) AS acquired",[lease])).rows[0]?.acquired===true);
  await db.query(`CREATE TABLE IF NOT EXISTS rmt_seaport_v2_binding(id integer PRIMARY KEY CHECK(id=1),identity jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS rmt_seaport_v2_blocks(block_number bigint PRIMARY KEY,block_hash text UNIQUE NOT NULL,timestamp text NOT NULL);
    CREATE TABLE IF NOT EXISTS rmt_seaport_v2_settlements(transaction_hash text PRIMARY KEY,block_number bigint NOT NULL REFERENCES rmt_seaport_v2_blocks(block_number) ON DELETE CASCADE,payload jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS rmt_seaport_v2_admin_events(transaction_hash text PRIMARY KEY,block_number bigint NOT NULL REFERENCES rmt_seaport_v2_blocks(block_number) ON DELETE CASCADE,payload jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS rmt_seaport_v2_marker(identity text PRIMARY KEY CHECK(identity='rmt-seaport-acquisition-local-v2'));
    INSERT INTO rmt_seaport_v2_marker VALUES('rmt-seaport-acquisition-local-v2') ON CONFLICT DO NOTHING`);
  need((await db.query("INSERT INTO rmt_seaport_v2_binding VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET identity=EXCLUDED.identity WHERE rmt_seaport_v2_binding.identity=EXCLUDED.identity RETURNING id",[json(m)])).rowCount===1);
}
export async function assertSeaportVaultWriter(db:Db){
  // pg_locks is checked on this exact backend; another connection never inherits authority.
  need((await db.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND objid=$1 AND granted",[lease])).rowCount===1);
}
export async function commitSeaportVaultBlock(db:Db,point:SeaportVaultPoint,rows:SeaportVaultSettlement[],m:SeaportVaultManifest,adminRows:SeaportSafeAdminReceipt[]=[]){
  await assertSeaportVaultWriter(db);need((await db.query("SELECT 1 FROM rmt_seaport_v2_binding WHERE id=1 AND identity=$1::jsonb",[json(m)])).rowCount===1);
  need(rows.length<=32&&rows.every(r=>r.blockNumber===point.blockNumber&&r.blockHash===point.blockHash&&r.vault.toLowerCase()===m.vault.toLowerCase()&&r.projectToken.toLowerCase()===m.projectToken.toLowerCase()&&r.custody.toLowerCase()===m.vault.toLowerCase()&&r.proof.evidence==="canonical-receipt-and-exact-local-call-trace"));
  need(adminRows.length<=32&&new Set(adminRows.map(r=>r.transactionHash.toLowerCase())).size===adminRows.length&&adminRows.every(r=>r.blockNumber===point.blockNumber&&r.blockHash===point.blockHash&&r.vault.toLowerCase()===m.vault.toLowerCase()&&r.projectToken.toLowerCase()===m.projectToken.toLowerCase()&&r.proof.evidence==="canonical-receipt-and-exact-local-call-trace"));
  await db.query("BEGIN");try{
    need((await db.query("INSERT INTO rmt_seaport_v2_blocks VALUES($1,$2,$3) ON CONFLICT(block_number) DO UPDATE SET block_hash=EXCLUDED.block_hash WHERE rmt_seaport_v2_blocks.block_hash=EXCLUDED.block_hash RETURNING block_number",[point.blockNumber,point.blockHash,point.timestamp])).rowCount===1);
    for(const row of rows)need((await db.query("INSERT INTO rmt_seaport_v2_settlements VALUES($1,$2,$3) ON CONFLICT(transaction_hash) DO UPDATE SET payload=EXCLUDED.payload WHERE rmt_seaport_v2_settlements.payload=EXCLUDED.payload RETURNING transaction_hash",[row.transactionHash.toLowerCase(),point.blockNumber,json(row)])).rowCount===1);
    for(const row of adminRows)need((await db.query("INSERT INTO rmt_seaport_v2_admin_events VALUES($1,$2,$3) ON CONFLICT(transaction_hash) DO UPDATE SET payload=EXCLUDED.payload WHERE rmt_seaport_v2_admin_events.payload=EXCLUDED.payload RETURNING transaction_hash",[row.transactionHash.toLowerCase(),point.blockNumber,json(row)])).rowCount===1);
    await db.query("COMMIT");
  }catch(error){await db.query("ROLLBACK");throw error;}
}
export async function rollbackSeaportVaultStore(db:Db,from:bigint){await assertSeaportVaultWriter(db);await db.query("DELETE FROM rmt_seaport_v2_blocks WHERE block_number>=$1",[from.toString()]);}
export async function readSeaportVaultStore(db:Db,transaction?:string){
  const checkpoints=await db.query("SELECT block_number,block_hash,timestamp FROM rmt_seaport_v2_blocks ORDER BY block_number DESC LIMIT 1");
  const rows=await db.query(`SELECT payload FROM rmt_seaport_v2_settlements ${transaction?"WHERE transaction_hash=$1":""} ORDER BY block_number DESC LIMIT 64`,transaction?[transaction.toLowerCase()]:[]);
  const admin=await db.query(`SELECT payload FROM rmt_seaport_v2_admin_events ${transaction?"WHERE transaction_hash=$1":""} ORDER BY block_number DESC LIMIT 64`,transaction?[transaction.toLowerCase()]:[]);
  const p=checkpoints.rows[0];return{checkpoint:p?{blockNumber:String(p.block_number),blockHash:p.block_hash,timestamp:p.timestamp}:null,settlements:rows.rows.map(r=>r.payload as SeaportVaultSettlement),adminEvents:admin.rows.map(r=>r.payload as SeaportSafeAdminReceipt)};
}
