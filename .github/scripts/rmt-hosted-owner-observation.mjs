import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
const require=createRequire(new URL("../../apps/launch-website/package.json",import.meta.url));
const {createPublicClient,http}=require("viem");
const {hexToString}=require("viem");
const {parseSiweMessage}=require("viem/siwe");
const {chromium,webkit}=createRequire(new URL("../../package.json",import.meta.url))("playwright");
const approval = {
  "sourceCommit": "6910b879340945e9390dda57ce068cc9e4f9af51",
  "owner": "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA",
  "singleIntent": "0x9929e89d4c1e3fed5e2ca96e7620508463ac14e60f7c559f8449e2ba951672ac",
  "origin": "https://www.rmtlaunch.fun",
  "bundleSha256": "7ca1432b449fff3f6b2ea08c4b1f764976c2cf093fc303ae3e5e82dd6deb3113",
  "functionSha256": "706eb4b1384e7d8e289be2dbbe876dbd241526dec2072bbcce1f76a71d9c1a4c"
};
const published = {source:approval.sourceCommit,deployId:"6b01efb639b4668b0b9b5d5d"};
const origin=approval.origin;
const report={source:published.source,deployId:published.deployId,bundleSha256:approval.bundleSha256,serverSha256:approval.functionSha256,
  began:new Date(),discovery:[],routes:[],browsers:[],walletSignatures:0,transactions:0};
