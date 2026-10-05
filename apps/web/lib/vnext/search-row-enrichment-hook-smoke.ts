import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), Module = require("node:module"), react = require("react"), load = Module._load;
const states: any[] = [], effects: (() => void | (() => void))[] = [], lanes: (() => Promise<unknown>)[] = [];
Module._load = function(id: string, ...args: unknown[]) {
  if (id === "react") return { ...react, useState(initial: unknown) { const i = states.length; states.push(typeof initial === "function" ? initial() : initial);return [states[i], (next: any) => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(), useEffect: (fn: () => void) => effects.push(fn) };
  if (id === "./use-scanner-refresh") return { useScannerRefresh: (fn: () => Promise<unknown>) => lanes.push(fn) };
  return load.call(this,id,...args);
};
const { useVNextMarketDirectory } = require("../../app/vnext/use-vnext-market-directory");Module._load = load;
let now = 0, online = true, mode = "ready", query = "", exactReads = 0;
const realNow = Date.now, realFetch = globalThis.fetch;
const descriptors = Object.fromEntries(["document","navigator","window"].map(k => [k,Object.getOwnPropertyDescriptor(globalThis,k)]));
const doc = Object.assign(new EventTarget(),{ visibilityState: "visible" });
Object.defineProperty(globalThis,"document",{ configurable:true,value:doc });
Object.defineProperty(globalThis,"navigator",{ configurable:true,value:{ get onLine(){ return online; } } });
Object.defineProperty(globalThis,"window",{ configurable:true,value:{ setTimeout,clearTimeout } });
Date.now = () => now;
const token = (n: number) => `0x${n.toString(16).padStart(40,"0")}`;
const pool = `0x${"ba".repeat(32)}`, quote = token(999);
globalThis.fetch = (async (input: string) => {
  const url = new URL(input,"https://controlled.invalid");
  if (url.pathname.endsWith("market-search")) {
    query = url.searchParams.get("q")!;
    return Response.json({ query,queryKind:"token-or-pool-address",status:query === "invalid" ? "invalid_query" : "found",results:query === "invalid" ? [] : [{ address:query,name:"Verified token",symbol:"EXACT",decimals:18,matchedBy:"token",markets:[] }] });
  }
  if (!url.searchParams.has("contract")) return Response.json({ markets:[],discoveryCoverage:{ mode:"bounded",completeWithinObservedCandidates:false,truncated:false,returnedCount:0,observedCandidateCount:0,limit:144 } });
  exactReads++;if (mode === "failure") return Response.json({ error:"Controlled provider outage" },{status:503});
  if (mode === "none") return Response.json({ markets:[] });
  const address = url.searchParams.get("contract")!;
  const evidence = { chainId:4663,assetId:`eip155:4663/contract:${address}`,token:{address,name:"Verified token",symbol:"EXACT"},venue:"uniswap",protocolVersion:4,pool:{kind:"bytes32",value:pool},baseToken:{address,name:"Verified token",symbol:"EXACT"},quoteToken:{address:quote,name:"Quote",symbol:"WETH"},assetSide:"BASE",displayEligibility:"eligible",chartEligibility:"unavailable",executionEligibility:"view-only",provenance:"dexscreener-token-pairs",priceUsd:2,liquidityUsd:100,volume24h:50,priceChange24h:1,marketCapUsd:null,fdvUsd:null,pairCreatedAt:null };
  return Response.json({ markets:[{ address,name:"Verified token",symbol:"EXACT",pairAddress:pool,primaryMarket:evidence,verifiedMarkets:[evidence],priceUsd:2,liquidityUsd:100 }] });
}) as typeof fetch;
async function main() {
  const hook = useVNextMarketDirectory(), cleanup = effects[0]();
  const refresh = lanes[1];await refresh();assert.equal(exactReads,0,"No fanout for normal directory");
  const found = await hook.submitUniversalSearch(token(1));assert.equal(found.markets[0].priceUsd,null);
  hook.retainSearchRows(found.markets);await refresh();assert.equal(exactReads,1);
  const enriched = states[7][0];assert.equal(enriched.address.toLowerCase(),token(1));assert.equal(enriched.priceUsd,2);
  assert.equal(enriched.primaryMarket.pool.value,pool);assert.equal(enriched.primaryMarket.quoteToken.symbol,"WETH");
  assert.equal(states[0].some((r: any) => r.address.toLowerCase() === token(1)),false,"Search success is not automatic browse admission");
  hook.retainSearchRows([enriched]);now += 60_000;await refresh();assert.equal(exactReads,1);
  const none = await hook.submitUniversalSearch(token(2));hook.retainSearchRows(none.markets);mode="none";await refresh();assert.equal(exactReads,2);assert.equal(states[7][0].priceUsd,null);
  now += 60_000;await refresh();assert.equal(exactReads,2,"No-market case backs off");
  now += 60_000;mode="ready";await refresh();assert.equal(exactReads,3);assert.equal(states[7][0].priceUsd,2,"Later market evidence recovers generally");
  const failure = await hook.submitUniversalSearch(token(3));hook.retainSearchRows(failure.markets);mode="failure";now+=60_000;await refresh();assert.equal(exactReads,4);assert.equal(states[7][0].priceUsd,null);
  now+=60_000;await refresh();assert.equal(exactReads,4,"Provider failure preserves row and backs off");
  const hidden = await hook.submitUniversalSearch(token(4));hook.retainSearchRows(hidden.markets);now+=60_000;doc.visibilityState="hidden";await refresh();assert.equal(exactReads,4);
  doc.visibilityState="visible";online=false;await refresh();assert.equal(exactReads,4);
  online=true;mode="ready";await Promise.all([refresh(),refresh(),refresh()]);assert.equal(exactReads,5,"Resume/focus opportunities coalesce");
  await hook.submitUniversalSearch("invalid");hook.retainSearchRows([]);now+=60_000;await refresh();assert.equal(exactReads,5,"Invalid/non-ERC20 search cannot be probed");
  if (typeof cleanup === "function") cleanup();
  console.log("Actual directory hook: passive broad-to-exact enrichment, no browse promotion, general/no-market/provider/invalid/already-enriched cases, hidden/offline and resume single flight PASS");
}
void main().catch(e => { console.error(e);process.exitCode=1; }).finally(() => {
  globalThis.fetch=realFetch;Date.now=realNow;
  for(const [k,d] of Object.entries(descriptors)) if(d) Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);
});
