import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash, randomBytes} from "node:crypto";
import {createServer} from "node:net";
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve, dirname, basename} from "node:path";
import {parseArgs} from "node:util";
import {postgresRuntimeEnvironment} from "../reclaim-v2/postgres-runtime-env.mjs";
import {createRequire} from "node:module";
const {Client}=createRequire(new URL("../../apps/indexer/package.json",import.meta.url))("pg");
import {curveProductionSchemaSql, initializeProductionCurveStore, commitProductionCurveRange,
  productionCurveScope, readProductionCurveLaunches, rollbackProductionCurve} from "../../apps/indexer/src/curve-production-store.js";
import {syntheticProductionConfig as config, syntheticProductionRegistration} from "../../apps/indexer/src/curve-production-smoke.js";
import {assertIndexWriterLease} from "../../apps/indexer/src/index-store.js";

const {values}=parseArgs({options:{"pg-bin":{type:"string"},output:{type:"string"}}});
assert.ok(values["pg-bin"]&&values.output,"Supply --pg-bin and a fresh --output path");
assert.equal(existsSync(values.output),false,"Evidence output must not overwrite existing data");
const output=resolve(values.output);mkdirSync(output,{mode:0o700});
const cluster=mkdtempSync(join(tmpdir(),"rmt089-backup-"));
const pgBin=resolve(values["pg-bin"]!),data=join(cluster,"data");
const environment=postgresRuntimeEnvironment({PATH:process.env.PATH!,LANG:"C.UTF-8"},pgBin,process.env);
const run=(tool:string,args:string[])=>execFileSync(join(pgBin,tool),args,{encoding:"utf8",env:environment,timeout:60000});
const versions=Object.fromEntries(["postgres","pg_ctl","initdb","createdb","pg_dump","pg_restore"].map(name=>[name,run(name,["--version"]).trim()]));
for(const version of Object.values(versions))assert.match(version,/PostgreSQL\) 18\.6\b/);
const socket=createServer();await new Promise<void>(done=>socket.listen(0,"127.0.0.1",done));
const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
const user="rmt089_synthetic",suffix=randomBytes(5).toString("hex");
const source="rmt_curve_production_smoke_backup_"+suffix,restored="rmt_curve_production_smoke_restore_"+suffix;
const url=(db:string)=>"postgresql://"+user+"@127.0.0.1:"+port+"/"+db;
const client=(db:string)=>new Client({connectionString:url(db),connectionTimeoutMillis:3000});
const tables=["rmt_curve_production_bindings","rmt_curve_production_checkpoints","rmt_curve_production_launches","retained_historical_sentinel"];
const scope=productionCurveScope(config),item=syntheticProductionRegistration();
const report:any={schemaVersion:1,suite:"Task089 isolated whole-database backup/restore and session writer lock",
  sourceCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),startedAt:new Date().toISOString(),
  syntheticOnly:true,productionAccess:false,originalRailwayVolumeTouched:false,versions,checks:[],limitations:[
    "This verifies the exact procedure on synthetic local data, not the existence/readability of any production backup.",
    "No production database credentials, volume, backup, configuration, or SQL session were accessed.",
    "An owner-controlled off-device encrypted copy, recovery key, retention/RPO and verified current production restore remain unestablished.",
    "The writer lease is a PostgreSQL session advisory lock; it has no expiration or periodic renewal."]};
