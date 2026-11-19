import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {test} from "node:test";
import {createSeaportVerifier,normalizeSeaportOrder,seaportOrderDigest,seaportOrderTypes,verifySeaportOrder} from "./seaport-order-verifier.mjs";
const require=createRequire(new URL("../../apps/indexer/package.json",import.meta.url));
const viem=require("viem"),{generatePrivateKey,privateKeyToAccount}=require("viem/accounts");
const {getAddress,keccak256,stringToHex,zeroAddress,zeroHash}=viem;
const verifier=createSeaportVerifier(viem);
const addr=n=>getAddress("0x"+BigInt(n).toString(16).padStart(40,"0"));
const h=value=>keccak256(stringToHex(value));
const json=value=>JSON.stringify(value,(_,v)=>typeof v==="bigint"?v.toString():v);

/** Mocked read-only transport tests. Genuine Seaport execution is separate;
 * these focused cases never claim a deployed venue or a real public listing. */
async function setup({standard=721,currency=false,conduit=false,chainId=31337,contractSeller=false}={}){
  const seller=privateKeyToAccount(generatePrivateKey());
  const a={seaport:addr(0x10001),controller:addr(0x10002),collection:addr(0x10003),vault:addr(0x10004),currency:addr(0x10005),fee:addr(0x10006),royalty:addr(0x10007),conduit:addr(0x10008),controllerActor:addr(0x10009),project:addr(0x10010)};
  const code=new Map(Object.values(a).map((value,i)=>[value.toLowerCase(),"0x6000"+(i+1).toString(16).padStart(2,"0")]));
  code.set(seller.address.toLowerCase(),contractSeller?"0x600099":"0x");
  const pin=address=>({address,runtimeHash:keccak256(code.get(address.toLowerCase())),sourceInputSha256:h("mock source "+address),sourceVerified:true,proxy:false});
  const c=currency?a.currency:zeroAddress,key=conduit?h("mock conduit identifier"):zeroHash;
  const order={chainId,seaport:a.seaport,counter:"0",signature:"0x01",parameters:{offerer:seller.address,zone:zeroAddress,offer:[{itemType:standard===721?2:3,token:a.collection,identifierOrCriteria:"7",startAmount:standard===721?"1":"2",endAmount:standard===721?"1":"2"}],consideration:[{itemType:currency?1:0,token:c,identifierOrCriteria:"0",startAmount:"925",endAmount:"925",recipient:seller.address},{itemType:currency?1:0,token:c,identifierOrCriteria:"0",startAmount:"25",endAmount:"25",recipient:a.fee},{itemType:currency?1:0,token:c,identifierOrCriteria:"0",startAmount:"50",endAmount:"50",recipient:a.royalty}],orderType:0,startTime:"1699999900",endTime:"1700001000",zoneHash:zeroHash,salt:"82",conduitKey:key,totalOriginalConsiderationItems:"3"}};
  const dig=()=>verifier.seaportOrderDigest(order);
  async function sign(){const normalized=verifier.normalizeSeaportOrder(order);order.signature=await seller.signTypedData({domain:dig().domain,types:seaportOrderTypes,primaryType:"OrderComponents",message:normalized.components});}
  await sign();if(contractSeller)order.signature="0x1234";
  const state={chainId,headerReads:0,latest:123n,hash:h("mock canonical block"),timestamp:1700000000n,counter:0n,status:[false,false,0n,0n],owner:seller.address,approved:true,balance:2000n,royalty:[a.royalty,50n],enabled:true,policy:[c,1000n,10000n,5000n,1],ce:1n,pe:1n,available:2000n,accounted:2000n,spent:0n,periodSpent:0n,last:1699999990,controller:a.controllerActor,project:a.project,collectionEnabled:true,collectionAnyId:false,collectionId:true,allowance:1000n,simulationOk:true,erc1271:"0x1626ba7e",info:undefined,reorg:false,reads:[],failure:undefined};
  const rpc={
    async getChainId(){return state.chainId;},
    async getBlock(args){state.headerReads++;return{number:args.blockNumber??state.latest,hash:state.reorg&&args.blockNumber?h("mock orphan replacement"):state.hash,timestamp:state.timestamp};},
    async getCode(args){assert.equal(args.blockNumber,state.latest);state.reads.push({method:"getCode",...args});return code.get(args.address.toLowerCase())??"0x";},
    async getBalance(args){assert.equal(args.blockNumber,state.latest);state.reads.push({method:"getBalance",...args});return state.balance;},
    async call(args){assert.equal(args.blockNumber,state.latest);const decoded=viem.decodeFunctionData({abi:verifier.seaportAbi,data:args.data});assert.equal(decoded.functionName,"fulfillAdvancedOrder");assert.equal(decoded.args[0].numerator,1n);assert.equal(decoded.args[0].denominator,1n);assert.deepEqual(decoded.args[1],[]);assert.equal(decoded.args[2],zeroHash);assert.equal(decoded.args[3],a.vault);assert.equal(args.account,a.vault);assert.equal(args.to,a.seaport);assert.equal(args.value,currency?0n:1000n);if(!state.simulationOk)throw Error("Mocked fill reverts");return{data:"0x"+"0".repeat(63)+"1"};},
    async readContract({functionName,args,blockNumber,address}){
      assert.equal(blockNumber,state.latest);state.reads.push({functionName,args,address,blockNumber});if(state.failure===functionName)throw Error("Mock provider unavailable");
      if(functionName==="information")return state.info??["1.6",dig().domainSeparator,a.controller];
      if(functionName==="getCounter")return state.counter;if(functionName==="getOrderHash")return dig().orderHash;if(functionName==="getOrderStatus")return state.status;
      if(functionName==="getConduit")return[a.conduit,true];if(functionName==="getChannelStatus")return true;
      if(functionName==="supportsInterface")return args[0]!=="0xffffffff";if(functionName==="ownerOf")return state.owner;if(functionName==="getApproved")return state.approved?(conduit?a.conduit:a.seaport):zeroAddress;
      if(functionName==="isApprovedForAll")return state.approved;if(functionName==="balanceOf")return state.balance;
      if(functionName==="allowance")return state.allowance;
      if(functionName==="royaltyInfo")return state.royalty;if(functionName==="isValidSignature")return state.erc1271;
      if(functionName==="purchasesEnabled")return state.enabled;if(functionName==="policy")return state.policy;if(functionName==="controllerEpoch")return state.ce;if(functionName==="policyEpoch")return state.pe;
      if(functionName==="available")return state.available;if(functionName==="accountedHeld")return state.accounted;if(functionName==="totalSpent")return state.spent;if(functionName==="periodSpent")return state.periodSpent;
      if(functionName==="periodSeconds")return 86400;if(functionName==="lastPurchaseAt")return state.last;if(functionName==="controller")return state.controller;if(functionName==="projectToken")return state.project;
      if(functionName==="collections")return[keccak256(code.get(a.collection.toLowerCase())),standard===721?1:2,state.collectionEnabled,state.collectionAnyId];if(functionName==="allowedTokenId")return state.collectionId;
      throw Error("Unexpected read-only method "+functionName);
    },
  };
  const options={profile:chainId===4663?"robinhood-4663-read-only-v1":"seaport-local-31337-v1",rpc,codecs:viem,nowMs:1700000000000,
    pins:{seaport:pin(a.seaport),conduitController:pin(a.controller),collections:[{...pin(a.collection),standard}],currencies:currency?[pin(a.currency)]:[],allowedConduits:conduit?[{...pin(a.conduit),key}]:[],marketplaceFeeRecipients:[a.fee],custody:{...pin(a.vault),acceptsSeaportFulfillment:true,policyKind:"rmt-nft-acquisition-v1"},...(contractSeller&&{contractSigners:[{...pin(seller.address),kind:"erc1271"}]})},
    review:{vault:a.vault,collection:a.collection,tokenId:"7",quantity:standard===721?"1":"2",currency:c,expectedOrderHash:dig().orderHash,maxTotalWei:"1000",availableReserveWei:"2000",projectToken:a.project,expectedController:a.controllerActor,expectedControllerEpoch:"1",expectedPolicyEpoch:"1",expectedConsideration:[{role:"seller",recipient:seller.address,amountWei:"925"},{role:"marketplace",recipient:a.fee,amountWei:"25"},{role:"royalty",recipient:a.royalty,amountWei:"50"}]},provenance:{kind:chainId===4663?"historical-replay":"synthetic-local"}};
  if(chainId===4663)options.witnessRpc={...rpc};
  return{order,options,state,a,code,seller,sign,refreshHash(){options.review.expectedOrderHash=dig().orderHash;},run(){return verifier.verifySeaportOrder(order,options);}};
}
function blocked(result,code){assert.notEqual(result.status,"verified",json(result));assert.equal(result.code,code,json(result));assert.equal(result.executionEnabled,false);assert.equal(result.executionAvailable,false);assert.equal(result.listingVerified,false);assert.equal(result.routeSupported,false);}

