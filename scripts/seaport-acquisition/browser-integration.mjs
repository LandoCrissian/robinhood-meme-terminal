import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {createRequire} from "node:module";
import {devices} from "playwright";
const require=createRequire(new URL("../../apps/launch-website/package.json",import.meta.url)),{keccak256}=require("viem");
const api="/api/seaport-acquisition",path="/my-launches/treasury/seaport-purchases",json=v=>JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x,2)+"\n";
/** The real Next server builds and simulates every request. The isolated
 * provider signs only the exact envelope visible in its preceding review. */
export async function testSeaportAcquisitionBrowser({browserEngine,site,fixture,out,sync,restart,hideTrace}){
  const{accounts:{owner},rpc,client,bindings:m,prepareBrowserOrder}=fixture;assert.equal(await client.getChainId(),31337);
  const evidence={schemaVersion:1,profile:"rmt-seaport-v2-connected-browser",scope:"LOCAL_SYNTHETIC_NOT_PRODUCTION_OR_PHYSICAL_IPHONE",status:"incomplete",reviews:[],submissions:[],recoveries:[],layouts:[],pageErrors:[],externalRequests:[],walletMethods:[],checks:{}};
  const save=()=>writeFileSync(join(out,"seaport-browser-evidence.json"),json(evidence));
  const context=await browserEngine.newContext({...devices["iPhone 13"],serviceWorkers:"block"}),page=await context.newPage();page.setDefaultTimeout(45000);let currentReview,loseHash=false;
  page.on("pageerror",e=>evidence.pageErrors.push(e.message));await context.route("**/*",route=>{if(new URL(route.request().url()).origin!==site){evidence.externalRequests.push(route.request().url());return route.abort();}return route.continue();});
  await context.exposeBinding("seaportSyntheticSend",async(_source,request)=>{
    assert.ok(currentReview);assert.deepEqual(request,currentReview.request);assert.equal(request.chainId,"0x7a69");assert.equal(request.from.toLowerCase(),owner.address.toLowerCase());assert.equal(evidence.submissions.some(x=>x.reviewHash===currentReview.reviewHash),false);
    const raw=await owner.signTransaction({chainId:31337,type:"eip1559",to:request.to,data:request.data,value:BigInt(request.value),nonce:Number(BigInt(request.nonce)),gas:BigInt(request.gas),maxFeePerGas:BigInt(request.maxFeePerGas),maxPriorityFeePerGas:BigInt(request.maxPriorityFeePerGas)}),hash=keccak256(raw);
    assert.equal(await rpc("eth_sendRawTransaction",[raw]),hash);const receipt=await client.waitForTransactionReceipt({hash,pollingInterval:100,timeout:30000,checkReplacement:false});assert.equal(receipt.status,"success");evidence.submissions.push({reviewHash:currentReview.reviewHash,request,transactionHash:hash,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash,gasUsed:String(receipt.gasUsed)});save();return loseHash?undefined:hash;
  });
  await context.exposeBinding("seaportSyntheticMethod",(_source,method)=>evidence.walletMethods.push(method));
  await context.addInitScript(({account})=>{window.ethereum={async request({method,params=[]}){await window.seaportSyntheticMethod(method);if(method==="eth_chainId")return"0x7a69";if(method==="eth_accounts"||method==="eth_requestAccounts")return[account];if(method==="eth_sendTransaction")return window.seaportSyntheticSend(params[0]);throw Error("Unsupported synthetic request");}};},{account:owner.address});
  const button=name=>page.getByRole("button",{name,exact:true});
  async function response(action,task){const observed=page.waitForResponse(r=>new URL(r.url()).pathname===api&&r.request().method()==="POST"&&r.request().postDataJSON()?.action===action).then(async r=>({http:r.status(),body:await r.json()}));await task();const result=await observed;assert.equal(result.http,200,json(result));return result.body;}
  async function prepare(operation,order,currency="0x0000000000000000000000000000000000000000"){
    await page.getByLabel("Action",{exact:true}).selectOption(operation);if(order){await page.getByLabel("Exact synthetic signed order JSON",{exact:true}).fill(json(order));await page.getByLabel("I checked the collection, signed order, complete consideration and vault custody",{exact:true}).check();}
    if(operation==="configure"){await page.getByLabel("Payment currency",{exact:true}).fill(currency);await page.getByLabel("Enable bounded permissionless triggering; the caller pays gas",{exact:true}).check();}
    const r=await response("prepare",()=>button("Prepare exact Seaport transaction").click());assert.equal(r.profile,"rmt-seaport-acquisition-local-v2",json(r));assert.equal(r.productionExecution,false);assert.equal(r.chainId,31337);currentReview=r;evidence.reviews.push(r);save();await page.getByRole("region",{name:"Reviewed Seaport V2 transaction"}).waitFor();return r;
  }
  async function confirm({lose=false}={}){loseHash=lose;const region=page.getByRole("region",{name:"Reviewed Seaport V2 transaction"});await region.getByRole("checkbox").check();const count=evidence.submissions.length;await response("revalidate",()=>button("Confirm synthetic Seaport transaction").click());await page.waitForFunction(({reviewHash,stage})=>Object.keys(localStorage).filter(k=>k.startsWith("rmt.seaport-acquisition.pending.v2:31337:")).some(k=>{const j=JSON.parse(localStorage.getItem(k)??"null");return j?.review?.reviewHash===reviewHash&&j.stage===stage;}),{reviewHash:currentReview.reviewHash,stage:lose?"hash-missing":"pending"});assert.equal(evidence.submissions.length,count+1);loseHash=false;return evidence.submissions.at(-1);}
  async function recover(status="confirmed"){const count=evidence.submissions.length,r=await response("verify",()=>button("Recover original Seaport transaction").click());assert.equal(r.status,status,json(r));assert.equal(evidence.submissions.length,count);evidence.recoveries.push(r);save();return r;}
  async function open(){await page.goto(site+path);await page.getByRole("heading",{name:"Seaport NFT acquisition",exact:true}).waitFor();await button("Connect synthetic Seaport wallet").click();await page.getByRole("status").getByText("Synthetic wallet connected",{exact:true}).waitFor();}
  try{
    const first=await prepareBrowserOrder({id:100,standard:721});await sync();await open();
    await page.getByText("No current live order is independently verified.",{exact:false}).first().waitFor();
    await prepare("configure");await confirm();await sync();await recover();
    const review=await prepare("buy",first);await page.getByText(review.listing.orderHash,{exact:true}).waitFor();const noWalletBefore=evidence.walletMethods.length;await page.screenshot({path:join(out,"seaport-purchase-review-portrait.png"),fullPage:false});assert.equal(evidence.walletMethods.length,noWalletBefore);
    const sent=await confirm({lose:true});await sync();await page.reload();const recovered=await recover();assert.equal(recovered.transactionHash,sent.transactionHash);assert.equal(recovered.indexed,true);assert.equal(recovered.settlement.orderHash,review.listing.orderHash);evidence.checks.missingHashRecoveredWithoutDuplicate=true;
    await restart();const durable=await recover();assert.deepEqual(durable.settlement,recovered.settlement);evidence.checks.postgresRestartDurable=true;
    const tokenOrder=await prepareBrowserOrder({id:101,standard:1155,currency:m.paymentToken});await button("Connect synthetic Seaport wallet").click();await prepare("configure",undefined,m.paymentToken);await confirm();await sync();await recover();const reorgSnapshot=await rpc("evm_snapshot");const secondReview=await prepare("buy",tokenOrder);
    hideTrace(true);await confirm();await sync({expectPending:true});await recover("pending");hideTrace(false);await sync();await recover();evidence.checks.traceOutagePendingThenRecovered=true;
    await prepare("disable");await confirm();await sync();await recover();evidence.checks.disableReviewedAndConfirmed=true;
    assert.equal(await rpc("evm_revert",[reorgSnapshot]),true);await rpc("anvil_mine",["0x4"]);await sync();const after=await(await fetch(site+api,{method:"POST",headers:{Origin:site,"Content-Type":"application/json"},body:JSON.stringify({action:"verify",review:secondReview})})).json();assert.notEqual(after.status,"confirmed");evidence.checks.reorgInvalidatesDurableSettlement=true;
    await prepare("disable");await confirm();await sync();await recover();evidence.checks.disableReviewedAndConfirmed=true;
    for(const[name,options]of[["desktop",{viewport:{width:1440,height:900}}],["portrait",devices["iPhone 13"]],["landscape",devices["iPhone 13 landscape"]]]){const c=await browserEngine.newContext({...options,serviceWorkers:"block"}),p=await c.newPage();try{await p.goto(site+path);await p.getByRole("heading",{name:"Seaport NFT acquisition",exact:true}).waitFor();await p.waitForLoadState("networkidle");assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const file=`seaport-${name}.png`;await p.screenshot({path:join(out,file),fullPage:false});evidence.layouts.push({name,screenshot:file,noOverflow:true,physicalIPhone:false});}finally{await c.close();}}
    assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.externalRequests,[]);evidence.status="PASS";save();return evidence;
  }finally{await context.close();}
}
