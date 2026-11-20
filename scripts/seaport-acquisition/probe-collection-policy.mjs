import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {gunzipSync,gzipSync} from "node:zlib";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {nativeSourcePins,extractPublicOpenSeaListingSummaries,compareSourceTemplate} from "./probe-current-native-sources.mjs";
const require=createRequire(new URL("../../apps/indexer/package.json",import.meta.url)),v=require("viem");
const sha=x=>createHash("sha256").update(x).digest("hex"),json=x=>JSON.stringify(x,(_,a)=>typeof a==="bigint"?String(a):a,2)+"\n";
const bytes=/^0x(?:[0-9a-f]{2})*$/i,addr=/^0x[0-9a-f]{40}$/i,same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const need=(ok,code)=>{if(!ok)throw Error(code);};
export const collectionPolicyProbePins=Object.freeze({...nativeSourcePins,
 eoaRegistry:"0xe0a0004dfa318fc38298ae81a666710eadceba5c",
 managementModule:"0x721c002d2cae3522602b93a0c48e11dc573a15e3",
 safeDelegateModule:"0x721c0086cc4f335407cc84a38ce7dcb1560476b0",
 ruleset:"0x00721ce73fde1e57a9048e0e19b7ee7c8d3f10e3"});
const p=collectionPolicyProbePins,roles=["collection","implementation","validator","seaport","eoaRegistry","managementModule","safeDelegateModule","ruleset"];
const providers={official:"https://rpc.mainnet.chain.robinhood.com",pocket:"https://robinhood.api.pocket.network"};
const publicTargets={listingApi:"https://api.opensea.io/api/v2/listings/collection/lammbs-59693791/best?limit=1",collectionUi:"https://opensea.io/collection/lammbs-59693791"};
const sourceUrl=(chain,address)=>`https://sourcify.dev/server/v2/contract/${chain}/${address}?fields=all`;
const sourceTargets=Object.fromEntries(["collection","implementation","validator","eoaRegistry","managementModule","safeDelegateModule","ruleset"].flatMap(role=>[4663,1].map(chain=>[role+"-"+chain,sourceUrl(chain,p[role])])));
const allowed=new Set([...Object.values(publicTargets),...Object.values(sourceTargets),...Object.values(providers)]);
const refRows=()=>JSON.parse(gunzipSync(readFileSync(new URL("../../docs/evidence/rmt-task085/marketplace/raw-public-source-responses.json.gz",import.meta.url))));
/** Independent reads are bounded, ordered and fully drained even when one
 * fails. No rejected sibling can keep mutating an already emitted archive. */
export async function boundedCollectionReads(items,concurrency,read){
 need(Array.isArray(items)&&Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=8,"READ_CONCURRENCY_BOUND");
 let next=0;const results=new Array(items.length);
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{for(;;){const index=next++;if(index>=items.length)return;try{results[index]={status:"fulfilled",value:await read(items[index],index)};}catch(reason){results[index]={status:"rejected",reason};}}}));
 const failed=results.find(x=>x.status==="rejected");if(failed)throw failed.reason;return results.map(x=>x.value);
}
/** Recover a partial Pocket point from an existing capture only after every
 * anchored code/call response matches the completed official point. This is
 * offline reconstruction, never a missing canonical witness or new snapshot. */
