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
try { for(const width of [375,390,430,1440]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844},isMobile:width<768,hasTouch:width<768});
  await context.addInitScript(()=>{window.__walletCalls=[];window.ethereum={on(){},removeListener(){},async request({method}){window.__walletCalls.push(method);return method==='eth_chainId'?'0x1237':[];}};});
  const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
  await installTokenRoutes(page);let generation=0, reads=0, unavailable=false;
  const canonical=canonicalDirectoryMarkets(), all=TOKEN_MARKETS.slice(0,6), count=()=>generation===0?4:generation===1?5:6;
  await page.route('**/api/vnext/market-directory**',route=>{reads++;return route.fulfill({status:unavailable?503:200,json:unavailable?{}:{canonical:true,inventorySource:'indexed',coverage:'complete',revalidationComplete:true,nextCursor:null,updatedAt:new Date().toISOString(),markets:canonical.filter(row=>all.slice(0,count()).some(m=>m.address===row.address))}});});
  await page.route('**/api/markets/external',route=>{reads++;return route.fulfill({status:unavailable?503:200,json:unavailable?{}:{markets:all.slice(0,count()).map((row,i)=>({...row,priceUsd:0.0001+generation*0.00001,ageMinutes:20+i,volume1h:1000,buys1h:generation>=3?(i+1)*100:(6-i)*100,sells1h:1})),stale:false,updatedAt:new Date().toISOString(),delayedSources:[]}});});
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:120000});await page.getByRole('button',{name:'I understand — enter RMT',exact:true}).click();
  const selector=width<768?'.rmtMobileMarketRow':'.rmtMarketTableRow', rows=page.locator(selector), input=page.locator(width<768?'#rmt-mobile-market-search':'#rmt-desktop-market-search');
  const rowIdentities=()=>rows.evaluateAll(nodes=>nodes.map(node=>node.querySelector('strong')?.textContent));
  await until(async()=>await rows.count()===4,'four active rows');await page.clock.runFor(2000);
  await input.fill(' ');await input.evaluate(n=>n.setSelectionRange(1,1));const before=await rows.allTextContents();await watch(page,selector);
  generation=1;const previous=reads;await page.clock.fastForward(61000);await until(async()=>reads>previous&&await page.locator('.rmtScannerUpdates button').count()===1,'new Active evidence arrives passively');
  assert.equal(await rows.count(),4,'new rows held while typing');assert.notDeepEqual(await rows.allTextContents(),before,'existing metric updates in place');
  const focus=await input.evaluate(n=>({value:n.value,caret:n.selectionStart,focused:document.activeElement===n}));assert.deepEqual(focus,{value:' ',caret:1,focused:true});const activeContinuity=await continuity(page);
  await page.locator('.rmtScannerUpdates button').click();await until(async()=>await rows.count()===5,'intentional publish');await input.fill('');await input.evaluate(n=>n.blur());
  await page.getByRole('button',{name:/^New\s/}).click();await page.clock.runFor(2000);generation=2;await page.clock.fastForward(61000);await until(async()=>await rows.count()===6,'New receives a new eligible row without navigation');
  await page.getByRole('button',{name:/^Active\s/}).click();await page.clock.runFor(2000);await page.evaluate(()=>scrollTo({top:150,behavior:'instant'}));await page.clock.runFor(2000);await rows.first().dispatchEvent('pointerdown');const order=await rowIdentities();await watch(page,selector);generation=3;await page.clock.fastForward(61000);await until(async()=>await page.locator('.rmtScannerUpdates button').count()===1,'ranking update deferred under touch');assert.deepEqual(await rowIdentities(),order);const rankContinuity=await continuity(page);await page.locator('body').dispatchEvent('pointerup');
  await page.locator('.rmtScannerUpdates button').click();await page.clock.runFor(2000);assert.notDeepEqual(await rowIdentities(),order);
  unavailable=true;const retained=await rowIdentities();const failedAt=reads;await page.clock.fastForward(61000);await until(()=>reads>failedAt,'outage read');assert.deepEqual(await rowIdentities(),retained,'failed refresh retains known rows');
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});const background=reads;await page.clock.fastForward(180000);assert.equal(reads,background,'hidden scanner does not poll');
  unavailable=false;await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('focus'));dispatchEvent(new Event('online'));});await page.clock.runFor(10);await until(()=>reads>background,'resume revalidates');
  results.push({width,evidence:'CONTROLLED_STATE_TRANSITIONS_NOT_PRODUCTION',activeNew:true,newNew:true,rank:true,focus,activeContinuity,rankContinuity,background:true,retained:true});
  for(const source of ['PONS','STONKBROKERS']) {
    let changed=false, launchReads=0;
    const entries=fixture.directory.entries.filter(e=>e.source===source), finished=entries.find(e=>e.state==='GRADUATED');assert.ok(finished);
    await page.route('**/api/vnext/launches?**',route=>{launchReads++;const staged=[changed?finished:{...finished,state:'BONDING',graduationBlock:null,graduationTransaction:null,graduatedMarkets:[]},...entries.filter(e=>e.launchId!==finished.launchId).slice(0,changed?2:1)];return route.fulfill({status:200,json:{...fixture.directory,entries:staged,nextCursor:null,availableSources:['PONS','STONKBROKERS']}});});
    await page.goto(`${base}/launches?source=${source}`,{waitUntil:'networkidle',timeout:120000});await page.clock.runFor(1000);await page.clock.fastForward(31000);await until(()=>launchReads>0,'launch passive read');await until(async()=>await page.locator('.rmtLaunchRow').count()===2,'controlled baseline');await page.clock.runFor(2000);
    await page.locator('#launch-search').fill('reading');await page.locator('#launch-search').evaluate(n=>n.setSelectionRange(3,3));await watch(page,'.rmtLaunchRow');changed=true;const prior=launchReads;await page.clock.fastForward(31000);await until(async()=>launchReads>prior&&await page.locator('.rmtLaunchRow').first().innerText().then(t=>t.includes('Graduated')),'state transition without navigation');assert.equal(await page.locator('.rmtLaunchRow').count(),2,'membership deferred while typing');const stability=await continuity(page);const caret=await page.locator('#launch-search').evaluate(n=>({value:n.value,caret:n.selectionStart,focused:document.activeElement===n}));assert.deepEqual(caret,{value:'reading',caret:3,focused:true});await page.locator('.rmtScannerUpdates button').click();await until(async()=>await page.locator('.rmtLaunchRow').count()===3,'new launch publishes intentionally');results.push({width,source,evidence:'CONTROLLED_STATE_TRANSITIONS_NOT_PRODUCTION',passiveGraduation:true,stability,caret});
  }
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0);assert.equal(await page.evaluate(()=>window.__walletCalls.length),0);await context.close();await writeFile(path.join(output,'report.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({width,activeNew:true,newNew:true,liveBothLaunchSources:true,allContinuityZero:true}));
}} finally {await browser.close();}
