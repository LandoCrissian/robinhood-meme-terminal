export const seaportVerificationProfiles=Object.freeze({"robinhood-4663-read-only-v1":4663,"seaport-local-31337-v1":31337});
export const seaportOrderTypes={
  OfferItem:[{name:"itemType",type:"uint8"},{name:"token",type:"address"},{name:"identifierOrCriteria",type:"uint256"},{name:"startAmount",type:"uint256"},{name:"endAmount",type:"uint256"}],
  ConsiderationItem:[{name:"itemType",type:"uint8"},{name:"token",type:"address"},{name:"identifierOrCriteria",type:"uint256"},{name:"startAmount",type:"uint256"},{name:"endAmount",type:"uint256"},{name:"recipient",type:"address"}],
  OrderComponents:[{name:"offerer",type:"address"},{name:"zone",type:"address"},{name:"offer",type:"OfferItem[]"},{name:"consideration",type:"ConsiderationItem[]"},{name:"orderType",type:"uint8"},{name:"startTime",type:"uint256"},{name:"endTime",type:"uint256"},{name:"zoneHash",type:"bytes32"},{name:"salt",type:"uint256"},{name:"conduitKey",type:"bytes32"},{name:"counter",type:"uint256"}],
};
const offerTuple="(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)";
const considerationTuple="(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)";
export const seaportOrderComponentsTuple=`(address offerer,address zone,${offerTuple}[] offer,${considerationTuple}[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 counter)`;
export const seaportOrderParametersTuple=seaportOrderComponentsTuple.replace("uint256 counter)","uint256 totalOriginalConsiderationItems)");
export const seaportAdvancedOrderTuple=`(${seaportOrderParametersTuple} parameters,uint120 numerator,uint120 denominator,bytes signature,bytes extraData)`;
export const seaportSignatures=[
  "function information() view returns(string version,bytes32 domainSeparator,address conduitController)",
  `function getOrderHash(${seaportOrderComponentsTuple} order) view returns(bytes32 orderHash)`,
  "function getCounter(address offerer) view returns(uint256 counter)",
  "function getOrderStatus(bytes32 orderHash) view returns(bool isValidated,bool isCancelled,uint256 totalFilled,uint256 totalSize)",
  `function fulfillAdvancedOrder(${seaportAdvancedOrderTuple} advancedOrder,(uint256 orderIndex,uint8 side,uint256 index,uint256 identifier,bytes32[] criteriaProof)[] criteriaResolvers,bytes32 fulfillerConduitKey,address recipient) payable returns(bool fulfilled)`,
];

/** Cryptographic/ABI primitives are injected by the application. This shared
 * module has no Node, network, wallet, filesystem or package-loading ability. */
