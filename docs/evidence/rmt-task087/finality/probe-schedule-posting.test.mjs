import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {probeSchedulePosting,TARGET,LIMITS,PROVIDERS} from './probe-schedule-posting.mjs';
const v=createRequire(new URL('../../../../apps/launch-website/package.json',import.meta.url))('viem'),hex=n=>'0x'+BigInt(n).toString(16),word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),hash=n=>v.keccak256(v.stringToHex(String(n)));
const now=1795150000000,query=118800000,batch=500123,origin=26449990,posting=26450000,finalized=26450020,latest=26450030,inbox='0xbd0d173eeb87d57a09521c24388a12789f33ba96';
const eventAbi=v.parseAbi(['event SequencerBatchDelivered(uint256 indexed batchSequenceNumber,bytes32 indexed beforeAcc,bytes32 indexed afterAcc,bytes32 delayedAcc,uint256 afterDelayedMessagesRead,(uint64 minTimestamp,uint64 maxTimestamp,uint64 minBlockNumber,uint64 maxBlockNumber) timeBounds,uint8 dataLocation)']);
const log={address:inbox,blockNumber:hex(posting),blockHash:hash(posting),transactionHash:hash('batch-transaction'),logIndex:'0x3',removed:false,topics:v.encodeEventTopics({abi:eventAbi,eventName:'SequencerBatchDelivered',args:{batchSequenceNumber:BigInt(batch),beforeAcc:hash('before'),afterAcc:hash('after')}}),data:v.encodeAbiParameters(v.parseAbiParameters('bytes32,uint256,(uint64 minTimestamp,uint64 maxTimestamp,uint64 minBlockNumber,uint64 maxBlockNumber),uint8'),[hash('delayed'),10n,{minTimestamp:1n,maxTimestamp:2n,minBlockNumber:1n,maxBlockNumber:2n},0])};
function block(n){return{number:hex(n),hash:Number(n)===Number(TARGET.number)?TARGET.hash:hash(n),parentHash:hash(BigInt(n)-1n),stateRoot:hash('state-'+n),timestamp:Number(n)===Number(TARGET.number)?hex(Date.parse('2026-11-17T23:32:28Z')/1000):hex(now/1000)};}
function fixture(change=()=>undefined){
 const calls=[];
 const fetcher=async(url,options)=>{const {id,method,params}=JSON.parse(options.body),provider=PROVIDERS.find(p=>p.url===url);assert.ok(provider);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.deepEqual(Object.keys(options.headers),['content-type']);const call={provider:provider.name,layer:provider.layer,method,params,index:calls.length};calls.push(call);
  const changed=change(call);if(changed?.error)return new Response(JSON.stringify({jsonrpc:'2.0',id,error:changed.error}));
  let result=changed?.result;
  if(result===undefined){
   if(method==='eth_chainId')result=provider.layer==='L2'?'0x1237':'0x1';
   else if(method==='eth_getBlockByNumber'){let n=params[0]==='latest'?(provider.layer==='L2'?query+4:latest):params[0]==='finalized'?finalized:BigInt(params[0]);result=block(n);}
   else if(method==='eth_call'){assert.equal(provider.layer,'L2');assert.equal(params[0].to,'0x00000000000000000000000000000000000000c8');assert.equal(params[1],hex(query));assert.equal(params[0].data.slice(10),word(TARGET.number).slice(2));const selector=params[0].data.slice(0,10);assert.ok(['0x81f1adaf','0x6f275ef2'].includes(selector));result=word(selector==='0x81f1adaf'?batch:origin);}
   else if(method==='eth_getLogs'){assert.equal(provider.layer,'L1');assert.equal(params[0].fromBlock,hex(origin));assert.equal(params[0].toBlock,hex(latest));assert.equal(params[0].address,inbox);assert.equal(params[0].topics[1],word(batch));result=[structuredClone(log)];}
   else if(method==='eth_getTransactionReceipt')result={status:'0x1',transactionHash:log.transactionHash,blockHash:log.blockHash,blockNumber:log.blockNumber,logs:[structuredClone(log)]};
   else assert.fail('Unexpected method');
  }
  return new Response(JSON.stringify({jsonrpc:'2.0',id,result}),{status:200});
 };
 return{calls,run:()=>probeSchedulePosting({fetcher,clock:()=>now,sleep:async()=>{}})};
}
test('one exact schedule target, 40 reads, two independent L1 postings and common finalized header',async()=>{
 const f=fixture(),{report,raw}=await f.run();assert.equal(report.status,'CORROBORATED_FINALIZED_L1_POSTING');assert.equal(report.requests,40);assert.equal(raw.length,40);assert.deepEqual(report.target,TARGET);assert.equal(report.mapping.batch,String(batch));assert.notEqual(report.mapping.batch,'396507');assert.equal(report.mapping.origin,String(origin));assert.equal(report.finalized.value.number,String(finalized));assert.equal(report.posting.value.blockNumber,String(posting));assert.equal(report.broadcastAuthorized,false);assert.equal(report.signingAuthorized,false);assert.equal(report.productionActivationAuthorized,false);assert.equal(LIMITS.attemptsPerRequest,1);assert.ok(f.calls.every(x=>!['eth_estimateGas','eth_sendTransaction','eth_sendRawTransaction','eth_sign'].includes(x.method)));for(const name of ['publicnode','flashbots'])assert.equal(f.calls.filter(x=>x.provider===name&&x.method==='eth_getLogs').length,1);
});
test('unsupported NodeInterface remains unverified without retry or any L1 requests',async()=>{
 const f=fixture(c=>c.method==='eth_call'?{error:{code:-32000,message:'unsupported'}}:undefined),{report}=await f.run();assert.equal(report.status,'UNVERIFIED');assert.equal(report.reason,'RPC_UNAVAILABLE');assert.equal(f.calls.filter(c=>c.method==='eth_call'&&c.provider==='official').length,1);assert.equal(f.calls.filter(c=>c.method==='eth_call'&&c.provider==='pocket').length,1);assert.equal(f.calls.filter(c=>c.layer==='L1').length,0);
});
test('missing exact batch in the one bounded log window stays unknown; no search widening',async()=>{
 const f=fixture(c=>c.method==='eth_getLogs'?{result:[]}:undefined),{report}=await f.run();assert.equal(report.status,'UNVERIFIED');assert.equal(report.reason,'NO_LOG_IN_SINGLE_BOUNDED_WINDOW');assert.equal(f.calls.filter(c=>c.method==='eth_getLogs').length,2);assert.equal(f.calls.filter(c=>c.method==='eth_getTransactionReceipt').length,0);assert.ok(report.requests<=40);
});
test('changed canonical schedule header or batch witnesses fail closed',async()=>{
 const f=fixture(c=>c.provider==='pocket'&&c.method==='eth_getBlockByNumber'&&c.params[0]===hex(TARGET.number)?{result:{...block(TARGET.number),hash:hash('wrong-schedule')}}:undefined);assert.equal((await f.run()).report.status,'CONFLICT');assert.equal(f.calls.filter(c=>c.layer==='L1').length,0);
 const g=fixture(c=>c.provider==='pocket'&&c.method==='eth_call'&&c.params[0].data.startsWith('0x81f1adaf')?{result:word(batch+1)}:undefined);assert.equal((await g.run()).report.status,'CONFLICT');assert.equal(g.calls.filter(c=>c.layer==='L1').length,0);
});
test('replaced/removed receipt event and disagreeing finalized header cannot become posting proof',async()=>{
 const f=fixture(c=>c.method==='eth_getTransactionReceipt'?{result:{status:'0x1',transactionHash:log.transactionHash,blockHash:log.blockHash,blockNumber:log.blockNumber,logs:[{...log,removed:true}]}}:undefined);assert.equal((await f.run()).report.status,'CONFLICT');
 const g=fixture(c=>c.provider==='flashbots'&&c.method==='eth_getBlockByNumber'&&c.params[0]===hex(finalized)?{result:{...block(finalized),hash:hash('other-finalized')}}:undefined);assert.equal((await g.run()).report.status,'CONFLICT');
});
test('a canonical posting newer than common finalized height is not called finalized',async()=>{
 const f=fixture(c=>c.layer==='L1'&&c.method==='eth_getBlockByNumber'&&(c.params[0]==='finalized'||c.params[0]===hex(posting-1))?{result:block(posting-1)}:undefined),{report}=await f.run();assert.equal(report.status,'CORROBORATED_L1_POSTING_NOT_FINALIZED');
});
