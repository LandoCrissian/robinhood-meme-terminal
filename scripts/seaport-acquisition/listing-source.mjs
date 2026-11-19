import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {createSeaportVerifier} from "../../packages/launchpad-common/seaport-order-verifier.mjs";

const require=createRequire(new URL("../../apps/indexer/package.json",import.meta.url));
const verifier=createSeaportVerifier(require("viem"));
const address=/^0x[0-9a-f]{40}$/i,hash=/^0x[0-9a-f]{64}$/i,uint=/^(0|[1-9][0-9]{0,77})$/;
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
export const listingSourceLimits=Object.freeze({maxBytes:524288,maxAgeMs:120000,timeoutMs:8000,maxListings:1});
const seaport="0x0000000000000068F116a894984e2DB1123eB395";
const need=(condition,reason)=>{if(!condition)throw Error(reason);};
const unavailable=(reason,source={})=>({schemaVersion:1,status:"UNAVAILABLE",reason,currentOrderIndependentlyVerified:false,executionApproved:false,executionEnabled:false,source});

/** A collection identity only selects a documented public GET endpoint. It is
 * never an executor, signature, target address or calldata. No credentials,
 * cookies, redirects, pagination or alternate backend are accepted. */
export async function fetchCurrentSeaportListing({sourceId="opensea-public-api",collection,tokenId,now=Date.now(),fetchImpl=fetch,verifierOptions}={}){
  let source={id:sourceId,observedAt:new Date(now).toISOString()};
  try{
    need(sourceId==="opensea-public-api","SOURCE_NOT_ADMITTED");
    need(collection?.verified===true&&collection.chainId===4663&&address.test(collection.address)&&/^[a-z0-9][a-z0-9-]{0,95}$/.test(collection.slug),"COLLECTION_IDENTITY_UNVERIFIED");
    need(uint.test(String(tokenId))&&Number.isSafeInteger(now)&&now>0,"INVALID_QUERY");
    const url=`https://api.opensea.io/api/v2/listings/collection/${collection.slug}/nfts/${tokenId}/best`;
    source={...source,url};
    const response=await fetchImpl(url,{method:"GET",redirect:"error",credentials:"omit",headers:{accept:"application/json"},signal:AbortSignal.timeout(listingSourceLimits.timeoutMs)});
    source.httpStatus=response.status;
    if(!response.ok){await response.body?.cancel();return unavailable(`SOURCE_HTTP_${response.status}`,source);}
    const date=Date.parse(response.headers.get("date")??"");
    need(Number.isFinite(date)&&Math.abs(now-date)<=listingSourceLimits.maxAgeMs,"SOURCE_TIMESTAMP_STALE_OR_MISSING");
    need(/^application\/json(?:;|$)/i.test(response.headers.get("content-type")??""),"SOURCE_CONTENT_TYPE");
    const declared=response.headers.get("content-length");
    need(declared===null||/^\d+$/.test(declared)&&Number(declared)<=listingSourceLimits.maxBytes,"SOURCE_BODY_LIMIT");
    need(response.body,"SOURCE_BODY_MISSING");
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;need(size<=listingSourceLimits.maxBytes,"SOURCE_BODY_LIMIT");chunks.push(part.value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const raw=Buffer.concat(chunks);source={...source,bytes:size,rawSha256:"0x"+createHash("sha256").update(raw).digest("hex"),responseDate:new Date(date).toISOString()};
    const row=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));
    need(row&&typeof row==="object"&&!Array.isArray(row)&&row.chain==="robinhood"&&row.status==="ACTIVE"&&hash.test(row.order_hash)&&same(row.protocol_address,seaport),"SOURCE_ORDER_IDENTITY");
    need(same(row.asset?.contract,collection.address)&&String(row.asset?.identifier)===String(tokenId),"SOURCE_ASSET_MISMATCH");
    const p=row.protocol_data?.parameters,signature=row.protocol_data?.signature;
    need(p&&typeof signature==="string"&&/^0x(?:[0-9a-f]{2}){1,4096}$/i.test(signature)&&uint.test(String(p.counter)),"SOURCE_UNSIGNED_OR_MISSING_COUNTER");
    need(Number.isSafeInteger(row.order_created_at)&&row.order_created_at>0&&row.order_created_at*1000<=now+30000,"SOURCE_CREATED_AT_INVALID");
    need(p.orderType===0&&Array.isArray(p.offer)&&p.offer.length===1&&Array.isArray(p.consideration)&&p.consideration.length>=1&&p.consideration.length<=10,"SOURCE_ORDER_SHAPE");
    const nft=p.offer[0];need([2,3].includes(nft.itemType)&&same(nft.token,collection.address)&&String(nft.identifierOrCriteria)===String(tokenId)&&uint.test(String(nft.startAmount))&&BigInt(nft.startAmount)>0n&&String(nft.startAmount)===String(nft.endAmount)&&String(row.remaining_quantity)===String(nft.startAmount),"SOURCE_QUANTITY_MISMATCH");
    need(uint.test(String(p.startTime))&&uint.test(String(p.endTime))&&BigInt(p.startTime)<=BigInt(Math.floor(now/1000))&&BigInt(p.endTime)>BigInt(Math.floor(now/1000)),"SOURCE_ORDER_EXPIRED_OR_NOT_STARTED");
    let total=0n;const currency=p.consideration[0].token;
    for(const item of p.consideration){need([0,1].includes(item.itemType)&&same(item.token,currency)&&uint.test(String(item.startAmount))&&String(item.startAmount)===String(item.endAmount),"SOURCE_DYNAMIC_OR_MIXED_PAYMENT");total+=BigInt(item.startAmount);}
    need(uint.test(String(row.price?.current?.value))&&BigInt(row.price.current.value)===total,"SOURCE_MANIPULATED_TOTAL");
    need(verifierOptions?.review&&same(verifierOptions.review.currency,currency),"SOURCE_WRONG_CURRENCY");
    const display=same(currency,"0x"+"00".repeat(20))?{symbol:"ETH",decimals:18}:verifierOptions.paymentDisplay;
    need(display&&row.price.current.currency===display.symbol&&row.price.current.decimals===display.decimals,"SOURCE_WRONG_DISPLAY_CURRENCY");
    const {counter,...parameters}=p;
    const order={chainId:4663,seaport,counter:String(counter),parameters,signature};
    const digest=verifier.seaportOrderDigest(order);need(same(digest.orderHash,row.order_hash),"SOURCE_ORDER_HASH_MISMATCH");
    const provenance={kind:"current-structured-order",source:sourceId,chainId:4663,seaport,orderHash:digest.orderHash,responseSha256:source.rawSha256,observedAtMs:now};
    const verified=await verifier.verifySeaportOrder(order,{...verifierOptions,profile:"robinhood-4663-read-only-v1",nowMs:now,provenance});
    // Task082 deliberately refuses a caller-declared API provenance. Only this
    // actual bounded GET may close that transport gap; every independent chain,
    // signature, status, NFT, source, currency and consideration check must pass.
    need(verified.orderVerified===true&&verified.code==="CURRENT_LISTING_SOURCE_UNPROVEN"&&same(verified.orderHash,digest.orderHash),"CURRENT_ORDER_CRYPTOGRAPHY_OR_POLICY_UNAVAILABLE");
    return{schemaVersion:1,status:"CURRENT_ORDER_INDEPENDENTLY_VERIFIED",currentOrderIndependentlyVerified:true,executionApproved:false,executionEnabled:false,source,order,verified:{...verified,listingVerified:true,currentListingStatus:"bounded-current-source-observed"}};
  }catch(error){return unavailable(String(error?.message??"SOURCE_UNAVAILABLE").slice(0,120),source);}
}

export function deriveAcquisitionStates({collectionVerified=false,listing,executionCompatible=false,vaultFunded=false,purchasesEnabled=false}={}){
  const currentOrderIndependentlyVerified=listing?.status==="CURRENT_ORDER_INDEPENDENTLY_VERIFIED"&&listing.currentOrderIndependentlyVerified===true;
  return{collectionVerified:collectionVerified===true,currentOrderIndependentlyVerified,executionCompatible:executionCompatible===true,vaultFunded:vaultFunded===true,purchasesEnabled:purchasesEnabled===true,unavailable:!collectionVerified||!currentOrderIndependentlyVerified||!executionCompatible||!vaultFunded,executionEnabled:false,productionStatus:"NO_GO"};
}
