import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {chromium,webkit,expect,type Page} from 'playwright/test';

async function main(){
type Boot={connected:boolean;authenticated:boolean;chainId:string;providerChainId:string;providerAvailable:boolean;walletCount?:number;accounts?:string[]};
const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const output=path.join(root,'cannacat-wallet-return-evidence');
const channel=process.env.CANNACAT_BROWSER??'chrome';
assert(['chrome','msedge','webkit'].includes(channel));
const ready:Boot={connected:true,authenticated:true,chainId:'eip155:1',providerChainId:'0x1237',providerAvailable:true};
const boot=new Map<string,{state:Boot;logoutReject?:boolean}>();
let checks=0,apiCalls=0;
const check=(condition:unknown,message:string)=>{assert.ok(condition,message);checks++;};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url!,'http://localhost');
    if(url.pathname==='/'){
      const entry=boot.get(url.searchParams.get('case')??'');assert(entry);
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Task120 wallet-return acceptance</title><style>body{background:#080b07;color:#eef4e7;font-family:system-ui;margin:0;padding:20px}main{max-width:680px;margin:auto}</style><p>DISPOSABLE SYNTHETIC SESSION — NO REAL SIGNATURES OR TRADES</p><main id="panel"></main><script>window.__CANNACAT_FIXTURE_BOOT__=${JSON.stringify(entry.state)};window.__CANNACAT_FIXTURE_LOGOUT_REJECT__=${!!entry.logoutReject};</script><script type="module">import{mountCannaCatPanel}from'/fixture/cannacat-panel.mjs';mountCannaCatPanel(document.querySelector('#panel'),{enabled:true,apiBaseUrl:'https://rmt-fixture.invalid/api/embed/cannacat',privyAppId:'synthetic-app',privyClientId:'synthetic-client'});</script></html>`);return;
    }
    const match=url.pathname.match(/^\/fixture\/([A-Za-z0-9_./-]+\.mjs)$/);
    if(!match||match[1].includes('..')){res.writeHead(404).end();return;}
    res.setHeader('Content-Type','text/javascript; charset=utf-8');
    res.end(await readFile(path.join(root,'apps/web/cannacat-sdk-fixture',match[1])));
  }catch{res.writeHead(500).end('Synthetic acceptance server unavailable');}
});
await mkdir(output,{recursive:true});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://localhost:${(server.address() as {port:number}).port}`;
const browser=await(channel==='webkit'?webkit.launch({headless:true}):chromium.launch({channel,headless:true}));
const results:{name:string;width:number;result:'PASS'|'FAIL';error?:string}[]=[];
try{
for(const width of [320,390]){
  const run=async(name:string,state:Boot,work:(page:Page,key:string)=>Promise<void>,logoutReject=false)=>{
    const key=`${width}-${name}`;boot.set(key,{state,logoutReject});
    const context=await browser.newContext({viewport:{width,height:844}});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin===base){await route.continue();return;}
      if(url.href==='https://api.exchange.coinbase.com/products/ETH-USD/ticker'){
        await route.fulfill({json:{price:'2000.00',time:new Date().toISOString()},headers:{'access-control-allow-origin':'*'}});return;
      }
      if(url.origin==='https://rpc.mainnet.chain.robinhood.com'){
        const hash=`0x${'a'.repeat(64)}`;
        const rpc=route.request().postDataJSON();
        const answer=(entry:{id:number;method:string;params?:Array<{to?:string}>})=>{
          const spot=entry.method==='eth_call'&&entry.params?.[0]?.to?.toLowerCase()==='0xf3334192d15450cdd385c8b70e03f9a6bd9e673b';
          const values:Record<string,unknown>={eth_chainId:'0x1237',eth_getBalance:'0xde0b6b3a7640000',eth_gasPrice:'0x3b9aca00',eth_call:spot?'0x'+[1000n*2n**96n,0n,0n,0n].map(x=>x.toString(16).padStart(64,'0')).join(''):'0x'+(50_000n*10n**18n).toString(16).padStart(64,'0'),eth_getBlockByNumber:{number:'0x64',hash,parentHash:hash,transactions:[],timestamp:'0x'+Math.floor(Date.now()/1000).toString(16),gasLimit:'0x1c9c380',gasUsed:'0x0',baseFeePerGas:'0x3b9aca00',difficulty:'0x0',extraData:'0x',miner:'0x'+'0'.repeat(40),size:'0x100',nonce:'0x0000000000000000',sha3Uncles:hash,transactionsRoot:hash,stateRoot:hash,receiptsRoot:hash,logsBloom:'0x'+'0'.repeat(512)}};
          assert(entry.method in values,'Unexpected RPC '+entry.method);return{jsonrpc:'2.0',id:entry.id,result:values[entry.method]};
        };
        await route.fulfill({json:Array.isArray(rpc)?rpc.map(answer):answer(rpc),headers:{'access-control-allow-origin':'*'}});return;
      }
      if(url.origin==='https://rmt-fixture.invalid')apiCalls++;
      await route.fulfill({status:503,body:'No executable API calls are needed for wallet restoration'});
    });
    const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    try{
      await page.goto(base+'/?case='+key);
      await page.getByRole('button',{name:'I understand — continue',exact:true}).click();
      await work(page,key);
      check(errors.length===0,'No wallet-return runtime errors');
      check((await page.evaluate(()=>window.__CANNACAT_FIXTURE_WALLET_REQUESTS__?.length??0))===0,'Return never submits a transaction');
      check((await page.evaluate(()=>window.__CANNACAT_FIXTURE_AUTH_REQUESTS__??0))===0,'Return never signs ownership automatically');
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Returning-wallet controls fit viewport');
      await page.screenshot({path:path.join(output,`${channel}-${key}.png`),fullPage:true});
      results.push({name,width,result:'PASS'});
    }catch(error){
      await page.screenshot({path:path.join(output,`${channel}-${key}-failure.png`),fullPage:true}).catch(()=>undefined);
      results.push({name,width,result:'FAIL',error:String(error).slice(0,1500)});
    }finally{await context.close();}
  };
  const selected=async(page:Page)=>{await page.locator('[data-wallet-status="ready"]').waitFor();await expect(page.getByLabel('Wallet balances')).toContainText('1 ETH');};
  const disconnected=async(page:Page)=>{await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible();check(await page.locator('.rmtcat-wallet-identity').count()===0,'Manual disconnect restores no signing selection');};
  await run('valid-return',ready,async page=>{
    await selected(page);await page.reload();await selected(page);
    const preference=await page.evaluate(()=>JSON.parse(localStorage.getItem('rmt:cannacat:wallet-return:1')??'null'));
    check(JSON.stringify(Object.keys(preference).sort())===JSON.stringify(['address','userDisconnected','version']),'Return preference contains no authentication or signing material');
    check(preference.version===1&&!preference.userDisconnected&&preference.address==='0x0000000000000000000000000000000000000123','Remember only the live-verified public account hint');
    check(await page.getByRole('button',{name:'Verify wallet ownership',exact:true}).count()===0,'Valid restored session needs no second Verify click');
    check((await page.evaluate(()=>window.__CANNACAT_FIXTURE_LOGIN_REQUESTS__??0))===0,'Valid return opens no login prompt');
    check((await page.evaluate(()=>window.__CANNACAT_FIXTURE_CHAIN_SWITCHES__??0))===0,'Return does not silently switch networks');
  });
  await run('expired-session',{...ready,authenticated:false},async page=>{
    await page.getByRole('button',{name:'Verify wallet ownership',exact:true}).waitFor();
    await expect(page.getByRole('button',{name:'Review trade',exact:true})).toBeDisabled();
    check((await page.evaluate(()=>window.__CANNACAT_FIXTURE_LOGIN_REQUESTS__??0))===0,'Expiry never starts an unsolicited login');
  });
  await run('manual-disconnect',ready,async(page,key)=>{
    await selected(page);await page.getByRole('button',{name:'Disconnect',exact:true}).click();
    await disconnected(page);
    // External connection and application authentication are independent. The
    // SDK may still know the provider after a successful application logout.
    boot.set(key,{state:{...ready,authenticated:false}});await page.reload();await disconnected(page);
    await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
    await page.evaluate(()=>window.__CANNACAT_FIXTURE_UPDATE__?.({authenticated:true,chainId:'eip155:4663',providerChainId:'0x1237'}));
    await selected(page);
    check((await page.evaluate(()=>window.__CANNACAT_FIXTURE_LOGIN_REQUESTS__??0))===1,'Explicit reconnect alone resumes the ordinary login');
  });
  await run('logout-unavailable',ready,async page=>{
    await selected(page);await page.getByRole('button',{name:'Disconnect',exact:true}).click();await disconnected(page);
    await page.reload();await disconnected(page);
    check(await page.evaluate(()=>JSON.parse(localStorage.getItem('rmt:cannacat:wallet-return:1')!).userDisconnected===true),'Manual disconnect survives a failed provider logout');
  },true);
  await run('provider-not-restored',ready,async(page,key)=>{
    await selected(page);boot.set(key,{state:{...ready,connected:false}});await page.reload();
    await page.getByRole('button',{name:'Reconnect wallet',exact:true}).waitFor();
    await expect(page.getByText('Previously used wallet', {exact:false})).toBeVisible();
    check(await page.locator('.rmtcat-wallet-identity').count()===0,'Remembered address is only a reconnect hint');
    await expect(page.getByRole('button',{name:'Review trade',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Reconnect wallet',exact:true}).click();await selected(page);
    check((await page.evaluate(()=>window.__CANNACAT_FIXTURE_LOGIN_REQUESTS__??0))===0,'Existing valid session uses reconnect instead of new sign-in');
  });
  await run('missing-provider',{...ready,providerAvailable:false},async page=>{
    await page.locator('[data-wallet-status="unavailable"]').waitFor();await expect(page.getByRole('button',{name:'Review trade',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Reconnect wallet',exact:true}).click();await selected(page);
  });
  await run('account-mismatch',{...ready,accounts:['0x1111111111111111111111111111111111111111']},async page=>{
    await page.locator('[data-wallet-status="account-mismatch"]').waitFor();await expect(page.getByRole('button',{name:'Review trade',exact:true})).toBeDisabled();
  });
  await run('multiple-wallets',{...ready,walletCount:2},async page=>{
    const choice=page.getByLabel('Choose signing wallet');await choice.waitFor();await expect(choice).toHaveValue('');
    check(await page.locator('.rmtcat-wallet-identity').count()===0,'Returning multiple wallets are never silently selected');
  });
  await run('wrong-network',{...ready,chainId:'eip155:4663',providerChainId:'0x1'},async page=>{
    await page.locator('[data-wallet-status="wrong-chain"]').waitFor();await expect(page.getByRole('button',{name:'Review trade',exact:true})).toBeDisabled();
    check((await page.evaluate(()=>window.__CANNACAT_FIXTURE_CHAIN_SWITCHES__??0))===0,'Network change needs a user action');
    await page.getByRole('button',{name:'Switch to Robinhood Chain',exact:true}).click();await selected(page);
    check((await page.evaluate(()=>window.__CANNACAT_FIXTURE_CHAIN_SWITCHES__??0))===1,'Explicit network switch is preserved');
  });
}
const failed=results.filter(x=>x.result==='FAIL');
check(apiCalls===0,'Session restoration never enters execution endpoints');
await writeFile(path.join(output,channel+'.json'),JSON.stringify({result:failed.length?'FAIL':'PASS',channel,checks,scenarios:results,executionApiCalls:apiCalls,realSignatures:0,realTransactions:0,transport:'SYNTHETIC_PROVIDER_RESTORATION_NOT_PHYSICAL_IPHONE',nativeIphoneSafariTested:false},null,2));
assert.equal(failed.length,0,JSON.stringify(failed));
console.log(JSON.stringify({result:'PASS',channel,checks,scenarios:results.length,realSignatures:0,realTransactions:0}));
}finally{await browser.close();server.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
