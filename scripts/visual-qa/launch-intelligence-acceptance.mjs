import assert from "node:assert/strict";
import {chromium} from "playwright";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {launchFixtureService} from "./launch-fixture-service.mjs";
import {captureAccountSurface} from "../../.github/scripts/account-first-browser-capture.mjs";
const base=process.env.RMT_VISUAL_BASE_URL??"http://127.0.0.1:3182";
assert.ok(["localhost","127.0.0.1"].includes(new URL(base).hostname));
const output=path.resolve(process.env.RMT_VISUAL_OUTPUT??"terminal-visual-v2","launches");await mkdir(output,{recursive:true});
const {server,state,fixture}=launchFixtureService();await new Promise(resolve=>server.listen(43112,"127.0.0.1",resolve));
const browser=await chromium.launch();const results=[],failures=[];
try {
for(const viewport of [{width:375,height:812},{width:390,height:844},{width:430,height:932},{width:1440,height:900}]){
  const context=await browser.newContext({viewport,isMobile:viewport.width<768,hasTouch:viewport.width<768});const page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(()=>{window.__walletRequests=0;window.ethereum={on(){},removeListener(){},async request({method}){if(/sign|sendTransaction|wallet_sendCalls/.test(method)){window.__walletRequests++;throw Error("Financial action prohibited");}return method==="eth_chainId"?"0x1237":[];}};});
  await page.route("**/api/vnext/asset-workspace?**",route=>route.fulfill({status:503,json:{error:"CONTROLLED_MARKET_ENRICHMENT_UNAVAILABLE"}}));
  await page.route("**/api/markets/ohlcv?**",route=>route.fulfill({status:503,json:{error:"CONTROLLED_CHART_UNAVAILABLE"}}));
  await page.route("**/api/vnext/asset-identity?**",route=>route.fulfill({status:503,json:{error:"CONTROLLED_METADATA_UNAVAILABLE"}}));
  const capture=async name=>{const fonts=await captureAccountSurface(page,path.join(output,`${viewport.width}-${name}.png`));const measures=await page.evaluate(()=>({overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),walletRequests:window.__walletRequests}));assert.equal(measures.overflow,0,name);assert.equal(measures.walletRequests,0);results.push({viewport,name,evidence:fixture.evidence,...measures,fontReadinessMs:fonts.readinessMs});};
  state.mode="ready";state.delay=0;
  await page.goto(`${base}/launches`,{waitUntil:"domcontentloaded",timeout:120000});await page.locator(".rmtLaunchCard").first().waitFor();
  assert.equal(await page.locator(".rmtLaunchCard").count(),6);assert.ok(await page.getByRole("link",{name:"pons",exact:true}).count());assert.ok(await page.getByRole("link",{name:"StonkBrokers",exact:true}).count());
  await capture("all-sources");
  const stability=await page.evaluate(()=>{const card=document.querySelector('.rmtLaunchCard');window.__launchCard=card;window.__launchAnchor={x:card.getBoundingClientRect().x,y:card.getBoundingClientRect().y,scroll:scrollY,actionY:card.querySelector(".rmtLaunchAction").getBoundingClientRect().y};return window.__launchAnchor;});
  await page.locator('#launch-search').fill('reading');await page.locator('#launch-search').evaluate(input=>input.setSelectionRange(2,2));
  const before=await page.locator('#launch-search').evaluate(input=>({value:input.value,caret:input.selectionStart}));
  await page.waitForTimeout(650);
  const after=await page.locator('#launch-search').evaluate(input=>({value:input.value,caret:input.selectionStart,focused:document.activeElement===input}));assert.deepEqual({value:after.value,caret:after.caret},before);assert.equal(after.focused,true);
  const stable=await page.evaluate(()=>{const card=document.querySelector('.rmtLaunchCard'),r=card.getBoundingClientRect();return {sameCard:card===window.__launchCard,actionMovement:Math.abs(card.querySelector(".rmtLaunchAction").getBoundingClientRect().y-window.__launchAnchor.actionY),cardMovement:Math.abs(r.y-window.__launchAnchor.y),scrollMovement:Math.abs(scrollY-window.__launchAnchor.scroll)};});assert.equal(stable.sameCard,true);assert.equal(stable.actionMovement,0);assert.equal(stable.cardMovement,0);assert.equal(stable.scrollMovement,0);results.push({viewport,name:'artwork-loading-continuity',...stable});
  await page.locator('#launch-search').fill('');

  await page.getByRole("button",{name:"More launches",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll(".rmtLaunchCard").length===10);
  const clock=page.locator('.rmtLaunchCard[data-token="0x53ab2efc7eacb23a4c7af32fddb2ccdc0a172fc6"]');assert.equal(await clock.getByRole("progressbar").count(),0,"Do not show current market cap ratio as incomplete historical graduation");
  const first=page.locator(".rmtLaunchCard").first();await first.locator("summary").click();await capture("origin-evidence");await first.locator("summary").click();
  const expected=fixture.directory.entries[0];
  await first.scrollIntoViewIfNeeded();
  await page.evaluate(token=>{window.__nav={started:performance.now(),genericFrames:0,shell:null,identity:null,ticket:null,token,done:false};const inspect=()=>{const n=window.__nav;if(n.done)return;const h=document.querySelector('#vn-asset-heading');const generic=document.querySelector('#rmt-market-directory-heading');if(generic&&generic.getClientRects().length&&!document.querySelector(".vnAssetWorkspace"))n.genericFrames++;const shell=document.querySelector('.vnAssetWorkspace');if(shell&&n.shell===null)n.shell=performance.now()-n.started;const text=document.querySelector('.vnAssetWorkspace')?.textContent??'';if((text.includes('BUNEE')||text.toLowerCase().includes(token))&&n.identity===null)n.identity=performance.now()-n.started;if(document.querySelector('.vnTradePanel')&&n.ticket===null)n.ticket=performance.now()-n.started;requestAnimationFrame(inspect);};requestAnimationFrame(inspect);},expected.token);
  await first.getByRole("link",{name:"Open BUNEE token market"}).click();await page.waitForURL(url=>url.searchParams.get("market")===expected.token,{timeout:120000});await page.locator("#vn-asset-heading").filter({hasText:expected.identity.name}).waitFor({timeout:30000});
  const navigation=await page.evaluate(()=>{window.__nav.done=true;return window.__nav;});assert.equal(navigation.genericFrames,0);assert.equal(new URL(page.url()).searchParams.get("market"),expected.token);results.push({viewport,name:"launch-to-token",...navigation});
  await capture("exact-token-workspace");
  await page.getByRole("tab",{name:"More",exact:true}).click();await page.getByText("Launch origin",{exact:true}).waitFor();assert.ok((await page.locator("body").innerText()).includes("pons"));await capture("token-origin");
  await page.goto(`${base}/launches?source=STONKBROKERS`,{waitUntil:"domcontentloaded"});await page.locator(".rmtLaunchCard").first().waitFor();assert.equal(await page.locator('.rmtLaunchCard[data-launch-id^="0x7ed"]').count(),0);await capture("stonk-source");
  await page.locator("#launch-search").fill("MONVERA");await page.getByRole("button",{name:"Search",exact:true}).click();await page.waitForURL("**q=MONVERA*");await page.locator(".rmtLaunchCard").first().waitFor();assert.equal(await page.locator(".rmtLaunchCard").count(),1);assert.ok((await page.locator("body").innerText()).includes("Existing token enrolled"));await capture("enrolled-token");
  state.mode="retained-outage";await page.goto(`${base}/launches?q=DOODLR`,{waitUntil:"domcontentloaded"});await page.getByText("Launch updates delayed. Showing recorded origins.").waitFor();assert.equal(await page.locator(".rmtLaunchCard").count(),1);await capture("retained-index-outage");
  await page.route('**/api/vnext/token-artwork?**',route=>route.fulfill({status:404}));
  state.mode="lens-unavailable";await page.goto(`${base}/launches?q=RUG`,{waitUntil:'domcontentloaded'});await page.locator('.rmtLaunchCard').first().waitFor();await capture('lens-and-artwork-unavailable');
  await page.unroute('**/api/vnext/token-artwork?**');
  state.mode="metadata-unavailable";await page.goto(`${base}/launches?q=${fixture.directory.entries[3].token}`,{waitUntil:"domcontentloaded"});await page.locator(".rmtLaunchCard").first().waitFor();await capture("unknown-metadata");
  state.mode="empty-outage";await page.goto(`${base}/launches?q=controlled-outage`,{waitUntil:"domcontentloaded"});await page.getByText("Launch discovery is temporarily unavailable. Markets remain available.").waitFor();await capture("index-outage");
  state.mode="ready";assert.deepEqual(errors,[]);await context.close();
}
} catch(error){failures.push(String(error));throw error;} finally{await browser.close();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,"acceptance.json"),JSON.stringify({evidence:fixture.evidence,reviewedHead:process.env.RMT_REVIEWED_HEAD??null,results,failures,upstreamReads:state.requests.length,passiveWalletRequests:0},null,2));}
