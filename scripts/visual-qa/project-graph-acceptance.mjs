import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { installTokenRoutes } from './token-presentation-fixtures.mjs';
const base = process.env.RMT_VISUAL_BASE_URL ?? 'http://127.0.0.1:3171';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const output=path.resolve(process.env.RMT_VISUAL_OUTPUT ?? 'terminal-visual-v2','project-graph');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});const results=[], navigationEvidence=[];
const canna='0x1139d423C1706BDeaD91f03507F521635591eD92', nft='0x289c8ce652f38029867842048068b39bd0464a3f';
try {
 for(const viewport of [{width:375,height:812},{width:390,height:844},{width:430,height:932},{width:1440,height:900}]) {
  const mobile=viewport.width<1024, context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,recordVideo:{dir:path.join(output,'videos'),size:viewport}}), page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',response=>{const url=new URL(response.url());if(url.origin===new URL(base).origin&&url.pathname.startsWith('/projects'))navigationEvidence.push({viewport,path:url.pathname,status:response.status(),resourceType:response.request().resourceType()});});
  page.on('requestfailed',request=>{const url=new URL(request.url());if(url.origin===new URL(base).origin&&url.pathname.startsWith('/projects'))navigationEvidence.push({viewport,path:url.pathname,failure:request.failure()?.errorText,resourceType:request.resourceType()});});
  await page.addInitScript(()=>{window.__projectWalletRequests=0;window.ethereum={on(){},removeListener(){},async request({method}){if(/sign|sendTransaction|wallet_sendCalls/.test(method)){window.__projectWalletRequests++;throw Error('Financial action prohibited');}return method==='eth_chainId'?'0x1237':[];}};});
  const routes=await installTokenRoutes(page);let delayed=false, unavailable=false, holdMarket=false;const marketWaiters=[];let marketResponses=0;
  // Controlled external identity response for the exact independently observed
  // CANNACAT address. The real directory selection and Project consumers run.
  await page.route(/\/api\/vnext\/asset-identity(?:\?.*)?$/,route=>{
   const address=new URL(route.request().url()).searchParams.get('address');
   return address?.toLowerCase()===canna.toLowerCase()
    ? route.fulfill({json:{resolution:{chainId:4663,requestedAddress:canna,requestedKind:'token',status:'token-only',token:{address:canna,name:'CannaCat',symbol:'CANNACAT',decimals:18,totalSupply:'1000000000000000000000000000'},pools:[],marketData:'identity-only',execution:'swap-capable',provenance:'robinhood-chain-contract-reads',resolvedAt:new Date().toISOString()}}})
    : route.fulfill({status:503,json:{error:'CONTROLLED_IDENTITY_UNAVAILABLE'}});
  });
  await page.route(/\/api\/vnext\/asset-workspace\?[^#]*view=market/,async route=>{
   if(holdMarket) await new Promise(resolve=>marketWaiters.push(resolve));
   if(delayed) await new Promise(r=>setTimeout(r,1800));
   if(unavailable) return route.fulfill({status:503,json:{error:'CONTROLLED_MARKET_UNAVAILABLE'}});
   const contract=new URL(route.request().url()).searchParams.get('address');
   await route.fulfill({json:{chainId:4663,contract,state:'READY',observedAt:new Date().toISOString(),provenance:'GECKOTERMINAL_TOKEN_POOLS',data:{token:contract,pool:'0x1111111111111111111111111111111111111111',priceUsd:0.0012,liquidityUsd:12000,volume24hUsd:8000,createdAt:null,dex:null,priceChange24h:null,buys24h:null,sells24h:null}}});
   marketResponses++;
  });
  const capture=async name=>{const measurements=await page.evaluate(()=>({overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),walletRequests:window.__projectWalletRequests}));assert.equal(measurements.overflow,0,name);assert.equal(measurements.walletRequests,0);await page.screenshot({path:path.join(output,`${viewport.width}-${name}.png`),fullPage:true});return measurements;};
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:180000});const consent=page.getByRole('button',{name:'I understand',exact:false});await consent.waitFor({state:'visible',timeout:5000}).catch(()=>{});if(await consent.isVisible())await consent.click();
  await page.locator(mobile?'.rmtMobileMarketRow':'.rmtMarketTableRow').first().waitFor();
  const primaryLabels=['Markets','Projects','NFTs','Portfolio','Distribution'];
  const terminalNav=page.locator('nav[aria-label="Terminal navigation"]:visible');
  assert.deepEqual((await terminalNav.locator('a,button').allTextContents()).map(label=>label.trim()),primaryLabels,'Five first-class product tabs in owner-selected order');
  await terminalNav.getByRole('link',{name:'Projects',exact:true}).click();await page.locator('.rmtProjectScanner').waitFor();
  const projectsNav=page.locator('nav[aria-label="RMT Terminal navigation"]:visible');
  assert.deepEqual((await projectsNav.locator('a').allTextContents()).map(label=>label.trim()),primaryLabels);
  assert.equal(await projectsNav.locator('[aria-current="page"]').innerText(),'Projects');
  assert.equal(await page.locator('.rmtProjectRow').count(),15);
  for(const [project,token,collection] of [['CannaCats','CANNACAT','CannaCats'],['Hopium Machines','HOPIUM','Hopium Machines']]) {
   const card=page.getByRole('link',{name:`Explore ${project} project`,exact:true});
   assert.ok(await card.locator('.rmtProjectRowAssets').getByText(token,{exact:true}).isVisible());
   assert.ok(await card.locator('.rmtProjectRowAssets').getByText(collection,{exact:true}).isVisible());
  }
  const ccffCard=page.getByRole('link',{name:'Explore CCFF00 project',exact:true});
  assert.equal(await ccffCard.getByText('NFT-led',{exact:true}).count(),1);
  assert.equal(await ccffCard.locator('.rmtProjectRowAssets').getByText('Token',{exact:true}).count(),0);
  await page.evaluate(()=>document.fonts.ready);
  const tokenLines=await page.getByRole('link',{name:'Explore CannaCats project',exact:true}).locator('.rmtProjectRowAssets').getByText('CANNACAT',{exact:true}).evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);return new Set([...range.getClientRects()].map(rect=>Math.round(rect.y))).size;});
  assert.equal(tokenLines,1,'The short exact token symbol remains legible on one line at every viewport');
  await capture('projects-landing');
  await page.getByRole('link',{name:'Explore CannaCats project',exact:true}).click();await page.locator('[data-project-market="cannacats"]').waitFor();
  assert.equal(await page.locator('nav[aria-label="RMT Terminal navigation"]:visible [aria-current="page"]').innerText(),'Projects');
  await page.locator('nav[aria-label="RMT Terminal navigation"]:visible').getByRole('link',{name:'Markets',exact:true}).click();
  await page.locator(mobile?'.rmtMobileMarketRow':'.rmtMarketTableRow').first().waitFor();
  await page.locator('.rmtExplore>summary').first().click();await page.locator('.rmtExploreChoices button').filter({hasText:'Projects'}).click();
  assert.equal(await page.locator('.rmtProjectRow').count(),15);await capture('projects-discovery');
  for(const query of ['CannaCats','CANNACAT',canna,nft,'Founding Feathers']) {
   const input=page.locator(mobile?'#rmt-mobile-market-search':'#rmt-desktop-market-search');
   await input.fill(query);await page.locator('.rmtProjectRow').first().waitFor();assert.match(await page.locator('.rmtProjectDiscovery').innerText(),query==='Founding Feathers'?/Founding Feathers/:/CannaCats/);
  }
  await page.locator(mobile?'#rmt-mobile-market-search':'#rmt-desktop-market-search').fill('CannaCats');
  await page.getByRole('link',{name:'Explore CannaCats project',exact:true}).click();await page.locator('[data-project-market="cannacats"]').waitFor();
  assert.equal(await page.locator('.rmtProjectAssetCard').count(),2);await capture('token-nft-project');
  await page.evaluate(() => {
   window.__projectNavigation = { started: null, destinationMs: null, identityMs: null, ticketMs: null, genericFrames: 0, selectedAssetLoss: 0, frames: 0, done: false };
   document.addEventListener('click', event => {
    if (event.target.closest('a[href*="?market="]')) window.__projectNavigation.started = performance.now();
   }, { once: true });
   const frame = () => {
    const n = window.__projectNavigation;
    if (n.done) return;
    if (n.started !== null) {
     n.frames++;
     const elapsed = performance.now() - n.started;
     const identity = document.querySelector('#vn-asset-heading');
     const workspace = document.querySelector('.rmtAssetSurface, .vnAssetWorkspace, #vn-asset-heading');
     if (workspace && n.destinationMs === null) n.destinationMs = elapsed;
     if (identity && n.identityMs === null) n.identityMs = elapsed;
     if (!identity && n.identityMs !== null) n.selectedAssetLoss++;
     if (!identity && document.querySelector('#rmt-mobile-markets-heading, #rmt-desktop-markets-heading')) n.genericFrames++;
     const ticket = document.querySelector('.rmtMobileTradeDock, .vnTradePanel');
     if (ticket && n.ticketMs === null) n.ticketMs = elapsed;
    }
    requestAnimationFrame(frame);
   };
   requestAnimationFrame(frame);
  });
  holdMarket=true;await page.getByRole('link',{name:'Trade token',exact:false}).click();await page.locator('#vn-asset-heading').waitFor();
  const directNavigation = await page.evaluate(() => { window.__projectNavigation.done = true; return window.__projectNavigation; });
  assert.equal(directNavigation.genericFrames, 0, 'Verified Project → Token never exposes a generic Markets intermediate screen');
  assert.equal(directNavigation.selectedAssetLoss, 0);
  assert.match(await page.locator('#vn-asset-heading').innerText(), /CANNACAT/i);
  navigationEvidence.push({ viewport, evidence: 'CONTROLLED_PUBLIC_COMPONENT_NAVIGATION', ...directNavigation });
  assert.ok(new URL(page.url()).searchParams.get('market').toLowerCase()===canna.toLowerCase());
  await page.getByRole('tab',{name:'Project',exact:true}).click();assert.ok(await page.getByRole('link',{name:'Explore project',exact:false}).isVisible());await capture('token-project-surface');
  await page.getByRole('tab',{name:'6H',exact:true}).click();
  if(mobile)await page.locator('.rmtMobileTradeDock .isBuy').click();
  const amount=page.getByLabel('Exact input amount',{exact:true});await page.getByLabel('Pay with asset',{exact:true}).selectOption('eip155:4663/native');await amount.fill('0.0005');await page.waitForTimeout(1000);await amount.focus();await amount.evaluate(n=>n.setSelectionRange(3,3));
  const measure=()=>page.evaluate(()=>{const amount=document.querySelector('[aria-label="Exact input amount"]');const dock=document.querySelector('.rmtMobileTradeDock')??document.querySelector('.vnTradeActionDock');const chart=document.querySelector('.vnChartFrame');const box=n=>n?{x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}:null;return {value:amount.value,start:amount.selectionStart,end:amount.selectionEnd,focus:document.activeElement===amount,scrollY,amount:box(amount),dock:box(dock),chart:box(chart),payment:document.querySelector('[aria-label="Pay with asset"]').value,section:document.querySelector('.rmtWorkspaceTabs [aria-selected="true"]')?.textContent,range:document.querySelector('.vnChart [role="tab"][aria-selected="true"]')?.textContent};});
  const before=await measure();assert.equal(before.start,3,'Nonterminal caret established before passive observation');routes.setChartMode('stale');routes.setRiskMode('unavailable');
  const aligned=await measure();assert.ok(marketWaiters.length>0,'Real workspace enrichment request is pending while the input is focused');const responsesBefore=marketResponses;holdMarket=false;marketWaiters.splice(0).forEach(resolve=>resolve());await new Promise(r=>setTimeout(r,10000));assert.ok(marketResponses>responsesBefore,'Delayed market evidence actually arrived');const after=await measure();assert.equal(after.value,before.value);assert.equal(after.payment,before.payment);assert.equal(after.section,before.section);assert.equal(after.range,'6H');assert.ok(after.dock,'Persistent action measured on both desktop and mobile');assert.equal(after.focus,true);assert.equal(after.start,3);assert.equal(after.scrollY,aligned.scrollY);assert.deepEqual(after.amount,aligned.amount);assert.deepEqual(after.dock,aligned.dock);assert.deepEqual(after.chart,aligned.chart);await capture('project-enrichment-isolation');
  // The wallet provider mounts on the client. Observe the first actual ticket,
  // not absent form markup in the server HTML. Hold optional market enrichment until
  // after typing so delayed synchronization cannot silently clear the draft.
  // Start a fresh controlled ticket; wallet-return draft recovery is covered by
  // the existing transaction journeys. Never remove an execution/recovery journal.
  await page.evaluate(()=>sessionStorage.removeItem('rmt:trade-draft-recovery:v1'));
  await page.addInitScript(()=>{
   if(new URLSearchParams(location.search).get('side')!=='sell') return;
   const evidence=window.__initialSellTicket={firstDom:null,firstVisible:null,wrongSideFrames:0,frames:0,done:false};
   const sample=()=>{
    if(evidence.done) return;
    const input=document.querySelector('[aria-label="Exact input amount"]');
    const selected=document.querySelector('.vnSideTabs [aria-selected="true"]');
    if(!input || !selected) return;
    const snapshot={side:selected.textContent.trim(),amount:input.value};
    evidence.firstDom??=snapshot;
    const box=input.getBoundingClientRect();
    if(box.width>0 && box.height>0 && getComputedStyle(input).visibility!=='hidden') {
     evidence.firstVisible??=snapshot;
     evidence.frames++;
     if(snapshot.side!=='Sell') evidence.wrongSideFrames++;
    }
   };
   const observer=new MutationObserver(sample);observer.observe(document,{childList:true,subtree:true,attributes:true});
   const frame=()=>{sample();if(!evidence.done)requestAnimationFrame(frame);else observer.disconnect();};
   requestAnimationFrame(frame);
  });
  holdMarket=true;
  const sellResponse=await page.goto(`${base}/?market=${canna}&project=cannacats&side=sell`,{waitUntil:'domcontentloaded'});
  assert.equal(sellResponse.status(),200);
  assert.match(sellResponse.headers()['content-type'],/text\/html/);
  await page.waitForFunction(()=>window.__initialSellTicket?.firstVisible!==null && window.__initialSellTicket?.firstVisible!==undefined);
  const initialTicket=await page.evaluate(()=>window.__initialSellTicket);
  assert.equal(initialTicket.firstDom.side,'Sell','The first client-mounted ticket already has the requested side');
  assert.equal(initialTicket.firstVisible.side,'Sell','The first visible ticket has the requested side');
  assert.equal(initialTicket.firstVisible.amount,'','A new Sell ticket never borrows the Buy default amount');
  assert.equal(initialTicket.wrongSideFrames,0);
  assert.equal(await page.getByRole('tab',{name:'Sell',exact:true}).getAttribute('aria-selected'),'true');
  await amount.fill('25');await amount.focus();await amount.evaluate(n=>n.setSelectionRange(1,1));
  await page.waitForTimeout(500);
  assert.equal(await amount.inputValue(),'25','Initial selected-side synchronization cannot clear early typing');
  assert.ok(marketWaiters.length>0,'Optional market enrichment is still delayed after typing');
  // The server seed already carries this exact project's verified units. Do not
  // require an unnecessary identity read merely to satisfy the fixture.
  holdMarket=false;marketWaiters.splice(0).forEach(resolve=>resolve());await page.waitForTimeout(1000);
  assert.equal(await amount.inputValue(),'25','Enrichment cannot replay the initial side request');
  assert.equal(await amount.evaluate(n=>document.activeElement===n && n.selectionStart===1 && n.selectionEnd===1),true,
   'Initial directory completion preserves typed input focus and caret');
  assert.equal(await page.getByRole('tab',{name:'Sell',exact:true}).getAttribute('aria-selected'),'true');
  const finalInitialTicket=await page.evaluate(()=>{window.__initialSellTicket.done=true;return window.__initialSellTicket;});
  assert.equal(finalInitialTicket.wrongSideFrames,0,'No wrong-side ticket flashes during initialization or enrichment');
  await capture('sell-deep-link-first-render');
  navigationEvidence.push({viewport,evidence:'CONTROLLED_INITIAL_SELL_CLIENT_RENDER',initialTicket:finalInitialTicket,amountAfterEnrichment:await amount.inputValue()});
  await page.goto(`${base}/projects/ccff00`,{waitUntil:'domcontentloaded'});await page.locator('[data-project-market="ccff00"]').waitFor();assert.equal(await page.getByRole('link',{name:'Trade token',exact:false}).count(),0,'No invented CCFF00 token');await capture('ccff00-nft-led');
  delayed=true;unavailable=true;await page.goto(`${base}/projects/cannacats`,{waitUntil:'domcontentloaded'});await page.locator('[data-project-market="cannacats"]').waitFor();await page.evaluate(()=>document.fonts.ready);const linksBefore=await page.locator('.rmtProjectPrimary').evaluateAll(nodes=>nodes.map(n=>({y:n.getBoundingClientRect().y,height:n.getBoundingClientRect().height})));await page.getByText('Market data unavailable',{exact:true}).waitFor();const linksAfter=await page.locator('.rmtProjectPrimary').evaluateAll(nodes=>nodes.map(n=>({y:n.getBoundingClientRect().y,height:n.getBoundingClientRect().height})));assert.deepEqual(linksAfter,linksBefore);await capture('project-market-unavailable');
  assert.deepEqual(errors,[]);results.push({viewport,scope:'CONTROLLED_EXTERNAL_HTTP_REAL_PUBLIC_COMPONENTS_EMULATED_VIEWPORT',searchQueries:5,amountMovementPx:after.amount.y-aligned.amount.y,actionMovementPx:after.dock?after.dock.y-aligned.dock.y:0,chartMovementPx:after.chart?after.chart.y-aligned.chart.y:0,scrollMovementPx:after.scrollY-aligned.scrollY,focus:after.focus,caret:after.start,marketLinkMovementPx:linksAfter[0].y-linksBefore[0].y,walletRequests:await page.evaluate(()=>window.__projectWalletRequests),errors});await context.close();
 }
} catch(error) {
 const failures=[];
 for(const context of browser.contexts()) {
  for(const page of context.pages()) {
   const index=failures.length;
   await page.screenshot({path:path.join(output,`failure-${index}.png`),fullPage:true}).catch(()=>{});
   failures.push({viewport:page.viewportSize(),path:new URL(page.url()).pathname,projectGrid:await page.locator('.rmtProjectScanner').count(),projectMarket:await page.locator('[data-project-market]').count(),navigation:await page.locator('nav[aria-label="RMT Terminal navigation"]:visible').allTextContents()});
  }
  // Flush the failing context's video too; browser.close alone may leave it empty.
  await context.close();
 }
 await writeFile(path.join(output,'failure.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD']).toString().trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}']).toString().trim(),profile:'CONTROLLED_NOT_LIVE_FINANCIAL_ACCEPTANCE',error:{name:error.name,message:error.message},completed:results,failures,navigationEvidence:navigationEvidence.slice(-50)},null,2));
 throw error;
} finally {await browser.close();}
await writeFile(path.join(output,'report.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD']).toString().trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}']).toString().trim(),profile:'CONTROLLED_NOT_LIVE_FINANCIAL_ACCEPTANCE',results,navigationEvidence},null,2));console.log(JSON.stringify(results));
