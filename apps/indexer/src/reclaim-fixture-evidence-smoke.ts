import assert from"node:assert/strict";
import type{Client}from"pg";
import{encodeAbiParameters,encodeEventTopics,encodeFunctionData,keccak256,parseAbi,type Address,type Hash,type PublicClient}from"viem";
import{buildReclaimEligibility,materializeReclaimRuntime,reclaimCampaignSignatures,reclaimFactorySignatures}from"../../../packages/launchpad-common/reclaim-runtime.mjs";
import{verifyReclaimFixtureBirth,readReclaimFixtureRange,readReclaimFixtureSnapshot}from"./reclaim-fixture-evidence.js";
import type{ReclaimFixtureModule,ReclaimFixtureBirth}from"./reclaim-fixture-types.js";
import type{FixtureTreasuryProofLog}from"./project-treasury-fixture-store.js";

const a=(n:number)=>`0x${((1n<<156n)+BigInt(n)).toString(16).padStart(40,"0")}`as Address;
const h=(n:number)=>`0x${n.toString(16).padStart(64,"0")}`as Hash;
const at=(n:number)=>({blockNumber:String(n),blockHash:h(n),timestamp:new Date((1_800_000_000+n)*1000).toISOString()});
const codecs={keccak256,encodeAbiParameters:(types:readonly{type:string}[],values:readonly unknown[])=>encodeAbiParameters(types as never,values as never)};

