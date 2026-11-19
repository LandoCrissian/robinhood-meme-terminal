const zeroAddress="0x0000000000000000000000000000000000000000";
const interfaces=[{type:"function",name:"supportsInterface",stateMutability:"view",inputs:[{name:"interfaceId",type:"bytes4"}],outputs:[{name:"",type:"bool"}]}];
const hash=value=>typeof value==="string"&&/^0x[0-9a-f]{64}$/i.test(value)&&BigInt(value)>0n;
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const address=value=>typeof value==="string"&&/^0x[0-9a-f]{40}$/i.test(value)&&!same(value,zeroAddress);
const limit=(promise,ms)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("bounded-read-timeout")),ms);Promise.resolve(promise).then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});
const text=value=>typeof value==="string"&&value.length>0&&value.length<=120&&!/[\u0000-\u001f\u007f]/.test(value)?value:null;

/** Parse identity only. This module never fetches a user URL or supplies order calldata. */
export function parseNftCollectionInput(input){
  if(typeof input!=="string"||input.length<1||input.length>256||input!==input.trim()||/[\\\s\u0000-\u001f\u007f]/.test(input))throw Error("Enter an exact collection contract or OpenSea collection URL");
  if(/^0x[0-9a-f]{40}$/i.test(input)){if(!address(input))throw Error("Invalid collection address");return{kind:"contract",address:input};}
  let url;try{url=new URL(input);}catch{throw Error("Unsupported collection identity");}
  if(url.protocol!=="https:"||!["opensea.io","www.opensea.io"].includes(url.hostname)||url.port||url.username||url.password||url.search||url.hash||input.includes("%"))throw Error("Only an exact HTTPS OpenSea collection URL is accepted");
  const match=/^\/collection\/([a-z0-9][a-z0-9_-]{0,127})\/?$/.exec(url.pathname);
  if(!match)throw Error("Use a collection URL, not a wallet, profile, token or listing URL");
  return{kind:"opensea-collection",slug:match[1],canonicalUrl:`https://opensea.io/collection/${match[1]}`};
}

/** Trusted adapters are supplied by the application, never by request JSON.
 * OpenSea metadata is only a bounded hint. RPC and separately verified source
 * evidence must agree. No listing/route/spending approval follows from identity. */