test("mocked static native/ERC20 ERC721/ERC1155 orders reconstruct typed hashes and exact read-only policy",async()=>{
  for(const standard of[721,1155])for(const currency of[false,true]){
    const f=await setup({standard,currency,conduit:currency}),r=await f.run();assert.equal(r.status,"verified",json(r));assert.equal(r.orderVerified,true);assert.equal(r.listingVerified,true);assert.equal(r.currentListingStatus,"synthetic-open-observed");assert.equal(r.routeSupported,false);assert.equal(r.custodyCompatible,false,"A caller capability flag cannot make V1 support Seaport custody");assert.equal(r.executionEnabled,false);assert.equal(r.purchasesEnabled,false);assert.equal(r.nft.custodyEstablished,false);assert.equal(r.royalty.protocolEnforced,false);assert.equal(r.payment.totalWei,"1000");assert.equal(r.policyEvidence.status,"observed");assert.ok(r.reads<=128);assert.ok(f.state.reads.every(row=>row.blockNumber===123n));
    assert.equal(verifier.seaportOrderDigest(f.order).orderHash,seaportOrderDigest(f.order,viem).orderHash);assert.equal(normalizeSeaportOrder(f.order,viem).components.offerer,f.seller.address);
  }
});

test("unsupported schema, criteria, fractions, zones, tips, dynamic prices and order types are rejected",async()=>{
  for(const change of[
    f=>{f.order.parameters.offer[0].itemType=4;},f=>{f.order.parameters.orderType=1;},f=>{f.order.parameters.orderType=2;},f=>{f.order.parameters.zone=f.a.fee;},f=>{f.order.parameters.zoneHash=h("unknown zone");},
    f=>{f.order.parameters.offer[0].endAmount="2";},f=>{f.order.parameters.consideration[0].endAmount="926";},f=>{f.order.parameters.totalOriginalConsiderationItems="2";},f=>{f.order.numerator="1";f.order.denominator="2";},
    f=>{f.order.calldata="0x12345678";},f=>{f.order.parameters.offer[0].identifierOrCriteria="07";},f=>{f.order.parameters.startTime=1700000000;},f=>{f.order.parameters.offer[0].startAmount="21";f.order.parameters.offer[0].endAmount="21";},
  ]){const f=await setup();change(f);const r=await f.run();assert.equal(r.status,"rejected",json(r));assert.equal(r.executionEnabled,false);assert.equal(f.state.reads.length,0);}
});

