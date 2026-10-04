import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installTokenRoutes } from './token-presentation-fixtures.mjs';
import { TOKEN_MARKETS, canonicalDirectoryMarkets } from './legion-fixtures.mjs';
const base = process.env.RMT_VISUAL_BASE_URL ?? 'http://127.0.0.1:3202';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const output = path.resolve(process.env.RMT_VISUAL_OUTPUT ?? 'terminal-visual-v2', 'live-scanners');
await mkdir(output, { recursive:true });
const fixture = JSON.parse(await readFile(new URL('../../apps/market-indexer/fixtures/launch-presentation-evidence.json', import.meta.url), 'utf8'));
const browser = await chromium.launch(), results = [];
const until = async (read, why) => { for(let n=0;n<100;n++){ if(await read()) return; await new Promise(r=>setTimeout(r,50)); } assert.fail(why); };
async function watch(page, selector) {
  await page.evaluate(selector => {
    const nodes=[...document.querySelectorAll(selector)], input=document.querySelector('#rmt-mobile-market-search,#rmt-desktop-market-search,#launch-search');
    window.__scannerWatch={nodes,y:nodes.map(n=>n.getBoundingClientRect().y),input,inputY:input?.getBoundingClientRect().y,scroll:scrollY,frames:0,replacements:0,hiddenArt:0,actionMovement:0,scrollMovement:0,inputMovement:0,active:true};
    const frame=()=>{const w=window.__scannerWatch;if(!w.active)return;w.frames++;
      w.replacements+=Number(w.nodes.some(n=>!n.isConnected));
      for(let i=0;i<w.nodes.length;i++){const n=w.nodes[i];w.actionMovement=Math.max(w.actionMovement,Math.abs(n.getBoundingClientRect().y-w.y[i]));const art=n.querySelector('.rmtMarketArtwork');const img=art?.querySelector('img');const fallback=art?.textContent?.trim();const visibleImage=img?.complete&&img.naturalWidth>0&&Number(getComputedStyle(img).opacity)>0;if(!art||art.getBoundingClientRect().width===0||(!fallback&&!visibleImage))w.hiddenArt++;}
      w.scrollMovement=Math.max(w.scrollMovement,Math.abs(scrollY-w.scroll));w.inputMovement=Math.max(w.inputMovement,Math.abs((w.input?.getBoundingClientRect().y??0)-(w.inputY??0)));requestAnimationFrame(frame);
    };requestAnimationFrame(frame);
  },selector);
}
async function continuity(page) {
  await page.clock.runFor(100);
  const r=await page.evaluate(()=>{const w=window.__scannerWatch;w.active=false;return {frames:w.frames,replacements:w.replacements,hiddenArt:w.hiddenArt,actionMovement:w.actionMovement,scrollMovement:w.scrollMovement,inputMovement:w.inputMovement};});
  assert.ok(r.frames>0);
  if(Object.entries(r).some(([key,value])=>key!=='frames'&&value!==0)){console.log(JSON.stringify({continuity:r,geometry:await page.evaluate(()=>({before:window.__scannerWatch.y,after:window.__scannerWatch.nodes.map(n=>n.getBoundingClientRect().y),scroll:scrollY,initialScroll:window.__scannerWatch.scroll,height:document.documentElement.scrollHeight,text:document.body.innerText.slice(0,3000)}))}));await page.screenshot({path:path.join(output,'continuity-failure.png')});}
  for(const key of ['replacements','hiddenArt','actionMovement','scrollMovement','inputMovement'])assert.equal(r[key],0,key);return r;
}
async function rankWindowAcceptance(page, width, selector, output) {
  // Controlled economics/ranking, never production data or provider admission.
  // The four named exact identities reproduce the owner's observed cutoff.
  const subjects = [
    ['TREE','0x496f7908020918046554c172b883c546cd353e6c'],
    ['DEGEN','0x0830a9dd26a04e959657ab6788d45f5725590c32'],
    ['CASHCAT','0x020bfc650a365f8bb26819deaabf3e21291018b4'],
    ['FLOKI','0x7cc1cc7fe807b38b0391206cff4282db63b2da80']
  ];
  const seed = Array.from({length:32},(_,i)=>{
    const [symbol,address] = subjects[i-20] ?? [`RANK${i}`,`0x${(800_000+i).toString(16).padStart(40,'0')}`];
    const token={address,name:symbol,symbol}, assetId=`eip155:4663/contract:${address}`;
    const template=TOKEN_MARKETS[1], pool={...template.canonicalMarkets[0],token1:address};
    const evidence={...template.primaryMarket,assetId,token,baseToken:token,provenance:'controlled-rank-window-fixture'};
    return {...template,...token,assetId,verifiedIdentity:{...token,decimals:18},primaryMarket:evidence,verifiedMarkets:[evidence],canonicalMarkets:[pool]};
  });
  let changed=false, excluded=false, reads=0;
  const ordered=()=>changed?[...seed.slice(24),...seed.slice(0,24)]:seed;
  const rowsNow=()=>ordered().map((row,i)=>({...row,
    imageUri:'https://cdn.dexscreener.com/scanner-rank-art',priceUsd:changed?0.00012:0.00011,
    buys1h:1000-i,sells1h:1,volume1h:1000,ageMinutes:i+1,priceChange24h:32-i,
    momentumScore:100-i,signal:'moving',...(excluded&&row.symbol==='TREE'?{volume1h:0,buys1h:0,sells1h:0}:{})}));
  await page.route('**/api/vnext/market-directory**',route=>{reads++;return route.fulfill({json:{canonical:true,inventorySource:'indexed',coverage:'complete',revalidationComplete:true,nextCursor:null,updatedAt:new Date().toISOString(),markets:seed.map(row=>({...canonicalDirectoryMarkets()[1],address:row.address,assetId:row.assetId,name:row.name,symbol:row.symbol,verifiedIdentity:row.verifiedIdentity,canonicalMarkets:row.canonicalMarkets}))}});});
  await page.route('**/api/markets/external',route=>{reads++;return route.fulfill({json:{markets:rowsNow(),stale:false,updatedAt:new Date().toISOString(),delayedSources:[]}});});
  const checks=[];
  for(const view of ['Active','Movers','New','Trending']) {
    changed=false;excluded=false;
    await page.goto(base,{waitUntil:'networkidle'});
    if(view!=='Active')await page.getByRole('button',{name:new RegExp(`^${view}\\s`)}).click();
    const rows=page.locator(selector), input=page.locator(width<768?'#rmt-mobile-market-search':'#rmt-desktop-market-search');
    await until(async()=>await rows.count()===24,'complete 24-row ranked window').catch(async error=>{console.log(JSON.stringify({view,url:page.url(),reads,rows:await rows.count(),body:await page.locator('body').innerText()}));throw error;});
    await until(()=>rows.last().locator('img').evaluate(n=>n.complete&&n.naturalWidth>0&&Number(getComputedStyle(n).opacity)>0),'rank window artwork ready');
    await page.clock.runFor(2000);
    const identities=()=>rows.evaluateAll(nodes=>nodes.map(n=>n.querySelector('strong')?.textContent));
    const baseline=await identities();assert.deepEqual(baseline.slice(-4),subjects.map(([symbol])=>symbol));
    await input.fill(' ');await input.evaluate(n=>n.setSelectionRange(1,1));
    await page.evaluate(()=>scrollTo({top:150,behavior:'instant'}));await page.clock.runFor(2000);
    await rows.first().dispatchEvent('pointerdown');await watch(page,selector);
    changed=true;const beforeReads=reads;await page.clock.fastForward(61000);
    await until(async()=>reads>beforeReads&&await page.locator('.rmtScannerUpdates button').count()===1,'fresh ranking crosses cutoff during hold');
    assert.deepEqual(await identities(),baseline,'still-eligible rows/order remain mounted outside fresh top24');
    assert.equal(await rows.count(),24,'hold never appends unseen entrants');
    const metricsChanged=await rows.last().innerText();assert.ok(metricsChanged.includes('0.00012'),'held row uses current metrics');
    const stable=await continuity(page);
    const focus=await input.evaluate(n=>({focused:document.activeElement===n,caret:n.selectionStart}));assert.deepEqual(focus,{focused:true,caret:1});
    await page.screenshot({path:path.join(output,`held-${width}-${view.toLowerCase()}.png`),fullPage:false});
    await page.locator('body').dispatchEvent('pointerup');await input.evaluate(n=>n.blur());
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.clock.runFor(2000);
    await until(async()=>!(await identities()).includes('TREE'),'top + idle adopts fresh window');
    assert.equal(await rows.count(),24);assert.notDeepEqual(await identities(),baseline);
    checks.push({view,stable,focus,heldWindow:24,rankingDetachments:0,postHoldFresh:true});
  }
  // Positive eligibility loss still overrides a hold; intentional removal is
  // checked separately from the zero-movement rank-omission invariant.
  changed=false;await page.goto(base,{waitUntil:'networkidle'});const rows=page.locator(selector);
  await until(async()=>await rows.count()===24,'exclusion baseline');
  await page.locator(width<768?'#rmt-mobile-market-search':'#rmt-desktop-market-search').fill(' ');
  excluded=true;const beforeReads=reads;await page.clock.fastForward(61000);
  await until(async()=>reads>beforeReads&&!(await rows.evaluateAll(nodes=>nodes.map(n=>n.querySelector('strong')?.textContent))).includes('TREE'),'excluded activity evidence removes TREE during hold');
  assert.equal(await rows.count(),23);
  excluded=false;const beforeReentry=reads;await page.clock.fastForward(61000);
  await until(()=>reads>beforeReentry,'fresh qualification revalidated');await page.clock.runFor(200);
  assert.equal(await rows.count(),23,'an authoritatively removed row is a pending entrant if it requalifies during hold');
  await page.locator('.rmtScannerUpdates button').click();await until(async()=>await rows.count()===24,'requalified entrant returns only on publication');
  return {width,evidence:'CONTROLLED_RANK_BOUNDARY_TRANSITIONS_NOT_PRODUCTION',checks,authoritativeExclusion:true,requalifiedEntrantDeferred:true};
}
async function workspaceRefreshAcceptance(page, width) {
  await installTokenRoutes(page);
  await page.goto(base,{waitUntil:'networkidle'});
  await page.locator(width<768?'.rmtMobileMarketRow':'.rmtMarketTableRow').filter({hasText:'PONS'}).first().click();
  await page.locator('.vnAssetWorkspace').waitFor();await page.clock.runFor(2000);
  if(width<768)await page.getByRole('button',{name:'Buy',exact:true}).click();
  await page.clock.runFor(2000); // Finish the intentional sheet-open transition before measuring passive updates.
  const amount=page.locator('input[aria-label="Exact input amount"]:visible').first();
  await amount.fill('0.01');await page.clock.runFor(500);await amount.focus();await amount.evaluate(n=>n.setSelectionRange(2,2));
  await new Promise(resolve=>setTimeout(resolve,600)); // CSS transitions use wall time even with the JS clock installed.
  const before=await amount.evaluate(n=>({value:n.value,caret:n.selectionStart,focused:document.activeElement===n,y:n.getBoundingClientRect().y}));
  assert.equal(before.focused,true);
  const heading=await page.locator('#vn-asset-heading').innerText(),url=page.url(),scroll=await page.evaluate(()=>scrollY);
  let reads=0;const count=request=>{if(request.url().includes('/api/vnext/asset-workspace'))reads++;};page.on('request',count);
  await page.clock.fastForward(61000);await until(()=>reads>0,'selected workspace passively revalidates');await page.clock.runFor(500);
  assert.equal(await page.locator('#vn-asset-heading').innerText(),heading);assert.equal(page.url(),url);
  assert.deepEqual(await amount.evaluate(n=>({value:n.value,caret:n.selectionStart,focused:document.activeElement===n,y:n.getBoundingClientRect().y})),before,'composer value/focus/caret/action position survive passive reads');
  assert.equal(await page.evaluate(()=>scrollY),scroll);page.off('request',count);
  return {width,evidence:'CONTROLLED_READ_ONLY_SIGNED_OUT_COMPOSER',selectedIdentity:heading,passiveReads:reads,focusCaretRetained:true,actionMovement:0,scrollMovement:0};
}
try { for(const width of [375,390,430,1440]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844},isMobile:width<768,hasTouch:width<768});
  await context.addInitScript(()=>{window.__walletCalls=[];window.ethereum={on(){},removeListener(){},async request({method}){window.__walletCalls.push(method);return method==='eth_chainId'?'0x1237':[];}};});
  const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
  await installTokenRoutes(page);let generation=0, reads=0, unavailable=false;
  let artworkFailures=0;
  await page.route('**/api/vnext/token-artwork?**',async route=>{const legacy=new URL(route.request().url()).searchParams.get('legacy');await new Promise(r=>setTimeout(r,150));if(legacy?.includes('scanner-art-2')){artworkFailures++;return route.fulfill({status:404,body:''});}return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#25c95b"/></svg>'});});
  const canonical=canonicalDirectoryMarkets(), all=TOKEN_MARKETS.slice(0,6), count=()=>generation===0?4:generation===1?5:6;
  await page.route('**/api/vnext/market-directory**',route=>{reads++;return route.fulfill({status:unavailable?503:200,json:unavailable?{}:{canonical:true,inventorySource:'indexed',coverage:'complete',revalidationComplete:true,nextCursor:null,updatedAt:new Date().toISOString(),markets:canonical.filter(row=>all.slice(0,count()).some(m=>m.address===row.address))}});});
  await page.route('**/api/markets/external',route=>{reads++;return route.fulfill({status:unavailable?503:200,json:unavailable?{}:{markets:all.slice(0,count()).map((row,i)=>({...row,imageUri:`https://cdn.dexscreener.com/scanner-art-${generation}`,priceUsd:0.0001+generation*0.00001,ageMinutes:20+i,volume1h:1000,buys1h:generation>=3?(i+1)*100:(6-i)*100,sells1h:1})),stale:false,updatedAt:new Date().toISOString(),delayedSources:[]}});});
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:120000});await page.getByRole('button',{name:'I understand — enter RMT',exact:true}).click();
  const selector=width<768?'.rmtMobileMarketRow':'.rmtMarketTableRow', rows=page.locator(selector), input=page.locator(width<768?'#rmt-mobile-market-search':'#rmt-desktop-market-search');
  const rowIdentities=()=>rows.evaluateAll(nodes=>nodes.map(node=>node.querySelector('strong')?.textContent));
  await until(async()=>await rows.count()===4,'four active rows');await until(()=>rows.first().locator('img').evaluate(n=>n.complete&&n.naturalWidth>0&&Number(getComputedStyle(n).opacity)>0),'initial controlled artwork loads');await page.clock.runFor(2000);
  await input.fill(' ');await input.evaluate(n=>n.setSelectionRange(1,1));const before=await rows.allTextContents();await watch(page,selector);
  generation=1;const previous=reads;await page.clock.fastForward(61000);await until(async()=>reads>previous&&await page.locator('.rmtScannerUpdates button').count()===1,'new Active evidence arrives passively');
  assert.equal(await rows.count(),4,'new rows held while typing');assert.notDeepEqual(await rows.allTextContents(),before,'existing metric updates in place');
  const focus=await input.evaluate(n=>({value:n.value,caret:n.selectionStart,focused:document.activeElement===n}));assert.deepEqual(focus,{value:' ',caret:1,focused:true});const activeContinuity=await continuity(page);
  await page.locator('.rmtScannerUpdates button').click();await until(async()=>await rows.count()===5,'intentional publish');await input.fill('');await input.evaluate(n=>n.blur());
  await page.getByRole('button',{name:/^New\s/}).click();await page.clock.runFor(2000);generation=2;await page.clock.fastForward(61000);await until(async()=>await rows.count()===6,'New receives a new eligible row without navigation');await until(()=>artworkFailures>0,'controlled artwork failure');assert.equal(await rows.first().locator('img').evaluateAll(images=>images.some(n=>n.complete&&n.naturalWidth>0&&Number(getComputedStyle(n).opacity)>0)),true,'last-good artwork survives failed replacement');
  await page.getByRole('button',{name:/^Active\s/}).click();await page.clock.runFor(2000);await page.evaluate(()=>scrollTo({top:150,behavior:'instant'}));await page.clock.runFor(2000);await rows.first().dispatchEvent('pointerdown');const order=await rowIdentities();await watch(page,selector);generation=3;await page.clock.fastForward(61000);await until(async()=>await page.locator('.rmtScannerUpdates button').count()===1,'ranking update deferred under touch');assert.deepEqual(await rowIdentities(),order);const rankContinuity=await continuity(page);await page.locator('body').dispatchEvent('pointerup');
  await page.locator('.rmtScannerUpdates button').click();await page.clock.runFor(2000);assert.notDeepEqual(await rowIdentities(),order);
  unavailable=true;const retained=await rowIdentities();const failedAt=reads;await page.clock.fastForward(61000);await until(()=>reads>failedAt,'outage read');assert.deepEqual(await rowIdentities(),retained,'failed refresh retains known rows');
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});const background=reads;await page.clock.fastForward(180000);assert.equal(reads,background,'hidden scanner does not poll');
  unavailable=false;await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('focus'));dispatchEvent(new Event('online'));});await page.clock.runFor(10);await until(()=>reads>background,'resume revalidates');
  await page.getByRole('button',{name:/^Movers\s/}).click();const geometryBefore=await input.boundingBox();await page.locator('.rmtExploreTrigger').click();assert.equal((await input.boundingBox()).y,geometryBefore.y,'Explore overlays rather than pushes the scanner');await page.locator('.rmtExploreDialog fieldset button').filter({has:page.locator('span',{hasText:/^RWA$/})}).click();assert.equal(await page.getByRole('button',{name:/^Movers\s/}).getAttribute('aria-pressed'),'true','universe does not replace activity');await page.evaluate(()=>history.back());await until(()=>page.evaluate(()=>new URL(location.href).searchParams.get('universe')!=='rwa'),'scope history back');await page.evaluate(()=>history.forward());await until(()=>page.evaluate(()=>new URL(location.href).searchParams.get('universe')==='rwa'),'scope history forward');await page.locator('.rmtExploreTrigger').click();assert.equal(await page.locator('.rmtExploreDialog fieldset button').filter({has:page.locator('span',{hasText:/^RWA$/})}).getAttribute('aria-pressed'),'true');await page.keyboard.press('Escape');assert.equal(await page.locator('.rmtExploreDialog[open]').count(),0);assert.equal(await page.locator('.rmtExploreTrigger').evaluate(n=>document.activeElement===n),true,'Explore restores focus');
  results.push({width,evidence:'CONTROLLED_STATE_TRANSITIONS_NOT_PRODUCTION',activeNew:true,newNew:true,rank:true,focus,activeContinuity,rankContinuity,background:true,retained:true,exploreGeometryMovement:0,scopeHistory:true,exploreFocusRestored:true,lastGoodArtwork:true});
  results.push(await rankWindowAcceptance(page,width,selector,output));
  results.push(await workspaceRefreshAcceptance(page,width));
  for(const source of ['PONS','STONKBROKERS']) {
    let changed=false, trimPage=false, launchReads=0;
    const entries=fixture.directory.entries.filter(e=>e.source===source), finished=entries.find(e=>e.state==='GRADUATED');assert.ok(finished);
    await page.route('**/api/vnext/launches?**',route=>{launchReads++;const staged=[changed?finished:{...finished,state:'BONDING',graduationBlock:null,graduationTransaction:null,graduatedMarkets:[]},...entries.filter(e=>e.launchId!==finished.launchId).slice(0,changed?2:1)];return route.fulfill({status:200,json:{...fixture.directory,entries:trimPage?staged.slice(0,2):staged,nextCursor:trimPage?'controlledOlderPage':null,availableSources:['PONS','STONKBROKERS']}});});
    await page.goto(`${base}/launches?source=${source}`,{waitUntil:'networkidle',timeout:120000});await page.clock.runFor(1000);await page.clock.fastForward(31000);await until(()=>launchReads>0,'launch passive read');await until(async()=>await page.locator('.rmtLaunchRow').count()===2,'controlled baseline');await page.clock.runFor(2000);
    await page.locator('#launch-search').fill('reading');await page.locator('#launch-search').evaluate(n=>n.setSelectionRange(3,3));await watch(page,'.rmtLaunchRow');changed=true;const prior=launchReads;await page.clock.fastForward(31000);await until(async()=>launchReads>prior&&await page.locator('.rmtLaunchRow').first().innerText().then(t=>t.includes('Graduated')),'state transition without navigation');assert.equal(await page.locator('.rmtLaunchRow').count(),2,'membership deferred while typing');const stability=await continuity(page);const caret=await page.locator('#launch-search').evaluate(n=>({value:n.value,caret:n.selectionStart,focused:document.activeElement===n}));assert.deepEqual(caret,{value:'reading',caret:3,focused:true});await page.locator('.rmtScannerUpdates button').click();await until(async()=>await page.locator('.rmtLaunchRow').count()===3,'new launch publishes intentionally');await page.locator('#launch-search').focus();await watch(page,'.rmtLaunchRow');trimPage=true;const beforeTrim=launchReads;await page.clock.fastForward(31000);await until(async()=>launchReads>beforeTrim&&await page.locator('.rmtScannerUpdates button').count()===1,'bounded page window changes');assert.equal(await page.locator('.rmtLaunchRow').count(),3,'page omission is not authoritative deletion while typing');const pagedContinuity=await continuity(page);await page.locator('.rmtScannerUpdates button').click();await until(async()=>await page.locator('.rmtLaunchRow').count()===2,'intentional window publication');results.push({width,source,evidence:'CONTROLLED_STATE_TRANSITIONS_NOT_PRODUCTION',passiveGraduation:true,stability,pagedContinuity,caret});
  }
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0);assert.equal(await page.evaluate(()=>window.__walletCalls.length),0);await context.close();await writeFile(path.join(output,'report.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({width,activeNew:true,newNew:true,liveBothLaunchSources:true,allContinuityZero:true}));
}} finally {await browser.close();}
