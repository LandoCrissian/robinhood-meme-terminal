import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {createSeaportVerifier} from "../../packages/launchpad-common/seaport-order-verifier.mjs";

const require=createRequire(new URL("../../apps/indexer/package.json",import.meta.url));
const v=require("viem"),legacy=createSeaportVerifier(v),zero=v.zeroAddress;
const profiles=Object.freeze({"robinhood-4663-read-only-v1":4663,"seaport-local-31337-v1":31337});
const canonicalSeaport="0x0000000000000068F116a894984e2DB1123eB395";
const hash=x=>typeof x==="string"&&/^0x[0-9a-f]{64}$/i.test(x),uint=x=>typeof x==="string"&&/^(0|[1-9][0-9]{0,77})$/.test(x)&&BigInt(x)<2n**256n;
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const record=x=>!!x&&typeof x==="object"&&!Array.isArray(x),exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const need=(ok,reason)=>{if(!ok)throw Error(reason);},sha=x=>"0x"+createHash("sha256").update(x).digest("hex");
const stable=x=>typeof x==="bigint"?x.toString():typeof x==="string"&&/^0x/i.test(x)?x.toLowerCase():Array.isArray(x)?x.map(stable):record(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
export const ownerSuppliedOrderLimits=Object.freeze({maxBytes:32768,maxAgeMs:86400000,maxFutureMs:30000,minRemainingSeconds:30,timeoutMs:5000,totalReadMs:15000,maxReads:128,maxDepth:16,maxJsonNodes:512});
const readAbi=v.parseAbi(["function ownerOf(uint256) view returns(address)","function getApproved(uint256) view returns(address)","function isApprovedForAll(address,address) view returns(bool)","function balanceOf(address,uint256) view returns(uint256)","function balanceOf(address) view returns(uint256)","function allowance(address,address) view returns(uint256)","function supportsInterface(bytes4) view returns(bool)","function royaltyInfo(uint256,uint256) view returns(address,uint256)"]);
const sourcePin=p=>record(p)&&v.isAddress(p.address,{strict:true})&&BigInt(p.address)>65535n&&hash(p.runtimeHash)&&p.runtimeHash!==v.zeroHash&&hash(p.sourceInputSha256)&&p.sourceInputSha256!==v.zeroHash&&p.sourceVerified===true&&p.proxy===false;
const fail=(reason,extra={})=>({schemaVersion:1,status:"UNAVAILABLE",reason,currentOrderIndependentlyVerified:false,publicListingVerified:false,executionApproved:false,executionEnabled:false,productionStatus:"NO_GO",...extra});

/** JSON grammar is first checked by JSON.parse, then walked only to reject
 * duplicate object keys (JSON.parse alone silently keeps the final value). */
function strictJson(text){
  const parsed=JSON.parse(text);let i=0,nodes=0;const ws=()=>{while(/\s/.test(text[i]??"")&&i<text.length)i++;};
  function str(){const start=i++;while(i<text.length){const c=text[i++];if(c==="\\")i++;else if(c==='"')return JSON.parse(text.slice(start,i));}throw Error("INVALID_JSON");}
  function walk(depth){need(depth<=ownerSuppliedOrderLimits.maxDepth&&++nodes<=ownerSuppliedOrderLimits.maxJsonNodes,"JSON_COMPLEXITY_LIMIT");ws();const c=text[i];
    if(c==="{"){i++;ws();const keys=new Set();if(text[i]==="}"){i++;return;}for(;;){const key=str();need(!keys.has(key),"DUPLICATE_JSON_KEY");keys.add(key);ws();need(text[i++]===":","INVALID_JSON");walk(depth+1);ws();if(text[i++]==="}")break;ws();}}
    else if(c==="["){i++;ws();if(text[i]==="]"){i++;return;}for(;;){walk(depth+1);ws();if(text[i++]==="]")break;ws();}}
    else if(c==='"')str();else{const token=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));need(token,"INVALID_JSON");i+=token[0].length;}
  }walk(0);ws();need(i===text.length,"INVALID_JSON");return parsed;
}
function validate(envelope,{profile="robinhood-4663-read-only-v1",nowMs=Date.now()}={}){
  const chainId=profiles[profile];need(chainId!==undefined,"UNSUPPORTED_PROFILE");need(Number.isSafeInteger(nowMs)&&nowMs>0,"INVALID_OBSERVATION_TIME");
  need(exact(envelope,["schemaVersion","kind","side","provenance","order"])&&envelope.schemaVersion===1&&envelope.kind==="OWNER_SUPPLIED"&&envelope.side==="LISTING","INVALID_OWNER_ORDER_SCHEMA");
  const p=envelope.provenance;need(exact(p,["obtainedAt","reference"])&&typeof p.obtainedAt==="string"&&typeof p.reference==="string"&&/^[A-Za-z0-9][A-Za-z0-9._ -]{0,95}$/.test(p.reference),"INVALID_OWNER_PROVENANCE");
  const obtained=Date.parse(p.obtainedAt);need(Number.isFinite(obtained)&&new Date(obtained).toISOString()===p.obtainedAt&&nowMs-obtained<=ownerSuppliedOrderLimits.maxAgeMs&&obtained-nowMs<=ownerSuppliedOrderLimits.maxFutureMs,"STALE_OR_INVALID_OWNER_PROVENANCE");
  canonicalSignature(envelope.order.signature);const normalized=legacy.normalizeSeaportOrder(envelope.order);need(normalized.chainId===chainId&&(chainId!==4663||same(normalized.seaport,canonicalSeaport)),"CHAIN_OR_SEAPORT_MISMATCH");
  need(normalized.components.conduitKey===v.zeroHash,"UNSUPPORTED_CONDUIT");const now=BigInt(Math.floor(nowMs/1000));need(normalized.components.startTime<=now&&normalized.components.endTime-now>=BigInt(ownerSuppliedOrderLimits.minRemainingSeconds),"ORDER_NOT_CURRENT_OR_NEAR_EXPIRY");
  const recipients=new Set();for(const p of normalized.components.consideration){const recipient=p.recipient.toLowerCase();need(!recipients.has(recipient),"DUPLICATE_CONSIDERATION_RECIPIENT");recipients.add(recipient);}
  return {chainId,normalized};
}
/** Never accepts URLs, calldata, source pins, policy overrides or credentials.
 * Owner provenance is an assertion, not proof that a public feed listed it. */