test("filled, partial, cancelled, stale-counter, expired and future orders fail closed",async()=>{
  for(const[change,code]of[
    [f=>f.state.status=[false,true,0n,0n],"ORDER_CANCELLED"],[f=>f.state.status=[false,false,1n,1n],"ORDER_FILLED_OR_PARTIAL"],[f=>f.state.status=[true,false,1n,2n],"ORDER_FILLED_OR_PARTIAL"],
    [f=>f.state.counter=1n,"STALE_COUNTER_OR_ORDER_HASH"],[f=>f.order.parameters.endTime="1699999999","ORDER_NOT_ACTIVE_OR_NEAR_EXPIRY"],[f=>f.order.parameters.startTime="1700000010","ORDER_NOT_ACTIVE_OR_NEAR_EXPIRY"],
  ]){const f=await setup();change(f);blocked(await f.run(),code);}
});

test("genuine EOA signatures reject mutation, cross-chain replay, noncanonical and bulk signatures",async()=>{
  const f=await setup();f.order.signature="0x"+"00".repeat(65);blocked(await f.run(),"NONCANONICAL_EOA_SIGNATURE");
  const g=await setup();g.order.parameters.salt="83";g.refreshHash();blocked(await g.run(),"INVALID_SELLER_SIGNATURE");
  const h1=await setup();h1.order.chainId=4663;blocked(await h1.run(),"VENUE_SOURCE_OR_CHAIN_UNVERIFIED");
  const bulk=await setup();bulk.order.signature+="00";blocked(await bulk.run(),"UNSUPPORTED_EOA_OR_BULK_SIGNATURE");
  const compact=await setup(),s=compact.order.signature;compact.order.signature=s.slice(0,66)+(BigInt("0x"+s.slice(66,130))|(BigInt(parseInt(s.slice(130),16)-27)<<255n)).toString(16).padStart(64,"0");assert.equal((await compact.run()).signatureKind,"eoa");
});