const save=()=>writeFileSync(join(process.env.RUNNER_TEMP,"hosted-owner-acceptance.json"),JSON.stringify(report,null,2)+"\n");
const request=async(path,body)=>{const response=await fetch(origin+path,{method:body?"POST":"GET",cache:"no-store",redirect:"error",
  headers:body?{origin,"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(65000)});
  return {response,value:await response.json()};};
const clients=["https://rpc.mainnet.chain.robinhood.com","https://robinhood.api.pocket.network"].map(url=>createPublicClient({transport:http(url,{retryCount:0,timeout:8000})}));
async function discovery(){
  const {response,value}=await request("/api/launchpad/new-engine");
  assert.equal(response.status,200);assert.equal(value.status,"ready");const p=value.checkpoint;
  const age=Date.now()-Date.parse(p.timestamp);
  assert.ok(age>=-15000&&age<120000);assert.equal(p.finality,"l2-confirmed");assert.equal(p.l1Finality,"unverified");assert.ok(p.confirmations>=20);
  for(const c of clients){const block=await c.getBlock({blockNumber:BigInt(p.blockNumber)});assert.equal(block.hash,p.blockHash);}
  report.discovery.push({at:new Date(),ageMs:age,block:p.blockNumber,hash:p.blockHash,confirmations:p.confirmations,requestId:response.headers.get("x-nf-request-id")});save();
}
try{
  await discovery();
  const {response,value}=await request("/api/launchpad/config");
  report.config={at:new Date(),http:response.status,...value,requestId:response.headers.get("x-nf-request-id")};save();
  assert.equal(response.status,200);assert.equal(value.status,"owner-creation-only");assert.equal(value.chainId,4663);
  assert.equal(value.factory,"0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3");assert.equal(value.trading,"disabled");assert.equal(value.claims,"disabled");
  for(const [route,body,code,status] of [["production-creation",{action:"owner-login"},200,"owner-login"],["production-lifecycle",{},404,"unavailable"],["production-earnings",{},404,"unavailable"]]){
    const {response,value}=await request("/api/launchpad/"+route,body);
    report.routes.push({route,code:response.status,status:value.status,requestId:response.headers.get("x-nf-request-id")});save();

    assert.equal(response.status,code);assert.equal(value.status,status);
    if(route==="production-creation"){const cookie=response.headers.get("set-cookie")??"";assert.ok(["Secure","HttpOnly","SameSite=Strict"].every(s=>cookie.includes(s)));assert.match(value.nonce,/^[0-9a-f]{64}$/)}
  }
  for(const [name,engine,viewport] of [["mobile WebKit",webkit,{width:390,height:844}],["desktop Chromium",chromium,{width:1280,height:820}]]){
    const browser=await engine.launch();
    try{
      const page=await browser.newPage({viewport,serviceWorkers:"block"});
      await page.addInitScript(()=>{
        // Only client-side account and chain selection. There are no keys in this fixture.
        const test={address:"0x2222222222222222222222222222222222222222",methods:[]};window.reviewWallet=test;
        window.ethereum={isMetaMask:true,on(){},removeListener(){},request:async({method,params})=>{
          test.methods.push(method);
          if(method==="eth_accounts"||method==="eth_requestAccounts")return [test.address];
          if(method==="eth_chainId")return "0x1237";
          if(method==="personal_sign")test.loginRequest=params;
          throw Error("Nonspending check only");
        }};
      });
      const nav=await page.goto(origin+"/create-token",{waitUntil:"domcontentloaded",timeout:75000});
      assert.equal(nav.status(),200);await page.getByText(/Owner creation acceptance/).first().waitFor({timeout:60000});
      await page.locator("#draft-name").fill("RMT");await page.locator("#draft-symbol").fill("RMT");
      await page.getByRole("button",{name:"Review draft",exact:true}).click();
      await page.getByRole("heading",{name:"Review token draft"}).waitFor();
      const connect=page.getByRole("button",{name:"Connect wallet",exact:true});
      await connect.click();await page.getByText("Connect an injected wallet on Robinhood Chain 4663.").waitFor();
      assert.equal(await page.getByRole("button",{name:/Sign in to preview/}).count(),0);
      await page.evaluate(address=>window.reviewWallet.address=address,approval.owner);await connect.click();
      await page.getByRole("button",{name:/Sign in to preview/}).waitFor();
      const challengeResponse=page.waitForResponse(r=>r.url()===origin+"/api/launchpad/production-creation"&&r.request().method()==="POST",{timeout:60000});
      await page.getByRole("button",{name:/Sign in to preview/}).click();
      const challenge=await challengeResponse;
      assert.equal(challenge.status(),200);
      const message=await challenge.json();assert.equal(message.status,"owner-login");assert.match(message.nonce,/^[a-f0-9]{64}$/);
      const cookies=await page.context().cookies(origin);
      const cookie=cookies.find(c=>c.name==="__Host-rmt-owner-preview"&&c.domain===new URL(origin).host&&c.path==="/");
      assert.ok(cookie?.httpOnly && cookie.secure && cookie.sameSite==="Strict", "Native wallet browser did not retain the strict owner cookie");
      const components=cookie.value.match(/^(\d{13})\.([0-9a-f]{64})$/);
      assert.ok(components && Number(components[1])===message.issuedAt && createHash("sha256").update(components[2]).digest("hex")===message.nonce,"Cookie/challenge mismatch");
      const attributes=(await challenge.headerValue("set-cookie")??"").split(";").slice(1).map(a=>a.trim());
      assert.ok(["Path=/","Secure","HttpOnly","SameSite=Strict","Max-Age=600"].every(a=>attributes.includes(a)));
      await page.waitForFunction(()=>window.reviewWallet.methods.includes("personal_sign"),null,{timeout:30000});
      const loginRequest=await page.evaluate(()=>window.reviewWallet.loginRequest);
      assert.equal(loginRequest[1].toLowerCase(),approval.owner.toLowerCase());
      const login=parseSiweMessage(hexToString(loginRequest[0]));
      assert.equal(login.domain,new URL(origin).host);assert.equal(login.uri,origin+"/create-token");
      assert.equal(login.address.toLowerCase(),approval.owner.toLowerCase());
      assert.equal(login.chainId,4663);assert.equal(login.requestId,approval.singleIntent);
      assert.equal(login.nonce,message.nonce);
      assert.equal(login.statement,"Access the unsigned RMT creation preview. This login grants no spending authority.");
      assert.ok(login.expirationTime.getTime()>Date.now());
      const methods=await page.evaluate(()=>window.reviewWallet.methods);
      assert.equal(methods.filter(m=>m==="personal_sign").length,1);
      assert.ok(methods.every(m=>["eth_accounts","eth_chainId","eth_requestAccounts","personal_sign"].includes(m)));
      report.browsers.push({name,at:new Date(),url:page.url(),http:nav.status(),requestId:nav.headers()["x-nf-request-id"],draftValidated:true,otherAccountBlocked:true,ownerPrompt:"Sign in to preview Â· no gas",strictCookieMatchedChallenge:true,browserPlatform:process.platform,challengeHttp:challenge.status(),challengeRequestId:challenge.headers()["x-nf-request-id"],loginMessage:{owner:login.address,domain:login.domain,uri:login.uri,chainId:login.chainId,intent:login.requestId,expiry:login.expirationTime},simulatedWalletDeclined:true,walletMethods:methods,realWallet:false});save();
    }finally{await browser.close()}
  }
  await discovery();
  for(let attempt=0;Number(report.discovery.at(-1).block)<=Number(report.discovery[0].block)&&attempt<4;attempt++){await wait(10000);await discovery()}
  assert.ok(Number(report.discovery.at(-1).block)>Number(report.discovery[0].block));
  assert.ok(report.routes.find(r=>r.route==="production-creation")?.code===200,"Published owner-login challenge rejected the canonical request");
  report.status="Verified live";report.finished=new Date();save();console.log(JSON.stringify({status:report.status,deploy:published.deployId,discovery:report.discovery.map(d=>d.block),browsers:report.browsers.map(b=>b.name)}));
}catch(e){report.status="Check incomplete";report.error=String(e.message).split("\n").slice(0,4).join("\n").slice(0,420);save();console.log(JSON.stringify({status:report.status,error:report.error,browsers:report.browsers.map(b=>b.name)}));process.exitCode=1}
