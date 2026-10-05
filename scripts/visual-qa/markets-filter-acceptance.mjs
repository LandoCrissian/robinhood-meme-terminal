import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installTokenRoutes } from './token-presentation-fixtures.mjs';

const base = process.env.RMT_VISUAL_BASE_URL ?? 'http://127.0.0.1:3111';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname), 'Controlled acceptance is local only');
const output = path.resolve(process.env.RMT_VISUAL_OUTPUT ?? 'terminal-visual-v2', 'markets-filter');
await mkdir(output, { recursive:true });
const browser = await chromium.launch(), results = [];
try {
  for (const width of [375,390,430,1440]) {
    const mobile=width<768, context=await browser.newContext({viewport:{width,height:mobile?844:900},isMobile:mobile,hasTouch:mobile}), page=await context.newPage(), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{window.__passiveWalletRequests=0;window.ethereum={on(){},removeListener(){},async request({method}){if(/sign|sendTransaction|wallet_sendCalls|eth_requestAccounts/.test(method)){window.__passiveWalletRequests++;throw Error('Passive wallet request prohibited');}return method==='eth_chainId'?'0x1237':[];}};});
    await installTokenRoutes(page);
    await page.goto(`${base}?universe=launches`,{waitUntil:'domcontentloaded'});
    const consent=page.getByRole('button',{name:'I understand',exact:false});
    if(await consent.isVisible()) await consent.click();
    await page.locator(mobile?'.rmtMobileMarketRow':'.rmtMarketTableRow').first().waitFor();
    await page.waitForURL(url=>url.searchParams.get('universe')==='all');
    const trigger=page.locator('.rmtExploreTrigger').first(), dialog=page.locator('.rmtExploreDialog'), input=page.locator(mobile?'#rmt-mobile-market-search':'#rmt-desktop-market-search');
    assert.equal((await trigger.innerText()).trim(),'All Markets');
    const geometry=await input.boundingBox();
    await trigger.click();
    assert.equal((await input.boundingBox()).y,geometry.y,'Filter opening does not move scanner geometry');
    const options=dialog.locator('fieldset button > span:first-child');
    assert.deepEqual(await options.allTextContents(),['All Markets','Project Tokens','RWA','Stock Tokens','Held']);
    assert.equal(await dialog.locator('a').count(),0,'Secondary filter cannot navigate to other products');
    assert.doesNotMatch(await dialog.innerText(),/Any activity|Launches|Choose a universe/);
    const bounds=await dialog.boundingBox();
    if(mobile) assert.equal(Math.round(bounds.y+bounds.height),844,'Mobile is a bottom sheet');
    else { assert.ok(bounds.width<=336,'Desktop is a compact popover'); assert.ok(bounds.y>=geometry.y-80,'Popover is anchored near its trigger'); }
    await page.screenshot({path:path.join(output,`${width}-filter-open.png`)});
    await page.getByRole('button',{name:'Close market filter',exact:true}).click();
    assert.equal(await trigger.evaluate(node=>document.activeElement===node),true,'Close restores focus');
    const combinations=[['Active','all'],['Movers','projects'],['New','rwa'],['Trending','stock'],['Active','held']];
    for(const [activity,scope] of combinations) {
      await page.locator('.rmtPrimaryViews').first().getByRole('button',{name:new RegExp(`^${activity}`)}).click();
      await trigger.click();
      const labels={all:'All Markets',projects:'Project Tokens',rwa:'RWA',stock:'Stock Tokens',held:'Held'};
      await dialog.locator('fieldset button').filter({has:page.locator('span',{hasText:new RegExp(`^${labels[scope]}$`)})}).click();
      assert.equal(await page.locator('.rmtPrimaryViews').first().getByRole('button',{name:new RegExp(`^${activity}`)}).getAttribute('aria-pressed'),'true','Universe selection preserves activity');
      assert.equal(new URL(page.url()).searchParams.get('universe'),scope);
      assert.equal((await trigger.innerText()).trim(),labels[scope]);
    }
    await page.evaluate(()=>history.back()); await page.waitForURL(url=>url.searchParams.get('universe')==='stock');
    assert.equal((await trigger.innerText()).trim(),'Stock Tokens');
    await page.evaluate(()=>history.forward()); await page.waitForURL(url=>url.searchParams.get('universe')==='held');
    assert.equal((await trigger.innerText()).trim(),'Held');
    await trigger.click(); await page.keyboard.press('Escape');
    assert.equal(await dialog.getAttribute('open'),null);
    const safety=await page.evaluate(()=>({overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),walletRequests:window.__passiveWalletRequests}));
    assert.equal(safety.overflow,0); assert.equal(safety.walletRequests,0); assert.deepEqual(errors,[]);
    results.push({width,result:'PASS',options:['All Markets','Project Tokens','RWA','Stock Tokens','Held'],scannerGeometryMovement:0,activityUniverseIndependence:'PASS',urlHistory:'PASS',...safety,errors});
    await context.close();
  }
} finally {await writeFile(path.join(output,'acceptance.json'),JSON.stringify(results,null,2));await browser.close();}
console.log('Markets filter: four viewports, exact options, overlay geometry, activity independence, history, focus and wallet safety PASS');