export async function resolveNftCollection(input,options){
  const base={schemaVersion:1,profile:"rmt-nft-collection-identity-v1",chainId:options?.chainId??null,collectionVerified:false,listingVerified:false,routeSupported:false,executionAvailable:false,purchasesEnabled:false,contracts:[]};
  const fail=(status,code)=>({...base,status,code});
  let parsed;try{parsed=parseNftCollectionInput(input);}catch{return fail("rejected","INVALID_COLLECTION_INPUT");}
  if(![31337,4663].includes(options?.chainId))return fail("rejected","UNSUPPORTED_CHAIN");
  const {rpc,verifiedSource,trustedCollectionHint,codecs}=options;
  if(!rpc||typeof verifiedSource!=="function"||typeof codecs?.getAddress!=="function"||typeof codecs?.isAddress!=="function"||typeof codecs?.keccak256!=="function")return fail("unavailable","SOURCE_OR_PROVIDER_UNAVAILABLE");
  const {getAddress,isAddress,keccak256}=codecs;
  if(parsed.kind==="contract"){if(!isAddress(parsed.address,{strict:true}))return fail("rejected","INVALID_COLLECTION_CONTRACT");parsed.address=getAddress(parsed.address);}
  if(!Array.isArray(options.allowedCurrencies)||!options.allowedCurrencies.some(currency=>same(currency,options.paymentAsset)))return fail("rejected","UNSUPPORTED_PAYMENT_ASSET");
  if(!isAddress(options.paymentAsset,{strict:true})||options.allowedCurrencies.length>8||!options.allowedCurrencies.every(currency=>isAddress(currency,{strict:true})))return fail("rejected","UNSUPPORTED_PAYMENT_ASSET");
  const timeout=options.timeoutMs??3000;if(!Number.isSafeInteger(timeout)||timeout<100||timeout>5000)return fail("rejected","INVALID_READ_LIMIT");
  let hint=null,contract=parsed.kind==="contract"?parsed.address:null;
  if(parsed.kind==="opensea-collection"){
    if(typeof trustedCollectionHint!=="function")return fail("unavailable","COLLECTION_METADATA_UNAVAILABLE");
    try{hint=await limit(trustedCollectionHint(parsed.slug),timeout);}catch{return fail("unavailable","COLLECTION_METADATA_UNAVAILABLE");}
    if(!hint||hint.slug!==parsed.slug||!Array.isArray(hint.contracts)||hint.contracts.length!==1)return fail("rejected","AMBIGUOUS_OR_UNBOUND_COLLECTION");
    const candidate=hint.contracts[0];if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))return fail("rejected","INVALID_COLLECTION_CONTRACT");
    const chain=candidate.chainId??({robinhood:4663})[candidate.chain];
    if(chain!==options.chainId)return fail("rejected","COLLECTION_CHAIN_MISMATCH");
    if(!address(candidate.address)||!isAddress(candidate.address,{strict:true}))return fail("rejected","INVALID_COLLECTION_CONTRACT");contract=getAddress(candidate.address);
  }
  try{
    if(await limit(rpc.getChainId(),timeout)!==options.chainId)return fail("rejected","PROVIDER_CHAIN_MISMATCH");
    const block=await limit(rpc.getBlock({blockTag:"latest"}),timeout),now=options.nowMs??Date.now();
    if(typeof block.number!=="bigint"||block.number<0n||!hash(block.hash)||typeof block.timestamp!=="bigint"||!Number.isSafeInteger(now))return fail("unavailable","INVALID_BLOCK_EVIDENCE");
    const age=BigInt(Math.floor(now/1000))-block.timestamp;if(age< -30n||age>300n)return fail("unavailable","STALE_BLOCK_EVIDENCE");
    const code=await limit(rpc.getCode({address:contract,blockNumber:block.number}),timeout);
    if(typeof code!=="string"||!/^0x(?:[a-f0-9]{2}){2,50000}$/i.test(code)||/^0xef0100/i.test(code))return fail("rejected","NOT_A_COLLECTION_CONTRACT");
    const runtimeHash=keccak256(code),support=await limit(Promise.all(["0x01ffc9a7","0xffffffff","0x80ac58cd","0xd9b67a26"].map(interfaceId=>rpc.readContract({address:contract,abi:interfaces,functionName:"supportsInterface",args:[interfaceId],blockNumber:block.number}))),timeout);
    if(support.some(result=>typeof result!=="boolean")||support[0]!==true||support[1]!==false||support[2]===support[3])return fail("rejected","UNSUPPORTED_NFT_STANDARD");
    const standard=support[2]?721:1155;
    if(hint?.contracts[0].standard!==undefined&&hint.contracts[0].standard!==standard)return fail("rejected","METADATA_STANDARD_MISMATCH");
    const source=await limit(verifiedSource({chainId:options.chainId,address:contract,runtimeHash,blockNumber:block.number,blockHash:block.hash}),timeout);
    if(!source||source.verified!==true||source.chainId!==options.chainId||!same(source.address,contract)||!same(source.runtimeHash,runtimeHash)||!hash(source.sourceInputSha256)||source.standard!==standard||source.proxy!==false)return fail("unavailable","VERIFIED_SOURCE_IDENTITY_UNAVAILABLE");
    const current=await limit(rpc.getBlock({blockNumber:block.number}),timeout);if(current.number!==block.number||!same(current.hash,block.hash))return fail("unavailable","REORG_OR_PROVIDER_DISAGREEMENT");
    return{...base,status:"verified",code:"COLLECTION_VERIFIED_LISTING_AND_ROUTE_UNVERIFIED",collectionVerified:true,
      ...(parsed.kind==="opensea-collection"&&{slug:parsed.slug,canonicalUrl:parsed.canonicalUrl}),...(text(hint?.name)&&{name:text(hint.name)}),
      contracts:[{address:contract,standard,runtimeHash,sourceInputSha256:source.sourceInputSha256,evidenceBlock:block.number.toString(),evidenceBlockHash:block.hash,evidenceTimestamp:new Date(Number(block.timestamp)*1000).toISOString()}],
      limitations:["Collection identity is not a verified listing or purchase route.","Observed L2 evidence does not establish independent L1 finality.","Production acquisition and all purchasing remain disabled."]};
  }catch{return fail("unavailable","COLLECTION_EVIDENCE_UNAVAILABLE");}
}