export function createSeaportVerifier(codecs){
  if(!codecs||["decodeFunctionResult","encodeFunctionData","getAddress","hashDomain","hashStruct","hashTypedData","isAddress","keccak256","parseAbi","recoverAddress"].some(name=>typeof codecs[name]!=="function"))throw Error("Seaport verification codecs unavailable");
  const {decodeFunctionResult,encodeFunctionData,getAddress,hashDomain,hashStruct,hashTypedData,isAddress,keccak256,parseAbi,recoverAddress}=codecs;
  const zeroAddress="0x"+"00".repeat(20),zeroHash="0x"+"00".repeat(32);
  const seaportAbi=parseAbi(seaportSignatures);
const readAbi=parseAbi([
  "function getConduit(bytes32 conduitKey) view returns(address conduit,bool exists)",
  "function getChannelStatus(address conduit,address channel) view returns(bool isOpen)",
  "function ownerOf(uint256 tokenId) view returns(address owner)",
  "function getApproved(uint256 tokenId) view returns(address operator)",
  "function isApprovedForAll(address owner,address operator) view returns(bool approved)",
  "function balanceOf(address owner,uint256 tokenId) view returns(uint256 balance)",
  "function balanceOf(address owner) view returns(uint256 balance)",
  "function supportsInterface(bytes4 interfaceId) view returns(bool supported)",
  "function royaltyInfo(uint256 tokenId,uint256 salePrice) view returns(address receiver,uint256 amount)",
  "function isValidSignature(bytes32 digest,bytes signature) view returns(bytes4 magicValue)",
  "function allowance(address owner,address spender) view returns(uint256 amount)",
  "function purchasesEnabled() view returns(bool enabled)",
  "function policy() view returns(address currency,uint128 perNftCap,uint128 totalBudget,uint128 periodBudget,uint32 cooldownSeconds)",
  "function controllerEpoch() view returns(uint64 epoch)","function policyEpoch() view returns(uint64 epoch)",
  "function controller() view returns(address current)","function projectToken() view returns(address project)",
  "function collections(address collection) view returns(bytes32 runtimeHash,uint8 standard,bool enabled,bool anyTokenId)",
  "function allowedTokenId(address collection,uint256 tokenId) view returns(bool allowed)",
  "function available(address currency) view returns(uint256 amount)","function accountedHeld(address currency) view returns(uint256 amount)",
  "function totalSpent(address currency) view returns(uint256 amount)","function periodSpent(address currency,uint256 period) view returns(uint256 amount)",
  "function periodSeconds() view returns(uint32 seconds_)","function lastPurchaseAt() view returns(uint48 timestamp)",
]);
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const isHash=v=>typeof v==="string"&&/^0x[0-9a-f]{64}$/i.test(v);
const isBytes=v=>typeof v==="string"&&/^0x(?:[0-9a-f]{2})*$/i.test(v);
const isRecord=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
const uint=v=>typeof v==="string"&&/^(?:0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<2n**256n;
const address=v=>typeof v==="string"&&isAddress(v,{strict:true});
const nonzeroAddress=v=>address(v)&&!same(v,zeroAddress)&&BigInt(v)>0xffffn;
const exact=(value,names)=>isRecord(value)&&Object.keys(value).length===names.length&&names.every(key=>Object.hasOwn(value,key));
const canonical=value=>typeof value==="bigint"?value.toString():typeof value==="string"&&/^0x[0-9a-f]*$/i.test(value)?value.toLowerCase():Array.isArray(value)?value.map(canonical):isRecord(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
class Rejected extends Error {constructor(code,status="rejected"){super(code);this.code=code;this.status=status;}}
const need=(condition,code,status)=>{if(!condition)throw new Rejected(code,status);};

/** A strict, static-price FULL_OPEN subset. Extra data, tips, bulk orders,
 * criteria, partial fractions and API-supplied calldata are never interpreted. */
function normalizeSeaportOrder(input){
  need(exact(input,["chainId","seaport","parameters","counter","signature"]),"INVALID_ORDER_SCHEMA");
  need(Number.isSafeInteger(input.chainId)&&input.chainId>0&&nonzeroAddress(input.seaport)&&uint(input.counter),"INVALID_ORDER_IDENTITY");
  need(isBytes(input.signature)&&input.signature.length>=4&&input.signature.length<=8194,"UNSUPPORTED_SIGNATURE");
  const p=input.parameters;
  need(exact(p,["offerer","zone","offer","consideration","orderType","startTime","endTime","zoneHash","salt","conduitKey","totalOriginalConsiderationItems"]),"INVALID_PARAMETERS_SCHEMA");
  need(nonzeroAddress(p.offerer)&&address(p.zone)&&p.orderType===0&&same(p.zone,zeroAddress)&&p.zoneHash===zeroHash,"UNSUPPORTED_ORDER_TYPE_OR_ZONE");
  need(uint(p.startTime)&&uint(p.endTime)&&BigInt(p.startTime)<BigInt(p.endTime)&&uint(p.salt)&&isHash(p.conduitKey),"INVALID_ORDER_TIME_OR_SALT");
  need(Array.isArray(p.offer)&&p.offer.length===1&&Array.isArray(p.consideration)&&p.consideration.length>=1&&p.consideration.length<=8,"UNSUPPORTED_ITEM_COUNT");
  need(uint(p.totalOriginalConsiderationItems)&&BigInt(p.totalOriginalConsiderationItems)===BigInt(p.consideration.length),"UNSUPPORTED_EXTRA_CONSIDERATION");
  function item(raw,consideration=false){
    need(exact(raw,["itemType","token","identifierOrCriteria","startAmount","endAmount",...(consideration?["recipient"]:[])]),"INVALID_ITEM_SCHEMA");
    need(Number.isSafeInteger(raw.itemType)&&address(raw.token)&&uint(raw.identifierOrCriteria)&&uint(raw.startAmount)&&uint(raw.endAmount)&&raw.startAmount===raw.endAmount&&BigInt(raw.startAmount)>0n,"UNSUPPORTED_DYNAMIC_OR_MALFORMED_ITEM");
    if(consideration)need([0,1].includes(raw.itemType)&&raw.identifierOrCriteria==="0"&&nonzeroAddress(raw.recipient)&&(raw.itemType===0?same(raw.token,zeroAddress):nonzeroAddress(raw.token)),"UNSUPPORTED_CONSIDERATION_ITEM");
    else need([2,3].includes(raw.itemType)&&nonzeroAddress(raw.token)&&BigInt(raw.startAmount)<=20n&&(raw.itemType!==2||raw.startAmount==="1"),"UNSUPPORTED_NFT_OR_CRITERIA");
    return{itemType:raw.itemType,token:getAddress(raw.token),identifierOrCriteria:BigInt(raw.identifierOrCriteria),startAmount:BigInt(raw.startAmount),endAmount:BigInt(raw.endAmount),...(consideration&&{recipient:getAddress(raw.recipient)})};
  }
  const offer=p.offer.map(value=>item(value)),consideration=p.consideration.map(value=>item(value,true));
  need(consideration.every(value=>value.itemType===consideration[0].itemType&&same(value.token,consideration[0].token)),"MIXED_PAYMENT_ASSETS");
  need(same(consideration[0].recipient,p.offerer),"SELLER_CONSIDERATION_MUST_BE_FIRST");
  const components={offerer:getAddress(p.offerer),zone:zeroAddress,offer,consideration,orderType:0,startTime:BigInt(p.startTime),endTime:BigInt(p.endTime),zoneHash:zeroHash,salt:BigInt(p.salt),conduitKey:p.conduitKey,counter:BigInt(input.counter)};
  const{counter:_counter,...parameters}=components;
  return{chainId:input.chainId,seaport:getAddress(input.seaport),signature:input.signature,components,parameters:{...parameters,totalOriginalConsiderationItems:BigInt(p.totalOriginalConsiderationItems)}};
}

function seaportOrderDigest(input){
  const order=normalizeSeaportOrder(input),domain={name:"Seaport",version:"1.6",chainId:order.chainId,verifyingContract:order.seaport};
  const types={EIP712Domain:[{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}]};
  return{domain,domainSeparator:hashDomain({domain,types}),orderHash:hashStruct({data:order.components,primaryType:"OrderComponents",types:seaportOrderTypes}),digest:hashTypedData({domain,types:seaportOrderTypes,primaryType:"OrderComponents",message:order.components})};
}
const sourcePin=(pin)=>isRecord(pin)&&nonzeroAddress(pin.address)&&isHash(pin.runtimeHash)&&!same(pin.runtimeHash,zeroHash)&&isHash(pin.sourceInputSha256)&&!same(pin.sourceInputSha256,zeroHash)&&pin.sourceVerified===true&&pin.proxy===false;
const signature65=(signature)=>{
  need(isBytes(signature)&&[130,132].includes(signature.length),"UNSUPPORTED_EOA_OR_BULK_SIGNATURE");
  const r=BigInt("0x"+signature.slice(2,66));let s=BigInt("0x"+signature.slice(66,130));let v;
  if(signature.length===130){v=Number(s>>255n)+27;s&=(1n<<255n)-1n;}else v=Number.parseInt(signature.slice(130,132),16);
  need(r>0n&&r<0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n&&s>0n&&s<=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n&&[27,28].includes(v),"NONCANONICAL_EOA_SIGNATURE");
  return "0x"+r.toString(16).padStart(64,"0")+s.toString(16).padStart(64,"0")+v.toString(16).padStart(2,"0");
};

/** Read operations only. Pins and reviewed terms are trusted application input,
 * never copied from marketplace/API request JSON. Verification never returns
 * executable calldata, requests a signature, approves assets or authorizes execution. */
async function verifySeaportOrder(input,options){
  const base={schemaVersion:1,profile:options?.profile??null,status:"unavailable",code:"EVIDENCE_UNAVAILABLE",chainId:null,orderVerified:false,listingVerified:false,routeSupported:false,custodyCompatible:false,purchasesEnabled:false,executionAvailable:false,executionEnabled:false,currentListingStatus:"not-assessed",finality:"unverified",limitations:["Read-only order acceptance never authorizes execution.","An open observation can change before a separately approved fulfillment.","Seaport does not enforce the RMT royalty admission policy."]};
  let reads=0;const started=Date.now();
  try{
    const chain=seaportVerificationProfiles[options?.profile];need(chain!==undefined,"UNSUPPORTED_VERIFIER_PROFILE");base.chainId=chain;base.finality=chain===31337?"synthetic-local":"observed-l2-unverified-l1";
    need(isRecord(options)&&isRecord(options.rpc)&&isRecord(options.pins)&&isRecord(options.review)&&isRecord(options.provenance),"INVALID_VERIFIER_CONFIGURATION");
    const inputSize=new TextEncoder().encode(JSON.stringify(input)).byteLength;need(inputSize<=32768,"ORDER_RESPONSE_LIMIT");
    const order=normalizeSeaportOrder(input),c=order.components,r=options.review,pins=options.pins,primary=options.rpc,witness=options.witnessRpc;
    need(chain!==4663||isRecord(witness)&&witness!==primary,"INDEPENDENT_PROVIDER_WITNESS_UNAVAILABLE","unavailable");
    const methods=["getChainId","getBlock","getCode","readContract","getBalance"];need(methods.every(name=>typeof primary[name]==="function")&&(!witness||methods.every(name=>typeof witness[name]==="function")),"INVALID_READ_ONLY_PROVIDER","unavailable");
    if(typeof primary.call==="function"&&(!witness||typeof witness.call==="function"))methods.push("call");
    const rpc=witness?Object.fromEntries(methods.map(name=>[name,async args=>{
      let first,second;if(name==="getBlock"&&args?.blockTag==="latest"){first=await primary[name](args);second=await witness[name]({blockNumber:first.number});}else [first,second]=await Promise.all([primary[name](args),witness[name](args)]);
      const view=value=>name==="getBlock"?{number:value.number,hash:value.hash,timestamp:value.timestamp}:value;
      need(JSON.stringify(canonical(view(first)))===JSON.stringify(canonical(view(second))),"PROVIDER_DISAGREEMENT","unavailable");return first;
    }])):primary;
    need(order.chainId===chain&&sourcePin(pins.seaport)&&same(pins.seaport.address,order.seaport)&&sourcePin(pins.conduitController),"VENUE_SOURCE_OR_CHAIN_UNVERIFIED","unavailable");
    need(Array.isArray(pins.collections)&&pins.collections.length<=8&&Array.isArray(pins.currencies)&&pins.currencies.length<=8&&Array.isArray(pins.allowedConduits)&&pins.allowedConduits.length<=8,"INVALID_PIN_LIMITS");
    need(nonzeroAddress(r.vault)&&nonzeroAddress(r.collection)&&uint(r.tokenId)&&uint(r.quantity)&&address(r.currency)&&uint(r.maxTotalWei)&&uint(r.availableReserveWei)&&isHash(r.expectedOrderHash),"INVALID_REVIEW_BINDING");
    need(Array.isArray(r.expectedConsideration)&&r.expectedConsideration.length===c.consideration.length&&r.expectedConsideration.every(value=>exact(value,["role","recipient","amountWei"])&&["seller","marketplace","royalty"].includes(value.role)&&nonzeroAddress(value.recipient)&&uint(value.amountWei)),"INVALID_REVIEW_CONSIDERATION");
    need(r.expectedConsideration[0].role==="seller"&&r.expectedConsideration.slice(1).every(value=>value.role!=="seller"),"INVALID_SELLER_ALLOCATION");
    const amount=c.consideration.reduce((sum,value)=>sum+value.startAmount,0n);need(amount<2n**256n&&amount>0n&&amount<=BigInt(r.maxTotalWei)&&amount<=BigInt(r.availableReserveWei),"BUDGET_OR_RESERVE_EXCEEDED");
    need(same(c.offer[0].token,r.collection)&&c.offer[0].identifierOrCriteria===BigInt(r.tokenId)&&c.offer[0].startAmount===BigInt(r.quantity)&&same(c.consideration[0].token,r.currency),"NFT_OR_PAYMENT_REVIEW_MISMATCH");
    const collection=pins.collections.find(value=>same(value.address,r.collection));need(sourcePin(collection)&&collection.standard===(c.offer[0].itemType===2?721:1155),"COLLECTION_SOURCE_OR_STANDARD_UNVERIFIED","unavailable");
    for(let i=0;i<c.consideration.length;i++){
      const item=c.consideration[i],expected=r.expectedConsideration[i];need(same(item.recipient,expected.recipient)&&item.startAmount===BigInt(expected.amountWei),"CONSIDERATION_REVIEW_MISMATCH");
      need(![r.vault,order.seaport,pins.conduitController.address,collection.address].some(a=>same(item.recipient,a)),"UNSAFE_CONSIDERATION_RECIPIENT");
      if(expected.role==="marketplace")need(Array.isArray(pins.marketplaceFeeRecipients)&&pins.marketplaceFeeRecipients.length<=8&&pins.marketplaceFeeRecipients.some(a=>same(a,item.recipient)),"UNKNOWN_MARKETPLACE_FEE_RECIPIENT");
    }
    const currency=same(r.currency,zeroAddress)?null:pins.currencies.find(value=>same(value.address,r.currency));need(!currency? same(r.currency,zeroAddress):sourcePin(currency),"PAYMENT_SOURCE_UNVERIFIED","unavailable");
    const timeout=options.timeoutMs??3000;need(Number.isSafeInteger(timeout)&&timeout>=100&&timeout<=5000,"INVALID_READ_TIMEOUT");
    async function read(action){reads+=witness?2:1;const remaining=Math.min(timeout,15000-(Date.now()-started));need(reads<=128&&remaining>0,"RPC_BUDGET_EXCEEDED","unavailable");let timer;try{return await Promise.race([action(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Rejected("RPC_TIMEOUT","unavailable")),remaining);})]);}finally{clearTimeout(timer);}}
    need(await read(()=>rpc.getChainId())===chain,"PROVIDER_CHAIN_MISMATCH");
    const block=await read(()=>rpc.getBlock({blockTag:"latest"}));need(typeof block.number==="bigint"&&block.number>0n&&isHash(block.hash)&&typeof block.timestamp==="bigint","INVALID_BLOCK_EVIDENCE","unavailable");
    const nowMs=options.nowMs??Date.now();need(Number.isSafeInteger(nowMs),"INVALID_OBSERVATION_TIME");const age=BigInt(Math.floor(nowMs/1000))-block.timestamp;need(age>=-30n&&age<=300n,"STALE_BLOCK_EVIDENCE","unavailable");
    need(c.startTime<=block.timestamp&&c.endTime>block.timestamp&&c.endTime-block.timestamp>=30n,"ORDER_NOT_ACTIVE_OR_NEAR_EXPIRY");
    const call=(a,abi,fn,args=[])=>read(()=>rpc.readContract({address:a,abi,functionName:fn,args,blockNumber:block.number}));
    async function codePin(pin){need(sourcePin(pin),"SOURCE_INPUT_UNVERIFIED","unavailable");const code=await read(()=>rpc.getCode({address:pin.address,blockNumber:block.number}));need(isBytes(code)&&code.length>4&&code.length<=100002&&same(keccak256(code),pin.runtimeHash),"RUNTIME_IDENTITY_MISMATCH","unavailable");return code;}
    await Promise.all([pins.seaport,pins.conduitController,collection,...(currency?[currency]:[])].map(codePin));
    const digest=seaportOrderDigest(input);need(same(digest.orderHash,r.expectedOrderHash),"ORDER_HASH_REVIEW_MISMATCH");
    const info=await call(order.seaport,seaportAbi,"information");need(Array.isArray(info)&&info.length===3&&info[0]==="1.6"&&same(info[1],digest.domainSeparator)&&same(info[2],pins.conduitController.address),"SEAPORT_DOMAIN_OR_CONTROLLER_MISMATCH");
    const [counter,onchainHash,status]=await Promise.all([call(order.seaport,seaportAbi,"getCounter",[c.offerer]),call(order.seaport,seaportAbi,"getOrderHash",[c]),call(order.seaport,seaportAbi,"getOrderStatus",[digest.orderHash])]);
    need(counter===c.counter&&same(onchainHash,digest.orderHash),"STALE_COUNTER_OR_ORDER_HASH");
    need(Array.isArray(status)&&status.length===4&&typeof status[0]==="boolean"&&typeof status[1]==="boolean"&&typeof status[2]==="bigint"&&typeof status[3]==="bigint","MALFORMED_ORDER_STATUS","unavailable");
    need(!status[1],"ORDER_CANCELLED");need(status[2]===0n&&status[3]===0n,"ORDER_FILLED_OR_PARTIAL");
    let operator=order.seaport,conduit=null;
    if(c.conduitKey!==zeroHash){
      conduit=pins.allowedConduits.find(value=>same(value.key,c.conduitKey));need(sourcePin(conduit),"UNKNOWN_OR_UNVERIFIED_CONDUIT","unavailable");await codePin(conduit);
      const [binding,open]=await Promise.all([call(pins.conduitController.address,readAbi,"getConduit",[c.conduitKey]),call(pins.conduitController.address,readAbi,"getChannelStatus",[conduit.address,order.seaport])]);
      need(Array.isArray(binding)&&binding.length===2&&binding[1]===true&&same(binding[0],conduit.address)&&open===true,"CONDUIT_BINDING_OR_CHANNEL_MISMATCH");operator=conduit.address;
    }
    const sellerCode=await read(()=>rpc.getCode({address:c.offerer,blockNumber:block.number}));need(isBytes(sellerCode??"0x"),"SELLER_CODE_UNAVAILABLE","unavailable");let signerKind;
    if(!sellerCode||sellerCode==="0x"){
      need(same(await recoverAddress({hash:digest.digest,signature:signature65(order.signature)}),c.offerer),"INVALID_SELLER_SIGNATURE");signerKind="eoa";
    }else{
      const pin=Array.isArray(pins.contractSigners)&&pins.contractSigners.length<=8&&pins.contractSigners.find(value=>same(value.address,c.offerer));need(sourcePin(pin)&&pin.kind==="erc1271"&&!/^0xef0100/i.test(sellerCode)&&same(keccak256(sellerCode),pin.runtimeHash),"UNSUPPORTED_CONTRACT_SIGNATURE","unavailable");
      need(await call(c.offerer,readAbi,"isValidSignature",[digest.digest,order.signature])==="0x1626ba7e","INVALID_CONTRACT_SIGNATURE");signerKind="erc1271";
    }
    const interfaces=await Promise.all(["0x01ffc9a7","0xffffffff",collection.standard===721?"0x80ac58cd":"0xd9b67a26","0x2a55205a"].map(id=>call(collection.address,readAbi,"supportsInterface",[id])));
    need(interfaces[0]===true&&interfaces[1]===false&&interfaces[2]===true&&typeof interfaces[3]==="boolean","INVALID_COLLECTION_INTERFACES");
    const approved=await call(collection.address,readAbi,"isApprovedForAll",[c.offerer,operator]);need(typeof approved==="boolean","MALFORMED_OPERATOR_APPROVAL","unavailable");
    if(collection.standard===721){const [owner,single]=await Promise.all([call(collection.address,readAbi,"ownerOf",[BigInt(r.tokenId)]),call(collection.address,readAbi,"getApproved",[BigInt(r.tokenId)])]);need(same(owner,c.offerer)&&(approved||same(single,operator)),"SELLER_OWNERSHIP_OR_APPROVAL_MISMATCH");}
    else need(approved&&await call(collection.address,readAbi,"balanceOf",[c.offerer,BigInt(r.tokenId)])>=BigInt(r.quantity),"SELLER_BALANCE_OR_APPROVAL_MISMATCH");
    const royaltyItems=r.expectedConsideration.filter(value=>value.role==="royalty");need(royaltyItems.length<=1,"UNSUPPORTED_MULTIPLE_ROYALTY_RECIPIENTS");let royalty={status:"not-supported-no-royalty-item",basis:"all-in-consideration",basisWei:amount.toString(),protocolEnforced:false};
    if(interfaces[3]){const observed=await call(collection.address,readAbi,"royaltyInfo",[BigInt(r.tokenId),amount]);need(Array.isArray(observed)&&observed.length===2&&address(observed[0])&&typeof observed[1]==="bigint"&&observed[1]>=0n&&observed[1]<=amount,"INVALID_ROYALTY_EVIDENCE");need(observed[1]===0n?royaltyItems.length===0:royaltyItems.length===1&&same(royaltyItems[0].recipient,observed[0])&&BigInt(royaltyItems[0].amountWei)===observed[1],"ROYALTY_RECIPIENT_OR_AMOUNT_MISMATCH");royalty={...royalty,status:"current-erc2981-admission-policy",recipient:observed[0],amountWei:observed[1].toString()};}else need(royaltyItems.length===0,"ROYALTY_SOURCE_UNVERIFIED","unavailable");
    const actualBalance=currency?await call(currency.address,readAbi,"balanceOf",[r.vault]):await read(()=>rpc.getBalance({address:r.vault,blockNumber:block.number}));need(typeof actualBalance==="bigint"&&actualBalance>=amount&&actualBalance>=BigInt(r.availableReserveWei),"INSUFFICIENT_OR_UNBOUND_RESERVE");
    const paymentAllowance=currency?await call(currency.address,readAbi,"allowance",[r.vault,order.seaport]):null;need(paymentAllowance===null||typeof paymentAllowance==="bigint"&&paymentAllowance>=0n,"INVALID_PAYMENT_ALLOWANCE","unavailable");const paymentApprovalReady=paymentAllowance===null||paymentAllowance===amount;
    let custodyCompatible=false,policyReady=false,policyEvidence={status:"unverified",reason:"No source-bound custody budget reader is configured"};
    if(sourcePin(pins.custody)&&same(pins.custody.address,r.vault)){
      await codePin(pins.custody);
      // Source correspondence, an interface or caller metadata cannot grant
      // asset-bearing Seaport custody. No admitted custody implementation yet
      // records Seaport settlement and enforces budgets around its external call.
      // V1 only admits its immutable synthetic venue; a 721 transfer may land
      // without updating nftHeld. No future policy kind is admitted implicitly.
      custodyCompatible=false;
      if(pins.custody.policyKind==="rmt-nft-acquisition-v1"){
        need(uint(r.expectedControllerEpoch)&&uint(r.expectedPolicyEpoch)&&nonzeroAddress(r.expectedController)&&nonzeroAddress(r.projectToken),"MISSING_CONTROLLER_POLICY_BINDING");
        const [enabled,policy,ce,pe,available,accounted,spent,periodSeconds,last,controller,projectToken]=await Promise.all([
          call(r.vault,readAbi,"purchasesEnabled"),call(r.vault,readAbi,"policy"),call(r.vault,readAbi,"controllerEpoch"),call(r.vault,readAbi,"policyEpoch"),
          call(r.vault,readAbi,"available",[r.currency]),call(r.vault,readAbi,"accountedHeld",[r.currency]),call(r.vault,readAbi,"totalSpent",[r.currency]),call(r.vault,readAbi,"periodSeconds"),call(r.vault,readAbi,"lastPurchaseAt"),call(r.vault,readAbi,"controller"),call(r.vault,readAbi,"projectToken")]);
        need(typeof enabled==="boolean"&&Array.isArray(policy)&&policy.length===5&&typeof ce==="bigint"&&typeof pe==="bigint"&&[available,accounted,spent].every(v=>typeof v==="bigint"&&v>=0n)&&Number(periodSeconds)===86400&&Number.isSafeInteger(Number(last)),"MALFORMED_CUSTODY_POLICY","unavailable");
        need(same(controller,r.expectedController)&&same(projectToken,r.projectToken),"PROJECT_OR_CONTROLLER_REVIEW_MISMATCH");need(ce===BigInt(r.expectedControllerEpoch)&&pe===BigInt(r.expectedPolicyEpoch),"STALE_CONTROLLER_OR_POLICY_EPOCH");
        const period=block.timestamp/86400n,periodSpent=await call(r.vault,readAbi,"periodSpent",[r.currency,period]);
        need(typeof periodSpent==="bigint"&&periodSpent>=0n&&typeof policy[1]==="bigint"&&typeof policy[2]==="bigint"&&typeof policy[3]==="bigint"&&Number.isSafeInteger(Number(policy[4])),"MALFORMED_CUSTODY_BUDGET","unavailable");
        const [admitted,idAllowed]=await Promise.all([call(r.vault,readAbi,"collections",[r.collection]),call(r.vault,readAbi,"allowedTokenId",[r.collection,BigInt(r.tokenId)])]);
        need(Array.isArray(admitted)&&admitted.length===4&&isHash(admitted[0])&&[1,2].includes(Number(admitted[1]))&&typeof admitted[2]==="boolean"&&typeof admitted[3]==="boolean"&&typeof idAllowed==="boolean","MALFORMED_COLLECTION_POLICY","unavailable");
        const collectionAllowed=same(admitted[0],collection.runtimeHash)&&Number(admitted[1])===(collection.standard===721?1:2)&&admitted[2]&&(admitted[3]||idAllowed);
        need(available===BigInt(r.availableReserveWei)&&available<=accounted&&accounted<=actualBalance,"RESERVE_ACCOUNTING_REVIEW_MISMATCH");
        policyReady=collectionAllowed&&enabled&&same(policy[0],r.currency)&&amount<=policy[1]*BigInt(r.quantity)&&spent+amount<=policy[2]&&periodSpent+amount<=policy[3]&&Number(policy[4])>=1&&block.timestamp>=BigInt(last)+BigInt(policy[4]);
        policyEvidence={status:"observed",enabled,controller,projectToken,controllerEpoch:ce.toString(),policyEpoch:pe.toString(),collection:{runtimeHash:admitted[0],standard:Number(admitted[1]),enabled:admitted[2],anyTokenId:admitted[3],tokenIdAllowed:idAllowed,preconditionsMet:collectionAllowed},availableWei:available.toString(),accountedWei:accounted.toString(),totalSpentWei:spent.toString(),periodSpentWei:periodSpent.toString(),period:period.toString(),perNftCapWei:policy[1].toString(),totalBudgetWei:policy[2].toString(),periodBudgetWei:policy[3].toString(),cooldownSeconds:String(policy[4]),lastPurchaseAt:String(last),purchasePreconditionsMet:policyReady};
      }
    }
    let fulfillmentSimulation={status:"unavailable",method:"fulfillAdvancedOrder",account:r.vault,recipient:r.vault,fulfillerConduitKey:zeroHash,authorizationProven:false,custodyAccountingProven:false};
    if(typeof rpc.call==="function")try{
      // The complete call is independently constructed from accepted fields.
      // No caller/API supplied calldata, tips, fractions, criteria or extraData.
      const data=encodeFunctionData({abi:seaportAbi,functionName:"fulfillAdvancedOrder",args:[{parameters:order.parameters,numerator:1n,denominator:1n,signature:order.signature,extraData:"0x"},[],zeroHash,r.vault]});
      const simulated=await read(()=>rpc.call({account:r.vault,to:order.seaport,data,value:currency?0n:amount,gas:3_000_000n,blockNumber:block.number}));
      need(simulated&&simulated.data==="0x"+"0".repeat(63)+"1"&&decodeFunctionResult({abi:seaportAbi,functionName:"fulfillAdvancedOrder",data:simulated.data})===true,"FULFILLMENT_SIMULATION_REJECTED","unavailable");
      fulfillmentSimulation={...fulfillmentSimulation,status:"succeeded"};
    }catch(error){if(error instanceof Rejected&&["PROVIDER_DISAGREEMENT","RPC_BUDGET_EXCEEDED"].includes(error.code))throw error;fulfillmentSimulation={...fulfillmentSimulation,status:"unavailable-or-reverted"};}
    const current=await read(()=>rpc.getBlock({blockNumber:block.number}));need(current.number===block.number&&same(current.hash,block.hash),"REORG_OR_PROVIDER_DISAGREEMENT","unavailable");
    need(["current-structured-order","historical-replay","synthetic-local"].includes(options.provenance.kind)&&!(chain===4663&&options.provenance.kind==="synthetic-local")&&!(chain===31337&&options.provenance.kind!=="synthetic-local"),"INVALID_LISTING_PROVENANCE");
    if(options.provenance.kind==="current-structured-order")need(options.provenance.source==="opensea-public-api"&&options.provenance.chainId===chain&&same(options.provenance.seaport,order.seaport)&&same(options.provenance.orderHash,digest.orderHash)&&isHash(options.provenance.responseSha256)&&Number.isSafeInteger(options.provenance.observedAtMs)&&Math.abs(nowMs-options.provenance.observedAtMs)<=300000,"STALE_OR_UNPROVEN_CURRENT_LISTING","unavailable");
    const historical=options.provenance.kind==="historical-replay",synthetic=chain===31337;
    const sourceUnproven=options.provenance.kind==="current-structured-order";
    // There is no authenticated bounded listing transport in this module.
    // A declared API label, timestamp and response hash cannot prove that a
    // current OpenSea listing was actually fetched. A future transport requires
    // separately reviewed admission, not an options flag.
    const listingVerified=synthetic&&!historical,routeSupported=false;
    return{...base,status:sourceUnproven?"unavailable":"verified",code:sourceUnproven?"CURRENT_LISTING_SOURCE_UNPROVEN":historical?"HISTORICAL_ORDER_ONLY":"ORDER_VERIFIED_CUSTODY_UNSUPPORTED",orderVerified:true,listingVerified,routeSupported,custodyCompatible,policyEvidence,fulfillmentSimulation,currentListingStatus:historical?"historical-only":synthetic?"synthetic-open-observed":"source-unproven",orderHash:digest.orderHash,digest:digest.digest,signatureKind:signerKind,operator,conduit:conduit?.address??null,nft:{collection:r.collection,standard:collection.standard,tokenId:r.tokenId,quantity:r.quantity,currentOwner:c.offerer,expectedReceiver:r.vault,custodyEstablished:false},payment:{currency:r.currency,totalWei:amount.toString(),maxTotalWei:r.maxTotalWei,reviewedReserveLimitWei:r.availableReserveWei,observedBalanceWei:actualBalance.toString(),operator:order.seaport,fulfillerConduitKey:zeroHash,observedAllowanceWei:paymentAllowance===null?null:paymentAllowance.toString(),exactApprovalReady:paymentApprovalReady,consideration:r.expectedConsideration.map(value=>({...value}))},royalty,observed:{blockNumber:block.number.toString(),blockHash:block.hash,timestamp:new Date(Number(block.timestamp)*1000).toISOString()},reads,sourceInputs:{seaport:pins.seaport.sourceInputSha256,controller:pins.conduitController.sourceInputSha256,collection:collection.sourceInputSha256,...(currency&&{currency:currency.sourceInputSha256})}};
  }catch(error){return{...base,status:error instanceof Rejected?error.status:"unavailable",code:error instanceof Rejected?error.code:"PROVIDER_OR_SIGNATURE_EVIDENCE_UNAVAILABLE",reads};}
}

  return{normalizeSeaportOrder,seaportOrderDigest,verifySeaportOrder,seaportAbi};
}

export const normalizeSeaportOrder=(input,codecs)=>createSeaportVerifier(codecs).normalizeSeaportOrder(input);
export const seaportOrderDigest=(input,codecs)=>createSeaportVerifier(codecs).seaportOrderDigest(input);
export async function verifySeaportOrder(input,options){
  try{return await createSeaportVerifier(options?.codecs).verifySeaportOrder(input,options);}
  catch{return{schemaVersion:1,profile:options?.profile??null,status:"unavailable",code:"VERIFICATION_CODECS_UNAVAILABLE",chainId:null,orderVerified:false,listingVerified:false,routeSupported:false,custodyCompatible:false,purchasesEnabled:false,executionAvailable:false,executionEnabled:false,currentListingStatus:"not-assessed",finality:"unverified",limitations:["Read-only verification codecs are unavailable."]};}
}
