import {createHash} from "node:crypto";
import {seaportVaultSignatures} from "../../packages/launchpad-common/seaport-vault-runtime.mjs";
const address=/^0x[0-9a-f]{40}$/i,hash=/^0x[0-9a-f]{64}$/i,decimal=/^(0|[1-9][0-9]{0,77})$/;
const zero="0x"+"00".repeat(20),same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const digest=v=>"0x"+createHash("sha256").update(JSON.stringify(v)).digest("hex");
const need=(v,code)=>{if(!v)throw Object.assign(Error(code),{code});};
const uint=v=>{need(typeof v==="string"&&decimal.test(v),"INVALID_INTEGER");const n=BigInt(v);need(n<2n**256n,"INVALID_INTEGER");return n;};
const safeCode=e=>/^[A-Z][A-Z0-9_]{0,79}$/.test(e?.code??"")?e.code:"READ_OR_PROOF_UNAVAILABLE";
export const watcherLimits=Object.freeze({maxEntries:8,maxRecords:64,maxStateBytes:524288,cycleTimeoutMs:15000,minIntervalMs:60000,maxGas:20000000n});
const outcome=(status,reason,extra={})=>({schemaVersion:1,status,reason,executionEnabled:false,executionApproved:false,broadcast:false,signatureRequested:false,...extra});
export function watcherBinding(configuration){
 const c=configuration;need(c&&["seaport-watch-local-31337","seaport-watch-4663-read-only"].includes(c.profile),"WATCH_PROFILE_UNASSIGNED");
 const chainId=c.profile==="seaport-watch-local-31337"?31337:4663;
 need(c.chainId===chainId&&[c.vault,c.projectToken,c.seaport,c.gasPayer].every(x=>address.test(x)&&!same(x,zero))&&hash.test(c.vaultRuntimeHash),"WATCH_BINDING_UNASSIGNED");
 return{profile:c.profile,chainId,vault:c.vault.toLowerCase(),projectToken:c.projectToken.toLowerCase(),seaport:c.seaport.toLowerCase(),gasPayer:c.gasPayer.toLowerCase(),vaultRuntimeHash:c.vaultRuntimeHash.toLowerCase()};
}
function assertSnapshot(s,b){
 need(s&&s.chainId===b.chainId&&same(s.vault,b.vault)&&same(s.projectToken,b.projectToken)&&same(s.seaport,b.seaport)&&same(s.vaultRuntimeHash,b.vaultRuntimeHash)&&s.runtimeVerified===true&&s.productionExecutionAvailable===false,"VAULT_BINDING_UNVERIFIED");
 need(s.canonical&&hash.test(s.canonical.hash),"CANONICAL_STATE_UNAVAILABLE");uint(s.canonical.number);uint(s.canonical.timestamp);uint(s.controllerEpoch);uint(s.policyEpoch);
 need(address.test(s.controller)&&hash.test(s.controllerAuthorityHash)&&typeof s.purchasesEnabled==="boolean"&&s.policy&&address.test(s.policy.currency),"POLICY_UNAVAILABLE");
 for(const k of["perNftCap","totalBudget","periodBudget","cooldownSeconds"])uint(s.policy[k]);
 for(const k of["availableWei","totalSpentWei","periodSpentWei","lastPurchaseAt"])uint(s[k]);
 need(s.gasPayer&&same(s.gasPayer.address,b.gasPayer),"GAS_PAYER_UNASSIGNED");for(const k of["latestNonce","pendingNonce","balanceWei"])uint(s.gasPayer[k]);
 need(s.gasPayer.latestNonce===s.gasPayer.pendingNonce,"GAS_PAYER_TRANSACTION_PENDING");
}
function fingerprint(s){
 return digest({chainId:s.chainId,vault:s.vault.toLowerCase(),runtime:s.vaultRuntimeHash,project:s.projectToken.toLowerCase(),controller:s.controller.toLowerCase(),authority:s.controllerAuthorityHash,controllerEpoch:s.controllerEpoch,policyEpoch:s.policyEpoch,enabled:s.purchasesEnabled,policy:s.policy,available:s.availableWei,totalSpent:s.totalSpentWei,periodSpent:s.periodSpentWei,lastPurchase:s.lastPurchaseAt,gasPayer:s.gasPayer});
}
function normalizeProof(p,s,b,nowMs){
 need(p&&["OWNER_SUPPLIED_CURRENT_ORDER_VERIFIED","CURRENT_ORDER_INDEPENDENTLY_VERIFIED"].includes(p.status)&&p.currentOrderIndependentlyVerified===true&&p.executionApproved===false&&p.executionEnabled===false,"CURRENT_ORDER_UNPROVEN");
 const o=p.order,v=p.verified,observed=p.observed??v?.observed,orderHash=p.orderHash??v?.orderHash;
 need(o&&o.chainId===b.chainId&&same(o.seaport,b.seaport)&&hash.test(orderHash)&&v?.payment&&v?.nft&&observed?.chainId===b.chainId,"CURRENT_ORDER_IDENTITY");
 need(observed.blockNumber===s.canonical.number&&same(observed.blockHash,s.canonical.hash)&&Date.parse(observed.timestamp)===Number(uint(s.canonical.timestamp))*1000&&Math.abs(nowMs-Date.parse(observed.timestamp))<=30000,"CURRENT_ORDER_STALE");
 const params=o.parameters,n=params?.offer?.[0];need(params?.orderType===0&&same(params.zone,zero)&&params.zoneHash==="0x"+"00".repeat(32)&&params.conduitKey==="0x"+"00".repeat(32)&&params.offer.length===1&&[2,3].includes(n.itemType),"ORDER_SUBSET_UNSUPPORTED");
 need(address.test(n.token)&&String(n.startAmount)===String(n.endAmount)&&uint(String(n.startAmount))>0n&&uint(String(n.startAmount))<=(n.itemType===2?1n:20n),"ORDER_QUANTITY_UNSUPPORTED");
 need(Array.isArray(params.consideration)&&params.consideration.length>0&&params.consideration.length<=8,"CONSIDERATION_UNAVAILABLE");
 const currency=params.consideration[0].token,total=params.consideration.reduce((sum,c)=>{need([0,1].includes(c.itemType)&&same(c.token,currency)&&String(c.startAmount)===String(c.endAmount)&&uint(String(c.startAmount))>0n&&address.test(c.recipient),"CONSIDERATION_UNAVAILABLE");return sum+uint(String(c.startAmount));},0n);
 need(same(currency,s.policy.currency)&&same(v.payment.currency,currency)&&v.payment.totalWei===String(total)&&same(v.nft.collection,n.token)&&v.nft.tokenId===String(n.identifierOrCriteria)&&v.nft.quantity===String(n.startAmount),"CONSIDERATION_IDENTITY");
 need(v.payment.consideration?.length===params.consideration.length&&params.consideration.every((c,i)=>same(c.recipient,v.payment.consideration[i].recipient)&&String(c.startAmount)===v.payment.consideration[i].amount),"CONSIDERATION_IDENTITY");
 need(s.collection&&same(s.collection.address,n.token)&&s.collection.enabled===true&&s.collection.tokenIdAllowed===true&&s.collection.standard===(n.itemType===2?721:1155)&&hash.test(s.collection.runtimeHash)&&s.orderConsumed===false,"COLLECTION_OR_ORDER_UNAVAILABLE");
 need(total<=uint(s.policy.perNftCap)*uint(String(n.startAmount))&&total+uint(s.totalSpentWei)<=uint(s.policy.totalBudget)&&total+uint(s.periodSpentWei)<=uint(s.policy.periodBudget)&&total<=uint(s.availableWei),"CAP_OR_RESERVE_EXCEEDED");
 const timestamp=uint(s.canonical.timestamp);need(uint(s.lastPurchaseAt)===0n||timestamp>=uint(s.lastPurchaseAt)+uint(s.policy.cooldownSeconds),"COOLDOWN_ACTIVE");
 need(uint(String(params.startTime))<=timestamp&&uint(String(params.endTime))>timestamp+1n,"ORDER_NOT_OPEN");
 const deadline=String(uint(String(params.endTime))-1n<timestamp+120n?uint(String(params.endTime))-1n:timestamp+120n);
 return{order:o,orderHash:orderHash.toLowerCase(),observed,currency,total:String(total),quantity:String(n.startAmount),deadline,sourceKind:p.status==="OWNER_SUPPLIED_CURRENT_ORDER_VERIFIED"?"OWNER_SUPPLIED":"PUBLIC",publicListingVerified:p.publicListingVerified===true,provenance:p.provenance??p.source??{}};
}
/** A read-only candidate, invoked by the existing indexer's verified-cycle
 * hook. There is no timer, wallet, private key, signature or submission method.
 * Production chain4663 can be observed but never produces execution requests.
 * Stores must provide durable compare-and-swap under the existing writer lease. */
