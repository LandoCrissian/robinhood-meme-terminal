import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,resolve,relative,isAbsolute,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {setTimeout as pause} from 'node:timers/promises';
import {gzipSync} from 'node:zlib';
import {checkL1Receipt,classifyL1Posting} from '../../../../scripts/production-readiness/rpc.mjs';

const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../../../..');
const v=createRequire(new URL('../../../../apps/launch-website/package.json',import.meta.url))('viem');
const scheduled=JSON.parse(readFileSync(resolve(repo,'docs/evidence/mobile-signing/factory-publication-scheduled.json')));
const protocol=JSON.parse(readFileSync(resolve(repo,'docs/evidence/fixed-supply-release/l1-batches.json')));
export const TARGET=Object.freeze({number:'116966133',hash:'0xba98e1e82b736a50c46dfae095f1f3fd3cc4932921938c7b2aa8d30f23ec9106',transactionHash:'0x96bd234e49d766c73c66f9787f26736040b4fc64d91ed2ae888eca3f4c8afb65'});
assert.equal(scheduled.receiptBlock,TARGET.number);assert.equal(scheduled.blockHash,TARGET.hash);assert.equal(scheduled.transactionHash,TARGET.transactionHash);
export const PROVIDERS=Object.freeze([
 {name:'official',layer:'L2',url:'https://rpc.mainnet.chain.robinhood.com'},
 {name:'pocket',layer:'L2',url:'https://robinhood.api.pocket.network'},
 {name:'publicnode',layer:'L1',url:'https://ethereum-rpc.publicnode.com'},
 {name:'flashbots',layer:'L1',url:'https://rpc.flashbots.net'},
].map(provider=>Object.freeze(provider)));
const NODE=protocol.l2.nodeInterface.toLowerCase(),INBOX=protocol.l1.inbox.toLowerCase();
assert.equal(NODE,'0x00000000000000000000000000000000000000c8');assert.equal(INBOX,'0xbd0d173eeb87d57a09521c24388a12789f33ba96');
const eventAbi=v.parseAbi(['event SequencerBatchDelivered(uint256 indexed batchSequenceNumber,bytes32 indexed beforeAcc,bytes32 indexed afterAcc,bytes32 delayedAcc,uint256 afterDelayedMessagesRead,(uint64 minTimestamp,uint64 maxTimestamp,uint64 minBlockNumber,uint64 maxBlockNumber) timeBounds,uint8 dataLocation)']);
const eventTopic=v.toEventSelector(protocol.l1.signature),abiUint=[{type:'uint64'}],hash=/^0x[0-9a-f]{64}$/i,quantity=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const sha=b=>createHash('sha256').update(b).digest('hex'),hex=n=>'0x'+BigInt(n).toString(16),word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),json=x=>JSON.stringify(x,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
const nodeData=Object.fromEntries(['findBatchContainingBlock','blockL1Num'].map(name=>[name,v.toFunctionSelector(name+'(uint64)')+v.encodeAbiParameters(abiUint,[BigInt(TARGET.number)]).slice(2)]));
export const LIMITS=Object.freeze({requests:40,attemptsPerRequest:1,timeoutMs:8000,responseBytes:192*1024,endpointSpacingMs:250,logWindowBlocks:384});
class EvidenceError extends Error{constructor(reason,status='UNVERIFIED'){super(reason);this.status=status;}}
function need(ok,reason,status='CONFLICT'){if(!ok)throw new EvidenceError(reason,status);}
function q(x){need(typeof x==='string'&&quantity.test(x),'INVALID_QUANTITY','UNVERIFIED');return BigInt(x);}
function h(x){need(typeof x==='string'&&hash.test(x),'INVALID_HASH','UNVERIFIED');return x.toLowerCase();}
function header(raw){return{number:q(raw.number).toString(),hash:h(raw.hash),parentHash:h(raw.parentHash),stateRoot:h(raw.stateRoot),timestamp:q(raw.timestamp).toString()};}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function uint64(raw){need(typeof raw==='string'&&raw.length===66&&hash.test(raw),'NODE_INTERFACE_RESULT_UNAVAILABLE','UNVERIFIED');let n;try{[n]=v.decodeAbiParameters(abiUint,raw);}catch{throw new EvidenceError('NODE_INTERFACE_RESULT_UNAVAILABLE');}need(v.encodeAbiParameters(abiUint,[n]).toLowerCase()===raw.toLowerCase(),'NONCANONICAL_NODE_RESULT','UNVERIFIED');need(n>0n,'ZERO_NODE_MAPPING','UNVERIFIED');return n.toString();}

export function exactBatchLog(raw,batch,from,through){
 need(raw&&raw.removed===false&&raw.address?.toLowerCase()===INBOX,'BATCH_LOG_IDENTITY_CONFLICT');
 const parsed={address:INBOX,blockNumber:q(raw.blockNumber).toString(),blockHash:h(raw.blockHash),transactionHash:h(raw.transactionHash),logIndex:q(raw.logIndex).toString(),topics:raw.topics?.map(h),data:raw.data};
 need(Array.isArray(parsed.topics)&&parsed.topics.length===4&&parsed.topics[0]===eventTopic&&parsed.topics[1]===word(batch),'BATCH_TOPIC_CONFLICT');
 need(BigInt(parsed.blockNumber)>=from&&BigInt(parsed.blockNumber)<=through,'BATCH_LOG_OUTSIDE_BOUNDED_WINDOW');
 let decoded;try{decoded=v.decodeEventLog({abi:eventAbi,eventName:'SequencerBatchDelivered',topics:parsed.topics,data:parsed.data,strict:true});}catch{throw new EvidenceError('BATCH_EVENT_DECODE_UNAVAILABLE');}
 need(decoded.args.batchSequenceNumber===BigInt(batch),'BATCH_SEQUENCE_CONFLICT');
 const encoded=v.encodeAbiParameters(v.parseAbiParameters('bytes32,uint256,(uint64 minTimestamp,uint64 maxTimestamp,uint64 minBlockNumber,uint64 maxBlockNumber),uint8'),[decoded.args.delayedAcc,decoded.args.afterDelayedMessagesRead,decoded.args.timeBounds,decoded.args.dataLocation]);
 need(encoded.toLowerCase()===parsed.data.toLowerCase(),'NONCANONICAL_BATCH_EVENT');return parsed;
}

/** A single fixed-target capture: no signing/submission, retry or search widening. */
export async function probeSchedulePosting({fetcher=fetch,clock=Date.now,sleep=pause}={}){
 const raw=[],report={schemaVersion:1,scope:'READ_ONLY_ORIGINAL_SCHEDULE_BATCH_L1_POSTING_ONLY',target:TARGET,status:'UNVERIFIED',broadcastAuthorized:false,signingAuthorized:false,productionActivationAuthorized:false,observedAt:new Date(clock()).toISOString(),trustBoundary:'L2_RPC_BATCH_MEMBERSHIP_AND_TWO_ETHEREUM_RPC_POSTING_READS',limits:LIMITS,protocol:{nodeInterface:NODE,sequencerInbox:INBOX,batchEventTopic:eventTopic},l2:[],ethereum:[],observations:[],limitations:['L2 batch membership relies on the recorded L2 RPC witnesses; no independent rollup execution/challenge proof is claimed.','This targets the original schedule block only, not current governance state, current backend checkpoints or any future execution.','Absence/unsupported data in the single bounded log window stays UNVERIFIED; it is not a finality veto.']};
 const queues=new Map(),lastStart=new Map();let sent=0;
 async function read(provider,method,params=[]){
  need(['eth_chainId','eth_getBlockByNumber','eth_call','eth_getLogs','eth_getTransactionReceipt'].includes(method),'READ_METHOD_SCOPE_VIOLATION');need(Array.isArray(params)&&JSON.stringify(params).length<=4096,'REQUEST_BOUND');
  if(method==='eth_call')need(provider.layer==='L2'&&params.length===2&&params[0].to===NODE&&Object.keys(params[0]).length===2&&Object.values(nodeData).includes(params[0].data)&&quantity.test(params[1]),'NODE_CALL_SCOPE_VIOLATION');
  if(method==='eth_getLogs'){const f=params[0];need(provider.layer==='L1'&&params.length===1&&f.address===INBOX&&f.topics?.length===2&&f.topics[0]===eventTopic&&hash.test(f.topics[1])&&q(f.toBlock)-q(f.fromBlock)<384n&&q(f.toBlock)>=q(f.fromBlock),'LOG_SCOPE_VIOLATION');}
  if(method==='eth_getTransactionReceipt')need(provider.layer==='L1'&&params.length===1&&hash.test(params[0]),'RECEIPT_SCOPE_VIOLATION');
  const work=(queues.get(provider.name)??Promise.resolve()).then(async()=>{
   const wait=LIMITS.endpointSpacingMs-(clock()-(lastStart.get(provider.name)??0));if(wait>0)await sleep(wait);
   need(sent<LIMITS.requests,'REQUEST_BUDGET_EXHAUSTED','UNVERIFIED');const id=++sent;lastStart.set(provider.name,clock());
   const request={jsonrpc:'2.0',id,method,params},entry={index:id,provider:provider.name,layer:provider.layer,url:provider.url,request,requestedAt:new Date(clock()).toISOString(),status:'UNAVAILABLE'};raw.push(entry);
   const signal=AbortSignal.timeout(LIMITS.timeoutMs);
   try{
    const response=await fetcher(provider.url,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json'},body:JSON.stringify(request)});entry.httpStatus=response.status;
    const chunks=[];let size=0;try{for await(const part of response.body??[]){size+=part.length;need(size<=LIMITS.responseBytes,'RESPONSE_BYTE_LIMIT','UNVERIFIED');chunks.push(part);}}finally{await response.body?.cancel().catch(()=>{});}
    const bytes=Buffer.concat(chunks);entry.responseBytes=bytes.length;entry.responseSha256=sha(bytes);entry.rawUtf8=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    need(response.status===200,'HTTP_UNAVAILABLE','UNVERIFIED');let body;try{body=JSON.parse(entry.rawUtf8);}catch{throw new EvidenceError('RPC_JSON_UNAVAILABLE');}
    need(body.jsonrpc==='2.0'&&body.id===id&&!(Object.hasOwn(body,'result')&&Object.hasOwn(body,'error')),'RPC_ENVELOPE_UNAVAILABLE','UNVERIFIED');
    if(body.error){entry.rpcCode=Number.isInteger(body.error.code)?body.error.code:null;throw new EvidenceError('RPC_UNAVAILABLE');}
    need(body.result!==null&&body.result!==undefined,'RPC_RESULT_MISSING','UNVERIFIED');entry.status='OBSERVED';return body.result;
   }catch(error){const reason=error instanceof EvidenceError?error.message:signal.aborted?'TIMEOUT':'TRANSPORT_OR_BODY_UNAVAILABLE';entry.reason=reason;throw error instanceof EvidenceError?error:new EvidenceError(reason);}
  });queues.set(provider.name,work.then(()=>{},()=>{}));return work;
 }
 async function both(rows,operation){const settled=await Promise.allSettled(rows.map(operation));const failed=settled.flatMap((r,i)=>r.status==='rejected'?[{provider:rows[i].provider.name,reason:r.reason instanceof EvidenceError?r.reason.message:'INVALID_RESULT',status:r.reason instanceof EvidenceError?r.reason.status:'UNVERIFIED'}]:[]);if(failed.length){report.failures??=[];report.failures.push(...failed);throw new EvidenceError(failed[0].reason,failed.some(x=>x.status==='CONFLICT')?'CONFLICT':'UNVERIFIED');}return settled.map(r=>r.value);}
 const l2=PROVIDERS.filter(p=>p.layer==='L2').map(provider=>({provider})),eth=PROVIDERS.filter(p=>p.layer==='L1').map(provider=>({provider}));
 try{
  await both(l2,async row=>{need(q(await read(row.provider,'eth_chainId'))===4663n,'L2_CHAIN_CONFLICT');row.latest=header(await read(row.provider,'eth_getBlockByNumber',['latest',false]));});
  const height=l2.map(r=>BigInt(r.latest.number)).reduce((a,b)=>a<b?a:b)-4n;need(height>=BigInt(TARGET.number),'L2_QUERY_BEFORE_TARGET','UNVERIFIED');const tag=hex(height);
  await both(l2,async row=>{const p=row.provider;row.queryBefore=header(await read(p,'eth_getBlockByNumber',[tag,false]));need(row.queryBefore.number===height.toString(),'QUERY_HEIGHT_CONFLICT');need(Number(row.queryBefore.timestamp)*1000>=clock()-180000&&Number(row.queryBefore.timestamp)*1000<=clock()+10000,'L2_QUERY_STALE_OR_FUTURE','UNVERIFIED');row.targetBefore=header(await read(p,'eth_getBlockByNumber',[hex(TARGET.number),false]));need(row.targetBefore.number===TARGET.number&&row.targetBefore.hash===TARGET.hash,'SCHEDULE_TARGET_CONFLICT');need(new Date(Number(row.targetBefore.timestamp)*1000).toISOString()===scheduled.noticeStartsUtc,'SCHEDULE_TIMESTAMP_CONFLICT');row.batch=uint64(await read(p,'eth_call',[{to:NODE,data:nodeData.findBatchContainingBlock},tag]));row.origin=uint64(await read(p,'eth_call',[{to:NODE,data:nodeData.blockL1Num},tag]));row.targetAfter=header(await read(p,'eth_getBlockByNumber',[hex(TARGET.number),false]));row.queryAfter=header(await read(p,'eth_getBlockByNumber',[tag,false]));need(same(row.targetBefore,row.targetAfter)&&same(row.queryBefore,row.queryAfter),'L2_HEADER_REORGANIZED');});
  need(same(l2[0].queryBefore,l2[1].queryBefore)&&same(l2[0].targetBefore,l2[1].targetBefore)&&l2[0].batch===l2[1].batch&&l2[0].origin===l2[1].origin,'L2_MAPPING_WITNESS_CONFLICT');report.mapping={status:'CORROBORATED',batch:l2[0].batch,origin:l2[0].origin,query:l2[0].queryBefore,providers:l2.map(x=>x.provider.name)};
  await both(eth,async row=>{const p=row.provider;need(q(await read(p,'eth_chainId'))===1n,'L1_CHAIN_CONFLICT');row.finalized=header(await read(p,'eth_getBlockByNumber',['finalized',false]));row.latest=header(await read(p,'eth_getBlockByNumber',['latest',false]));need(BigInt(row.latest.number)>=BigInt(row.finalized.number),'L1_FINALIZED_AHEAD_OF_HEAD');});
  const common=eth.map(r=>BigInt(r.finalized.number)).reduce((a,b)=>a<b?a:b);
  await both(eth,async row=>{const p=row.provider;row.commonFinalized=header(await read(p,'eth_getBlockByNumber',[hex(common),false]));row.ownFinalizedRecheck=header(await read(p,'eth_getBlockByNumber',[hex(row.finalized.number),false]));need(row.commonFinalized.number===common.toString()&&same(row.finalized,row.ownFinalizedRecheck),'L1_FINALIZED_REORGANIZED');});
  need(same(eth[0].commonFinalized,eth[1].commonFinalized),'COMMON_FINALIZED_WITNESS_CONFLICT');report.finalized={status:'CORROBORATED',value:eth[0].commonFinalized,providers:eth.map(x=>x.provider.name)};
  await both(eth,async row=>{const p=row.provider,from=BigInt(report.mapping.origin),max=from+383n,through=BigInt(row.latest.number)<max?BigInt(row.latest.number):max;need(through>=from,'POSTING_WINDOW_NOT_AVAILABLE','UNVERIFIED');row.logQuery={address:INBOX,topics:[eventTopic,word(report.mapping.batch)],fromBlock:hex(from),toBlock:hex(through)};const logs=await read(p,'eth_getLogs',[row.logQuery]);need(Array.isArray(logs),'BATCH_LOG_RESULT_UNAVAILABLE','UNVERIFIED');need(logs.length!==0,'NO_LOG_IN_SINGLE_BOUNDED_WINDOW','UNVERIFIED');need(logs.length===1,'MULTIPLE_BATCH_LOGS_CONFLICT');row.log=exactBatchLog(logs[0],report.mapping.batch,from,through);row.before=header(await read(p,'eth_getBlockByNumber',[hex(row.log.blockNumber),false]));const receipt=await read(p,'eth_getTransactionReceipt',[row.log.transactionHash]);try{row.receipt=checkL1Receipt(receipt,row.log);}catch{throw new EvidenceError('L1_RECEIPT_LOG_CONFLICT','CONFLICT');}row.after=header(await read(p,'eth_getBlockByNumber',[hex(row.log.blockNumber),false]));need(row.before.number===row.log.blockNumber&&row.before.hash===row.log.blockHash&&same(row.before,row.after),'POSTING_BLOCK_REORGANIZED');});
  need(same(eth[0].log,eth[1].log)&&same(eth[0].before,eth[1].before),'POSTING_WITNESS_CONFLICT');report.posting={status:'CORROBORATED',value:eth[0].log,providers:eth.map(x=>x.provider.name)};
  await both(l2,async row=>{row.finalTarget=header(await read(row.provider,'eth_getBlockByNumber',[hex(TARGET.number),false]));row.finalQuery=header(await read(row.provider,'eth_getBlockByNumber',[tag,false]));need(same(row.targetBefore,row.finalTarget)&&same(row.queryBefore,row.finalQuery),'FINAL_L2_CANONICALITY_CONFLICT');});
  await both(eth,async row=>{row.finalCommonFinalized=header(await read(row.provider,'eth_getBlockByNumber',[hex(common),false]));need(same(row.commonFinalized,row.finalCommonFinalized),'FINAL_L1_CANONICALITY_CONFLICT');});
  report.status=classifyL1Posting(report.posting,report.finalized);
 }catch(error){report.status=error instanceof EvidenceError?error.status:'UNVERIFIED';report.reason=error instanceof EvidenceError?error.message:'INVALID_RESULT';}
 report.l2=l2.map(({provider,...row})=>({provider:provider.name,url:provider.url,...row}));report.ethereum=eth.map(({provider,...row})=>({provider:provider.name,url:provider.url,...row}));report.requests=sent;report.completedAt=new Date(clock()).toISOString();report.observations=raw.map(({rawUtf8,...entry})=>entry);return{report,raw};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const {values}=parseArgs({options:{output:{type:'string'}}});assert.ok(values.output,'Pass a fresh output directory under this finality evidence path');const out=resolve(values.output),rel=relative(here,out);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'Output must stay in Task087 finality evidence');assert.ok(!existsSync(out),'Output must be fresh');mkdirSync(out,{recursive:true});
 const sources=['docs/evidence/rmt-task087/finality/probe-schedule-posting.mjs','docs/evidence/rmt-task087/finality/probe-schedule-posting.test.mjs','scripts/production-readiness/rpc.mjs','docs/evidence/fixed-supply-release/l1-batches.json','docs/evidence/mobile-signing/factory-publication-scheduled.json'],sourceFiles=sources.map(path=>({path,sha256:sha(readFileSync(resolve(repo,path)))}));
 const {report,raw}=await probeSchedulePosting();assert.deepEqual(sources.map(path=>({path,sha256:sha(readFileSync(resolve(repo,path)))})),sourceFiles,'Finality source changed during the capture');report.sourceFiles=sourceFiles;writeFileSync(join(out,'report.json'),json(report),{flag:'wx'});const plain=Buffer.from(json(raw)),compressed=gzipSync(plain,{level:9,mtime:0});writeFileSync(join(out,'raw-responses.json.gz'),compressed,{flag:'wx'});writeFileSync(join(out,'integrity-manifest.json'),json({schemaVersion:1,target:TARGET,status:report.status,requests:report.requests,nodeVersion:process.version,rawBytes:plain.length,rawSha256:sha(plain),storedBytes:compressed.length,storedSha256:sha(compressed),encoding:'gzip mtime0 original captured public request/response records',reportSha256:sha(readFileSync(join(out,'report.json'))),sourceFiles:report.sourceFiles}),{flag:'wx'});console.log(json({status:report.status,requests:report.requests,output:out,broadcastAuthorized:false}));if(report.status==='CONFLICT')process.exitCode=1;
}
