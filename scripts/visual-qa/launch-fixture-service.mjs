import {createServer} from "node:http";
import {readFileSync} from "node:fs";
const fixture=JSON.parse(readFileSync(new URL("../../apps/market-indexer/fixtures/launch-presentation-evidence.json",import.meta.url),"utf8"));
export function launchFixtureService(){
  const state={mode:"ready",requests:[],delay:0};
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,"http://localhost");state.requests.push({path:url.pathname,query:url.search});
    if(url.pathname!=="/v1/launches"||req.headers.authorization!==`Bearer ${"b".repeat(64)}`){res.writeHead(404).end();return;}
    if(state.delay)await new Promise(resolve=>setTimeout(resolve,state.delay));
    if(state.mode==="empty-outage"){res.writeHead(503).end();return;}
    const directory=structuredClone(fixture.directory);
    // Explicit controlled pagination regression, never production data.
    const ponsOnlyPage=url.searchParams.get('q')?.startsWith('controlled-pons-page-');
    let entries=directory.entries.filter(e=>(!url.searchParams.get("token")||e.token===url.searchParams.get("token"))&&(!url.searchParams.get("source")||e.source===url.searchParams.get("source"))&&(!url.searchParams.get("q")||ponsOnlyPage||`${e.token} ${e.identity.name} ${e.identity.symbol}`.toLowerCase().includes(url.searchParams.get("q").toLowerCase())));
    if(ponsOnlyPage&&!url.searchParams.get('source'))entries=entries.filter(e=>e.source==='PONS');
    if(state.mode==="metadata-unavailable")entries=entries.map(e=>({...e,identity:{name:null,symbol:null,decimals:null,artwork:null},identityObservations:{}}));
    if(state.mode==="lens-unavailable")entries=entries.map(e=>({...e,progressBps:null,marketCapUsd8:null}));
    if(state.mode==="retained-outage")directory.status="unavailable";
    const after=url.searchParams.get("cursor");if(after)entries=entries.slice(Number(after));
    const limit=Math.min(url.searchParams.get("token")?50:6,Number(url.searchParams.get('limit'))||50);
    directory.nextCursor=entries.length>limit?String((Number(after)||0)+limit):null;
    directory.entries=entries.slice(0,limit);
    res.setHeader("Content-Type","application/json");res.end(JSON.stringify(directory));
  });
  return {server,state,fixture};
}