test("source/runtime/proxy identity and unknown conduits are not inferred from addresses",async()=>{
  for(const[change,code]of[
    [f=>f.options.pins.seaport.sourceVerified=false,"VENUE_SOURCE_OR_CHAIN_UNVERIFIED"],
    [f=>f.options.pins.conduitController.sourceInputSha256=zeroHash,"VENUE_SOURCE_OR_CHAIN_UNVERIFIED"],
    [f=>f.options.pins.collections[0].proxy=true,"COLLECTION_SOURCE_OR_STANDARD_UNVERIFIED"],
    [f=>f.code.set(f.a.seaport.toLowerCase(),"0x6000ff"),"RUNTIME_IDENTITY_MISMATCH"],
    [f=>{f.order.parameters.conduitKey=h("unknown conduit");f.refreshHash();},"UNKNOWN_OR_UNVERIFIED_CONDUIT"],
    [f=>f.state.info=["1.6",h("cross-domain"),f.a.controller],"SEAPORT_DOMAIN_OR_CONTROLLER_MISMATCH"],
  ]){const f=await setup();change(f);blocked(await f.run(),code);}
  const erc20=await setup({currency:true});erc20.options.pins.currencies[0].proxy=true;blocked(await erc20.run(),"PAYMENT_SOURCE_UNVERIFIED");
});

test("seller transfer, lost approval, wrong consideration, fees and royalty changes are rejected",async()=>{
  for(const[change,code]of[
    [f=>f.state.owner=f.a.fee,"SELLER_OWNERSHIP_OR_APPROVAL_MISMATCH"],[f=>f.state.approved=false,"SELLER_OWNERSHIP_OR_APPROVAL_MISMATCH"],
    [f=>f.options.review.expectedConsideration[1].recipient=f.a.royalty,"CONSIDERATION_REVIEW_MISMATCH"],[f=>f.options.pins.marketplaceFeeRecipients=[],"UNKNOWN_MARKETPLACE_FEE_RECIPIENT"],
    [f=>f.state.royalty=[f.a.fee,50n],"ROYALTY_RECIPIENT_OR_AMOUNT_MISMATCH"],[f=>f.state.royalty=[f.a.royalty,51n],"ROYALTY_RECIPIENT_OR_AMOUNT_MISMATCH"],
    [f=>f.options.review.maxTotalWei="999","BUDGET_OR_RESERVE_EXCEEDED"],[f=>f.state.balance=999n,"INSUFFICIENT_OR_UNBOUND_RESERVE"],
    [f=>f.options.review.currency=f.a.currency,"NFT_OR_PAYMENT_REVIEW_MISMATCH"],
  ]){const f=await setup();change(f);blocked(await f.run(),code);}
});

test("controller epochs, project identity, disabled policy and custody limits are independent gates",async()=>{
  for(const[change,code]of[
    [f=>f.state.ce=2n,"STALE_CONTROLLER_OR_POLICY_EPOCH"],[f=>f.state.pe=2n,"STALE_CONTROLLER_OR_POLICY_EPOCH"],
    [f=>f.state.controller=f.a.royalty,"PROJECT_OR_CONTROLLER_REVIEW_MISMATCH"],[f=>f.state.project=f.a.fee,"PROJECT_OR_CONTROLLER_REVIEW_MISMATCH"],
    [f=>f.state.available=1000n,"RESERVE_ACCOUNTING_REVIEW_MISMATCH"],
  ]){const f=await setup();change(f);blocked(await f.run(),code);}
  for(const change of[f=>f.state.enabled=false,f=>f.state.policy[1]=999n,f=>f.state.policy[2]=999n,f=>f.state.policy[3]=999n,f=>f.state.last=1700000000,f=>f.state.collectionEnabled=false,f=>f.state.collectionId=false]){const f=await setup();change(f);const r=await f.run();assert.equal(r.orderVerified,true);assert.equal(r.routeSupported,false);assert.equal(r.policyEvidence.purchasePreconditionsMet,false);assert.equal(r.executionEnabled,false);}
  const existing=await setup();existing.options.pins.custody.acceptsSeaportFulfillment=false;const r=await existing.run();assert.equal(r.code,"ORDER_VERIFIED_CUSTODY_UNSUPPORTED");assert.equal(r.orderVerified,true);assert.equal(r.custodyCompatible,false);assert.equal(r.routeSupported,false);
  const unbound=await setup();delete unbound.options.pins.custody.policyKind;const u=await unbound.run();assert.equal(u.policyEvidence.status,"unverified");assert.equal(u.routeSupported,false);
  for(const allowance of[0n,2n**256n-1n]){const f=await setup({currency:true});f.state.allowance=allowance;const r=await f.run();assert.equal(r.orderVerified,true);assert.equal(r.payment.exactApprovalReady,false);assert.equal(r.routeSupported,false);}
  const reverting=await setup();reverting.state.simulationOk=false;const simulation=await reverting.run();assert.equal(simulation.orderVerified,true);assert.equal(simulation.fulfillmentSimulation.status,"unavailable-or-reverted");assert.equal(simulation.routeSupported,false);
});

