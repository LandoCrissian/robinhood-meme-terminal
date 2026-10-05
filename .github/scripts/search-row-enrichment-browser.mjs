import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function runSearchRowEnrichmentBrowser({ browser, base, data, output, natural = false, widths = [375,390,430,1440] }) {
  const results = [], token = data.search.results[0].address.toLowerCase();
  const selected = data.external.markets.find(m => m.address.toLowerCase() === token).primaryMarket;
  for(const width of widths) {
    const context = await browser.newContext({viewport:{width,height:width===1440?900:844},isMobile:width<768,hasTouch:width<768});
    await context.addInitScript(() => {window.__searchErrors=[];window.__searchWallet=0;addEventListener('error',e=>window.__searchErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__searchErrors.push(String(e.reason)));const wrap=p=>{if(!p?.request)return;const f=p.request;p.request=function(...a){window.__searchWallet++;return f.apply(this,a);};};wrap(window.ethereum);addEventListener('eip6963:announceProvider',e=>wrap(e.detail?.provider));});
    const page = await context.newPage(), reads = [], browserErrors = [];let phase='ready';
    page.on('pageerror',error=>browserErrors.push(error.message));
    if(!natural) await page.clock.install();
    await page.route('**/api/**',async route=>{
      const url = new URL(route.request().url()), p=url.pathname;reads.push({at:Date.now(),path:p,query:url.search});
      if(p==='/api/vnext/market-directory') return route.fulfill({status:200,json:data.canonical});
      if(p==='/api/vnext/market-search') return route.fulfill({status:200,json:data.search});
      if(p==='/api/markets/external') return route.fulfill(url.searchParams.has('contract')
        ? phase==='ready'?{status:200,json:data.external}:{status:503,json:{error:'Controlled provider failure'}}
        :{status:200,json:data.broad});
      return route.fulfill({status:503,json:{error:'Optional evidence unavailable in controlled acceptance'}});
    });
    try {
      await page.goto(base,{waitUntil:'domcontentloaded',timeout:120000});await page.getByRole('button',{name:/I understand/}).click();
      if(!natural) await page.clock.runFor(1000);
      await page.waitForFunction(()=>Boolean(document.querySelector('#rmt-mobile-market-search, #rmt-desktop-market-search')));
      assert.ok(reads.some(r=>r.path==='/api/markets/external'&&!r.query),'Initial broad directory read occurs');
      const input=page.locator(width<768?'#rmt-mobile-market-search':'#rmt-desktop-market-search');await input.fill(data.search.query);await input.press('Enter');
      const selector=width<768?'.rmtMobileMarketRow':'.rmtMarketTableRow',row=page.locator(selector).filter({hasText:new RegExp(token,'i')}).first();await row.waitFor();
      const price=width<768?row.locator('.rmtMobileMarketPrice strong'):row.locator(':scope > strong').first();
      assert.ok((await price.innerText()).startsWith('—'),'Initial genuine identity row is unresolved');
      assert.match(await row.innerText(),/Market data delayed/);
      await input.focus();await input.evaluate(n=>n.setSelectionRange(2,2));
      await row.evaluate((n,{selector,token})=>{const input=document.querySelector(innerWidth<768?'#rmt-mobile-market-search':'#rmt-desktop-market-search');const art=n.querySelector('.rmtMarketArtwork');const w=window.__searchWatch={node:n,input,art,token,selector,scroll:scrollY,y:n.getBoundingClientRect().y,iy:input.getBoundingClientRect().y,frames:0,detachments:0,remounts:0,flashes:0,hiddenArt:0,actionMovement:0,scrollMovement:0,overflow:0,active:true};const frame=()=>{if(!w.active)return;w.frames++;const current=[...document.querySelectorAll(selector)].find(n=>n.textContent.toLowerCase().includes(token));if(!n.isConnected)w.detachments++;if(current!==n)w.remounts++;if(!current)w.flashes++;w.actionMovement=Math.max(w.actionMovement,Math.abs(n.getBoundingClientRect().y-w.y),Math.abs(input.getBoundingClientRect().y-w.iy));w.scrollMovement=Math.max(w.scrollMovement,Math.abs(scrollY-w.scroll));w.overflow=Math.max(w.overflow,document.documentElement.scrollWidth-innerWidth);const imgs=[...art.querySelectorAll('img')];if(!art.textContent.trim()&&!imgs.some(i=>i.complete&&i.naturalWidth&&getComputedStyle(i).opacity!=='0'))w.hiddenArt++;requestAnimationFrame(frame);};requestAnimationFrame(frame);},{selector,token});
      if(output){await mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,`search-${width}-unresolved.png`)});}
      if(natural) await page.waitForTimeout(65000);else {await page.clock.fastForward(61000);await page.waitForTimeout(300);}
      await page.waitForFunction(({selector,token})=>{const n=[...document.querySelectorAll(selector)].find(n=>n.textContent.toLowerCase().includes(token));return n?.textContent.includes('$');},{selector,token},{timeout:15000});
      const rowPrice=await price.innerText();assert.ok(rowPrice.startsWith('$'));
      const stability=await page.evaluate(()=>{const w=window.__searchWatch;w.active=false;return {frames:w.frames,detachments:w.detachments,remounts:w.remounts,flashes:w.flashes,hiddenArtworkFrames:w.hiddenArt,actionMovement:w.actionMovement,scrollMovement:w.scrollMovement,overflow:w.overflow,focus:document.activeElement===w.input,caret:w.input.selectionStart,wallet:window.__searchWallet,errors:window.__searchErrors};});
      for(const key of ['detachments','remounts','flashes','hiddenArtworkFrames','actionMovement','scrollMovement','overflow','wallet'])assert.equal(stability[key],0,`${width} ${key}`);
      assert.equal(stability.focus,true);assert.equal(stability.caret,2);assert.deepEqual(stability.errors,[]);
      const exactBeforeTap=reads.filter(r=>r.path==='/api/markets/external'&&new URLSearchParams(r.query).has('contract'));
      assert.equal(exactBeforeTap.length,1,'One exact-token attempt, independent of number of rendered rows');
      if(output)await page.screenshot({path:path.join(output,`search-${width}-priced.png`)});
      await row.click();const workspace=page.locator('.vnAssetPrice');await workspace.waitFor();
      const initial=await workspace.evaluate(n=>({pool:n.dataset.selectedPool,price:Number(n.dataset.priceUsd),provider:n.dataset.priceSource,text:n.textContent}));
      assert.equal(initial.pool.toLowerCase(),selected.pool.value.toLowerCase());assert.equal(initial.price,selected.priceUsd);
      assert.equal(initial.provider,selected.provenance.startsWith('dexscreener')?'DexScreener':'GeckoTerminal');
      const heading=await page.locator('#vn-asset-heading').innerText();assert.ok(heading.includes(selected.token.symbol));
      assert.ok(await page.locator('.vnAssetWorkspace').getByRole('button',{name:new RegExp(`Copy full token contract ${token}`,'i')}).count(),'Workspace retains exact token identity');
      assert.match(await page.locator('.vnPriceAuthoritySummary').innerText(),new RegExp(selected.quoteToken.symbol));
      assert.deepEqual(browserErrors,[],'No browser exception during enrichment or selected-market navigation');
      if(output)await page.screenshot({path:path.join(output,`search-${width}-workspace.png`)});
      results.push({width,evidence:data.evidence,clock:natural?'NATURAL_60_SECOND_BROWSER_REFRESH':'CONTROLLED_CLOCK_REAL_REFRESH_HOOK',token,scannerPrice:rowPrice,selectedPool:selected.pool,quote:selected.quoteToken,provider:selected.provenance,price:selected.priceUsd,initialWorkspace:initial,stability,requests:reads,exactReadsBeforeTap:exactBeforeTap.length,pass:true});
    } catch(error) {
      if(output) {await mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,`search-${width}-failure.png`)});await writeFile(path.join(output,`search-${width}-failure.json`),JSON.stringify({error:String(error),reads,browserErrors,body:await page.locator('body').innerText(),diagnostics:await page.evaluate(()=>({marks:performance.getEntriesByType('mark').map(m=>m.name),errors:window.__searchErrors}))},null,2));}
      throw error;
    } finally {await context.close();}
  }
  if(output)await writeFile(path.join(output,'search-row-browser.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results.map(r=>({...r,requests:undefined}))));return results;
}