export function parseOwnerSuppliedOrder(rawUtf8,options={}){
  need(typeof rawUtf8==="string"||rawUtf8 instanceof Uint8Array,"OWNER_ORDER_REQUIRES_UTF8_BYTES");
  const bytes=typeof rawUtf8==="string"?Buffer.from(rawUtf8,"utf8"):Buffer.from(rawUtf8);need(bytes.length>0&&bytes.length<=ownerSuppliedOrderLimits.maxBytes,"OWNER_ORDER_BYTE_LIMIT");
  const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);need(Buffer.from(text,"utf8").equals(bytes),"INVALID_UTF8");const envelope=strictJson(text);validate(envelope,options);
  return {envelope,provenance:{kind:"OWNER_SUPPLIED",...envelope.provenance,rawSha256:sha(bytes),bytes:bytes.length,publicFeedAuthenticated:false}};
}
function canonicalSignature(signature){
  need(typeof signature==="string"&&/^0x[0-9a-f]+$/i.test(signature)&&[130,132].includes(signature.length),"UNSUPPORTED_EOA_SIGNATURE");
  const r=BigInt("0x"+signature.slice(2,66));let s=BigInt("0x"+signature.slice(66,130)),recovery;if(signature.length===130){recovery=Number(s>>255n)+27;s&=(1n<<255n)-1n;}else recovery=parseInt(signature.slice(130,132),16);
  need(r>0n&&r<0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n&&s>0n&&s<=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n&&[27,28].includes(recovery),"NONCANONICAL_EOA_SIGNATURE");
  return "0x"+r.toString(16).padStart(64,"0")+s.toString(16).padStart(64,"0")+recovery.toString(16).padStart(2,"0");
}

/** Trusted application options are separate from untrusted owner bytes. Reads
 * are corroborated at one canonical block; no transaction or calldata escapes.
 * The local profile is synthetic corroboration, never a live4663 feed claim. */
