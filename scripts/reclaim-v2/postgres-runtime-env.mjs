import assert from "node:assert/strict";
import {posix} from "node:path";

/** The verified PG18 extraction needs its private libraries. Give that one
 * directory to PostgreSQL children only; never inherit arbitrary loader paths,
 * production credentials or preload settings into website/indexer processes. */
export function postgresRuntimeEnvironment(base,pgBin,env,platform=process.platform){
  const result={...base};
  if(platform!=="linux"||!env.RMT_PG18_BIN&&!env.RMT_PG18_EVIDENCE)return result;
  assert.equal(env.RMT_PG18_BIN,pgBin,"Fixture PostgreSQL binary selection changed");
  if(pgBin==="/usr/lib/postgresql/18/bin")return result;
  const home=env.RMT_PG18_EVIDENCE,temp=env.RUNNER_TEMP;
  assert.ok(typeof home==="string"&&typeof temp==="string"&&posix.isAbsolute(home)&&posix.isAbsolute(temp)
    &&!/\r|\n/.test(home+temp)&&home===posix.normalize(home)&&temp===posix.normalize(temp),"Unbound PostgreSQL runtime directory");
  const relative=posix.relative(temp,home);
  assert.match(relative,/^rmt-pg18\.6\.[A-Za-z0-9]+$/,"PostgreSQL libraries must belong to this temporary fixture");
  assert.equal(pgBin,posix.join(home,"root/usr/lib/postgresql/18/bin"));
  result.LD_LIBRARY_PATH=posix.join(home,"root/usr/lib/x86_64-linux-gnu");
  return result;
}
