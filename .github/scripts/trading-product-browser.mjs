import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Local real React/API lifecycle; provider/RPC/wallet transports are synthetic.
// Delays model an optional-source outage, not measured production latency.
export async function runTradingProductBrowser({ browser, base, identity, external, wallet, token, output }) {
  const baseline = process.env.RMT_PRODUCT_BASELINE === 'true';
  const results = [];
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
    await context.addInitScript(({wallet}) => {
      window.__productPrompts = 0;
      window.ethereum = { isMetaMask: true, on(){}, removeListener(){}, async request({method}) {
        if (method === 'eth_chainId') return '0x1237';
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet];
        if (/sign|sendTransaction/.test(method)) { window.__productPrompts++; throw new Error('No financial action in product profile'); }
        return null;
      }};
    }, {wallet});
    const page = await context.newPage();
    const calls = [];
    let delayedSelection = false;
    page.on('request', request => { if (/\/api\/vnext\/(quotes|verify|authorize)/.test(request.url())) calls.push({ at: Date.now(), path: new URL(request.url()).pathname, amount:request.postDataJSON()?.inputAmountAtomic??null }); });
    await page.route('**/*', async route => {
      const request = route.request();
      if (new URL(request.url()).origin === base) {
        if (delayedSelection && new URL(request.url()).pathname === '/api/markets/external') await new Promise(r=>setTimeout(r,5000));
        const headers = request.headers(); if (headers['privy-id-token']) headers['privy-id-token'] = identity;
        return route.continue({headers});
      }
      const response = external({url:request.url(),method:request.method(),body:request.postData()});
      return route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.body)});
    });
    await page.goto(`${base}/?market=${token}&side=buy`, {waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'I understand',exact:false}).click();
    await page.getByRole('button',{name:'Start with live markets',exact:true}).click();
    await page.getByLabel('Exact input amount').waitFor({timeout:30000});
    if(process.env.RMT_PRODUCT_NAV_ONLY !== 'true') {
    await page.waitForResponse(r=>r.url().endsWith('/api/vnext/authorize')&&r.status()===200,{timeout:30000});
    const amountInput=page.getByLabel('Exact input amount');
    await amountInput.fill('26'); await page.waitForTimeout(80);
    await amountInput.fill('27'); await page.waitForTimeout(80);
    const lastTypedAt=Date.now(); await amountInput.fill('28');
    await page.waitForResponse(r=>r.url().endsWith('/api/vnext/authorize')&&r.status()===200,{timeout:30000});
    const typed=calls.filter(x=>x.at>=lastTypedAt&&x.path.endsWith('/quotes'));
    const observedDebounceMs=typed[0]?.at-lastTypedAt;
    if(!baseline){assert.ok(observedDebounceMs>=350,'amount changes debounce before any quote');assert.ok(typed.every(x=>x.amount==='28000000'),'obsolete typing must not request prices');}
    const count = since => calls.filter(x=>x.at>=since);
    const visibleAt=Date.now(); await page.waitForTimeout(21000);
    const visible=count(visibleAt);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(1000); const hiddenAt=Date.now(); await page.waitForTimeout(11000); const hidden=count(hiddenAt);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(2000);
    await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});window.dispatchEvent(new Event('offline'));});
    await page.waitForTimeout(1000);const offlineAt=Date.now(); await page.waitForTimeout(11000);const offline=count(offlineAt);
    await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});window.dispatchEvent(new Event('online'));});
    await page.waitForTimeout(2000);
    let closed=[];
    if(mobile){await page.getByRole('button',{name:'Close trade sheet',exact:true}).last().click();await page.waitForTimeout(1000);const at=Date.now();await page.waitForTimeout(11000);closed=count(at);}
    const result={evidence:'MOCKED_LOCAL_BROWSER',viewport:mobile?'mobile':'desktop',baseline,observedDebounceMs,visibleWindowMs:21000,visible,hiddenWindowMs:11000,hidden,offlineWindowMs:11000,offline,closedWindowMs:mobile?11000:null,closed};
    results.push(result);
    await writeFile(path.join(output,`product-${baseline?'before':'after'}-${result.viewport}.json`),JSON.stringify(result,null,2));
    if(!baseline){assert.equal(hidden.length,0);assert.equal(offline.length,0);assert.equal(closed.length,0);assert.ok(visible.filter(x=>x.path.endsWith('/verify')).length<=3,'bounded idle firm cadence');}
    }
    if(mobile && await page.getByRole('button',{name:'Close trade sheet',exact:true}).last().isVisible()) await page.getByRole('button',{name:'Close trade sheet',exact:true}).last().click();
    await page.locator('[data-terminal-nav="markets"]').filter({visible:true}).first().click();
    const search=page.locator(mobile?'#rmt-mobile-market-search':'#rmt-desktop-market-search');
    const discovered='0x0000000000000000000000000000000000009903';
    await search.fill(discovered);
    delayedSelection=true;
    let searchResponseAt=null;
    page.on('response',r=>{if(r.url().includes('/api/vnext/market-search?'))searchResponseAt=Date.now();});
    const started=Date.now();
    await search.press('Enter');
    await page.locator('#vn-asset-heading').filter({hasText:'OBSERVED'}).waitFor({timeout:15000});
    const shellMs=Date.now()-started;
    await page.locator('.vnAssetPrice strong').waitFor();
    const priceText=await page.locator('.vnAssetPrice strong').innerText();
    const priceMs=priceText.includes('$')?Date.now()-started:null;
    if(mobile)await page.locator('.rmtMobileTradeDock .isBuy').waitFor();
    else await page.getByLabel('Exact input amount').waitFor();
    const controlsMs=Date.now()-started;
    const navigation={evidence:'MOCKED_LOCAL_BROWSER',viewport:mobile?'mobile':'desktop',baseline,optionalExternalDelayMs:5000,trigger:"exact-contract search submit",searchResponseMs:searchResponseAt===null?null:searchResponseAt-started,
      tokenClickToShellMs:shellMs,priceState:priceMs===null?"UNAVAILABLE":"READY",tokenClickToPriceMs:priceMs,tokenClickToTradeControlsMs:controlsMs,
      coreUsableMs:Math.max(shellMs,priceMs??0,controlsMs),optionalEnrichmentCompleteMs:null};
    await writeFile(path.join(output,`navigation-${baseline?'before':'after'}-${navigation.viewport}.json`),JSON.stringify(navigation,null,2));
    if(!baseline)assert.ok(navigation.coreUsableMs<1000,'known search result must not wait for delayed external enrichment');
    assert.equal(await page.evaluate(()=>window.__productPrompts),0);
    await context.close();
  }
  return results;
}