test("pinned ERC1271 is a separate supported read path; unknown/delegated seller code is unavailable",async()=>{
  const f=await setup({contractSeller:true});assert.equal((await f.run()).signatureKind,"erc1271");f.state.erc1271="0xffffffff";blocked(await f.run(),"INVALID_CONTRACT_SIGNATURE");
  const g=await setup({contractSeller:true});delete g.options.pins.contractSigners;blocked(await g.run(),"UNSUPPORTED_CONTRACT_SIGNATURE");
  const h1=await setup({contractSeller:true});h1.code.set(h1.seller.address.toLowerCase(),"0xef0100"+h1.a.fee.slice(2));blocked(await h1.run(),"UNSUPPORTED_CONTRACT_SIGNATURE");
});

test("current 4663 order evidence needs independent observations and bound listing provenance",async()=>{
  const missing=await setup({chainId:4663});delete missing.options.witnessRpc;blocked(await missing.run(),"INDEPENDENT_PROVIDER_WITNESS_UNAVAILABLE");
  const f=await setup({chainId:4663});f.options.provenance={kind:"current-structured-order"};blocked(await f.run(),"STALE_OR_UNPROVEN_CURRENT_LISTING");
  const g=await setup({chainId:4663});g.options.provenance={kind:"current-structured-order",source:"opensea-public-api",chainId:4663,seaport:g.a.seaport,orderHash:g.options.review.expectedOrderHash,responseSha256:h("mock bounded API response"),observedAtMs:1700000000000};const r=await g.run();assert.equal(r.orderVerified,true);assert.equal(r.status,"unavailable");assert.equal(r.code,"CURRENT_LISTING_SOURCE_UNPROVEN");assert.equal(r.listingVerified,false);assert.equal(r.currentListingStatus,"source-unproven");assert.equal(r.executionEnabled,false);assert.equal(r.finality,"observed-l2-unverified-l1");
  const historical=await setup({chainId:4663}),old=await historical.run();assert.equal(old.orderVerified,true);assert.equal(old.listingVerified,false);assert.equal(old.routeSupported,false);assert.equal(old.currentListingStatus,"historical-only");
  const disagreement=await setup({chainId:4663});disagreement.options.witnessRpc={...disagreement.options.rpc,getChainId:async()=>31337};blocked(await disagreement.run(),"PROVIDER_DISAGREEMENT");
  const conflictingStatus=await setup({chainId:4663});conflictingStatus.options.witnessRpc={...conflictingStatus.options.rpc,readContract:args=>args.functionName==="getOrderStatus"?Promise.resolve([false,true,0n,0n]):conflictingStatus.options.rpc.readContract(args)};blocked(await conflictingStatus.run(),"PROVIDER_DISAGREEMENT");
});

test("provider failure, stale headers and reorg remain unavailable without fabricated acceptance",async()=>{
  const f=await setup();f.state.failure="royaltyInfo";blocked(await f.run(),"PROVIDER_OR_SIGNATURE_EVIDENCE_UNAVAILABLE");
  const g=await setup();g.options.nowMs+=301000;blocked(await g.run(),"STALE_BLOCK_EVIDENCE");
  const h1=await setup();h1.state.reorg=true;blocked(await h1.run(),"REORG_OR_PROVIDER_DISAGREEMENT");
  const timeout=await setup();timeout.options.timeoutMs=100;timeout.options.rpc={...timeout.options.rpc,getChainId:()=>new Promise(()=>{})};blocked(await timeout.run(),"RPC_TIMEOUT");
  const noCodec=await verifySeaportOrder({},{});assert.equal(noCodec.code,"VERIFICATION_CODECS_UNAVAILABLE");assert.equal(noCodec.executionEnabled,false);
});
