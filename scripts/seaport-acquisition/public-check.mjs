import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {isAbsolute,join} from "node:path";
import {parseArgs} from "node:util";
import {chromium,webkit,devices} from "playwright";

const {values}=parseArgs({options:{url:{type:"string"},browser:{type:"string"},output:{type:"string"}}});
assert.ok(values.url&&values.output&&["chromium","webkit"].includes(values.browser));
const site=new URL(values.url);assert.equal(site.protocol,"http:");assert.equal(site.hostname,"127.0.0.1");assert.equal(site.href,site.origin+"/");assert.ok(isAbsolute(values.output));
await mkdir(values.output,{recursive:false});
const denied=[];
for(const method of ["GET","HEAD","POST"]){
  const response=await fetch(new URL("/api/seaport-acquisition",site),{method,...(method==="POST"&&{headers:{Origin:site.origin,"Content-Type":"application/json"},body:JSON.stringify({action:"prepare",operation:"purchase",fields:{}})}),redirect:"error",signal:AbortSignal.timeout(15_000)});
  assert.equal(response.status,404);assert.match(response.headers.get("cache-control"),/no-store/);assert.equal(response.headers.get("set-cookie"),null);denied.push({method,status:response.status});
}
const engine=values.browser==="webkit"?webkit:chromium,browser=await engine.launch(),layouts=[];
try{
  for(const [name,options] of [["desktop",{viewport:{width:1440,height:900}}],["portrait",devices["iPhone 13"]],["landscape",devices["iPhone 13 landscape"]]]){
    const context=await browser.newContext({...options,serviceWorkers:"block"}),wallet=[],external=[],financial=[],errors=[];
    await context.exposeBinding("unexpectedSeaportWallet",(_source,method)=>wallet.push(method));
    await context.addInitScript(()=>{Object.defineProperty(window,"ethereum",{configurable:true,get(){void window.unexpectedSeaportWallet("provider-read");return{request:async({method})=>{void window.unexpectedSeaportWallet(method);throw Error("Read-only website must not access a wallet");}};}});window.addEventListener("eip6963:requestProvider",()=>void window.unexpectedSeaportWallet("wallet-discovery"));});
    await context.route("**/*",route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==site.origin){external.push(url.origin);return route.abort();}if(request.method()!=="GET"||url.pathname==="/api/seaport-acquisition"||/^\/(?:preview-rpc|mcp|admin)(?:\/|$)/.test(url.pathname)){financial.push(request.method()+" "+url.pathname);return route.abort();}return route.continue();});
    const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
    try{
      const response=await page.goto(new URL("/my-launches/treasury/seaport-purchases",site).href);assert.equal(response.status(),404);await page.waitForLoadState("networkidle");
      assert.equal(await page.getByRole("button",{name:/Confirm.*Seaport|Prepare.*Seaport|Purchase NFT|Enable purchases/i}).count(),0);
      const noOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);assert.equal(noOverflow,true);
      const media=await page.evaluate(()=>({touch:navigator.maxTouchPoints,coarse:matchMedia("(pointer: coarse)").matches}));
      const screenshot=values.browser+"-"+name+"-seaport-public-disabled.png";await page.screenshot({path:join(values.output,screenshot),fullPage:false});
      assert.deepEqual(await page.evaluate(()=>({touch:navigator.maxTouchPoints,coarse:matchMedia("(pointer: coarse)").matches})),media);
      assert.deepEqual(wallet,[]);assert.deepEqual(external,[]);assert.deepEqual(financial,[]);assert.deepEqual(errors,[]);
      layouts.push({name,screenshot,noOverflow,walletCalls:wallet,externalRequests:external,financialRequests:financial,physicalIPhoneAcceptance:false});
    }finally{await context.close();}
  }
}finally{await browser.close();}
const report={schemaVersion:1,scope:"ACTUAL_PUBLIC_BUILD_SEAPORT_EXECUTION_NEGATIVES",status:"PASS",browser:values.browser,denied,layouts,productionExecution:false};
await writeFile(join(values.output,"seaport-public-acceptance.json"),JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log("Seaport V2 public routes blocked; zero wallet calls; no production execution.");
