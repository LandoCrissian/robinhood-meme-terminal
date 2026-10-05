import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base=process.env.RMT_VISUAL_BASE_URL??'http://127.0.0.1:3111';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const capture=JSON.parse(await readFile(new URL('../../docs/product/pre-trader-cleanup-evidence/nft-captured-query-replay.json',import.meta.url),'utf8'));
assert.equal(capture.authority,'CAPTURED_GENUINE_SUBSET_REPLAY_THROUGH_CORRECTED_LOCAL_POSTGRES_QUERY');
assert.equal(capture.item.tokenId,'5');
assert.ok(capture.inventory.items.some(item=>item.tokenId===capture.item.tokenId));
for(let i=1;i<capture.inventory.items.length;i++) assert.ok(BigInt(capture.inventory.items[i-1].tokenId)<BigInt(capture.inventory.items[i].tokenId));
const output=path.resolve(process.env.RMT_VISUAL_OUTPUT??'terminal-visual-v2','nft-numeric-inventory');
await mkdir(output,{recursive:true});
// This is captured genuine evidence, served only to a local production build.
// It is not fresh production data and cannot claim full collection coverage.
const server=createServer((request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1:43111');let body,status=200;
  if(request.headers.authorization!==`Bearer ${'a'.repeat(64)}`){status=401;body={error:'unauthorized'};}
  else if(url.pathname==='/internal/v1/projects/ccff00/inventory'){
    assert.equal(url.searchParams.get('afterTokenId'),null,'Captured acceptance only claims the first corrected page');
    const limit=Number(url.searchParams.get('limit')??24),items=capture.inventory.items.slice(0,limit);
    body={...capture.inventory,items,nextCursor:items.length<capture.inventory.items.length?items.at(-1).tokenId:capture.inventory.nextCursor};
  } else if(url.pathname==='/internal/v1/projects/ccff00/items/5')body=capture.item;
  else if(url.pathname==='/internal/v1/projects/ccff00/onchain')body=capture.onchain;
  else {status=503;body={error:'NOT_CAPTURED_NO_FABRICATED_EVIDENCE'};}
  response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(body));
});
await new Promise(resolve=>server.listen(43111,'127.0.0.1',resolve));
const browser=await chromium.launch(),results=[];
try{
 for(const width of [375,390,430,1440]){
  const mobile=width<768,context=await browser.newContext({viewport:{width,height:mobile?844:900},isMobile:mobile,hasTouch:mobile}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.__nftWalletRequests=0;window.ethereum={on(){},removeListener(){},async request({method}){if(/sign|sendTransaction|wallet_sendCalls|eth_requestAccounts/.test(method)){window.__nftWalletRequests++;throw Error('Financial action prohibited');}return method==='eth_chainId'?'0x1237':[];}};});
  const navigate=async(anchor,destination)=>{
    await anchor.waitFor();const href=await anchor.getAttribute('href');
    await anchor.evaluate(node=>node.scrollIntoView({block:'center'}));
    await page.waitForFunction(href=>{const node=document.querySelector(`a[href="${href}"]`),key=node&&Object.keys(node).find(key=>key.startsWith('__reactProps$'));return key&&typeof node[key]?.onClick==='function';},href);
    await anchor.click();
    await page.waitForURL(url=>url.pathname===new URL(href,base).pathname&&url.search===new URL(href,base).search,{waitUntil:'domcontentloaded'});
    await destination.waitFor();return {href,settledUrl:page.url(),destinationRendered:true};
  };
  await page.goto(`${base}/nft?q=ccff00%20%235`,{waitUntil:'domcontentloaded'});
  // NFT routes are read-only and intentionally do not mount TradingTermsGate.
  assert.equal(await page.locator('.tradingTermsBackdrop').count(),0);
  const search=page.locator('[data-nft-item-lookup="CONFIRMED"] [data-nft-search-item]');
  await search.waitFor();assert.equal(await search.getAttribute('href'),'/nft/ccff00/5');
  const searchToItem=await navigate(search,page.locator('[data-nft-item-workspace]'));
  assert.equal(await page.getByRole('heading',{name:'Token #5',exact:true}).count(),1);
  await navigate(page.getByRole('link',{name:/Back to CCFF00 collection/}),page.locator('[data-nft-gallery] a[href="/nft/ccff00/5"]'));
  const gallery=page.locator('[data-nft-gallery]');assert.equal(await gallery.locator('a[href^="/nft/ccff00/"]').count(),24);
  await page.screenshot({path:path.join(output,`${width}-genuine-collection.png`)});
  const item=gallery.locator('a[href="/nft/ccff00/5"]');
  const collectionToItem=await navigate(item,page.locator('[data-nft-item-workspace]'));
  assert.equal(await page.getByRole('heading',{name:'Token #5',exact:true}).count(),1);
  await page.screenshot({path:path.join(output,`${width}-genuine-item.png`)});
  const safety=await page.evaluate(()=>({overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),walletRequests:window.__nftWalletRequests}));
  assert.equal(safety.overflow,0);assert.equal(safety.walletRequests,0);assert.deepEqual(errors,[]);
  results.push({width,evidence:capture.authority,capturedAt:capture.capturedAt,result:'PASS',searchToItem,collectionToItem,itemLinks:24,...safety,errors});
  await context.close();
 }
}finally{await writeFile(path.join(output,'acceptance.json'),JSON.stringify(results,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log('Captured genuine NFT numeric inventory: collection renders 24 item links, first-click search/item and collection/item at four viewports PASS');