export function reconstructPartialCollectionProvider(report,raw){
 need(report.corroborated===false&&report.providers?.official?.canonicalRechecked===true&&!report.providers.pocket,"PARTIAL_PROVIDER_RECONSTRUCTION_SCOPE");
 const point=report.providers.official,tag=v.toHex(BigInt(point.anchor.number));
 const expected=raw.filter(r=>r.url===providers.official&&["eth_getCode","eth_call"].includes(r.request?.method)&&r.request.params.at(-1)===tag);
 const counterpart=raw.filter(r=>r.url===providers.pocket&&["eth_getCode","eth_call"].includes(r.request?.method)&&r.request.params.at(-1)===tag);
 need(expected.length>0&&counterpart.length===expected.length,"PARTIAL_PROVIDER_READ_COVERAGE");
 const value=row=>{need(row.httpStatus===200&&typeof row.rawUtf8==="string","PARTIAL_PROVIDER_RESPONSE_UNAVAILABLE");const x=JSON.parse(row.rawUtf8);need(x.jsonrpc==="2.0"&&x.id===row.request.id&&!(Object.hasOwn(x,"result")&&Object.hasOwn(x,"error")),"PARTIAL_PROVIDER_RESPONSE_IDENTITY");return x.error?{errorData:x.error.data??null}:{result:x.result};};
 for(const row of expected){const matches=counterpart.filter(other=>other.request.method===row.request.method&&json(other.request.params)===json(row.request.params));need(matches.length>=1&&matches.every(other=>json(value(row))===json(value(other))),"PARTIAL_PROVIDER_STATE_DISAGREEMENT");}
 const headers=raw.filter(r=>r.url===providers.pocket&&r.request?.method==="eth_getBlockByNumber"&&r.request.params[0]===tag),initial=value(headers[0]).result;
 need(headers.length===2&&initial?.number===tag&&same(initial.hash,point.anchor.hash)&&String(BigInt(initial.timestamp))===point.anchor.timestamp,"PARTIAL_PROVIDER_ANCHOR_MISMATCH");
 need(value(headers[1]).result===null,"PARTIAL_PROVIDER_CANONICAL_FAILURE_UNAVAILABLE");
 const result=structuredClone(report);result.providers.pocket={...structuredClone(point),canonicalRechecked:false,offlineReconstructedFromCapturedEqualResponses:true};result.attemptedAnchor=point.anchor;
 result.offlineEvidenceReconstruction={status:"PARTIAL_POINT_ONLY_NOT_CORROBORATED",networkReads:0,matchedCodeAndCallResponses:expected.length,canonicalRecheckResponseSha256:headers[1].sha256,limitation:"The original Pocket final header response is null. Equal captured code/state does not establish a canonical witness or collection qualification."};return result;
}
export function selectorNamesFromSources(sources){
 const result={};for(const record of Object.values(sources??{}))for(const m of (record?.content??"").matchAll(/error\s+(\w+)\(\)\s*;/g))result[v.toFunctionSelector(m[1]+"()")]=m[1];return result;
}
/** Bind private module constants by unique reference immutable words plus the
 * reference's published constructor arguments. This does not establish the
 * chain4663 deployment transaction, all domain immutables or admin authority. */
export function bindReferenceConstructorModules(reference,actualRuntime){
 const comparison=compareSourceTemplate(reference,actualRuntime);need(comparison.executableOutsideImmutablesEqual,"VALIDATOR_REFERENCE_EXECUTABLE_MISMATCH");
 const constructor=reference.abi?.find(x=>x.type==="constructor"),encoded=reference.creationBytecode?.transformationValues?.constructorArguments;
 need(constructor&&bytes.test(encoded??""),"REFERENCE_CONSTRUCTOR_UNAVAILABLE");
 const args=v.decodeAbiParameters(constructor.inputs,encoded),refCode=reference.runtimeBytecode.onchainBytecode;
 const result={referenceChainId:1,actualDeploymentConstructorVerified:false,overallImmutableBindingsVerified:false,modules:{}};
 for(const [role,index]of [["eoaRegistry",1],["managementModule",2],["safeDelegateModule",3]]){
  const address=args[index];need(addr.test(address)&&same(address,p[role]),"REFERENCE_MODULE_BINDING_MISMATCH");const word=address.toLowerCase().slice(2).padStart(64,"0");
  const matching=Object.entries(reference.runtimeBytecode.immutableReferences??{}).filter(([,ranges])=>ranges.length&&ranges.every(({start,length})=>length===32&&refCode.slice(2+start*2,2+(start+length)*2).toLowerCase()===word));
  need(matching.length===1,"REFERENCE_IMMUTABLE_MAPPING_UNAVAILABLE");const id=matching[0][0],values=comparison.immutableValues[id];need(values?.length===1&&values[0].slice(2)===word,"ACTUAL_MODULE_BINDING_MISMATCH");
  result.modules[role]={address:address.toLowerCase(),referenceImmutableId:id,actualValues:values,currentCodeBindingVerified:true};
 }
 return result;
}
export function classifyDirectCollectionTransfer({approved,success,revertData,errors={}}){
 need(typeof approved==="boolean"&&typeof success==="boolean","TRANSFER_EVIDENCE_UNAVAILABLE");
 if(success)return {status:"READ_ONLY_CALL_SUCCEEDED_NOT_PURCHASE_ADMISSION",revertSelector:null};
 const selector=typeof revertData==="string"&&/^0x[0-9a-f]{8}/i.test(revertData)?revertData.slice(0,10).toLowerCase():null;
 const name=selector?errors[selector]??null:null;
 return {status:!approved?"SELLER_AUTHORIZATION_MISSING":"TRANSFER_REJECTED_REQUIRES_POLICY_REVIEW",revertSelector:selector,errorName:name,
  limitation:"An unapproved Seaport call does not prove immutable validator or receiver incompatibility."};
}

