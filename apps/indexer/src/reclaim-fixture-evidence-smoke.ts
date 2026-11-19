import assert from "node:assert/strict";
import type {Client} from "pg";
import {ContractFunctionRevertedError,encodeAbiParameters,encodeEventTopics,encodeFunctionData,keccak256,parseAbi,zeroAddress,type Address,type Hash,type PublicClient} from "viem";
import {buildReclaimEligibility,materializeReclaimRuntime,reclaimCampaignSignatures,reclaimFactorySignatures} from "../../../packages/launchpad-common/reclaim-v2-runtime.mjs";
import {verifyReclaimFixtureBirth,readReclaimFixtureRange,readReclaimFixtureSnapshot} from "./reclaim-fixture-evidence.js";
import type {ReclaimFixtureModule} from "./reclaim-fixture-types.js";
import type {FixtureTreasuryProofLog} from "./project-treasury-fixture-store.js";

const a=(n:number)=>`0x${((1n<<156n)+BigInt(n)).toString(16).padStart(40,"0")}` as Address;
const h=(n:number)=>`0x${n.toString(16).padStart(64,"0")}` as Hash;
const at=(n:number)=>({blockNumber:String(n),blockHash:h(n),timestamp:new Date((1_800_000_000+n)*1000).toISOString()});
const codecs={keccak256,encodeAbiParameters:(types:readonly{type:string}[],values:readonly unknown[])=>encodeAbiParameters(types as never,values as never)};

/** Provider doubles exercise proof rejection. Real native burn, irreversible
 * sink and Safe execution use separate synthetic-chain acceptance receipts. */