/** Canonical-shaped provider tests, explicitly not blockchain-execution proof. */
export async function testReclaimFixtureProofs(){
  const factoryAbi=parseAbi(reclaimFactorySignatures),abi=parseAbi(reclaimCampaignSignatures);
  const transfer=parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]),nft=parseAbi(["event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
    "event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)"]);
  const creator=a(978100),campaign=a(978101),claimant=a(978102),collection=a(978103),factory=a(978104),reward=a(978105),core=a(978106),origin=a(978107);
  const factoryCode="0x6000",rewardCode="0x6001",coreCode="0x6002",nftCode="0x6003",intent=h(978001);
  const m:ReclaimFixtureModule={schemaVersion:1,profile:"rmt-reclaim-v1",chainId:31337,reclaimFactory:factory,factoryRuntimeHash:keccak256(factoryCode),coreFactory:core,coreFactoryRuntimeHash:keccak256(coreCode),
    rewardToken:reward,rewardTokenRuntimeHash:keccak256(rewardCode),campaignCreationCode:"0x6000",campaignCreationCodeHash:keccak256("0x6000"),campaignRuntimeTemplate:`0x${"00".repeat(160)}`,
    campaignImmutableReferences:{"1":[{start:0,length:32}],"2":[{start:32,length:32}],"3":[{start:64,length:32}],"4":[{start:96,length:32}],"5":[{start:128,length:32}]},
    campaignImmutableNames:{"1":"creator","2":"rewardToken","3":"rewardRuntimeHash","4":"deploymentChainId","5":"deploymentFactory"},
    collections:[{address:collection,runtimeHash:keccak256(nftCode),standard:1,items:[{tokenId:"42",maxQuantity:"1"}]}],
    deployment:{transactionHash:h(20),blockNumber:"2",blockHash:h(2)},compilerInputSha256:"a".repeat(64)};
  const campaignCode=materializeReclaimRuntime(m.campaignRuntimeTemplate,m.campaignImmutableReferences,m.campaignImmutableNames,
    {creator,rewardToken:reward,rewardRuntimeHash:m.rewardTokenRuntimeHash,deploymentChainId:31337,deploymentFactory:factory});
  const leaf=buildReclaimEligibility({chainId:31337,campaign,collection,runtimeHash:keccak256(nftCode),standard:1,items:[{tokenId:"42",maxQuantity:"1"}]},codecs);
  const log=(address:Address,topics:readonly Hash[],data:`0x${string}`,height:number,index:number):FixtureTreasuryProofLog=>({address,topics,data,
    blockNumber:BigInt(height),blockHash:h(height),transactionHash:h(height*10),transactionIndex:0,logIndex:index,removed:false});
  const birthLog=log(factory,encodeEventTopics({abi:factoryAbi,eventName:"CampaignCreated",args:{creator,campaign,intent}})as Hash[],
    encodeAbiParameters([{type:"address"},{type:"uint128"},{type:"uint32"}],[creator,5n,4]),3,0);
  const funded=log(campaign,encodeEventTopics({abi,eventName:"Funded",args:{controller:creator}})as Hash[],encodeAbiParameters([{type:"uint256"}],[1000n]),4,1);
  const payout=(height:number,from:Address,to:Address,value:bigint,index:number)=>log(reward,encodeEventTopics({abi:transfer,eventName:"Transfer",args:{from,to}})as Hash[],encodeAbiParameters([{type:"uint256"}],[value]),height,index);
  const nftTransfer=(height:number,from:Address,to:Address,index:number)=>log(collection,encodeEventTopics({abi:nft,eventName:"Transfer",args:{from,to,tokenId:42n}})as Hash[],"0x",height,index);
  const accepted=log(campaign,encodeEventTopics({abi,eventName:"TradeInAccepted",args:{receiptId:1n,claimant,collection}})as Hash[],
    encodeAbiParameters([{type:"uint8"},{type:"uint256[]"},{type:"uint256[]"},{type:"uint256"},{type:"uint64"},{type:"uint64"}],[1,[42n],[1n],5n,3n,0n]),5,2);
  const returned=log(campaign,encodeEventTopics({abi,eventName:"TradeInReturned",args:{receiptId:1n,claimant}})as Hash[],encodeAbiParameters([{type:"uint256"}],[5n]),6,2);
  const logsByHeight=new Map([[3,[birthLog]],[4,[payout(4,creator,campaign,1000n,0),funded]],[5,[nftTransfer(5,claimant,campaign,0),payout(5,campaign,claimant,5n,1),accepted]],
    [6,[payout(6,claimant,campaign,5n,0),nftTransfer(6,campaign,claimant,1),returned]]]);
  const knobs={mode:"",births:true,phase:5,receiptReads:0,duplicate:false,standard:1 as 1|2};
  const actualLogs=(height:number)=>{
    let logs=logsByHeight.get(height)??[];
    if(knobs.standard===2)logs=logs.map(l=>{
      if(l.address===collection)return log(collection,encodeEventTopics({abi:nft,eventName:"TransferBatch",args:{operator:campaign,from:height===5?claimant:campaign,to:height===5?campaign:claimant}})as Hash[],
        encodeAbiParameters([{type:"uint256[]"},{type:"uint256[]"}],[[42n],[1n]]),height,l.logIndex!);
      if(height===5&&l.address===campaign)return{...accepted,data:encodeAbiParameters([{type:"uint8"},{type:"uint256[]"},{type:"uint256[]"},{type:"uint256"},{type:"uint64"},{type:"uint64"}],[2,[42n],[1n],5n,3n,0n])};return l;
    });return logs;
  };
  const rpc={
    getChainId:async()=>knobs.mode==="wrong-chain"?4663:31337,
    getCode:async({address}:{address:Address})=>[creator,claimant].includes(address)?undefined:address===factory?factoryCode:address===reward?rewardCode:address===core?coreCode:address===collection?nftCode:knobs.mode==="runtime"?"0x6004":campaignCode,
    getTransactionCount:async()=>0,
    getTransaction:async({hash}:{hash:Hash})=>{const height=Number(BigInt(hash)/10n),input=height===4?encodeFunctionData({abi,functionName:"fund",args:[1000n]}):height===6?encodeFunctionData({abi,functionName:"returnTradeIn",args:[1n,1_800_000_100n]}):encodeFunctionData({abi,functionName:"redeem",args:[collection,[42n],[1n],[1n],[[]],3n,5n,0n,1_800_000_100n]});
      return{chainId:31337,hash,blockNumber:BigInt(height),blockHash:h(height),transactionIndex:0,to:campaign,from:height===4?creator:claimant,value:0n,nonce:0,input};},
    getBlock:async({blockNumber}:{blockNumber:bigint})=>({number:blockNumber,hash:knobs.mode==="header"?h(999):h(Number(blockNumber)),timestamp:1_800_000_000n+blockNumber,
      transactions:knobs.mode==="multi-transaction"?[h(Number(blockNumber)*10),h(999)]:knobs.mode==="membership"?[h(999)]:[h(Number(blockNumber)*10)]}),
    getTransactionReceipt:async({hash}:{hash:Hash})=>{knobs.receiptReads++;if(knobs.mode==="missing-receipt")throw Error("provider receipt unavailable");const height=Number(BigInt(hash)/10n);
      let logs=actualLogs(height);if(knobs.mode==="missing-log")logs=logs.filter(l=>l.address!==campaign&&l.address!==factory);
      if(knobs.mode==="payout")logs=logs.map(l=>l.address===reward?{...l,data:encodeAbiParameters([{type:"uint256"}],[999n])}:l);
      if(knobs.mode==="recipient")logs=logs.map(l=>l.address===reward?payout(height,campaign,a(999),5n,l.logIndex!):l);
      if(knobs.mode==="nft-log")logs=logs.filter(l=>l.address!==collection);
      if(knobs.mode==="nft-value")logs=logs.map(l=>l.address===collection?{...l,data:encodeAbiParameters([{type:"uint256[]"},{type:"uint256[]"}],[[42n],[2n]])}:l);
      return{status:"success",transactionHash:hash,blockNumber:BigInt(height),blockHash:h(height),transactionIndex:0,logs,
        to:height===2?null:height===3?factory:campaign,from:height===4?creator:claimant,contractAddress:height===2?factory:null};},
    getLogs:async({address,fromBlock,toBlock}:{address:Address|Address[];fromBlock:bigint;toBlock:bigint})=>{
      const found=[...logsByHeight].filter(([height])=>BigInt(height)>=fromBlock&&BigInt(height)<=toBlock).flatMap(([height])=>actualLogs(height))
        .filter(l=>Array.isArray(address)?address.includes(l.address):l.address===address);
      return knobs.duplicate?[...found,...found]:found;
    },
    readContract:async({address,functionName,args=[],blockNumber}:{address:Address;functionName:string;args?:readonly unknown[];blockNumber:bigint})=>{
      if(functionName==="originCurveForToken")return origin;
      if(functionName==="token")return reward;if(functionName==="factory")return core;
      if(functionName==="totalSupply")return 1_000_000_000n*10n**18n;if(functionName==="decimals")return 18;
      if(functionName==="rewardToken")return reward;if(functionName==="rewardRuntimeHash")return m.rewardTokenRuntimeHash;
      if(functionName==="deploymentChainId")return 31337n;if(functionName==="campaignCreationCodeHash")return m.campaignCreationCodeHash;
      if(functionName==="campaignForIntent"||functionName==="predict")return campaign;
      if(functionName==="creator"||functionName==="controller")return creator;if(functionName==="deploymentFactory")return factory;
      if(functionName==="rewardPerUnit")return 5n;if(functionName==="walletCap")return 4;
      if(functionName==="policyEpoch")return 3n;if(functionName==="controllerEpoch")return 1n;
      if(functionName==="paused"||functionName==="closed")return false;
      if(functionName==="funded")return 1000n;if(functionName==="paid")return blockNumber>=5n?5n:0n;
      if(functionName==="repaid")return blockNumber>=6n?5n:0n;if(functionName==="recovered"||functionName==="unsolicited"||functionName==="outstandingLiability")return 0n;
      if(functionName==="reserve")return knobs.mode==="accounting"?999n:blockNumber===5n?995n:1000n;
      if(functionName==="tradeInNonce")return blockNumber>=5n?1n:0n;
      if(functionName==="collections")return[keccak256(nftCode),buildReclaimEligibility({chainId:31337,campaign,collection,runtimeHash:keccak256(nftCode),standard:knobs.standard,items:[{tokenId:"42",maxQuantity:"1"}]},codecs).root,4,4,knobs.standard,true];
      if(functionName==="tradeIns")return[claimant,collection,knobs.standard,3n,5n,1,blockNumber>=6n?2:1];
      if(functionName==="receiptItems")return[[42n],[1n]];if(functionName==="receiptCollectionHash")return keccak256(nftCode);
      if(functionName==="ownerOf")return knobs.mode==="custody"?a(999):blockNumber===5n?campaign:claimant;
      if(functionName==="balanceOf"&&address.toLowerCase()===reward){if(knobs.mode==="archive")throw Error("archive unavailable");const who=String(args[0]).toLowerCase();
        if(who===campaign)return blockNumber<4n?0n:blockNumber===5n?995n:1000n;
        if(who===creator)return blockNumber<4n?1000n:0n;if(who===claimant)return blockNumber===5n?5n:0n;}
      if(functionName==="balanceOf"&&address.toLowerCase()===collection){const who=String(args[0]).toLowerCase();
        if(who===campaign)return knobs.mode==="nft-balance"?0n:blockNumber===5n?1n:0n;if(who===claimant)return blockNumber===5n?0n:1n;}
      throw Error("Unexpected Reclaim provider read");
    },
  }as unknown as PublicClient;
  const birth=await verifyReclaimFixtureBirth(rpc,m,campaign,at(6),birthLog);assert.equal(birth.creator.toLowerCase(),creator.toLowerCase());assert.equal(birth.runtimeHash,keccak256(campaignCode));
  const db={query:async()=>({rows:[{payload:birth}]})}as unknown as Client;
  const scope:[number,string,string]=[31337,core.toLowerCase(),h(1)];
  const range=await readReclaimFixtureRange(db,scope,m,rpc,[at(5)]);assert.equal(range.events.length,1);assert.equal(range.events[0]?.settlement?.amount,"5");assert.equal(range.states[0]?.reserve,"995");
  const back=await readReclaimFixtureRange(db,scope,m,rpc,[at(6)]);assert.equal(back.events[0]?.settlement?.kind,"return");assert.equal(back.states[0]?.repaid,"5");
  knobs.standard=2;m.collections[0]!.standard=2;
  const multi=await readReclaimFixtureRange(db,scope,m,rpc,[at(5)]);assert.equal(multi.events[0]?.settlement?.standard,2);
  assert.equal((await readReclaimFixtureRange(db,scope,m,rpc,[at(6)])).events[0]?.settlement?.kind,"return");
  for(const mode of["nft-value","nft-balance"]){knobs.mode=mode;await assert.rejects(readReclaimFixtureRange(db,scope,m,rpc,[at(5)]),/evidence/);}
  knobs.mode="";knobs.standard=1;m.collections[0]!.standard=1;
  for(const mode of["wrong-chain","missing-receipt","header","membership","runtime","missing-log","payout","recipient","nft-log","custody","archive","multi-transaction","accounting"]){
    knobs.mode=mode;await assert.rejects(readReclaimFixtureRange(db,scope,m,rpc,[at(5)]),/evidence|unavailable/,"Invalid/missing evidence must not advance: "+mode);
  }
  knobs.mode="";knobs.duplicate=true;const replay=await readReclaimFixtureRange(db,scope,m,rpc,[at(5)]);assert.equal(replay.events.length,1);
  knobs.duplicate=false;knobs.mode="accounting";await assert.rejects(readReclaimFixtureSnapshot(rpc,m,birth,at(5)),/evidence/);knobs.mode="";
  const tree=buildReclaimEligibility({chainId:31337,campaign,collection,runtimeHash:keccak256(nftCode),standard:1,
    items:[{tokenId:"5",maxQuantity:"1"},{tokenId:"1",maxQuantity:"1"},{tokenId:"42",maxQuantity:"1"}]},codecs);
  assert.deepEqual(tree.items.map(i=>i.tokenId),["1","5","42"]);
  for(const item of tree.items){let digest=buildReclaimEligibility({chainId:31337,campaign,collection,runtimeHash:keccak256(nftCode),standard:1,items:[item]},codecs).root;
    for(const sibling of item.proof)digest=keccak256(`0x${BigInt(digest)<BigInt(sibling)?digest.slice(2)+sibling.slice(2):sibling.slice(2)+digest.slice(2)}`);assert.equal(digest,tree.root);}
  assert.notEqual(buildReclaimEligibility({chainId:4663,campaign,collection,runtimeHash:keccak256(nftCode),standard:1,items:[{tokenId:"42",maxQuantity:"1"}]},codecs).root,leaf.root);
  assert.throws(()=>buildReclaimEligibility({chainId:31337,campaign,collection,runtimeHash:keccak256(nftCode),standard:1,items:[{tokenId:"42",maxQuantity:"1"},{tokenId:"42",maxQuantity:"1"}]},codecs),/duplicate/);
  assert.throws(()=>materializeReclaimRuntime(m.campaignRuntimeTemplate,{...m.campaignImmutableReferences,"6":[{start:0,length:32}]},{...m.campaignImmutableNames,"6":"controller"},
    {creator,rewardToken:reward,rewardRuntimeHash:m.rewardTokenRuntimeHash,deploymentChainId:31337,deploymentFactory:factory}),/coverage/);
  console.info("Reclaim canonical receipt, NFT/reward settlement, archive/chain/reorg failures, duplicate and Merkle/runtime smoke passed.");
}
