import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {verifyWrappedNativeProxy} from "../seaport-verification/provenance-proxy.mjs";
import {assessSeaportPaymentAsset} from "./payment-policy.mjs";
const require=createRequire(new URL("../../apps/indexer/package.json",import.meta.url)),{zeroAddress,keccak256}=require("viem");
const sha=b=>createHash("sha256").update(b).digest("hex");
const listingUrl="https://api.opensea.io/api/v2/listings/collection/lammbs-59693791/best?limit=1";
const root=new URL("../../docs/evidence/rmt-task083/marketplace/",import.meta.url);
const urls=Object.freeze({official:"https://rpc.mainnet.chain.robinhood.com",pocket:"https://robinhood.api.pocket.network"});
/** Fixed legitimate GET only, one request, no API key/cookie/redirect/private
 * fallback. HTTP401 is a final source boundary, not permission to bypass it. */
async function probePublicSource(fetchImpl){
 const source={url:listingUrl,method:"GET",credentials:"omit",redirect:"error",apiCredentialsUsed:false,currentSignedOrderAdmitted:false};
 try{const response=await fetchImpl(listingUrl,{method:"GET",credentials:"omit",redirect:"error",headers:{accept:"application/json"},signal:AbortSignal.timeout(8000)});
  const reader=response.body?.getReader(),parts=[];let bytes=0;try{if(reader)for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>524288)throw Error("PUBLIC_BODY_LIMIT");parts.push(r.value);}}finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();}
  const raw=Buffer.concat(parts);return {...source,status:response.ok?"OBSERVED_NOT_ADMITTED":"UNAVAILABLE",httpStatus:response.status,responseDate:response.headers.get("date"),contentType:response.headers.get("content-type"),bytes,rawSha256:sha(raw),rawUtf8:new TextDecoder("utf-8",{fatal:true}).decode(raw),reason:response.ok?"Transport observation only; each typed order still needs strict subset and fresh independent state proof":"SOURCE_HTTP_"+response.status};
 }catch(e){return {...source,status:"UNAVAILABLE",reason:String(e.message).slice(0,160)};}
}
async function observeAdminOwnerCode(payment,fetchImpl){
 const result={};for(const[name,p]of Object.entries(payment.providers??{})){
  if(p.adminOwner?.status!=="observed"){result[name]={status:"UNAVAILABLE"};continue;}
  try{if(urls[name]!==p.url||!/^[1-9][0-9]{0,15}$/.test(payment.anchor)||!/^0x[0-9a-f]{40}$/i.test(p.adminOwner.address))throw Error("OWNER_READ_SCOPE");
   const params=[p.adminOwner.address,"0x"+BigInt(payment.anchor).toString(16)],response=await fetchImpl(p.url,{method:"POST",redirect:"error",credentials:"omit",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:84,method:"eth_getCode",params}),signal:AbortSignal.timeout(8000)});
   const reader=response.body?.getReader(),parts=[];let size=0;try{if(reader)for(;;){const n=await reader.read();if(n.done)break;size+=n.value.length;if(size>192*1024)throw Error("OWNER_CODE_LIMIT");parts.push(n.value);}}finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();}
   const body=JSON.parse(Buffer.concat(parts));if(response.status!==200||body.error||typeof body.result!=="string"||!/^0x(?:[0-9a-f]{2})*$/i.test(body.result))throw Error("OWNER_CODE_UNAVAILABLE");
   result[name]={status:"observed",address:p.adminOwner.address,blockNumber:payment.anchor,runtime:body.result,runtimeHash:keccak256(body.result),emptyCode:body.result==="0x",signerQuorumEstablished:false,timelockEstablished:false};
  }catch(e){result[name]={status:"UNAVAILABLE",reason:String(e.message).slice(0,160),signerQuorumEstablished:false,timelockEstablished:false};}
 }return result;
}

/** One exact source-proven proxy hop beneath the observed ProxyAdmin owner.
 * This is a bounded control map, not a generic storage/contract explorer. */
