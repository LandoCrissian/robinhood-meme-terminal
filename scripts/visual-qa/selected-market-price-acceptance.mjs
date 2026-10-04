import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installTokenRoutes } from './token-presentation-fixtures.mjs';
const base=process.env.RMT_VISUAL_BASE_URL??'http://127.0.0.1:3214';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const output=path.resolve(process.env.RMT_VISUAL_OUTPUT??'terminal-visual-v2','selected-market-price');
await mkdir(output,{recursive:true});
const captured=JSON.parse(await readFile(new URL('./selected-market-price-snapshot.json',import.meta.url),'utf8'));
const original=captured.external.markets[0], pool=original.primaryMarket.pool.value;
const browser=await chromium.launch(),results=[];
try { for(const width of [375,390,430,1440]) {
 const context=await browser.newContext({viewport:{width,height:width===1440?900:844},isMobile:width<768,hasTouch:width<768});
 await context.addInitScript(()=>{window.__walletCalls=[];window.ethereum={on(){},removeListener(){},async request({method}){window.__walletCalls.push(method);return method==='eth_chainId'?'0x1237':[];}};});
 const page=await context.newPage(),errors=[],reads=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await installTokenRoutes(page);
 let changed=false;
 const market=()=>changed?{...original,priceUsd:original.priceUsd*1.01,primaryMarket:{...original.primaryMarket,priceUsd:original.priceUsd*1.01}}:original;
 const packet=()=>({...captured.external,markets:[market()],updatedAt:new Date().toISOString()});
 await page.route('**/api/vnext/market-directory**',route=>route.fulfill({json:packet()}));
 await page.route('**/api/markets/external**',route=>{reads.push(route.request().url());return route.fulfill({json:packet()});});
 await page.route('**/api/vnext/asset-workspace**',route=>{
  const url=new URL(route.request().url());reads.push(url.href);
  // The adverse response is the actual former other-pool presentation. Its
  // controlled arrival must never replace the selected pool's spot price.
  return route.fulfill({json:url.searchParams.get('view')==='market'?captured.otherPoolPresentation:captured.core});
 });
 await page.goto(base,{waitUntil:'domcontentloaded'});
 const consent=page.getByRole('button',{name:'I understand — enter RMT',exact:true});await consent.click();await page.clock.runFor(1000);
 const input=page.locator(width<768?'#rmt-mobile-market-search':'#rmt-desktop-market-search');await input.fill(original.symbol);await page.clock.runFor(2000);
 const row=page.locator(width<768?'.rmtMobileMarketRow':'.rmtMarketTableRow').filter({hasText:original.symbol}).first();await row.waitFor();
 const scannerText=await row.innerText();assert.ok(scannerText.includes('0.000006882'));
 await row.click();await page.locator('.vnAssetPrice').waitFor();await page.clock.runFor(2000);
 const price=page.locator('.vnAssetPrice');assert.equal(await price.getAttribute('data-selected-pool'),pool);assert.equal(Number(await price.getAttribute('data-price-usd')),original.priceUsd);
 assert.equal(await price.getAttribute('data-price-source'),'DexScreener');assert.match(await page.locator('#vn-asset-heading').innerText(),/SHRINU/);
 assert.ok(reads.some(url=>url.includes('view=market')&&new URL(url).searchParams.get('pair')===pool),'exact PoolId travels to presentation reader');
 await page.screenshot({path:path.join(output,`${width}-selected.png`)});
 await page.getByRole('button',{name:'Show selected market price evidence'}).click();await page.getByText('Markets',{exact:true}).last().click();
 await page.getByRole('region',{name:'Observed market prices'}).waitFor().catch(()=>page.locator('[aria-label="Observed market prices"]').waitFor());
 await page.screenshot({path:path.join(output,`${width}-market-evidence.png`)});
 assert.match(await page.locator('[aria-label="Observed market prices"]').innerText(),/not averaged|not executable depth/);
 // Return to the unchanged chart section before measuring a passive update.
 await page.getByRole('tab',{name:'Activity',exact:true}).click();await page.clock.runFor(2000);
 const node=await price.elementHandle(),before=await price.boundingBox(),scroll=await page.evaluate(()=>scrollY),count=reads.length;
 changed=true;await page.clock.fastForward(61000);await page.waitForFunction(expected=>Number(document.querySelector('.vnAssetPrice')?.dataset.priceUsd)===expected,original.priceUsd*1.01);await page.clock.runFor(300);
 assert.equal(await price.getAttribute('data-selected-pool'),pool);assert.equal(await node.evaluate(n=>n.isConnected),true);
 const after=await price.boundingBox();assert.equal(after.y,before.y);assert.equal(await page.evaluate(()=>scrollY),scroll);assert.ok(reads.length>count);
 assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.__walletCalls.length),0);
 results.push({width,evidence:captured.evidence,token:original.address,pool,scannerPrice:original.priceUsd,initialWorkspacePrice:original.priceUsd,controlledUpdatedPrice:original.priceUsd*1.01,otherPoolRejected:true,selectedPriceNodeRetained:true,actionMovement:0,scrollMovement:0,overflow:0,passiveWalletRequests:0,errors});
 await context.close();
 }}finally{await browser.close();await writeFile(path.join(output,'acceptance.json'),JSON.stringify(results,null,2));}
console.log(JSON.stringify({selectedMarketPriceAcceptance:'PASS',viewports:results.map(x=>x.width)}));