export async function testReclaimFixtureProofs(){
  const factoryAbi=parseAbi(reclaimFactorySignatures),abi=parseAbi(reclaimCampaignSignatures);
  const erc20=parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
  const nft=parseAbi(["function ownerOf(uint256) view returns(address)","event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
    "event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)","event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)"]);
  const creator=a(979100),campaign=a(979101),claimant=a(979102),collection=a(979103),factory=a(979104),reward=a(979105),core=a(979106),origin=a(979107),deployer=a(979108),sink=a(979109),part1=a(979110),part2=a(979111);
  const factoryCode="0x6000",rewardCode="0x6001",coreCode="0x6002",nftCode="0x6003",deployerCode="0x6004",sinkCode="0x6005",intent=h(979001),policyHash=h(979002);
  const m:ReclaimFixtureModule={schemaVersion:2,profile:"rmt-reclaim-v2-permanent",chainId:31337,reclaimFactory:factory,factoryRuntimeHash:keccak256(factoryCode),coreFactory:core,coreFactoryRuntimeHash:keccak256(coreCode),
    rewardToken:reward,rewardTokenRuntimeHash:keccak256(rewardCode),campaignCreationCode:"0x6000",campaignCreationCodeHash:keccak256("0x6000"),campaignRuntimeTemplate:`0x${"00".repeat(224)}`,
    campaignImmutableReferences:Object.fromEntries(Array.from({length:7},(_,i)=>[String(i+1),[{start:i*32,length:32}]])),
    campaignImmutableNames:{"1":"creator","2":"rewardToken","3":"rewardRuntimeHash","4":"deploymentChainId","5":"deploymentFactory","6":"permanentSink","7":"sinkRuntimeHash"},
    campaignDeployer:deployer,deployerRuntimeHash:keccak256(deployerCode),permanentSink:sink,sinkRuntimeHash:keccak256(sinkCode),retirementProfilesHash:h(979003),
    creationPart1:part1,creationPart1RuntimeHash:keccak256("0x0060"),creationPart2:part2,creationPart2RuntimeHash:keccak256("0x0000"),
    retirementProfiles:[{runtimeHash:keccak256(nftCode),standard:1,mode:1,policyHash}],collections:[{address:collection,runtimeHash:keccak256(nftCode),standard:1,retirementMode:1,policyHash,items:[{tokenId:"42",maxQuantity:"1"}]}],
    deployment:{transactionHash:h(20),blockNumber:"2",blockHash:h(2)},compilerInputSha256:"a".repeat(64)};
  const material={creator,rewardToken:reward,rewardRuntimeHash:m.rewardTokenRuntimeHash,deploymentChainId:31337,deploymentFactory:factory,permanentSink:sink,sinkRuntimeHash:m.sinkRuntimeHash};
  const profilesHash=()=>keccak256(encodeAbiParameters([{type:"tuple[]",components:[{name:"runtimeHash",type:"bytes32"},{name:"standard",type:"uint8"},{name:"mode",type:"uint8"},{name:"policyHash",type:"bytes32"}]}],[m.retirementProfiles]));m.retirementProfilesHash=profilesHash();
  const campaignCode=materializeReclaimRuntime(m.campaignRuntimeTemplate,m.campaignImmutableReferences,m.campaignImmutableNames,material);
  const knobs={mode:"",duplicate:false,standard:1 as 1|2,retirementMode:1 as 1|2};
  const leaf=()=>buildReclaimEligibility({chainId:31337,campaign,collection,runtimeHash:keccak256(nftCode),standard:knobs.standard,retirementMode:knobs.retirementMode,policyHash,items:[{tokenId:"42",maxQuantity:"1"}]},codecs);
  const destination=()=>knobs.retirementMode===1?zeroAddress:sink;
  const log=(address:Address,topics:readonly Hash[],data:`0x${string}`,height:number,index:number):FixtureTreasuryProofLog=>({address,topics,data,blockNumber:BigInt(height),blockHash:h(height),transactionHash:h(height*10),transactionIndex:0,logIndex:index,removed:false});
  const birthLog=log(factory,encodeEventTopics({abi:factoryAbi,eventName:"CampaignCreated",args:{creator,campaign,intent}}) as Hash[],encodeAbiParameters([{type:"address"},{type:"uint128"},{type:"uint32"}],[creator,5n,4]),3,0);
  const logs=()=>[
    knobs.standard===1?log(collection,encodeEventTopics({abi:nft,eventName:"Transfer",args:{from:claimant,to:destination(),tokenId:42n}}) as Hash[],"0x",5,0)
      :knobs.retirementMode===1?log(collection,encodeEventTopics({abi:nft,eventName:"TransferSingle",args:{operator:campaign,from:claimant,to:destination()}}) as Hash[],encodeAbiParameters([{type:"uint256"},{type:"uint256"}],[42n,1n]),5,0)
        :log(collection,encodeEventTopics({abi:nft,eventName:"TransferBatch",args:{operator:campaign,from:claimant,to:destination()}}) as Hash[],encodeAbiParameters([{type:"uint256[]"},{type:"uint256[]"}],[[42n],[1n]]),5,0),
    log(reward,encodeEventTopics({abi:erc20,eventName:"Transfer",args:{from:campaign,to:knobs.mode==="recipient"?a(999):claimant}}) as Hash[],encodeAbiParameters([{type:"uint256"}],[knobs.mode==="payout"?999n:5n]),5,1),
    log(campaign,encodeEventTopics({abi,eventName:"NFTPermanentlyRetired",args:{receiptId:knobs.mode==="receipt-id-gap"?2n:1n,collection}}) as Hash[],encodeAbiParameters([{type:"uint8"},{type:"uint8"},{type:"address"},{type:"uint256[]"},{type:"uint256[]"},{type:"uint256[]"},{type:"uint256[]"}],
      [knobs.standard,knobs.retirementMode,destination(),[42n],[1n],[10n],[knobs.mode==="event-supply"?1n:knobs.retirementMode===1?9n:10n]]),5,2),
    log(campaign,encodeEventTopics({abi,eventName:"TradeInAccepted",args:{receiptId:knobs.mode==="receipt-id-gap"?2n:1n,claimant,collection}}) as Hash[],encodeAbiParameters([{type:"uint8"},{type:"uint256[]"},{type:"uint256[]"},{type:"uint256"},{type:"uint64"},{type:"uint64"},{type:"uint8"},{type:"address"}],
      [knobs.standard,[42n],[1n],5n,3n,0n,knobs.retirementMode,destination()]),5,3),
  ];
  const actualLogs=()=>{let value=logs();if(knobs.mode==="missing-log")value=value.filter(l=>l.address!==campaign);if(knobs.mode==="nft-log")value=value.filter(l=>l.address!==collection);
    if(knobs.mode==="missing-retirement")value=value.filter(l=>l.logIndex!==2);if(knobs.mode==="legacy-return")value.push(log(campaign,[keccak256(new TextEncoder().encode("TradeInReturned(uint64,address,uint256)"))],"0x",5,4));return value;};
  const rpc={getChainId:async()=>knobs.mode==="wrong-chain"?4663:31337,
    getCode:async({address}:{address:Address})=>[creator,claimant].includes(address)?undefined:address===factory?factoryCode:address===reward?rewardCode:address===core?coreCode:address===collection?nftCode
      :address===deployer?deployerCode:address===sink?knobs.mode==="sink-runtime"?"0x6006":sinkCode:address===part1?"0x0060":address===part2?knobs.mode==="creation-part"?"0x0001":"0x0000":knobs.mode==="runtime"?"0x6004":campaignCode,
    getTransactionCount:async()=>0,
    getTransaction:async({hash}:{hash:Hash})=>{const height=Number(BigInt(hash)/10n);return{chainId:31337,
      type:knobs.mode==="legacy-format"?"legacy":knobs.mode==="delegation-format"?"eip7702":"eip1559",
      ...(knobs.mode==="authorization-list"&&{authorizationList:[]}),
      ...(knobs.mode==="access-list"&&{accessList:[{address:campaign,storageKeys:[]}]}),
      ...(knobs.mode==="malformed-access-list"&&{accessList:"invalid-provider-shape"}),
      hash,blockNumber:BigInt(height),blockHash:h(height),transactionIndex:0,to:height===3?factory:campaign,from:height===3?creator:claimant,value:0n,nonce:0,
      input:height===3?encodeFunctionData({abi:factoryAbi,functionName:"create",args:[intent,creator,5n,4]}):encodeFunctionData({abi,functionName:"redeem",args:[collection,[42n],[1n],[1n],[[]],3n,5n,0n,1_800_000_100n]})};},
    getBlock:async({blockNumber}:{blockNumber:bigint})=>({number:blockNumber,hash:knobs.mode==="header"?h(999):h(Number(blockNumber)),timestamp:1_800_000_000n+blockNumber,transactions:knobs.mode==="multi-transaction"?[h(Number(blockNumber)*10),h(999)]:knobs.mode==="membership"?[h(999)]:[h(Number(blockNumber)*10)]}),
    getTransactionReceipt:async({hash}:{hash:Hash})=>{if(knobs.mode==="missing-receipt")throw Error("provider receipt unavailable");const height=Number(BigInt(hash)/10n);return{status:"success",transactionHash:hash,blockNumber:BigInt(height),blockHash:h(height),transactionIndex:0,
      logs:height===3?[birthLog]:height===5?actualLogs():[],to:height===2?null:height===3?factory:campaign,from:height===3?creator:claimant,contractAddress:height===2?factory:null};},
    getLogs:async({address,fromBlock,toBlock}:{address:Address|Address[];fromBlock:bigint;toBlock:bigint})=>{const all=[...(fromBlock<=3n&&toBlock>=3n?[birthLog]:[]),...(fromBlock<=5n&&toBlock>=5n?actualLogs():[])].filter(l=>Array.isArray(address)?address.includes(l.address):l.address===address);return knobs.duplicate?[...all,...all]:all;},
    readContract:async({address,functionName,args=[],blockNumber}:{address:Address;functionName:string;args?:readonly unknown[];blockNumber:bigint})=>{
      if(functionName==="originCurveForToken")return origin;if(functionName==="token")return reward;if(functionName==="factory")return address===deployer?factory:core;
      if(functionName==="totalSupply")return address===reward?1_000_000_000n*10n**18n:blockNumber<5n?10n:knobs.mode==="supply"?8n:knobs.retirementMode===1?9n:10n;
      if(functionName==="decimals")return 18;if(functionName==="rewardToken")return reward;if(functionName==="rewardRuntimeHash")return m.rewardTokenRuntimeHash;
      if(functionName==="deploymentChainId")return 31337n;if(functionName==="campaignCreationCodeHash")return m.campaignCreationCodeHash;
      if(functionName==="creationPart1")return part1;if(functionName==="creationPart2")return part2;if(functionName==="campaignDeployer")return deployer;
      if(functionName==="creationPart1Hash")return m.creationPart1RuntimeHash;if(functionName==="creationPart2Hash")return m.creationPart2RuntimeHash;
      if(functionName==="permanentSink")return sink;if(functionName==="sinkRuntimeHash")return m.sinkRuntimeHash;if(functionName==="retirementProfilesHash")return m.retirementProfilesHash;
      if(functionName==="retirementPolicy")return knobs.mode==="unreviewed-profile"?h(999):policyHash;
      if(functionName==="campaignForIntent"||functionName==="predict")return campaign;
      if(functionName==="creator"||functionName==="controller")return creator;if(functionName==="deploymentFactory")return factory;
      if(functionName==="rewardPerUnit")return 5n;if(functionName==="walletCap")return 4;if(functionName==="policyEpoch")return 3n;if(functionName==="controllerEpoch")return 1n;
      if(functionName==="paused"||functionName==="closed")return false;if(functionName==="funded")return 1000n;if(functionName==="paid")return blockNumber>=5n?5n:0n;
      if(["recovered","unsolicited","outstandingLiability"].includes(functionName))return 0n;if(functionName==="reserve")return knobs.mode==="accounting"?999n:blockNumber<5n?1000n:995n;
      if(functionName==="tradeInNonce")return blockNumber>=5n?1n:0n;
      if(functionName==="collections")return[keccak256(nftCode),leaf().root,4,4,knobs.standard,knobs.retirementMode,policyHash,true];
      if(functionName==="tradeIns")return[claimant,collection,knobs.standard,3n,5n,1,1,knobs.retirementMode,destination()];
      if(functionName==="receiptItems")return[[42n],[1n]];if(functionName==="receiptCollectionHash")return keccak256(nftCode);
      if(functionName==="exists")return knobs.mode==="resurrected";
      if(functionName==="ownerOf"){if(blockNumber<5n)return claimant;if(knobs.mode==="custody")return a(999);if(knobs.retirementMode===2)return sink;
        if(knobs.mode==="owner-archive")throw Error("owner archive unavailable");throw new ContractFunctionRevertedError({abi:nft,functionName:"ownerOf",data:"0x"});}
      if(functionName==="balanceOf"&&address===reward){if(knobs.mode==="archive")throw Error("archive unavailable");return String(args[0]).toLowerCase()===campaign.toLowerCase()?blockNumber<5n?1000n:995n:String(args[0]).toLowerCase()===claimant.toLowerCase()?blockNumber<5n?0n:5n:0n;}
      if(functionName==="balanceOf"&&address===collection){if(String(args[0]).toLowerCase()===claimant.toLowerCase())return blockNumber<5n?1n:0n;if(String(args[0]).toLowerCase()===sink.toLowerCase())return ["sink-balance","custody"].includes(knobs.mode)?0n:blockNumber<5n?0n:1n;return 0n;}
      throw Error("Unexpected permanent Reclaim provider read "+functionName);
    },
  } as unknown as PublicClient;
  const birth=await verifyReclaimFixtureBirth(rpc,m,campaign,at(5),birthLog);assert.equal(birth.creator.toLowerCase(),creator.toLowerCase());
  const db={query:async()=>({rows:[{payload:birth}]})} as unknown as Client,scope:[number,string,string]=[31337,core,h(1)];
  const emptyBirth=await readReclaimFixtureRange(db,scope,m,rpc,[at(3)]);
  assert.equal(emptyBirth.births.length,1);assert.equal(emptyBirth.events.length,0);
  assert.equal(emptyBirth.states[0]?.tradeInNonce,"0","A real V2 birth has zero accepted surrenders and must index before funding or eligibility");
  for(const standard of[1,2] as const)for(const retirementMode of[1,2] as const){
    knobs.standard=standard;knobs.retirementMode=retirementMode;m.collections[0]!.standard=standard;m.collections[0]!.retirementMode=retirementMode;m.retirementProfiles[0]!.standard=standard;m.retirementProfiles[0]!.mode=retirementMode;m.retirementProfilesHash=profilesHash();
    const range=await readReclaimFixtureRange(db,scope,m,rpc,[at(5)]);assert.equal(range.events.length,2);const settled=range.events.find(e=>e.settlement);
    assert.equal(settled?.settlement?.kind,"permanent-surrender");assert.equal(settled?.settlement?.retirementMode,retirementMode);assert.equal(settled?.settlement?.destination,destination());
    assert.deepEqual(settled?.settlement?.supplyAfter,[retirementMode===1?"9":"10"]);assert.equal(range.states[0]?.reserve,"995");assert.equal("repaid" in range.states[0]!,false);
    assert.equal(range.states[0]?.tradeInNonce,"1");assert.equal(settled?.settlement?.receiptId,"1","The first V2 accepted receipt is ID1");
    const modes=["delegation-format","legacy-format","authorization-list","access-list","malformed-access-list","wrong-chain","missing-receipt","header","membership","runtime","missing-log","missing-retirement","receipt-id-gap","event-supply","payout","recipient","nft-log","archive","multi-transaction","accounting","supply","unreviewed-profile","creation-part","legacy-return"];
    if(retirementMode===2)modes.push("custody","sink-runtime","sink-balance");else if(standard===1)modes.push("resurrected","owner-archive");
    for(const mode of modes){knobs.mode=mode;await assert.rejects(readReclaimFixtureRange(db,scope,m,rpc,[at(5)]),/evidence|unavailable|contract/i,`${standard}/${retirementMode}/${mode}`);}
    knobs.mode="";knobs.duplicate=true;assert.equal((await readReclaimFixtureRange(db,scope,m,rpc,[at(5)])).events.length,2);knobs.duplicate=false;
  }
  knobs.mode="accounting";await assert.rejects(readReclaimFixtureSnapshot(rpc,m,birth,at(5)),/evidence/);knobs.mode="";
  const input={chainId:31337 as const,campaign,collection,runtimeHash:keccak256(nftCode),standard:1 as const,retirementMode:1 as const,policyHash,items:[{tokenId:"5",maxQuantity:"1"},{tokenId:"1",maxQuantity:"1"},{tokenId:"42",maxQuantity:"1"}]};
  const tree=buildReclaimEligibility(input,codecs);assert.deepEqual(tree.items.map(i=>i.tokenId),["1","5","42"]);
  for(const item of tree.items){let digest=buildReclaimEligibility({...input,items:[item]},codecs).root;for(const sibling of item.proof)digest=keccak256(`0x${BigInt(digest)<BigInt(sibling)?digest.slice(2)+sibling.slice(2):sibling.slice(2)+digest.slice(2)}`);assert.equal(digest,tree.root);}
  for(const fields of[{chainId:4663 as const},{retirementMode:2 as const},{policyHash:h(999)}])assert.notEqual(buildReclaimEligibility({...input,...fields},codecs).root,tree.root);
  assert.throws(()=>materializeReclaimRuntime(m.campaignRuntimeTemplate,{...m.campaignImmutableReferences,"8":[{start:0,length:32}]},{...m.campaignImmutableNames,"8":"controller"},material),/coverage/);
  console.info("Permanent Reclaim native-burn/sink ERC721/1155 canonical retirement, no-return, reward, archive, reorg, replay and policy-domain smoke passed.");
}