export async function probeWrappedNativeOwnerProxyAuthority(payment,ownerCode,{fetchImpl=fetch}={}){
 const result={scope:"ONE_SOURCE_PROVEN_PROXY_HOP_READ_ONLY",status:"UNAVAILABLE",signerQuorumEstablished:false,upgradePolicyAdmitted:false,providers:{},rawReads:[]};
 const slots={implementation:"0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",admin:"0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"};
 const reproducedProxyHash="0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353";
 try{
  if(!payment.bindingsCorroborated||!payment.authorityCorroborated||!/^[1-9][0-9]{0,15}$/.test(payment.anchor))throw Error("PRIOR_CORROBORATED_BINDING_REQUIRED");
  const tag="0x"+BigInt(payment.anchor).toString(16);
  async function read(name,method,params){
   if(!["eth_getStorageAt","eth_getCode","eth_call","eth_getBlockByNumber"].includes(method))throw Error("OWNER_PROXY_READ_SCOPE");
   const response=await fetchImpl(urls[name],{method:"POST",redirect:"error",credentials:"omit",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:84,method,params}),signal:AbortSignal.timeout(8000)});
   const reader=response.body?.getReader(),parts=[];let size=0;try{if(reader)for(;;){const n=await reader.read();if(n.done)break;size+=n.value.length;if(size>192*1024)throw Error("OWNER_PROXY_RESPONSE_LIMIT");parts.push(n.value);}}finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();}
   const raw=Buffer.concat(parts),text=new TextDecoder("utf-8",{fatal:true}).decode(raw);result.rawReads.push({provider:name,method,params,httpStatus:response.status,rawUtf8:text,rawSha256:sha(raw)});
   const body=JSON.parse(text);if(response.status!==200||body.error)return {error:body.error??"HTTP_"+response.status};return {value:body.result};
  }
  const jobs=await Promise.allSettled(["official","pocket"].map(async name=>{
   const p=payment.providers[name],owner=p.adminOwner.address,known=ownerCode[name];if(p.url!==urls[name]||known?.runtimeHash!==reproducedProxyHash||p.proxyRuntimeHash!==reproducedProxyHash)throw Error("OWNER_NOT_EXACT_REPRODUCED_PROXY");
   const provider={proxy:owner,proxyRuntimeHash:known.runtimeHash,slots:{},implementationRuntimeHash:null,adminRuntimeHash:null,delegatedOwnerGetter:null,canonical:false};
   for(const [role,slot]of Object.entries(slots)){const r=await read(name,"eth_getStorageAt",[owner,slot,tag]);if(!/^0x[0-9a-f]{64}$/i.test(r.value??""))throw Error("OWNER_PROXY_SLOT_UNAVAILABLE");provider.slots[role]={slot,word:r.value,address:"0x"+r.value.slice(-40)};}
   for(const role of ["implementation","admin"]){const r=await read(name,"eth_getCode",[provider.slots[role].address,tag]);if(!/^0x(?:[0-9a-f]{2})*$/i.test(r.value??""))throw Error("OWNER_PROXY_CODE_UNAVAILABLE");provider[role+"RuntimeHash"]=keccak256(r.value);provider[role+"RuntimeBytes"]=(r.value.length-2)/2;}
   const own=await read(name,"eth_call",[{to:owner,data:"0x8da5cb5b"},tag]);provider.delegatedOwnerGetter=own.error?{status:"unavailable",error:own.error}:/^0x[0-9a-f]{64}$/i.test(own.value??"")?{status:"observed",address:"0x"+own.value.slice(-40),authorityNotAdmitted:true}:{status:"unavailable",reason:"MALFORMED_OWNER_GETTER"};
   const block=await read(name,"eth_getBlockByNumber",[tag,false]);provider.canonical=block.value?.hash===p.block.hash;if(!provider.canonical)throw Error("OWNER_PROXY_ANCHOR_CHANGED");result.providers[name]=provider;
  }));
  const rejected=jobs.find(job=>job.status==="rejected");if(rejected)throw rejected.reason;
  if(JSON.stringify(result.providers.official)!==JSON.stringify(result.providers.pocket))throw Error("OWNER_PROXY_PROVIDER_DISAGREEMENT");
  result.status="SOURCE_PROVEN_PROXY_HOP_OBSERVED_AUTHORITY_UNADMITTED";
 }catch(e){result.reason=String(e.message).slice(0,160);}
 result.limitations=["One proxy hop only; downstream implementation source, admin signer sets/quorum, modules/roles and upgrade timelocks are not independently established.","No direct EOA or Safe control is inferred from an address, bytecode name or owner getter. No proxy currency payment is admitted."];return result;
}

