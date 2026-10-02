import assert from "node:assert/strict";
import {chromium} from "playwright";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {installTokenRoutes} from "./token-presentation-fixtures.mjs";
import {launchFixtureService} from "./launch-fixture-service.mjs";
import {captureAccountSurface} from "../../.github/scripts/account-first-browser-capture.mjs";
const base=process.env.RMT_VISUAL_BASE_URL??"http://127.0.0.1:3182";
assert.ok(["localhost","127.0.0.1"].includes(new URL(base).hostname));
const output=path.resolve(process.env.RMT_VISUAL_OUTPUT??"terminal-visual-v2","launches");await mkdir(output,{recursive:true});
const {server,state,fixture}=launchFixtureService();await new Promise(resolve=>server.listen(43112,"127.0.0.1",resolve));
const browser=await chromium.launch();const results=[],failures=[];
try {
for(const viewport of [{width:375,height:812},{width:390,height:844},{width:430,height:932},{width:1440,height:900}]){
  // Distinct ordinary case-insensitive searches isolate controlled provider
  // states from the real server's 15-second data cache across viewport lanes.
  const lane=[375,390,430,1440].indexOf(viewport.width);
  const retainedQuery=['DOODLR','doodlr','Doodlr','dooDLR'][lane];
  const lensQuery=['RUG','rug','Rug','rUG'][lane];
  const metadataQuery=[fixture.directory.entries[3].token,fixture.directory.entries[3].token.toUpperCase().replace('0X','0x'),fixture.directory.entries[3].token.replace('266f','266F'),fixture.directory.entries[3].token.replace('d224','D224')][lane];
  const context=await browser.newContext({viewport,isMobile:viewport.width<768,hasTouch:viewport.width<768});const page=await context.newPage();const errors=[],artworkResponses=[];page.on("pageerror",error=>errors.push(error.message));
  page.on('response',response=>{const url=new URL(response.url());if(url.pathname==='/api/vnext/token-artwork')artworkResponses.push({boundary:'RMT_ARTWORK_PROXY',token:url.searchParams.get('address'),status:response.status()});});
  // Monitor both the Launches page and its actual Markets companion.
  await context.addInitScript(()=>{window.__walletRequests=0;window.ethereum={on(){},removeListener(){},async request({method}){if(/sign|sendTransaction|wallet_sendCalls/.test(method)){window.__walletRequests++;throw Error("Financial action prohibited");}return method==="eth_chainId"?"0x1237":[];}};});
  await page.route("**/api/vnext/asset-workspace?**",route=>route.fulfill({status:503,json:{error:"CONTROLLED_MARKET_ENRICHMENT_UNAVAILABLE"}}));
  await page.route("**/api/markets/ohlcv?**",route=>route.fulfill({status:503,json:{error:"CONTROLLED_CHART_UNAVAILABLE"}}));
  await page.route("**/api/vnext/asset-identity?**",route=>route.fulfill({status:503,json:{error:"CONTROLLED_METADATA_UNAVAILABLE"}}));
  const capture=async name=>{const fonts=await captureAccountSurface(page,path.join(output,`${viewport.width}-${name}.png`));const measures=await page.evaluate(()=>({overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),walletRequests:window.__walletRequests}));assert.equal(measures.overflow,0,name);assert.equal(measures.walletRequests,0);results.push({viewport,name,evidence:fixture.evidence,...measures,fontReadinessMs:fonts.readinessMs});};
  state.mode="ready";state.delay=0;
  await page.goto(`${base}/launches`,{waitUntil:"domcontentloaded",timeout:120000});await page.locator(".rmtLaunchRow").first().waitFor();
  assert.equal(await page.locator(".rmtLaunchRow").count(),6);assert.ok(await page.getByRole("link",{name:"pons",exact:true}).count());assert.ok(await page.getByRole("link",{name:"StonkBrokers",exact:true}).count());
  await capture("all-sources");
  const density=await page.locator('.rmtLaunchRow').evaluateAll(rows=>({rowHeights:rows.map(row=>row.getBoundingClientRect().height),fullyVisible:rows.filter(row=>{const r=row.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}).length,artworkSizes:rows.map(row=>row.querySelector('.rmtMarketArtwork').getBoundingClientRect().width)}));
  assert.ok(density.rowHeights.every(height=>height<=80),'Launch discovery remains a compact scanner');
  assert.ok(density.fullyVisible>=4,'Many launches are visible together');
  results.push({viewport,name:'scanner-density',...density});
  const stability=await page.evaluate(()=>{const card=document.querySelector('.rmtLaunchRow');window.__launchCard=card;window.__launchAnchor={x:card.getBoundingClientRect().x,y:card.getBoundingClientRect().y,scroll:scrollY,actionY:card.getBoundingClientRect().y};return window.__launchAnchor;});
  await page.locator('#launch-search').fill('reading');await page.locator('#launch-search').evaluate(input=>input.setSelectionRange(2,2));
  const before=await page.locator('#launch-search').evaluate(input=>({value:input.value,caret:input.selectionStart}));
  await page.evaluate(()=>{
    const cards=[...document.querySelectorAll('.rmtLaunchRow')];
    const anchors=cards.map(card=>({card,y:card.getBoundingClientRect().y,actionY:card.getBoundingClientRect().y}));
    const scroll=scrollY;
    window.__launchFrames={active:true,frames:0,majorReplacementFrames:0,hiddenArtworkFrames:0,actionMovement:0,cardMovement:0,scrollMovement:0};
    const inspect=()=>{
      const result=window.__launchFrames;if(!result.active)return;result.frames++;
      if(anchors.some(({card})=>!card.isConnected))result.majorReplacementFrames++;
      if(anchors.some(({card})=>{const art=card.querySelector('.rmtLaunchArtwork');if(!art)return true;const fallback=art.querySelector('span'),img=art.querySelector('img');const fallbackVisible=fallback?.textContent?.trim()&&getComputedStyle(fallback).opacity!=='0';const imageVisible=img?.complete&&img.naturalWidth>0&&getComputedStyle(img).opacity!=='0';return !fallbackVisible&&!imageVisible;}))result.hiddenArtworkFrames++;
      for(const {card,y,actionY} of anchors){result.cardMovement=Math.max(result.cardMovement,Math.abs(card.getBoundingClientRect().y-y));result.actionMovement=Math.max(result.actionMovement,Math.abs(card.getBoundingClientRect().y-actionY));}
      result.scrollMovement=Math.max(result.scrollMovement,Math.abs(scrollY-scroll));requestAnimationFrame(inspect);
    };requestAnimationFrame(inspect);
  });
  // Observe real artwork completion (or its bounded unavailable fallback)
  // while retaining the same rows, controls, caret and scroll anchors.
  const artwork=await page.locator('.rmtLaunchArtwork img').evaluateAll(images=>Promise.all(images.map(img=>new Promise(resolve=>{
    const result=()=>({loaded:img.complete&&img.naturalWidth>0,complete:img.complete});
    if(img.complete)return resolve(result());
    const timer=setTimeout(()=>{img.removeEventListener('load',done);img.removeEventListener('error',done);resolve(result());},5000);
    function done(){clearTimeout(timer);img.removeEventListener('load',done);img.removeEventListener('error',done);resolve(result());}
    img.addEventListener('load',done);img.addEventListener('error',done);
  }))));
  await page.waitForTimeout(650);
  results.push({viewport,name:'artwork-boundary-outcomes',artwork});
  const frames=await page.evaluate(()=>{window.__launchFrames.active=false;return window.__launchFrames;});assert.ok(frames.frames>0);assert.equal(frames.majorReplacementFrames,0);assert.equal(frames.hiddenArtworkFrames,0);assert.equal(frames.actionMovement,0);assert.equal(frames.cardMovement,0);assert.equal(frames.scrollMovement,0);results.push({viewport,name:'continuous-frame-continuity',...frames});
  const after=await page.locator('#launch-search').evaluate(input=>({value:input.value,caret:input.selectionStart,focused:document.activeElement===input}));assert.deepEqual({value:after.value,caret:after.caret},before);assert.equal(after.focused,true);
  const stable=await page.evaluate(()=>{const card=document.querySelector('.rmtLaunchRow'),r=card.getBoundingClientRect();return {sameCard:card===window.__launchCard,actionMovement:Math.abs(card.getBoundingClientRect().y-window.__launchAnchor.actionY),cardMovement:Math.abs(r.y-window.__launchAnchor.y),scrollMovement:Math.abs(scrollY-window.__launchAnchor.scroll)};});assert.equal(stable.sameCard,true);assert.equal(stable.actionMovement,0);assert.equal(stable.cardMovement,0);assert.equal(stable.scrollMovement,0);results.push({viewport,name:'artwork-loading-continuity',...stable});
  await page.locator('#launch-search').fill('');
  await capture("scanner-artwork-settled");

  await page.getByRole("button",{name:"More launches",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll(".rmtLaunchRow").length===10);
  const clock=page.locator('.rmtLaunchRow[data-token="0x53ab2efc7eacb23a4c7af32fddb2ccdc0a172fc6"]');assert.equal(await clock.getByRole("progressbar").count(),0,"Do not show current market cap ratio as incomplete historical graduation");
  const first=page.locator(".rmtLaunchRow").first();
  assert.equal(await page.locator(".rmtLaunchScanner details").count(),0,"Discovery must not contain per-row technical dossiers");
  const expected=fixture.directory.entries[0];
  await first.scrollIntoViewIfNeeded();
  await page.evaluate(token=>{window.__nav={started:performance.now(),genericFrames:0,shell:null,identity:null,ticket:null,token,done:false};const inspect=()=>{const n=window.__nav;if(n.done)return;const h=document.querySelector('#vn-asset-heading');const generic=document.querySelector('#rmt-market-directory-heading');if(generic&&generic.getClientRects().length&&!document.querySelector(".vnAssetWorkspace"))n.genericFrames++;const shell=document.querySelector('.vnAssetWorkspace');if(shell&&n.shell===null)n.shell=performance.now()-n.started;const text=document.querySelector('.vnAssetWorkspace')?.textContent??'';if((text.includes('BUNEE')||text.toLowerCase().includes(token))&&n.identity===null)n.identity=performance.now()-n.started;if(document.querySelector('.vnTradePanel')&&n.ticket===null)n.ticket=performance.now()-n.started;requestAnimationFrame(inspect);};requestAnimationFrame(inspect);},expected.token);
  await first.click();await page.waitForURL(url=>url.searchParams.get("market")===expected.token,{waitUntil:"domcontentloaded",timeout:120000});await page.locator("#vn-asset-heading").filter({hasText:expected.identity.name}).waitFor({timeout:30000});
  const navigation=await page.evaluate(()=>{window.__nav.done=true;return window.__nav;});assert.equal(navigation.genericFrames,0);assert.equal(new URL(page.url()).searchParams.get("market"),expected.token);results.push({viewport,name:"launch-to-token",...navigation});
  // A fresh public session reaches the existing terminal disclosure. Use its
  // normal non-financial action before interacting with workspace tabs.
  await page.getByRole('button',{name:'I understand — enter RMT',exact:true}).click();
  await page.locator('.tradingTermsBackdrop').waitFor({state:'hidden'});
  await capture("exact-token-workspace");
  await page.getByRole("tab",{name:"More",exact:true}).click();
  const originSummary=page.locator('.vnMoreDisclosure > summary').filter({hasText:'Origin & launch'});
  const originDisclosure=originSummary.locator('..');
  const openedBefore=await originDisclosure.evaluate(details=>details.open);
  if(!openedBefore)await originSummary.click();
  const disclosureState=await originDisclosure.evaluate(details=>({open:details.open,summary:details.querySelector('summary')?.textContent,ancestry:[details,...function*(){for(let p=details.parentElement;p;p=p.parentElement)yield p;}()].map(e=>({tag:e.tagName,className:e.className,open:e.tagName==='DETAILS'?e.open:null,display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility}))}));
  results.push({viewport,name:'origin-disclosure',openedBefore,...disclosureState});
  try {
    // The established mobile chassis intentionally hides card eyebrows.
    // Assert the visible source heading and actual evidence, not hidden copy.
    await originDisclosure.locator('[data-launch-origin] h3').waitFor();
    assert.ok((await originDisclosure.locator('[data-launch-origin] h3').innerText()).includes('pons'));
    await originDisclosure.locator('[data-launch-origin]').getByText('Launched',{exact:true}).waitFor();
  } catch(error) {
    await capture('origin-disclosure-failure');
    await writeFile(path.join(output,`${viewport.width}-origin-disclosure-failure.html`),await originDisclosure.evaluate(details=>details.outerHTML));
    throw error;
  }
  assert.equal(await originDisclosure.evaluate(details=>details.open),true,'Origin disclosure must actually be open');
  assert.ok((await page.locator("body").innerText()).includes("pons"));await capture("token-origin");
  const origin=page.locator('[data-launch-origin]');await origin.locator('summary').click();await capture("origin-evidence");await origin.getByText('Source contract',{exact:true}).waitFor();
  const evidenceLinks=await origin.locator('a[href]').evaluateAll(links=>links.map(link=>link.href.toLowerCase()));
  assert.ok(evidenceLinks.some(href=>href.endsWith('/'+expected.sourceContract)));
  assert.ok(evidenceLinks.some(href=>href.endsWith('/'+expected.launchTransaction)));
  await page.goto(`${base}/launches?source=STONKBROKERS`,{waitUntil:"domcontentloaded"});await page.locator(".rmtLaunchRow").first().waitFor();assert.equal(await page.locator('.rmtLaunchRow[data-launch-id^="0x7ed"]').count(),0);await capture("stonk-source");
  await page.locator("#launch-search").fill("MONVERA");await page.getByRole("button",{name:"Find",exact:true}).click();
  // A correct rendered destination must not wait for unrelated subresources
  // to finish the document load. Preserve exact URL and identity assertions.
  await page.waitForURL(url=>url.pathname==='/launches'&&url.searchParams.get('q')==='MONVERA'&&url.searchParams.get('source')==='STONKBROKERS',{waitUntil:'domcontentloaded'});
  const enrolled=fixture.directory.entries.find(entry=>entry.identity.symbol==='MONVERA');assert.ok(enrolled);
  await page.locator(`.rmtLaunchRow[data-token="${enrolled.token}"]`).waitFor();assert.equal(await page.locator(".rmtLaunchRow").count(),1);assert.ok((await page.locator("body").innerText()).includes("Existing token enrolled"));await capture("enrolled-token");
  state.mode="retained-outage";await page.goto(`${base}/launches?q=${retainedQuery}`,{waitUntil:"domcontentloaded"});await page.getByText("Launch updates delayed. Showing recorded origins.").waitFor();assert.equal(await page.locator(".rmtLaunchRow").count(),1);await capture("retained-index-outage");
  await page.route('**/api/vnext/token-artwork?**',route=>route.fulfill({status:404}));
  state.mode="lens-unavailable";await page.goto(`${base}/launches?q=${lensQuery}`,{waitUntil:'domcontentloaded'});await page.locator('.rmtLaunchRow').first().waitFor();await capture('lens-and-artwork-unavailable');
  await page.unroute('**/api/vnext/token-artwork?**');
  state.mode="metadata-unavailable";state.delay=300;await page.goto(`${base}/launches?q=${metadataQuery}`,{waitUntil:"domcontentloaded"});await page.locator(".rmtLaunchRow").first().waitFor();await capture("unknown-metadata-delayed-index");state.delay=0;
  state.mode="empty-outage";await page.goto(`${base}/launches?q=controlled-outage-${viewport.width}`,{waitUntil:"domcontentloaded"});await page.getByText("Launch discovery is temporarily unavailable. Markets remain available.").waitFor();await capture("index-outage");
  state.mode="ready";
  // Companion capture uses the existing real Markets components and external
  // fixture boundary, never a screenshot-only scanner implementation.
  const markets=await context.newPage();markets.on('pageerror',error=>errors.push(error.message));
  await installTokenRoutes(markets);
  await markets.goto(base,{waitUntil:'domcontentloaded',timeout:120000});
  const consent=markets.getByRole('button',{name:'I understand — enter RMT',exact:true});
  if(await consent.isVisible())await consent.click();
  await markets.locator(viewport.width<768?'.rmtMobileMarketRow':'.rmtMarketTableRow').first().waitFor();
  await captureAccountSurface(markets,path.join(output,`${viewport.width}-markets-companion.png`));
  const marketDensity=await markets.locator(viewport.width<768?'.rmtMobileMarketRow':'.rmtMarketTableRow').evaluateAll(rows=>({rowHeights:rows.map(row=>row.getBoundingClientRect().height),artworkSizes:rows.map(row=>row.querySelector('.rmtMarketArtwork').getBoundingClientRect().width),overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),walletRequests:window.__walletRequests}));
  assert.equal(marketDensity.overflow,0);assert.equal(marketDensity.walletRequests,0);
  assert.deepEqual([...new Set(density.artworkSizes)],[...new Set(marketDensity.artworkSizes)],'Shared Markets artwork sizing');
  results.push({viewport,name:'markets-chassis-companion',evidence:'CONTROLLED_EXISTING_MARKETS_EXTERNAL_FIXTURES',...marketDensity});
  results.push({viewport,name:'artwork-proxy-results',responses:artworkResponses});
  assert.deepEqual(errors,[]);await context.close();
}
} catch(error){failures.push(String(error));throw error;} finally{await browser.close();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,"acceptance.json"),JSON.stringify({evidence:fixture.evidence,reviewedHead:process.env.RMT_REVIEWED_HEAD??null,results,failures,upstreamReads:state.requests.length,passiveWalletRequests:0},null,2));}