/** One fixed real collection and NFT478, credential-free public sources and
 * read-only calls. No arbitrary URLs, seller impersonation/signing, approval,
 * state overrides, token transfer transaction or submission method exists. */
export async function probeCollectionPolicy({fetchImpl=fetch,nowMs=Date.now()}={}){
 const raw=[],report={schemaVersion:1,status:"BLOCKED_NO_BROADCAST",chainId:4663,collection:p.collection,tokenId:"478",observedAt:new Date(nowMs).toISOString(),productionApproved:false,productionCatalogEmpty:true,broadcast:false,realSignatures:false,exploration:{candidates:1,maximumCandidates:1,additionalCandidates:[]},providers:{},roles:[],state:null,transferChecks:[],authorityClosure:{status:"UNRESOLVED",unknowns:[],mutableBoundaries:["COLLECTION_OWNER","TRANSFER_VALIDATOR_SELECTION","COLLECTION_RULESET","VALIDATOR_LISTS","ROYALTY_CONFIGURATION","MAX_SUPPLY"]},order:{status:"CURRENT_ORDER_UNAVAILABLE",fullSignedPayloadAvailable:false}};
 let reads=0,getCount=0;
 async function request(url,body,maxBytes=2*1024*1024){
  need(allowed.has(url),"FIXED_PUBLIC_TARGET_REQUIRED");if(!body)need(++getCount<=16,"PUBLIC_SOURCE_READ_BOUND");
  const method=body?"POST":"GET",options={method,credentials:"omit",redirect:"error",signal:AbortSignal.timeout(10000),headers:body?{"content-type":"application/json"}:{accept:"application/json,text/html"},...(body?{body:JSON.stringify(body)}:{})};
  try{const response=await fetchImpl(url,options);const parts=[],reader=response.body?.getReader();let size=0;
   try{if(reader)for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;need(size<=maxBytes,"PUBLIC_RESPONSE_BOUND");parts.push(value);}}finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();}
   const b=Buffer.concat(parts),text=new TextDecoder("utf-8",{fatal:true}).decode(b),record={url,method,credentials:"omit",apiCredentialUsed:false,redirect:"error",observedAt:new Date().toISOString(),httpStatus:response.status,contentType:response.headers.get("content-type"),bytes:b.length,sha256:sha(b),...(body?{request:body}:{}),rawUtf8:text};raw.push(record);return{...record,ok:response.ok,text};
  }catch{const record={url,method,credentials:"omit",apiCredentialUsed:false,status:"UNAVAILABLE",reason:"PUBLIC_TRANSPORT_UNAVAILABLE",...(body?{request:body}:{}),observedAt:new Date().toISOString()};raw.push(record);return record;}
 }
 const sourceRecords={};
 // Source identity is independently compared with code at the common anchor.
 // A chain1 reference is never represented as exact chain4663 constructor proof.
 for(const [key,result]of await boundedCollectionReads(Object.entries(sourceTargets),4,async([key,url])=>[key,await request(url)]))sourceRecords[key]=result;
 const [api,ui]=await boundedCollectionReads(Object.values(publicTargets),2,url=>request(url));
 report.order={status:"CURRENT_ORDER_UNAVAILABLE",fullSignedPayloadAvailable:false,api:{url:api.url,httpStatus:api.httpStatus??null,responseSha256:api.sha256??null},ui:{url:ui.url,httpStatus:ui.httpStatus??null,responseSha256:ui.sha256??null},dependency:"A voluntarily supplied already seller-authorized complete signed supported order, or explicitly authorized lawful complete-order data access.",notRequested:"No seller signature, token approval, API purchase or credentials requested."};
 if(ui.ok)try{report.order.publicUiClaim=extractPublicOpenSeaListingSummaries(ui.text,{nowMs}).find(x=>x.tokenId==="478")??null;}catch{report.order.ui.parseStatus="UNAVAILABLE";}
 const sourceObject=key=>{const r=sourceRecords[key];if(!r?.ok)return null;try{return JSON.parse(r.text);}catch{return null;}};
 const old=refRows(),implementation=sourceObject("implementation-4663")??JSON.parse(old.find(r=>r.url.includes("/contract/4663/"+p.implementation))?.rawUtf8??"null"),reference=sourceObject("validator-1")??JSON.parse(old.find(r=>r.url.includes("/contract/1/"+p.validator))?.rawUtf8??"null");
 need(implementation?.abi&&reference?.abi,"REFERENCE_SOURCE_UNAVAILABLE");
 const errors={...selectorNamesFromSources(implementation.sources),...selectorNamesFromSources(reference.sources)};
 report.referenceErrorSelectors=Object.fromEntries(Object.entries(errors).filter(([selector])=>["0xe1f1d02e",v.toFunctionSelector("TransferCallerNotOwnerNorApproved()")].includes(selector)));
 let id=0,pocketReadTail=Promise.resolve();
 async function rpc(provider,method,params){
  need(["eth_chainId","eth_getBlockByNumber","eth_getCode","eth_call"].includes(method),"READ_ONLY_METHOD_REQUIRED");need(++reads<=160&&JSON.stringify(params).length<=8192,"RPC_READ_BOUND");
  const requestId=++id,read=()=>request(providers[provider],{jsonrpc:"2.0",id:requestId,method,params},256*1024);
  // The shared Pocket endpoint rate-limits bursts. Providers still progress
  // concurrently, but Pocket has one request in flight and 250ms spacing.
  let r;if(provider==="pocket"){const previous=pocketReadTail;let release;pocketReadTail=new Promise(resolve=>{release=resolve;});await previous;try{r=await read();}finally{await new Promise(resolve=>setTimeout(resolve,250));release();}}else r=await read();
  need(r.ok,"RPC_TRANSPORT_UNAVAILABLE");const x=JSON.parse(r.text);need(x?.jsonrpc==="2.0"&&x.id===requestId&&!(Object.hasOwn(x,"result")&&Object.hasOwn(x,"error")),"RPC_RESPONSE_IDENTITY");if(x.error)return{error:x.error};need(Object.hasOwn(x,"result")&&x.result!==null,"RPC_RESULT_UNAVAILABLE");return{value:x.result};
 }
 try{
  const tips=await boundedCollectionReads(Object.keys(providers),2,async name=>{need((await rpc(name,"eth_chainId",[])).value==="0x1237","CHAIN_MISMATCH");return BigInt((await rpc(name,"eth_getBlockByNumber",["latest",false])).value.number);});
  const height=tips.reduce((a,b)=>a<b?a:b)-8n,tag=v.toHex(height);
  report.attemptedAnchor={number:String(height)};
  await boundedCollectionReads(Object.keys(providers),2,async name=>{
   const head=(await rpc(name,"eth_getBlockByNumber",[tag,false])).value;need(BigInt(head?.number??-1)===height&&/^0x[0-9a-f]{64}$/i.test(head?.hash??"")&&BigInt(head?.timestamp??0)>0n,"HEADER_BINDING_UNAVAILABLE");const point={chainId:4663,anchor:{number:String(height),hash:head.hash,timestamp:String(BigInt(head.timestamp))},roles:[],state:{},transferChecks:[],reads:[],canonicalRechecked:false};report.providers[name]=point;
   point.roles=await boundedCollectionReads(roles,4,async role=>{const result=await rpc(name,"eth_getCode",[p[role],tag]);need(bytes.test(result.value??"")&&result.value!=="0x","RUNTIME_UNAVAILABLE");
    const source4663=sourceObject(role+"-4663"),source1=sourceObject(role+"-1"),source=source4663?.runtimeBytecode?.onchainBytecode?source4663:source1?.runtimeBytecode?.onchainBytecode?source1:null;
    let correspondence;try{if(source)correspondence=compareSourceTemplate(source,result.value);}catch{}
    const selected=source===source4663?sourceRecords[role+"-4663"]:source===source1?sourceRecords[role+"-1"]:null;
    const row={role,address:p[role].toLowerCase(),runtimeHash:v.keccak256(result.value),codeBytes:(result.value.length-2)/2,source:{status:!source?"SOURCE_UNAVAILABLE":source===source4663?"HOSTED_4663_SOURCE":"REFERENCE_CHAIN1_SOURCE",url:selected?.url??null,responseSha256:selected?.sha256??null,fullRuntimeMatch:correspondence?.fullRuntimeEqualsHostedSource??false,executableOutsideImmutablesEqual:correspondence?.executableOutsideImmutablesEqual??false,immutableBindings:correspondence?.immutableValues??{},immutableBindingsVerified:false,independentlyRecompiled:false,...(role==="seaport"?{status:"PREVIOUSLY_PINNED_GENUINE_SEAPORT_RUNTIME",fullRuntimeMatch:same(v.keccak256(result.value),p.seaportRuntimeHash)}:{})}};
    if(role==="collection"){const clone="0x363d3d373d3d3d363d73"+p.implementation.slice(2).toLowerCase()+"5af43d82803e903d91602b57fd5bf3";need(same(result.value,clone),"CLONE_BINDING_MISMATCH");point.state.clone={kind:"EIP1167_FIXED_IMPLEMENTATION",implementation:p.implementation.toLowerCase(),runtime:result.value};}
    if(role==="validator")point.state.validatorModuleBindings=bindReferenceConstructorModules(reference,result.value);
    return row;
   });
   need(point.roles.find(r=>r.role==="implementation").source.fullRuntimeMatch,"IMPLEMENTATION_SOURCE_MISMATCH");need(point.roles.find(r=>r.role==="seaport").source.fullRuntimeMatch,"SEAPORT_RUNTIME_MISMATCH");
   async function call(abi,to,functionName,args=[],from){const readIndex=point.reads.length;point.reads.push(null);const transaction={to,data:v.encodeFunctionData({abi,functionName,args}),...(from?{from}:{})},r=await rpc(name,"eth_call",[transaction,tag]);let decoded=null;
    if(!r.error)try{decoded=v.decodeFunctionResult({abi,functionName,data:r.value});}catch{throw Error("SOURCE_ABI_RESPONSE_UNAVAILABLE");}
    const revertData=typeof r.error?.data==="string"&&bytes.test(r.error.data)?r.error.data:null;
    const item={from:from??null,to,functionName,args,success:!r.error,value:decoded,revertData,revertSelector:revertData?.slice(0,10)??null};point.reads[readIndex]=item;return item;
   }
   const c=p.collection,val=p.validator;
   for(const [field,value]of await boundedCollectionReads([["collectionOwner","owner",[]],["validator","getTransferValidator",[]],["maxSupply","maxSupply",[]],["totalSupply","totalSupply",[]],["seller","ownerOf",[478n]],["tokenApproved","getApproved",[478n]],["royaltyQuote","royaltyInfo",[478n,10n**18n]],["erc721","supportsInterface",["0x80ac58cd"]],["erc1155","supportsInterface",["0xd9b67a26"]]],4,async([field,fn,args])=>{const r=await call(implementation.abi,c,fn,args);need(r.success,"COLLECTION_STATE_UNAVAILABLE");return[field,r.value];}))point.state[field]=value;
   need(same(point.state.validator,val),"VALIDATOR_BINDING_DRIFT");
   for(const [field,value]of await boundedCollectionReads([["validatorOwner","owner",[]],["validatorPolicy","getCollectionSecurityPolicy",[c]],["ruleset","boundRuleset",[0]],["listOwner","listOwners",[0]],["sellerFrozen","isAccountFrozenForCollection",[c,point.state.seller]],["receiverFrozen","isAccountFrozenForCollection",[c,p.receiverCompatibilitySample]]],4,async([field,fn,args])=>{const r=await call(reference.abi,val,fn,args);return[field,r.success?r.value:{status:"UNAVAILABLE",revertSelector:r.revertSelector}];}))point.state[field]=value;
   need(same(point.state.ruleset,p.ruleset),"RULESET_BINDING_DRIFT");
   point.state.operatorApprovals={};point.state.operatorWhitelist={};
   for(const [operatorRole,operator]of [["seaport",p.seaport],["conduit",p.conduit]]){
    const [approval,whitelist,direct,sim,check]=await boundedCollectionReads([
     [implementation.abi,c,"isApprovedForAll",[point.state.seller,operator]],
     [reference.abi,val,"isAccountInListByCollection",[c,1,operator]],
     [implementation.abi,c,"transferFrom",[point.state.seller,p.receiverCompatibilitySample,478n],operator],
     [reference.abi,val,"validateTransferSim",[c,operator,point.state.seller,p.receiverCompatibilitySample,478n]],
     [reference.abi,val,"validateTransfer",[operator,point.state.seller,p.receiverCompatibilitySample,478n],c]
    ],4,args=>call(...args));
    need(approval.success,"SELLER_APPROVAL_UNAVAILABLE");point.state.operatorApprovals[operatorRole]=approval.value;point.state.operatorWhitelist[operatorRole]=whitelist.success?whitelist.value:{status:"UNAVAILABLE"};
    const approved=approval.value||same(point.state.tokenApproved,operator);
    point.transferChecks.push({kind:"directTransferFrom",operator,from:operator,to:c,receiver:p.receiverCompatibilitySample,method:"transferFrom(address,address,uint256)",approvalPresent:approved,approved,success:direct.success,revertData:direct.revertData,...classifyDirectCollectionTransfer({approved,success:direct.success,revertData:direct.revertData,errors}),receiverScope:"EXISTING_OPERATIONS_SAFE_CONTRACT_SAMPLE_NOT_V2_VAULT"});
    point.transferChecks.push({kind:"validatorSimulation",operator,from:c,to:val,receiver:p.receiverCompatibilitySample,method:"validateTransfer(address,address,address,uint256)",approvalPresent:approved,approved,success:check.success,revertData:check.revertData,errorCode:sim.success?sim.value[1]:check.revertSelector,errorName:errors[sim.success?sim.value[1]:check.revertSelector]??null,simulationResult:sim.success?sim.value:{status:"UNAVAILABLE"},receiverScope:"EXISTING_OPERATIONS_SAFE_CONTRACT_SAMPLE_NOT_V2_VAULT"});
   }
   const sellerWhite=await call(reference.abi,val,"isAccountInListByCollection",[c,1,point.state.seller]);point.state.sellerWhitelisted=sellerWhite.success?sellerWhite.value:{status:"UNAVAILABLE"};
   point.state.authorityAccounts=await boundedCollectionReads([["collectionOwner",point.state.collectionOwner],["validatorOwner",point.state.validatorOwner],["listOwner",point.state.listOwner]].filter(([,address])=>addr.test(address??"")),3,async([role,address])=>{const code=(await rpc(name,"eth_getCode",[address,tag])).value;need(bytes.test(code??""),"AUTHORITY_CODE_UNAVAILABLE");return{role,address,codeHash:v.keccak256(code),codeBytes:(code.length-2)/2,accountKind:code==="0x"?"EMPTY_CODE_EOA_CANDIDATE":/^0xef0100[0-9a-f]{40}$/i.test(code)?"EIP7702_DELEGATED":"CONTRACT_OR_UNKNOWN",signerIndependenceOrKeyControlVerified:false};});
   const after=(await rpc(name,"eth_getBlockByNumber",[tag,false])).value;need(same(after.hash,head.hash)&&after.number===head.number&&after.timestamp===head.timestamp,"REORG_DURING_OBSERVATION");point.canonicalRechecked=true;report.providers[name]=point;
  });
  const a=report.providers.official,b=report.providers.pocket;
  // Diagnostic reads can complete in a different order; consensus concerns
  // the common header, ordered runtime roles, state and transfer evidence.
  const consensus=x=>({chainId:x.chainId,anchor:x.anchor,roles:x.roles,state:x.state,transferChecks:x.transferChecks,canonicalRechecked:x.canonicalRechecked});
  const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==="object"?Object.fromEntries(Object.keys(x).sort().map(key=>[key,canonical(x[key])])):x;
  need(json(canonical(consensus(a)))===json(canonical(consensus(b))),"PROVIDER_DISAGREEMENT");report.corroborated=true;report.anchor=a.anchor;report.roles=a.roles;report.state=a.state;report.transferChecks=a.transferChecks;
  report.authorityClosure.unknowns=["Exact chain4663 source/constructor and immutable-module authority closure is not independently compiled/admitted.","Collection owner and validator/list administration retain mutable transfer/royalty powers; control independence and transaction-time enforcement are not established.","Existing V2 purchase calldata does not bind this dynamic validator/royalty policy fingerprint; offchain revalidation cannot prevent same-block privileged changes or future freezes.","No owner-approved real collection policy or full current signed order payload exists for this candidate."];
  report.compatibility={currentDirectSellerAuthorization:report.state.operatorApprovals.seaport||same(report.state.tokenApproved,p.seaport)?"PRESENT":"MISSING",validatorCheck:report.transferChecks.filter(x=>x.kind==="validatorSimulation"),immutableReceiverBanEstablished:false,transactionTimeEnforcement:"NOT_BOUND_BY_EXISTING_VAULT",collectionAdmission:"NO_GO"};
 }catch(error){report.corroborated=false;report.observationFailure=/^[A-Z][A-Z0-9_]+$/.test(error?.message??"")?error.message:"COLLECTION_OBSERVATION_UNAVAILABLE";report.authorityClosure.unknowns.push(report.observationFailure);}
 report.sourceResponses=Object.fromEntries(Object.entries(sourceRecords).map(([key,r])=>[key,{url:r.url,httpStatus:r.httpStatus??null,responseSha256:r.sha256??null}]));report.finishedAt=new Date().toISOString();report.readBudget={rpcReads:reads,maxRpcReads:160,publicGets:getCount,maxPublicGets:16,maxConcurrentPublicGets:4,maxConcurrentRpcReads:8,maxConcurrentPocketReads:1,pocketReadSpacingMs:250};return{report,raw};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 need(process.argv.length===3,"ISOLATED_OUTPUT_DIRECTORY_REQUIRED");const out=resolve(process.argv[2]),producerSha256=sha(readFileSync(fileURLToPath(import.meta.url)));mkdirSync(out,{recursive:true});const {report,raw}=await probeCollectionPolicy(),body=Buffer.from(json(raw)),encoded=Buffer.from(json(report));writeFileSync(resolve(out,"collection-policy-observation.json"),encoded);writeFileSync(resolve(out,"raw-public-responses.json.gz"),gzipSync(body,{level:9}));writeFileSync(resolve(out,"probe-manifest.json"),json({schemaVersion:1,status:"BLOCKED_NO_BROADCAST",producerSha256,reportSha256:sha(encoded),rawSha256:sha(body),rawBytes:body.length,responses:raw.length,scannerStatus:"REQUIRES_UNCHANGED_RAW_SCAN"}));console.log(json({status:report.status,order:report.order.status,corroborated:report.corroborated,anchor:report.anchor??null,failure:report.observationFailure??null,output:out}));
}