export async function verifyCurrentOwnerSuppliedOrder(envelope,{profile="robinhood-4663-read-only-v1",nowMs=Date.now(),verifierOptions,paymentProfile}={}){
 let reads=0;const started=Date.now();
 try{
  need(Buffer.byteLength(JSON.stringify(envelope),"utf8")<=ownerSuppliedOrderLimits.maxBytes,"OWNER_ORDER_BYTE_LIMIT");
  const {chainId,normalized:order}=validate(envelope,{profile,nowMs}),c=order.components,o=verifierOptions;
  need(record(o)&&record(o.rpc)&&record(o.witnessRpc)&&o.rpc!==o.witnessRpc&&record(o.pins)&&record(o.review),"INDEPENDENT_CURRENT_PROOF_UNAVAILABLE");
  const {rpc,witnessRpc,pins,review:r}=o,methods=["getChainId","getBlock","getCode","readContract","getBalance"];need(methods.every(k=>typeof rpc[k]==="function"&&typeof witnessRpc[k]==="function"),"INVALID_READ_ONLY_PROVIDER");
  async function corroborate(method,args){
    need(reads+2<=ownerSuppliedOrderLimits.maxReads,"RPC_READ_LIMIT");reads+=2;const remaining=Math.min(ownerSuppliedOrderLimits.timeoutMs,ownerSuppliedOrderLimits.totalReadMs-(Date.now()-started));need(remaining>0,"RPC_TIME_LIMIT");let timer;
    try{return await Promise.race([(async()=>{let a,b;if(method==="getBlock"&&args?.blockTag==="latest"){a=await rpc[method](args);b=await witnessRpc[method]({blockNumber:a.number});}else[a,b]=await Promise.all([rpc[method](args),witnessRpc[method](args)]);// viem getCode maps the JSON-RPC empty bytecode "0x" to undefined.
      // Normalize that documented outcome only; null/malformed/contract code
      // remains distinct, including disagreement with a nonempty witness.
      const view=x=>method==="getBlock"?{number:x.number,hash:x.hash,timestamp:x.timestamp}:method==="getCode"&&x===undefined?"0x":x;need(JSON.stringify(stable(view(a)))===JSON.stringify(stable(view(b))),"PROVIDER_DISAGREEMENT");return method==="getCode"?view(a):a;})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("RPC_TIMEOUT")),remaining);})]);}finally{clearTimeout(timer);}
  }
  need(await corroborate("getChainId")===chainId,"PROVIDER_CHAIN_MISMATCH");
  const block=await corroborate("getBlock",{blockTag:"latest"});need(typeof block.number==="bigint"&&block.number>0n&&hash(block.hash)&&typeof block.timestamp==="bigint","INVALID_CANONICAL_BLOCK");
  const age=BigInt(Math.floor(nowMs/1000))-block.timestamp;need(age>=-30n&&age<=300n,"STALE_BLOCK_EVIDENCE");need(c.startTime<=block.timestamp&&c.endTime-block.timestamp>=30n,"ORDER_NOT_ACTIVE_AT_BLOCK");
  const call=(address,abi,functionName,args=[])=>corroborate("readContract",{address,abi,functionName,args,blockNumber:block.number});
  const codeAt=address=>corroborate("getCode",{address,blockNumber:block.number});
  async function pinCode(pin){need(sourcePin(pin),"SOURCE_OR_PROXY_POLICY_UNADMITTED");const code=await codeAt(pin.address);need(typeof code==="string"&&/^0x(?:[0-9a-f]{2}){1,50000}$/i.test(code)&&same(v.keccak256(code),pin.runtimeHash),"SOURCE_RUNTIME_MISMATCH");return code;}
  need(sourcePin(pins.seaport)&&same(pins.seaport.address,order.seaport)&&sourcePin(pins.conduitController),"VENUE_SOURCE_UNVERIFIED");
  need(Array.isArray(pins.collections)&&pins.collections.length<=8&&Array.isArray(pins.currencies)&&pins.currencies.length<=8,"INVALID_PIN_LIMITS");
  need(record(r)&&v.isAddress(r.vault,{strict:true})&&BigInt(r.vault)>65535n&&uint(r.tokenId)&&uint(r.quantity)&&hash(r.expectedOrderHash)&&uint(r.maxTotalWei)&&uint(r.availableReserveWei),"INVALID_TRUSTED_REVIEW");
  const offer=c.offer[0],payments=c.consideration,currency=payments[0].token,native=same(currency,zero),total=payments.reduce((sum,p)=>sum+p.startAmount,0n),digest=legacy.seaportOrderDigest(envelope.order);
  need(same(r.collection,offer.token)&&BigInt(r.tokenId)===offer.identifierOrCriteria&&BigInt(r.quantity)===offer.startAmount&&same(r.currency,currency)&&same(r.expectedOrderHash,digest.orderHash),"REVIEW_IDENTITY_MISMATCH");
  need(total>0n&&total<2n**256n&&total<=BigInt(r.maxTotalWei)&&total<=BigInt(r.availableReserveWei),"REVIEW_BUDGET_EXCEEDED");
  need(Array.isArray(r.expectedConsideration)&&r.expectedConsideration.length===payments.length&&r.expectedConsideration.every(p=>exact(p,["role","recipient","amountWei"])&&uint(p.amountWei)),"INVALID_EXACT_CONSIDERATION");
  const collection=pins.collections.find(p=>same(p.address,offer.token));need(sourcePin(collection)&&collection.standard===(offer.itemType===2?721:1155),"COLLECTION_SOURCE_UNVERIFIED");
  for(let n=0;n<payments.length;n++){const p=payments[n],expected=r.expectedConsideration[n];need(same(p.recipient,expected.recipient)&&p.startAmount===BigInt(expected.amountWei)&&(n===0?expected.role==="seller":["marketplace","royalty"].includes(expected.role)),"CONSIDERATION_REVIEW_MISMATCH");
    need(![r.vault,order.seaport,pins.conduitController.address,offer.token,currency].some(a=>!same(a,zero)&&same(a,p.recipient)),"UNSAFE_CONSIDERATION_RECIPIENT");
    if(expected.role==="marketplace")need(Array.isArray(pins.marketplaceFeeRecipients)&&pins.marketplaceFeeRecipients.length<=8&&pins.marketplaceFeeRecipients.some(a=>same(a,p.recipient)),"UNKNOWN_FEE_RECIPIENT");
  }
  let paymentPin=null;if(!native){need(chainId===31337&&paymentProfile==="immutable-synthetic-local","PRODUCTION_ERC20_POLICY_UNADMITTED");paymentPin=pins.currencies.find(p=>same(p.address,currency));need(sourcePin(paymentPin),"SYNTHETIC_PAYMENT_SOURCE_UNVERIFIED");}
  await Promise.all([pinCode(pins.seaport),pinCode(pins.conduitController),pinCode(collection),...(paymentPin?[pinCode(paymentPin)]:[])]);
  const info=await call(order.seaport,legacy.seaportAbi,"information");need(Array.isArray(info)&&info.length===3&&info[0]==="1.6"&&same(info[1],digest.domainSeparator)&&same(info[2],pins.conduitController.address),"DOMAIN_OR_CONTROLLER_MISMATCH");
  const [counter,orderHash,status,sellerCode]=await Promise.all([call(order.seaport,legacy.seaportAbi,"getCounter",[c.offerer]),call(order.seaport,legacy.seaportAbi,"getOrderHash",[c]),call(order.seaport,legacy.seaportAbi,"getOrderStatus",[digest.orderHash]),codeAt(c.offerer)]);
  need(counter===c.counter&&same(orderHash,digest.orderHash),"STALE_COUNTER_OR_ORDER_HASH");
  need(Array.isArray(status)&&status.length===4&&typeof status[0]==="boolean"&&typeof status[1]==="boolean"&&typeof status[2]==="bigint"&&typeof status[3]==="bigint","MALFORMED_ORDER_STATUS");
  need(!status[1]&&status[2]===0n&&status[3]===0n,"ORDER_CANCELLED_FILLED_OR_PARTIAL");
  need(sellerCode==="0x","CONTRACT_OR_DELEGATED_SELLER_UNSUPPORTED");need(same(await v.recoverAddress({hash:digest.digest,signature:canonicalSignature(order.signature)}),c.offerer),"INVALID_SELLER_SIGNATURE");
  const interfaces=await Promise.all(["0x01ffc9a7","0xffffffff",collection.standard===721?"0x80ac58cd":"0xd9b67a26","0x2a55205a"].map(id=>call(collection.address,readAbi,"supportsInterface",[id])));
  need(interfaces[0]===true&&interfaces[1]===false&&interfaces[2]===true&&typeof interfaces[3]==="boolean","COLLECTION_INTERFACE_MISMATCH");
  const approved=await call(collection.address,readAbi,"isApprovedForAll",[c.offerer,order.seaport]);need(typeof approved==="boolean","MALFORMED_APPROVAL");let ownership;
  if(collection.standard===721){const[owner,single]=await Promise.all([call(collection.address,readAbi,"ownerOf",[offer.identifierOrCriteria]),call(collection.address,readAbi,"getApproved",[offer.identifierOrCriteria])]);need(same(owner,c.offerer)&&(approved||same(single,order.seaport)),"OWNERSHIP_OR_APPROVAL_MISMATCH");ownership={owner,balance:"1",singleApproval:single};}
  else{const balance=await call(collection.address,readAbi,"balanceOf",[c.offerer,offer.identifierOrCriteria]);need(typeof balance==="bigint"&&balance>=offer.startAmount&&approved,"BALANCE_OR_APPROVAL_MISMATCH");ownership={owner:c.offerer,balance:String(balance),singleApproval:null};}
  const royaltyItems=r.expectedConsideration.filter(p=>p.role==="royalty");need(royaltyItems.length<=1,"MULTIPLE_ROYALTIES_UNSUPPORTED");let royalty={status:"unsupported-no-royalty-item",protocolEnforced:false};
  if(interfaces[3]){const result=await call(collection.address,readAbi,"royaltyInfo",[offer.identifierOrCriteria,total]);need(Array.isArray(result)&&result.length===2&&v.isAddress(result[0])&&typeof result[1]==="bigint"&&result[1]>=0n&&result[1]<=total,"MALFORMED_ROYALTY");need(result[1]===0n?royaltyItems.length===0:royaltyItems.length===1&&same(royaltyItems[0].recipient,result[0])&&BigInt(royaltyItems[0].amountWei)===result[1],"ROYALTY_REVIEW_MISMATCH");royalty={status:"current-erc2981-policy",recipient:result[0],amountWei:String(result[1]),basisWei:String(total),protocolEnforced:false};}
  else need(royaltyItems.length===0,"ROYALTY_SOURCE_UNVERIFIED");
  const balance=native?await corroborate("getBalance",{address:r.vault,blockNumber:block.number}):await call(currency,readAbi,"balanceOf",[r.vault]);need(typeof balance==="bigint"&&balance>=total&&balance>=BigInt(r.availableReserveWei),"INSUFFICIENT_REVIEWED_RESERVE");
  const allowance=native?null:await call(currency,readAbi,"allowance",[r.vault,order.seaport]);need(allowance===null||allowance===0n,"NONZERO_PREEXISTING_PAYMENT_ALLOWANCE");
  const after=await corroborate("getBlock",{blockNumber:block.number});need(after.number===block.number&&same(after.hash,block.hash)&&after.timestamp===block.timestamp,"CANONICAL_BLOCK_CHANGED");
  const observed={chainId,blockNumber:String(block.number),blockHash:block.hash,timestamp:new Date(Number(block.timestamp)*1000).toISOString()};
  const payment={currency,totalWei:String(total),maxTotalWei:r.maxTotalWei,reviewedReserveLimitWei:r.availableReserveWei,observedBalanceWei:String(balance),consideration:structuredClone(r.expectedConsideration),allowanceWei:allowance===null?null:String(allowance),exactTemporaryApprovalRequired:!native,productionPaymentAdmitted:false};
  const approval={operator:order.seaport,conduitKey:v.zeroHash,isApprovedForAll:approved,...ownership};
  const nft={collection:offer.token,standard:collection.standard,tokenId:String(offer.identifierOrCriteria),quantity:String(offer.startAmount),currentOwner:c.offerer,expectedReceiver:r.vault,custodyEstablished:false};
  return {schemaVersion:1,status:"OWNER_SUPPLIED_CURRENT_ORDER_VERIFIED",currentOrderIndependentlyVerified:true,publicListingVerified:false,sourceKind:"OWNER_SUPPLIED",proofScope:chainId===4663?"TWO_PROVIDER_CURRENT_4663_ORDER_STATE_NOT_PUBLIC_FEED":"SYNTHETIC_LOCAL_CORROBORATION_ONLY",executionApproved:false,executionEnabled:false,productionStatus:"NO_GO",profile,order:structuredClone(envelope.order),orderHash:digest.orderHash,provenance:{kind:"OWNER_SUPPLIED",...envelope.provenance,publicFeedAuthenticated:false},observed,verified:{orderVerified:true,listingVerified:false,signatureKind:"eoa",digest:digest.digest,nft,payment,royalty,approval,observed,reads},limitations:["Owner-supplied provenance does not prove public feed availability.","Current read-only proof can change before any separately reviewed transaction.","No custody, contract security, L1 finality, keeper funding or execution authority is admitted."]};
 }catch(error){return fail(String(error?.message??"CURRENT_PROOF_UNAVAILABLE").slice(0,120),{profile,reads});}
}
export async function ingestOwnerSuppliedSignedOrder(rawUtf8,options={}){
 try{const parsed=parseOwnerSuppliedOrder(rawUtf8,options),result=await verifyCurrentOwnerSuppliedOrder(parsed.envelope,options);return {...result,provenance:parsed.provenance};}
 catch(error){return fail(String(error?.message??"OWNER_ORDER_UNAVAILABLE").slice(0,120));}
}