const sha=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
const snapshot=async(db:any)=>{
  const rows:any={};
  for(const table of tables)rows[table]=(await db.query("SELECT row_to_json(t) AS row FROM "+table+" t ORDER BY row_to_json(t)::text")).rows.map(r=>r.row);
  return JSON.parse(JSON.stringify(rows));
};
const clients:any[]=[];const connect=async(db:string)=>{const c=client(db);clients.push(c);await c.connect();return c;};
let started=false;
const start=()=>{run("pg_ctl",["-D",data,"-l",join(output,"postgres.log"),"-o","-h 127.0.0.1 -p "+port+" -k ''","-w","start"]);started=true;};
const stop=()=>{run("pg_ctl",["-D",data,"-m","fast","-w","stop"]);started=false;};
try {
  run("initdb",["-D",data,"-U",user,"-A","trust","--no-instructions"]);start();
  run("createdb",["--host","127.0.0.1","--port",String(port),"--username",user,source]);
  run("createdb",["--host","127.0.0.1","--port",String(port),"--username",user,restored]);
  const writer=await connect(source),challenger=await connect(source);
  await assert.rejects(initializeProductionCurveStore(writer,config),/verified backup and explicit installation/);
  await writer.query("CREATE TABLE retained_historical_sentinel(id integer PRIMARY KEY, marker text NOT NULL)");
  await writer.query("INSERT INTO retained_historical_sentinel VALUES(1,'synthetic original historical row preserved')");
  await writer.query(curveProductionSchemaSql);
  await initializeProductionCurveStore(writer,config);await assertIndexWriterLease(writer,config.binding.chainId);
  await assert.rejects(initializeProductionCurveStore(challenger,config),/database_writer_conflict/);
  await assert.rejects(assertIndexWriterLease(challenger,config.binding.chainId),/database_writer_conflict/);
  await commitProductionCurveRange(writer,config,100n,item.checkpoint,[item]);
  const before=await snapshot(writer),writerPid=(await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const backup=join(output,"synthetic-database.backup");
  run("pg_dump",["--format=custom","--no-owner","--no-acl","--file",backup,"--dbname",url(source)]);
  const inventory=run("pg_restore",["--list",backup]);writeFileSync(join(output,"archive-inventory.txt"),inventory);
  for(const table of tables)assert.ok(inventory.includes(table),"Backup omitted "+table);
  assert.deepEqual(await snapshot(writer),before,"Dump cannot mutate source data");
  assert.equal((await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,writerPid);
  await assertIndexWriterLease(writer,config.binding.chainId);
  await assert.rejects(initializeProductionCurveStore(challenger,config),/database_writer_conflict/);
  const destination=await connect(restored);
  assert.equal((await destination.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n,0);
  run("pg_restore",["--exit-on-error","--no-owner","--no-acl","--dbname",url(restored),backup]);
  assert.deepEqual(await snapshot(destination),before,"Whole restored database differs from source");
  await initializeProductionCurveStore(destination,config);await assertIndexWriterLease(destination,config.binding.chainId);
  const restoredChallenger=await connect(restored);
  await assert.rejects(initializeProductionCurveStore(restoredChallenger,config),/database_writer_conflict/);
  assert.deepEqual((await readProductionCurveLaunches(destination,scope,item.checkpoint,{limit:25}))[0]?.creation,item.creation);
  assert.deepEqual(await snapshot(writer),before,"Restoring another database must preserve source");
  report.checks.push("schema admission refuses uninstalled database","exact sole writer lock held","second source writer refused","whole custom dump includes existing historical and new-engine tables","dump preserved same source session/lock/data","fresh restore bytes equal source","restored database independently acquires one writer lock","second restored writer refused","creation identity and checkpoint preserved");
  for(const c of clients.splice(0))await c.end();
  stop();start();
  const recovered=await connect(restored),sourceAgain=await connect(source);
  assert.deepEqual(await snapshot(recovered),before,"Restored bytes changed after PostgreSQL process restart");
  assert.deepEqual(await snapshot(sourceAgain),before,"Source bytes changed after PostgreSQL process restart");
  await assert.rejects(assertIndexWriterLease(recovered,config.binding.chainId),/database_writer_conflict/);
  await initializeProductionCurveStore(recovered,config);await assertIndexWriterLease(recovered,config.binding.chainId);
  const next={...item.checkpoint,blockNumber:"101",blockHash:"0x"+"a".repeat(64) as `0x${string}`};
  await commitProductionCurveRange(recovered,config,101n,next,[]);
  assert.deepEqual((await readProductionCurveLaunches(recovered,scope,next,{limit:25}))[0]?.creation,item.creation);
  await rollbackProductionCurve(recovered,scope,99n);
  const replacement={...item,checkpoint:{...item.checkpoint,blockHash:"0x"+"b".repeat(64) as `0x${string}`},
    creation:{...item.creation,blockHash:"0x"+"b".repeat(64) as `0x${string}`,transactionHash:"0x"+"c".repeat(64) as `0x${string}`}};
  await commitProductionCurveRange(recovered,config,100n,replacement.checkpoint,[replacement]);
  assert.deepEqual((await readProductionCurveLaunches(recovered,scope,replacement.checkpoint,{limit:25}))[0]?.creation,replacement.creation);
  await assert.rejects(readProductionCurveLaunches(recovered,scope,item.checkpoint,{limit:25}),/checkpoint changed/);
  assert.deepEqual(await snapshot(sourceAgain),before,"Recovery/reorg in restored destination changed source");
  report.checks.push("actual PostgreSQL process restart preserves both databases","session locks absent after restart until explicit reacquisition","original receipt retained as durable cursor advances","restored reorg rollback/replay replaces exact canonical identity","old hash rejected after replay","source database unchanged by restored recovery");
  report.status="PASS";report.backup={format:"PostgreSQL custom",sha256:sha(readFileSync(backup)),bytes:readFileSync(backup).length,containsSyntheticDataOnly:true};
  report.sourceSnapshotSha256=sha(JSON.stringify(before));report.checkCount=report.checks.length;
} finally {
  for(const c of clients)await c.end().catch(()=>undefined);
  let cleanupFailure: unknown;
  try {
    if(started)stop();
    assert.equal(realpathSync(cluster),cluster,"Temporary cluster path changed");
    assert.equal(dirname(cluster),realpathSync(tmpdir()),"Cluster left temporary root");
    assert.match(basename(cluster),/^rmt089-backup-[A-Za-z0-9]+$/);
    rmSync(cluster,{recursive:true});
    report.cleanup={processStopped:true,privateTemporaryClusterRemoved:true};
  } catch(error) {
    cleanupFailure=error;
    report.cleanup={processStopped:!started,privateTemporaryClusterRemoved:false};
  }
  report.finishedAt=new Date().toISOString();
  writeFileSync(join(output,"backup-restore.json"),JSON.stringify(report,null,2)+"\n");
  if(cleanupFailure)throw cleanupFailure;
}
console.log(JSON.stringify({status:report.status,checks:report.checkCount,backup:report.backup,sourceSnapshotSha256:report.sourceSnapshotSha256},null,2));
