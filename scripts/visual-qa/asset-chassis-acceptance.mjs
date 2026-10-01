import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
      if (['ordinary-full','markets','stock-token'].includes(name)) {
        await page.evaluate(() => scrollTo({top:0,left:0,behavior:'instant'}));
        await page.waitForFunction(()=>scrollY===0);
        await page.screenshot({ path:path.join(output,`${viewport.width}-${name}-viewport.png`) });
      }
      states.push({name,...metrics});
    };
    try {
      await page.goto(base,{waitUntil:'domcontentloaded',timeout:180000});
      const consent=page.getByRole('button',{name:'I understand',exact:false});
      await consent.waitFor({state:'visible',timeout:10000}).catch(()=>{});
      if(await consent.isVisible()) await consent.click();
      await page.locator(mobile?'.rmtMobileMarketRow':'.rmtMarketTableRow').first().waitFor();
      if (!baseline) {
        await page.waitForFunction(()=>typeof window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_SET_STATE__==='function');
        assert.equal(await page.evaluate(()=>Boolean(window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_STATE__?.authenticated)),false,'Visual SDK boundary remains signed out');
        await page.getByRole('button',{name:'Sign in',exact:true}).first().waitFor();
        const skip=page.locator('.vnSkipLink'); await skip.focus();
        const bounds=await skip.boundingBox(); assert.ok(bounds&&bounds.height>=44,'Keyboard skip action is exposed at usable size');
        await skip.blur();
      }
      await capture('markets');
      if(!baseline) {
        const summaries = await page.locator('[data-chain-pulse-expanded] > button > span:first-child > span').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,clipped:n.scrollWidth>n.clientWidth+1})));
        assert.ok(summaries.length===2&&summaries.every(s=>!s.clipped),'Markets context summaries wrap without truncation');
        assert.ok(summaries.some(s=>s.text.includes('24h volume $640M')),'Ready controlled chain context passes production payload validation');
        await page.locator('.rmtExplore > summary').first().click();
        assert.equal(await page.locator('.rmtExploreChoices button').filter({hasText:/Launches/}).count(),0,'Empty launch categories are not presented as populated');
        assert.equal(await page.locator('.rmtExploreChoices button').filter({hasText:/Projects/}).count(),1,'Verified Project Graph activates Projects independently of loaded token rows');
        await capture('markets-explore');
        await page.locator('.rmtExplore > summary').first().click();
      }
      for(const name of ['New','Movers','Trending','Active']) {
        await page.locator('.rmtMarketViews').first().getByRole('button',{name:new RegExp(`^${name}`)}).click();
        await capture(`markets-${name.toLowerCase()}`);
      }
      await page.locator(mobile?'.rmtMobileMarketRow':'.rmtMarketTableRow').filter({hasText:'STONKBROKER'}).first().click();
      await page.locator('#vn-asset-heading').waitFor();
      await page.locator('.vnChartFrame svg').waitFor();
      if(!baseline && mobile) {
        const caption=await page.locator('.vnChartHeadline > small').evaluate(n=>({height:n.getBoundingClientRect().height,hiddenDuplicate:getComputedStyle(n.querySelector('.vnChartObservationLabel')).display}));
        assert.equal(caption.hiddenDuplicate,'none','Mobile chart does not duplicate token identity above its plot');
        assert.ok(caption.height<=22,'Mobile chart caption occupies one line inside the fixed header');
        const header=await page.locator('.vnChartHeader').boundingBox();
        const style=await page.locator('.vnChartStyle > summary').boundingBox();
        assert.ok(style.x+style.width>=header.x+header.width-16&&style.y>=header.y&&style.y+style.height<=header.y+header.height+1,'44px mobile chart-style target stays right-aligned inside its fixed header');
      }
      await capture('ordinary-full');
      const measuredRanges=[];
      for(const range of ['5M','15M','1H','6H','24H','7D']) {
        await page.getByRole('tab',{name:range,exact:true}).click();
        await page.waitForFunction(r=>document.querySelector('.vnChartRanges [aria-selected="true"]')?.textContent===r,range);
        await pause(220);
        const geometry=await page.locator('.vnChartFrame').evaluate(node=>{
          const svg=node.querySelector('svg'), b=node.getBoundingClientRect();
          return {width:b.width,height:b.height,viewBox:svg?.getAttribute('viewBox'),axis:svg?[...svg.querySelectorAll('.vnChartGrid text')].map(t=>({font:Number.parseFloat(getComputedStyle(t).fontSize),fill:getComputedStyle(t).fill,label:t.textContent,bounds:{x:t.getBBox().x,y:t.getBBox().y,width:t.getBBox().width,height:t.getBBox().height}})):[],
            bounds:svg?[...svg.querySelectorAll('.vnChartCandle line,.vnChartCandle rect,rect.vnChartVolume')].map(n=>n.getBBox()).map(b=>({x:b.x,y:b.y,width:b.width,height:b.height})):[]};
        });
        if(!baseline) {
          assert.ok(geometry.viewBox,`${range}: actual chart drawn`);
          const [, , width,height]=geometry.viewBox.split(' ').map(Number);
          assert.equal(width,Math.round(geometry.width)); assert.equal(height,Math.round(geometry.height));
          assert.equal(geometry.axis.length,geometry.width<520?4:5,'Price tick density follows actual plot width');
          assert.ok(geometry.axis.every(t=>t.font>=13&&t.fill==='rgb(174, 184, 174)'),'Readable 13px secondary-contrast price axis');
          assert.ok(new Set(geometry.axis.map(t=>t.label)).size===geometry.axis.length,'Price tick formatting remains distinct');
          for(const tick of geometry.axis) assert.ok(tick.bounds.x>=0&&tick.bounds.x+tick.bounds.width<=width,'Axis labels remain inside the same chart frame');
          assert.ok(geometry.bounds.length>0,`${range}: rendered candle and volume bounds measured`);
          for(const b of geometry.bounds) { assert.ok(b.x>=0&&b.y>=0);assert.ok(b.x+b.width<=width+.1&&b.y+b.height<=height+.1); }
        }
        measuredRanges.push({range,...geometry});
        await capture(`chart-${range.toLowerCase()}`);
      }
      if(!baseline) {
        if(mobile) await page.locator('.vnChartStyle > summary').click();
        const styles=page.locator(mobile?'.vnChartStyle':'.vnChartModes');
        await styles.getByRole('button',{name:'Line',exact:true}).click();
        const line=page.locator('.vnChartLine'); await line.waitFor();
        const lineBounds=await line.evaluate(node=>{
          const b=node.getBBox(),frame=node.ownerSVGElement.viewBox.baseVal;
          return {x:b.x,y:b.y,width:b.width,height:b.height,frameWidth:frame.width,frameHeight:frame.height};
        });
        assert.ok(lineBounds.width>0&&lineBounds.x>=0&&lineBounds.y>=0);
        assert.ok(lineBounds.x+lineBounds.width<=lineBounds.frameWidth+.1&&lineBounds.y+lineBounds.height<=lineBounds.frameHeight+.1);
        measuredRanges.push({range:'7D',style:'line',bounds:lineBounds});
        await capture('chart-line');
        await styles.getByRole('button',{name:'Candles',exact:true}).click();
        if(mobile) await page.locator('.vnChartStyle > summary').click();
      }
      await page.getByRole('tab',{name:'1H',exact:true}).click();
      await pause(220);
      for(const name of baseline?['Activity','Safety','Markets','Position','Origin']:['Activity','Holders','Project','Position','More']) {
        await page.getByRole('tab',{name,exact:true}).click();
        if(!baseline&&name==='Position') {
          const position=page.locator('.vnPositionCard');
          assert.equal(await position.getByRole('button').count(),0,'Position does not duplicate the persistent Buy/Sell controls');
          assert.equal(await position.locator('.vnPositionValue').count(),0,'Signed-out Position has no empty valuation grid');
          assert.ok(await position.getByText('Sign in to view your holdings.',{exact:true}).isVisible());
          assert.ok((await position.boundingBox()).height<=180,'Unavailable Position is compact');
        }
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
      if(!baseline && !mobile) {
        const balance=await page.locator('.vnConfirmedBalance strong').evaluate(n=>({text:n.textContent,overflow:getComputedStyle(n).overflow,clipped:n.scrollWidth>n.clientWidth+1}));
        assert.ok(!balance.clipped&&balance.overflow==='visible','Desktop available balance/status is not ellipsized');
      }
      if(mobile) await page.getByRole('button',{name:'Close trade sheet',exact:true}).last().click();
      if(!baseline) {
        // Controlled-only social state. These URLs are never admitted to production data.
        routes.setChartMode('ready'); routes.setSocialLinks(true);
        await page.goto(base,{waitUntil:'domcontentloaded'});
        await page.locator(mobile?'.rmtMobileMarketRow':'.rmtMarketTableRow').filter({hasText:'STONKBROKER'}).first().click();
        await page.locator('.vnChartFrame svg').waitFor();
        await page.getByRole('tab',{name:'More',exact:true}).click();
        const quick=page.locator('.vnAssetQuickLinks');
        assert.doesNotMatch(await quick.innerText(),/V4 PoolId|Canonical pool|Observed pool|GeckoTerminal|Technical evidence/,'Primary Market Details contains no technical source dump');
        await quick.locator('.vnMoreLinksButton').click();
        const icons=[];
        for(const label of ['Website','X','Telegram']) {
          const icon=quick.getByRole('link',{name:new RegExp(` ${label} from market metadata$`)});
          await icon.waitFor();
          const info=await icon.evaluate(n=>({name:n.getAttribute('aria-label'),title:n.title,href:n.href,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,icon:n.querySelector('svg')?.getBoundingClientRect().width,overflow:n.scrollWidth>n.clientWidth+1}));
          assert.ok(info.name&&info.title&&info.width>=44&&info.height>=44&&info.icon===20&&!info.overflow);
          icons.push(info);
        }
        await capture('populated-social-links-controlled');
        states.at(-1).scope='CONTROLLED_SOCIAL_LINKS_NOT_PRODUCTION_RELATIONSHIPS'; states.at(-1).icons=icons;
        await page.locator('.vnMoreDisclosure > summary').filter({hasText:'Evidence & Sources'}).click();
        assert.match(await page.locator('.vnAssetSourceLinks').innerText(),/V4 PoolId/,'Pool identity and provider provenance remain available in Sources');
        await capture('social-provenance-controlled');
        routes.setContextUnavailable(true);
        await page.goto(base,{waitUntil:'domcontentloaded'});
        await page.getByText('Market context unavailable',{exact:true}).waitFor();
        await page.getByText('Stablecoin context unavailable',{exact:true}).waitFor();
        for(const card of await page.locator('[data-chain-pulse-expanded]').all()) {
          const summary=await card.locator('button > span:first-child > span').textContent();
          assert.equal((summary.match(/unavailable/gi)??[]).length,1,'A failed context source has one concise summary');
        }
        await capture('markets-context-unavailable');
      }
      // Distinct Stock Token surface, using an exact canonical positive-deny address.
      const stock='0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea';
      const resolution={ chainId:4663,requestedAddress:stock,requestedKind:'token',status:'token-only',token:{address:stock,name:'SpaceX Stock Token',symbol:'SPCX',decimals:18,totalSupply:'1000000000000000000000000'},pools:[],marketData:'identity-only',execution:'view-only',provenance:'robinhood-chain-contract-reads',resolvedAt:new Date().toISOString() };
      const relationship={relationship:'canonical-stock-token',assetId:'stock:spcx',tokenName:'SpaceX Stock Token',tokenSymbol:'SPCX',contractAddress:stock,currentMultiplier:'1',status:'active',logoUrl:null,provenance:'robinhood-live-asset-registry'};
      const stockMarket={...TOKEN_MARKETS[0],address:stock,assetId:`eip155:4663/contract:${stock}`,name:resolution.token.name,symbol:'SPCX',canonicalMarkets:[],stockAssetRelationships:[relationship],rwaRelationship:'canonical-stock-token',priceUsd:null,liquidityUsd:null,volume24h:null,volume5m:null,volume1h:null,buys5m:null,sells5m:null,buys1h:null,sells1h:null,buys24h:null,sells24h:null,priceChange24h:null,marketCapUsd:null,fdvUsd:null,ageMinutes:null,primaryMarket:{...TOKEN_MARKETS[0].primaryMarket,assetId:`eip155:4663/contract:${stock}`,token:resolution.token,baseToken:resolution.token,executionEligibility:'view-only'},verifiedMarkets:[]};
      routes.setChartMode('unavailable');
      await page.route(/\/api\/markets\/external(?:\?.*)?$/,route=>route.fulfill({json:{markets:[stockMarket],source:'CONTROLLED_STOCK_REGISTRY_AND_MARKET',stockAssetCoverage:'complete',updatedAt:new Date().toISOString()}}));
      await page.route(/\/api\/vnext\/asset-identity(?:\?.*)?$/,route=>route.fulfill({json:{resolution}}));
      await page.route(/\/api\/vnext\/asset-workspace(?:\?.*)?$/,route=>route.fulfill({json:{resolution,stockAssetRelationships:[{relationship:'canonical-stock-token',assetId:'stock:spcx',tokenName:'SpaceX Stock Token',tokenSymbol:'SPCX',contractAddress:stock,currentMultiplier:'1',status:'active',logoUrl:null,provenance:'robinhood-live-asset-registry'}],stockAssetCoverage:'complete',updatedAt:new Date().toISOString()}}));
      await page.route(/\/api\/markets\/external-trades(?:\?.*)?$/,route=>route.fulfill({status:503,json:{error:'CONTROLLED_STOCK_TAPE_UNAVAILABLE'}}));
      await page.goto(`${base}/?market=0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea`,{waitUntil:'domcontentloaded'});
      await page.locator('#vn-asset-heading').waitFor();
      if(!baseline) await page.getByRole('region',{name:'Stock Token information'}).waitFor();
      await capture('stock-token');
      if(!baseline) {
        assert.ok(await page.getByRole('region',{name:'Stock Token information'}).isVisible());
        assert.equal(await page.locator('.vnAssetClass').textContent(),'Stock Token');
        assert.equal(await page.locator('.rmtMobileTradeDock button.isBuy:enabled').count(),0);
        assert.ok((await page.locator('.vnChart').boundingBox()).height<=150,'Stock reference empty state does not reserve a premium plot');
        assert.equal(await page.locator('.vnAssetPrice').count(),0,'No synthetic ordinary-token price is copied into the Stock Token fixture');
        assert.equal(await page.locator('.vnChartFrame svg').count(),0,'Unavailable Stock chart is never fabricated');
      }
      assert.deepEqual(errors,[]);
      assert.ok(await page.getByRole('button',{name:'Sign in',exact:true}).first().isVisible(),'Real identity bridge exposes the normal signed-out entry under the controlled SDK boundary');
      results.push({viewport,scope:'CONTROLLED_EXTERNAL_HTTP_AND_PRIVY_SDK_REAL_PUBLIC_COMPONENTS_EMULATED_VIEWPORT',presentationProfile:'EXISTING_PRIVY_BRIDGE_ACCEPTANCE_PROFILE_SIGNED_OUT_NO_USER_WALLET_OR_IDENTITY_TOKEN',states,measuredRanges,requests,errors,walletRequests:0});
    } catch(error) {
      failures.push({viewport,message:error.message});
      console.error(`${viewport.width}: ${error.message}`);
      await page.screenshot({path:path.join(output,`${viewport.width}-failure.png`),fullPage:true}).catch(()=>{});
      results.push({viewport,states,requests,errors,failure:error.message});
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(path.join(output,'report.json'),JSON.stringify({head:process.env.RMT_REVIEWED_HEAD??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),dirty:Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()),baseline,results,failures},null,2));
}
assert.deepEqual(failures,[]);
if (!baseline) {
  const primary = ['375-ordinary-full','390-ordinary-full','430-ordinary-full','1440-ordinary-full','390-markets','1440-markets','390-stock-token','1440-stock-token'];
  const secondary = ['390-activity','390-holders','390-project','390-position','390-more','390-evidence-sources','390-populated-social-links-controlled','390-social-provenance-controlled','390-stale-chart','390-chart-unavailable','390-markets-explore','390-markets-context-unavailable','1440-activity','1440-holders','1440-project','1440-more','1440-populated-social-links-controlled','1440-markets-explore'];
  const source = { head:process.env.RMT_REVIEWED_HEAD??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(), scope:'CONTROLLED_EXTERNAL_HTTP_AND_PRIVY_SDK_REAL_PUBLIC_COMPONENTS_SIGNED_OUT_EMULATED_VIEWPORTS', configuration:'EXISTING_PRIVY_BRIDGE_ACCEPTANCE_PROFILE_SIGNED_OUT_LOCAL_NONCREDENTIAL_ZEROX_READINESS_CONFIGURATION', primary, secondary };
  const cards = await Promise.all([...primary,...secondary].map(async (name,index) => {
    const file = `${name}${index<primary.length?'-viewport':''}.png`;
    const png = (await readFile(path.join(output,file))).toString('base64');
    return `<figure><figcaption>${name}${name.includes('controlled')?' · CONTROLLED SOCIAL URLS, NOT PRODUCTION LINKS':''}</figcaption><a href="${name}.png"><img src="data:image/png;base64,${png}" alt="${name}" loading="lazy"></a></figure>`;
  }));
  await writeFile(path.join(output,'review-set.json'),JSON.stringify(source,null,2));
  await writeFile(path.join(output,'FINAL_AFTER_REVIEW.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>PR559 final product review</title><style>body{margin:24px;background:#0b0e0c;color:#f4f7f3;font:16px system-ui}p{line-height:1.6;overflow-wrap:anywhere}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}figure{margin:0}figcaption{margin:12px 0;font-size:14px}img{width:100%;height:auto;border:1px solid #314337;border-radius:12px}a{color:#82f28f}</style><h1>PR559 final after review</h1><p>Head ${source.head}<br>Tree ${source.tree}</p><p>Controlled external market/holder data, real public RMT components, signed out. Local noncredential 0x readiness configuration and the existing Privy SDK boundary fixture enable the normal signed-out ticket. The real RMT PrivyIdentityBridge mounts; no authenticated user, identity token or wallet is injected. Production configuration is not used or changed. Emulated viewports, not physical iPhones. Social URLs are controlled-only. These captures prove presentation, not production activation or financial acceptance. Click a capture for the full-page image.</p><h2>Primary product surfaces</h2><main>${cards.slice(0,8).join('')}</main><h2>Secondary and degraded states</h2><main>${cards.slice(8).join('')}</main></html>`);
}
console.log(JSON.stringify({viewports:results.map(r=>({viewport:r.viewport,states:r.states.length,walletRequests:r.walletRequests})),failures}));