export async function qualifyCurrentMarketplace({fetchImpl=fetch,paymentObservation,nowMs=Date.now()}={}){
 const report={schemaVersion:1,scope:"READ_ONLY_4663_NOT_EXECUTION_AUTHORITY",status:"BLOCKED_NO_BROADCAST",observedAt:new Date(nowMs).toISOString(),productionChanged:false,productionBroadcast:false,ownerSignaturesRequested:false,currentLiveListingVerified:false,productionPaymentAdmitted:false};
 report.publicSource=await probePublicSource(fetchImpl);
 try{report.payment=paymentObservation??await verifyWrappedNativeProxy("latest");}catch(e){report.payment={status:"UNAVAILABLE",reason:String(e.message).slice(0,200),productionPaymentAdmitted:false};}
 const previous=JSON.parse(gunzipSync(readFileSync(new URL("marketplace-qualification.json.gz",root)),{maxOutputLength:2*1024*1024}));
 report.preservedSourceComparisons={};for(const[name,record]of Object.entries(previous.assets.wrappedNative.sourceRecords)){const actual=report.payment.providers?.official?.[name==="proxy"?"proxyRuntimeHash":name+"RuntimeHash"];report.preservedSourceComparisons[name]={priorTask083SourceEvidence:"docs/evidence/rmt-task083/marketplace/marketplace-qualification.json.gz",priorSourceReproduction:record.reproduction,currentRuntimeEqualsPreservedSource:!!actual&&actual===record.reproduction.actualRuntimeHash,newCompilerExecution:false};}
 report.adminOwnerCode=await observeAdminOwnerCode(report.payment,fetchImpl);
 report.ownerProxyAuthority=await probeWrappedNativeOwnerProxyAuthority(report.payment,report.adminOwnerCode,{fetchImpl});
 report.nativePolicy=assessSeaportPaymentAsset({currency:zeroAddress});report.wrappedNativePolicy=assessSeaportPaymentAsset({currency:report.payment.proxy??"0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"});
 report.authorityAssessment={signerQuorumEstablished:false,upgradeNoticeOrTimelockEstablished:false,upgradePolicyAdmitted:false,reason:"Observed owner/code is not proof of controlling signer set, quorum or immutable delay. Preserved ProxyAdmin source exposes onlyOwner upgrade/upgradeAndCall/changeProxyAdmin; aeWETH includes gateway bridgeBurn."};
 report.feedVerdict="NO_CURRENT_PUBLIC_ORDER_ADMITTED_OWNER_SUPPLIED_PATH_REQUIRES_FRESH_PROOF";report.nextInput="Strict OWNER_SUPPLIED signed structured listing bytes; collection URL or historical fulfilled receipt is insufficient";
 report.documentation=[{url:"https://docs.opensea.io/reference/get_best_listings_collection",purpose:"Documented best-listings GET; credential UI does not grant credential or bypass authority"},{url:"https://docs.opensea.io/reference/api-keys",purpose:"No API key provisioned or purchased"},{url:"https://reservoirprotocol.readme.io/reference/supported-chains",purpose:"No independently established documented Robinhood current-order endpoint is admitted here"}];
 report.limitations=["The bounded source attempt does not establish absence of all live orders.","No original compiler input is newly reproduced in this read-only refresh; exact earlier metadata gaps remain.","No current signed owner order was supplied during this qualification.","Independent L1 finality, contract security clearance, owner asset policy and production release remain unapproved."];
 return report;
}
