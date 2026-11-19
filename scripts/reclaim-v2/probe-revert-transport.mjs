import assert from 'node:assert/strict';import{spawn,execFileSync}from'node:child_process';import{createServer}from'node:http';import{createServer as socket}from'node:net';import{createRequire}from'node:module';import{writeFileSync}from'node:fs';import{setTimeout as delay}from'node:timers/promises';
import{parseArgs}from'node:util';import{isAbsolute}from'node:path';
import{compileReclaimFixtureAssets}from'./fixture-assets.mjs';
import{fixtureCallRevert}from'./read-proxy-errors.mjs';
const require=createRequire(new URL('../../apps/indexer/package.json',import.meta.url));
const{createPublicClient,http,encodeDeployData,encodeFunctionData,BaseError,ContractFunctionRevertedError,keccak256}=require('viem');
const{values:args}=parseArgs({options:{anvil:{type:'string'},solc:{type:'string'},output:{type:'string'}}});for(const k of['anvil','solc','output'])assert.ok(args[k]&&isAbsolute(args[k]));
const version=execFileSync(args.anvil,['--version'],{encoding:'utf8',windowsHide:true}).trim();
const s=socket();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));
const child=spawn(args.anvil,['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--silent'],{stdio:'ignore',windowsHide:true});
const url='http://127.0.0.1:'+port,post=async(method,params=[])=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(3000)});assert.equal(r.status,200);return r.json();};let proxy;
try{
 let ok=false;for(let i=0;i<30;i++){try{ok=(await post('eth_chainId')).result==='0x7a69';if(ok)break;}catch{}await delay(100);}assert.ok(ok);
 const a=compileReclaimFixtureAssets({solc:args.solc}).artifacts.ReclaimBurn721Fixture;
 const from=(await post('eth_accounts')).result[0],data=encodeDeployData({abi:a.abi,bytecode:a.bytecode});
 const tx=(await post('eth_sendTransaction',[{from,data,gas:'0x989680'}])).result;assert.match(tx,/^0x[0-9a-f]{64}$/);
 let receipt;for(let i=0;i<30;i++){receipt=(await post('eth_getTransactionReceipt',[tx])).result;if(receipt)break;await delay(100);}assert.equal(receipt?.status,'0x1');
 const call=encodeFunctionData({abi:a.abi,functionName:'ownerOf',args:[999n]}),raw=await post('eth_call',[{to:receipt.contractAddress,data:call},'latest']),proof=fixtureCallRevert('eth_call',raw);assert.ok(proof);assert.equal(proof.code,3);
 let corrupt=false;proxy=createServer(async(req,res)=>{const incoming=JSON.parse(Buffer.concat(await Array.fromAsync(req)).toString('utf8'));const b=await post(incoming.method,incoming.params);const e=fixtureCallRevert(incoming.method,b);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:incoming.id,jsonrpc:'2.0',error:corrupt?{code:-32000,message:'Isolated upstream read failed'}:e}));});
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const rpc=createPublicClient({transport:http('http://127.0.0.1:'+proxy.address().port,{retryCount:0})});
 const absent=async()=>{try{await rpc.readContract({address:receipt.contractAddress,abi:a.abi,functionName:'ownerOf',args:[999n]});return false;}catch(e){return e instanceof BaseError&&e.walk(x=>x instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError;}};
 assert.equal(await absent(),true);corrupt=true;assert.equal(await absent(),false);
 const report={schemaVersion:1,status:'PASSED',scope:'LOCAL_ANVIL_31337_NO_UPSTREAM_NO_MAINNET',chainId:31337,anvilRuntime:version,source:'ReclaimBurn721Fixture',runtimeHash:keccak256(await post('eth_getCode',[receipt.contractAddress,'latest']).then(b=>b.result)),creationTransaction:tx,
  condition:'ownerOf for unminted synthetic ID999; this is transport proof, not a burn claim',actualUpstreamCode:raw.error.code,canonicalRevertDataHash:keccak256(raw.error.data),preservedRevertRecognized:true,genericFailureRecognizedAsAbsence:false,transactionSubmissions:1,replacementTransactions:0,contractReadRetryCount:0,productionChanges:false};
 writeFileSync(args.output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}child.kill();await delay(100);}
