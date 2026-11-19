import assert from "node:assert/strict";
import test from "node:test";
import {postgresRuntimeEnvironment} from "./postgres-runtime-env.mjs";
const home="/tmp/runner/rmt-pg18.6.Abc123",bin=home+"/root/usr/lib/postgresql/18/bin";
const env=()=>({RUNNER_TEMP:"/tmp/runner",RMT_PG18_EVIDENCE:home,RMT_PG18_BIN:bin,
  LD_LIBRARY_PATH:"/untrusted",LD_PRELOAD:"/untrusted.so",RAILWAY_TOKEN:"synthetic-secret",DATABASE_URL:"synthetic-secret",NODE_OPTIONS:"--inspect"});
test("verified extracted PostgreSQL children receive only their bound private library directory",()=>{
  const base={PATH:"/usr/bin",LANG:"C.UTF-8"},before=structuredClone(base),e=env(),copy=structuredClone(e);
  assert.deepEqual(postgresRuntimeEnvironment(base,bin,e,"linux"),{...base,LD_LIBRARY_PATH:home+"/root/usr/lib/x86_64-linux-gnu"});
  assert.deepEqual(base,before);assert.deepEqual(e,copy);
});
test("native/preinstalled binaries and non-Linux processes never inherit raw runtime variables",()=>{
  const base={PATH:"/usr/bin"};assert.deepEqual(postgresRuntimeEnvironment(base,"/usr/lib/postgresql/16/bin",{},"linux"),base);
  assert.deepEqual(postgresRuntimeEnvironment(base,"C:/pgsql/bin",env(),"win32"),base);
  assert.deepEqual(postgresRuntimeEnvironment(base,"/usr/lib/postgresql/18/bin",{...env(),RMT_PG18_BIN:"/usr/lib/postgresql/18/bin"},"linux"),base);
});
test("binary drift, outside roots, traversal, loader lists and unbound directories fail closed",()=>{
  const changes=[{RMT_PG18_BIN:"/usr/bin"},{RMT_PG18_EVIDENCE:"/other/rmt-pg18.6.Abc123"},
    {RMT_PG18_EVIDENCE:"/tmp/runner/../rmt-pg18.6.Abc123"},{RMT_PG18_EVIDENCE:home+":/other"},
    {RMT_PG18_EVIDENCE:home+"\nKEY=value"},{RUNNER_TEMP:"/other"},{RUNNER_TEMP:undefined},{RMT_PG18_EVIDENCE:undefined}];
  for(const change of changes)assert.throws(()=>postgresRuntimeEnvironment({},bin,{...env(),...change},"linux"));
});
