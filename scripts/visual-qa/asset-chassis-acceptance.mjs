import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { installTokenRoutes } from './token-presentation-fixtures.mjs';
import { TOKEN_MARKETS } from './legion-fixtures.mjs';

// Real public UI, controlled external HTTP evidence, local host only.
// Financial requests are prohibited. Physical iPhone/live provider acceptance is separate.
const base = process.env.RMT_VISUAL_BASE_URL ?? 'http://127.0.0.1:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const baseline = process.argv.includes('--baseline');
const output = path.resolve(process.env.RMT_VISUAL_OUTPUT ?? 'terminal-visual-v2', baseline ? 'asset-chassis-before' : 'asset-chassis');
await mkdir(output, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [], failures = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width:375,height:812 },{ width:390,height:844 },{ width:430,height:932 },{ width:1440,height:900 }]) {
    const mobile = viewport.width < 1024;
    const context = await browser.newContext({ viewport, colorScheme:'dark', isMobile:mobile, hasTouch:mobile, recordVideo:{ dir:path.join(output,'videos'),size:viewport } });
    const page = await context.newPage(), errors = [], requests = [], states = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (/\/api\//.test(req.url())) requests.push({ path:new URL(req.url()).pathname, method:req.method() }); });
    await page.addInitScript(() => {
      window.__financialRequests = 0;
      window.ethereum = { on(){},removeListener(){},async request({method}) {
        if (/sign|sendTransaction|wallet_sendCalls/.test(method)) { window.__financialRequests++; throw Error('Financial request forbidden'); }
        return method === 'eth_chainId' ? '0x1237' : [];
      } };
    });
    const routes = await installTokenRoutes(page);
    const capture = async name => {
      await pause(120);
      const metrics = await page.evaluate(() => ({ overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth), walletRequests:window.__financialRequests,
        chartHeight:document.querySelector('.vnChart')?.getBoundingClientRect().height ?? null,
        primary:document.querySelector('.vnAssetClass')?.textContent,
        range:document.querySelector('.vnChartRanges [aria-selected="true"]')?.textContent }));
      if (!baseline) { assert.ok(metrics.overflow <= 1, `${name}: no page overflow`); assert.equal(metrics.walletRequests,0); }
      await page.screenshot({ path:path.join(output,`${viewport.width}-${name}.png`),fullPage:true });
      states.push({name,...metrics});
    };
    try {
      await page.goto(base,{waitUntil:'domcontentloaded',timeout:180000});
      const consent=page.getByRole('button',{name:'I understand',exact:false});
      await consent.waitFor({state:'visible',timeout:10000}).catch(()=>{});
      if(await consent.isVisible()) await consent.click();
      await page.locator(mobile?'.rmtMobileMarketRow':'.rmtMarketTableRow').first().waitFor();
      if (!baseline) {
        const skip=page.locator('.vnSkipLink'); await skip.focus();
        const bounds=await skip.boundingBox(); assert.ok(bounds&&bounds.height>=44,'Keyboard skip action is exposed at usable size');
        await skip.blur();
      }
      await capture('markets');
      for(const name of ['New','Movers','Trending','Active']) {
        await page.locator('.rmtMarketViews').first().getByRole('button',{name:new RegExp(`^${name}`)}).click();
        await capture(`markets-${name.toLowerCase()}`);
      }
      await page.locator(mobile?'.rmtMobileMarketRow':'.rmtMarketTableRow').filter({hasText:'STONKBROKER'}).first().click();
      await page.locator('#vn-asset-heading').waitFor();
      await page.locator('.vnChartFrame svg').waitFor();
      await capture('ordinary-full');
      const measuredRanges=[];
      for(const range of ['5M','15M','1H','6H','24H','7D']) {
        await page.getByRole('tab',{name:range,exact:true}).click();
        await page.waitForFunction(r=>document.querySelector('.vnChartRanges [aria-selected="true"]')?.textContent===r,range);
        await pause(220);
        const geometry=await page.locator('.vnChartFrame').evaluate(node=>{
          const svg=node.querySelector('svg'), b=node.getBoundingClientRect();
          return {width:b.width,height:b.height,viewBox:svg?.getAttribute('viewBox'),axis:svg?[...svg.querySelectorAll('.vnChartGrid text')].map(t=>({font:Number.parseFloat(getComputedStyle(t).fontSize),x:Number(t.getAttribute('x'))})):[],
            bounds:svg?[...svg.querySelectorAll('.vnChartCandles line,.vnChartCandles rect,.vnChartVolume rect')].map(n=>n.getBBox()).map(b=>({x:b.x,y:b.y,width:b.width,height:b.height})):[]};
        });
        if(!baseline) {
          assert.ok(geometry.viewBox,`${range}: actual chart drawn`);
          const [, , width,height]=geometry.viewBox.split(' ').map(Number);
          assert.equal(width,Math.round(geometry.width)); assert.equal(height,Math.round(geometry.height));
          assert.ok(geometry.axis.every(t=>t.font>=12));
          for(const b of geometry.bounds) { assert.ok(b.x>=0&&b.y>=0);assert.ok(b.x+b.width<=width+.1&&b.y+b.height<=height+.1); }
        }
        measuredRanges.push({range,...geometry});
        await capture(`chart-${range.toLowerCase()}`);
      }
      await page.getByRole('tab',{name:'1H',exact:true}).click();
      await pause(220);
      for(const name of baseline?['Activity','Safety','Markets','Position','Origin']:['Activity','Holders','Project','Position','More']) {
        await page.getByRole('tab',{name,exact:true}).click();
        await capture(name.toLowerCase());
      }
      if(!baseline) {
        await page.getByRole('tab',{name:'Project',exact:true}).click();
        assert.ok(await page.getByText('Project not linked yet',{exact:true}).isVisible());
        await page.getByRole('tab',{name:'More',exact:true}).click();
        await page.locator('.vnMoreDisclosure > summary').filter({hasText:'Evidence & Sources'}).click();
        await capture('evidence-sources');
        await page.getByRole('tab',{name:'Holders',exact:true}).click();
        await page.locator('.vnHolderSources > summary').click();
        await capture('holder-evidence');
      }
      // A settled optional-provider error must retain the rendered chart and its geometry.
      routes.setChartMode('stale');
      await page.getByRole('tab',{name:'6H',exact:true}).click(); await pause(250);
      await capture('stale-chart');
      if(!baseline) {
        assert.ok(await page.locator('.vnChartHeadline').getByText(/Market data delayed/).isVisible());
        assert.ok(await page.locator('.vnChartFrame svg').isVisible());
      }
      routes.setChartMode('unavailable');
      await page.getByRole('tab',{name:'24H',exact:true}).click();await pause(250);
      await capture('chart-unavailable');
      routes.setRiskMode('unavailable');
      await page.getByRole('tab',{name:baseline?'Safety':'Holders',exact:true}).click();await pause(250);
      await capture('partial-holders');
      if(mobile) await page.locator('.rmtMobileTradeDock .isBuy').click();
      const amount=page.getByLabel('Exact input amount',{exact:true});
      await amount.waitFor();
      await page.getByLabel('Pay with asset',{exact:true}).selectOption('eip155:4663/native');await amount.fill('0.0005');assert.equal(await amount.inputValue(),'0.0005');
      await capture('trade-ticket');
      if(mobile) await page.getByRole('button',{name:'Close trade sheet',exact:true}).last().click();
      // Distinct Stock Token surface, using an exact canonical positive-deny address.
      const stock='0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea';
      const resolution={ chainId:4663,requestedAddress:stock,requestedKind:'token',status:'token-only',token:{address:stock,name:'SpaceX Stock Token',symbol:'SPCX',decimals:18,totalSupply:'1000000000000000000000000'},pools:[],marketData:'identity-only',execution:'view-only',provenance:'robinhood-chain-contract-reads',resolvedAt:new Date().toISOString() };
      const relationship={relationship:'canonical-stock-token',assetId:'stock:spcx',tokenName:'SpaceX Stock Token',tokenSymbol:'SPCX',contractAddress:stock,currentMultiplier:'1',status:'active',logoUrl:null,provenance:'robinhood-live-asset-registry'};
      const stockMarket={...TOKEN_MARKETS[0],address:stock,assetId:`eip155:4663/contract:${stock}`,name:resolution.token.name,symbol:'SPCX',canonicalMarkets:[],stockAssetRelationships:[relationship],rwaRelationship:'canonical-stock-token',primaryMarket:{...TOKEN_MARKETS[0].primaryMarket,assetId:`eip155:4663/contract:${stock}`,token:resolution.token,baseToken:resolution.token,executionEligibility:'view-only'},verifiedMarkets:[]};
      await page.route(/\/api\/markets\/external(?:\?.*)?$/,route=>route.fulfill({json:{markets:[stockMarket],source:'CONTROLLED_STOCK_REGISTRY_AND_MARKET',stockAssetCoverage:'complete',updatedAt:new Date().toISOString()}}));
      await page.route(/\/api\/vnext\/asset-identity(?:\?.*)?$/,route=>route.fulfill({json:{resolution}}));
      await page.route(/\/api\/vnext\/asset-workspace(?:\?.*)?$/,route=>route.fulfill({json:{resolution,stockAssetRelationships:[{relationship:'canonical-stock-token',assetId:'stock:spcx',tokenName:'SpaceX Stock Token',tokenSymbol:'SPCX',contractAddress:stock,currentMultiplier:'1',status:'active',logoUrl:null,provenance:'robinhood-live-asset-registry'}],stockAssetCoverage:'complete',updatedAt:new Date().toISOString()}}));
      await page.goto(`${base}/?market=0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea`,{waitUntil:'domcontentloaded'});
      await page.locator('#vn-asset-heading').waitFor();
      if(!baseline) await page.getByRole('region',{name:'Stock Token information'}).waitFor();
      await capture('stock-token');
      if(!baseline) {
        assert.ok(await page.getByRole('region',{name:'Stock Token information'}).isVisible());
        assert.equal(await page.locator('.vnAssetClass').textContent(),'Stock Token');
        assert.equal(await page.locator('.rmtMobileTradeDock button.isBuy:enabled').count(),0);
      }
      assert.deepEqual(errors,[]);
      results.push({viewport,scope:'CONTROLLED_EXTERNAL_HTTP_REAL_PUBLIC_COMPONENTS_EMULATED_VIEWPORT',states,measuredRanges,requests,errors,walletRequests:0});
    } catch(error) {
      failures.push({viewport,message:error.message});
      await page.screenshot({path:path.join(output,`${viewport.width}-failure.png`),fullPage:true}).catch(()=>{});
      results.push({viewport,states,requests,errors,failure:error.message});
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(path.join(output,'report.json'),JSON.stringify({head:process.env.RMT_REVIEWED_HEAD??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),baseline,results,failures},null,2));
}
assert.deepEqual(failures,[]);
console.log(JSON.stringify({viewports:results.map(r=>({viewport:r.viewport,states:r.states.length,walletRequests:r.walletRequests})),failures}));