export function createReadOnlySeaportWatcher({configuration,store,readState,discover,verifyEntry,prepareUnsigned,isCanonical,codecs,now=Date.now}){
 const binding=watcherBinding(configuration),bindingHash=digest(binding);
 need(store&&["load","commit"].every(k=>typeof store[k]==="function")&&[readState,discover,verifyEntry,prepareUnsigned,isCanonical].every(f=>typeof f==="function")&&typeof codecs?.parseAbi==="function"&&typeof codecs?.encodeFunctionData==="function","WATCH_DEPENDENCY_UNAVAILABLE");
 const abi=codecs.parseAbi(seaportVaultSignatures),interval=configuration.minIntervalMs??watcherLimits.minIntervalMs;
 need(Number.isSafeInteger(interval)&&interval>=1000&&interval<=3600000,"POLL_INTERVAL_UNSUPPORTED");
 let active;
 async function cycle({force=false}={}){
  const started=now();need(Number.isSafeInteger(started)&&started>0,"CLOCK_UNAVAILABLE");const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),watcherLimits.cycleTimeoutMs);
  const read=async task=>{need(!abort.signal.aborted,"READ_TIMEOUT");const remaining=watcherLimits.cycleTimeoutMs-(now()-started);need(remaining>0,"READ_TIMEOUT");let t;try{return await Promise.race([task(abort.signal),new Promise((_,reject)=>{t=setTimeout(()=>reject(Object.assign(Error("READ_TIMEOUT"),{code:"READ_TIMEOUT"})),remaining);})]);}finally{clearTimeout(t);need(!abort.signal.aborted,"READ_TIMEOUT");}};
  try{
   const previous=await read(()=>store.load(bindingHash));need(previous&&previous.bindingHash===bindingHash&&Number.isSafeInteger(previous.revision)&&Array.isArray(previous.records)&&previous.records.length<=watcherLimits.maxRecords&&Number.isSafeInteger(previous.lastPollAtMs),"WATCH_STORE_UNAVAILABLE");
   if(!force&&started<previous.lastPollAtMs+interval)return outcome("IDLE","POLL_INTERVAL",{bindingHash});
   const next={...previous,revision:previous.revision+1,lastPollAtMs:started,records:previous.records.map(x=>({...x}))};
   const commit=async()=>{need(Buffer.byteLength(JSON.stringify(next))<=watcherLimits.maxStateBytes,"WATCH_STORE_CAPACITY");need(await read(()=>store.commit(previous.revision,next))===true,"WATCH_STORE_CONFLICT");};
   const initial=await read(signal=>readState({binding,signal}));assertSnapshot(initial,binding);
   if(initial.purchasesEnabled!==true){for(const r of next.records)if(r.status==="PREPARED")r.status="INVALIDATED";await commit();return outcome("OFF","MINED_POLICY_OFF",{bindingHash});}
   const open=next.records.find(r=>r.status==="PREPARED");
   if(open){
    const canonical=await read(signal=>isCanonical(open.observed,signal));
    const current=await read(signal=>readState({binding,orderHash:open.orderHash,order:open.order,signal}));assertSnapshot(current,binding);
    if(!canonical||!current.purchasesEnabled||open.stateFingerprint!==fingerprint(current)||uint(open.deadline)<=uint(current.canonical.timestamp)){open.status="INVALIDATED";await commit();return outcome("REVIEW_REQUIRED","ORIGINAL_PROPOSAL_INVALIDATED",{bindingHash,orderHash:open.orderHash});}
    await commit();return outcome("IDLE","ORDER_ALREADY_PREPARED",{bindingHash,orderHash:open.orderHash});
   }
   const feed=await read(signal=>discover({binding,signal}));if(feed?.status!=="AVAILABLE"){await commit();return outcome("UNAVAILABLE","LISTING_FEED_UNAVAILABLE",{bindingHash});}
   need(Array.isArray(feed.entries)&&feed.entries.length<=watcherLimits.maxEntries,"LISTING_FEED_BOUND");
   for(const entry of feed.entries){
    need(entry&&["OWNER_SUPPLIED","PUBLIC"].includes(entry.sourceKind)&&Buffer.byteLength(JSON.stringify(entry))<=32768,"LISTING_ENTRY_BOUND");
    const first=await read(signal=>verifyEntry(entry,{binding,state:initial,signal}));const firstHash=first?.orderHash??first?.verified?.orderHash;
    if(!hash.test(firstHash))continue;
    if(next.records.some(r=>same(r.orderHash,firstHash)))continue;
    const state=await read(signal=>readState({binding,orderHash:firstHash,order:first.order,signal}));assertSnapshot(state,binding);
    if(!state.purchasesEnabled){await commit();return outcome("OFF","MINED_POLICY_OFF",{bindingHash});}
    // Reverify current signature/counter/status/ownership/approval and complete
    // consideration, rather than trusting a discovery result or a prior poll.
    const second=await read(signal=>verifyEntry(entry,{binding,state,signal}));const p=normalizeProof(second,state,binding,now());
    need(same(firstHash,p.orderHash)&&await read(signal=>isCanonical(p.observed,signal))===true,"CURRENT_ORDER_REORG");
    if(binding.chainId!==31337){await commit();return outcome("UNAVAILABLE","PRODUCTION_VAULT_NOT_RELEASED",{bindingHash,orderHash:p.orderHash});}
    need(next.records.length<watcherLimits.maxRecords,"WATCH_STORE_CAPACITY");
    const parameters={...p.order.parameters,totalOriginalConsiderationItems:BigInt(p.order.parameters.consideration.length)};
    const advanced={parameters,numerator:1n,denominator:1n,signature:p.order.signature,extraData:"0x"},request={signedOrderHash:p.orderHash,counter:uint(String(p.order.counter)),policyEpoch:uint(state.policyEpoch),controllerEpoch:uint(state.controllerEpoch),deadline:Number(p.deadline)};
    const data=codecs.encodeFunctionData({abi,functionName:"purchase",args:[advanced,request]});
    const intent={chainId:"0x7a69",type:"0x2",from:binding.gasPayer,to:binding.vault,value:"0x0",nonce:"0x"+uint(state.gasPayer.pendingNonce).toString(16),data};
    const prepared=await read(signal=>prepareUnsigned({intent,binding,state,proof:p,signal})),q=prepared?.request;
    need(q&&Object.keys(q).length===10&&["type","chainId","from","to","value","nonce","data"].every(k=>same(q[k],intent[k]))&&/^0x[1-9a-f][0-9a-f]*$/i.test(q.gas)&&/^0x[1-9a-f][0-9a-f]*$/i.test(q.maxFeePerGas)&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(q.maxPriorityFeePerGas),"UNSIGNED_REQUEST_MISMATCH");
    need(BigInt(q.gas)<=watcherLimits.maxGas&&BigInt(q.maxPriorityFeePerGas)<=BigInt(q.maxFeePerGas)&&BigInt(q.gas)*BigInt(q.maxFeePerGas)<=uint(state.gasPayer.balanceWei)&&prepared.simulationSucceeded===true,"SIMULATION_OR_GAS_UNAVAILABLE");
    const final=await read(signal=>readState({binding,orderHash:p.orderHash,order:p.order,signal}));assertSnapshot(final,binding);
    need(final.purchasesEnabled&&fingerprint(final)===fingerprint(state)&&final.canonical.number===state.canonical.number&&same(final.canonical.hash,state.canonical.hash)&&await read(signal=>isCanonical(p.observed,signal))===true,"STATE_CHANGED_BEFORE_PREPARATION");
    const candidate={orderHash:p.orderHash,status:"PREPARED",order:p.order,sourceKind:p.sourceKind,publicListingVerified:p.publicListingVerified,observed:p.observed,stateFingerprint:fingerprint(state),deadline:p.deadline,request:q,maximumNetworkFeeWei:String(BigInt(q.gas)*BigInt(q.maxFeePerGas)),createdAtMs:started,walletConfirmationRequired:true,executionApproved:false,executionEnabled:false,simulated:true};
    next.records.push(candidate);await commit();return outcome("PREPARED","EXPLICIT_WALLET_REVIEW_REQUIRED",{bindingHash,candidate});
   }
   await commit();return outcome("IDLE","NO_ADMITTED_NEW_ORDER",{bindingHash});
  }catch(error){return outcome("UNAVAILABLE",safeCode(error),{bindingHash});}finally{clearTimeout(timer);}
 }
 return{binding,bindingHash,tick(options){if(!active)active=cycle(options).finally(()=>{active=undefined;});return active;}};
}
