import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {encodeAbiParameters,encodeEventTopics,encodeFunctionData,erc20Abi,keccak256,parseAbi,zeroAddress,type Address,type Hash,type Hex,type PublicClient} from "viem";
import {nftAcquisitionFactorySignatures,nftAcquisitionVaultSignatures} from "../../../packages/launchpad-common/nft-acquisition-runtime.mjs";
import {configuredNftAcquisitionModule,verifyNftAcquisitionModule,readNftAcquisitionRange} from "./nft-acquisition-fixture-evidence.js";
import type {NftAcquisitionModule} from "./nft-acquisition-fixture-types.js";
import type {CurveFixtureBinding} from "./curve-launch-evidence.js";

const a=(n:number)=>`0x${((1n<<156n)+BigInt(n)).toString(16).padStart(40,"0")}` as Address,h=(n:number)=>`0x${n.toString(16).padStart(64,"0")}` as Hash;
const code="0x60006000"as Hex,codeHash=keccak256(code),factoryAbi=parseAbi(nftAcquisitionFactorySignatures),vaultAbi=parseAbi(nftAcquisitionVaultSignatures);
function model(){
 const module:NftAcquisitionModule={schemaVersion:1,profile:"rmt-nft-acquisition-local-v1",chainId:31337,coreFactory:a(1),coreFactoryRuntimeHash:codeHash,factory:a(2),factoryRuntimeHash:codeHash,venue:a(3),venueRuntimeHash:codeHash,paymentToken:a(4),paymentTokenRuntimeHash:codeHash,projectToken:a(5),creator:a(6),vault:a(7),vaultRuntimeHash:codeHash,collections:[{address:a(8),standard:721,runtimeHash:codeHash,sourceInputSha256:h(88),name:"Synthetic provider-double collection"}],deployment:{transactionHash:h(9),blockNumber:"10",blockHash:h(10),timestamp:new Date(1_800_000_010_000).toISOString()},compilerInputSha256:"a".repeat(64)};
 return{module,binding:{chainId:31337,factory:module.coreFactory,factoryRuntimeHash:codeHash}as CurveFixtureBinding};
}
test("fixture module config is absent by default and rejects hosted, ambiguous, wrong-chain or malformed inputs",()=>{
 const{module,binding}=model(),directory=mkdtempSync(join(tmpdir(),"rmt-nft-module-unit-")),file=join(directory,"module.json"),env={RMT_NFT_ACQUISITION_FIXTURE:"local-reviewed-nft-acquisition-v1",RMT_NFT_ACQUISITION_DEPLOYMENT:file};
 try{
  assert.equal(configuredNftAcquisitionModule({},binding),null);writeFileSync(file,JSON.stringify(module));assert.deepEqual(configuredNftAcquisitionModule(env,binding),module);
  for(const extra of[{NETLIFY:"true"},{VERCEL:"1"},{RAILWAY_ENVIRONMENT_ID:"fixture-is-still-hosted"},{DEPLOY_ID:"x"},{CONTEXT:"deploy-preview"},{RMT_NFT_ACQUISITION_FIXTURE:"production"},{RMT_NFT_ACQUISITION_DEPLOYMENT:"relative.json"}])assert.throws(()=>configuredNftAcquisitionModule({...env,...extra},binding));
  for(const invalid of[{...module,chainId:4663},{...module,profile:"unreviewed"},{...module,coreFactory:a(99)},{...module,factoryRuntimeHash:h(0)},{...module,collections:[]},{...module,collections:[module.collections[0],module.collections[0]]},{...module,collections:[{...module.collections[0],standard:20}]},{...module,compilerInputSha256:"bad"}]){writeFileSync(file,JSON.stringify(invalid));assert.throws(()=>configuredNftAcquisitionModule(env,binding));}
  for(const invalid of["{invalid", " ".repeat(131073)]){writeFileSync(file,invalid);assert.throws(()=>configuredNftAcquisitionModule(env,binding));}
 }finally{unlinkSync(file);rmdirSync(directory);}
});

function provider(){
 const{module}=model(),mode={name:""},point={blockNumber:"11",blockHash:h(11),timestamp:new Date(1_800_000_011_000).toISOString()},data=encodeFunctionData({abi:vaultAbi,functionName:"fundNative",args:[h(12)]});
 const metadata=(height:bigint,transactionHash:Hash,logIndex:number)=>({blockNumber:height,blockHash:h(Number(height)),transactionHash,transactionIndex:0,logIndex,removed:false});
 const birth={address:module.factory,topics:encodeEventTopics({abi:factoryAbi,eventName:"VaultCreated",args:{creator:module.creator,projectToken:module.projectToken,vault:module.vault}}),data:encodeAbiParameters([{type:"address"},{type:"bytes32"}],[module.creator,h(1)]),...metadata(10n,module.deployment.transactionHash,0)};
 const funded={address:module.vault,topics:encodeEventTopics({abi:vaultAbi,eventName:"FundingReceived",args:{currency:zeroAddress,sender:module.creator}}),data:encodeAbiParameters([{type:"uint256"},{type:"bytes32"}],[100n,h(12)]),...metadata(11n,h(110),0)};
 const block=(height:bigint)=>({number:height,hash:mode.name==="header"?h(999):h(Number(height)),timestamp:1_800_000_000n+height,transactions:mode.name==="membership"?[h(999)]:[height===10n?module.deployment.transactionHash:h(110)]});
 const receipt=(hash:Hash)=>({status:"success",transactionHash:mode.name==="wrong-receipt-identity"?h(999):hash,blockNumber:hash===module.deployment.transactionHash?10n:11n,blockHash:mode.name==="receipt-block"?h(999):hash===module.deployment.transactionHash?h(10):h(11),transactionIndex:0,from:module.creator,to:hash===module.deployment.transactionHash?module.factory:module.vault,logs:mode.name==="missing-log"?[]:[hash===module.deployment.transactionHash?birth:funded]});
 const values={coreFactory:module.coreFactory,coreFactoryHash:module.coreFactoryRuntimeHash,venue:module.venue,venueHash:module.venueRuntimeHash,paymentToken:module.paymentToken,paymentTokenHash:module.paymentTokenRuntimeHash,deploymentChainId:31337n,productionExecutionAvailable:false,projectToken:module.projectToken,creator:module.creator,deploymentFactory:module.factory,originCurveForToken:a(20),totalSupply:1_000_000_000n*10n**18n,controller:module.creator,controllerEpoch:1n,policyEpoch:1n,purchasesEnabled:false,policy:[zeroAddress,10n,20n,20n,5],balanceOf:0n};
 const rpc={getChainId:async()=>mode.name==="wrong-chain"?4663:31337,getBlock:async({blockNumber}:{blockNumber:bigint})=>block(blockNumber),getCode:async({address}:{address:Address})=>mode.name==="runtime"?"0x6001":address===module.creator?undefined:code,getTransactionCount:async()=>0,
  getTransactionReceipt:async({hash}:{hash:Hash})=>{if(mode.name==="missing-receipt")throw Error("provider unavailable");return receipt(hash);},getLogs:async()=>[{...funded,...(mode.name==="removed-log"&&{removed:true})}],
  readContract:async({functionName}:{functionName:string})=>{if(mode.name==="binding"&&functionName==="venue")return a(999);if(!(functionName in values))throw Error("Unexpected read "+functionName);return values[functionName as keyof typeof values];},getBalance:async()=>100n,
  getTransaction:async({hash}:{hash:Hash})=>{const birth=hash===module.deployment.transactionHash;return{type:"eip1559",chainId:31337,hash,from:module.creator,to:birth?module.factory:module.vault,input:mode.name==="calldata"?"0x6000":birth?encodeFunctionData({abi:factoryAbi,functionName:"create",args:[module.projectToken,module.creator,h(1)]}):data,value:birth?0n:100n,nonce:0,blockNumber:birth?10n:11n,blockHash:birth?h(10):h(11),transactionIndex:0};},
  request:async()=>{if(mode.name==="missing-trace")throw Error("trace provider unavailable");if(mode.name==="malformed-trace")return{type:"CALL"};return{type:"CALL",from:module.creator,to:mode.name==="trace-recipient"?a(999):module.vault,input:data,value:mode.name==="trace-value"?"0x63":"0x64",...(mode.name==="reverted-trace"&&{error:"execution reverted"})};}
 }as unknown as PublicClient;
 return{rpc,module,mode,point};
}
test("module verification uses runtime and immutable bindings, complete creation receipt identity and source-chain evidence",async()=>{
 const{rpc,module,mode}=provider();await verifyNftAcquisitionModule(rpc,module);
 for(const name of["wrong-chain","header","receipt-block","missing-receipt","missing-log","runtime","binding","wrong-receipt-identity","membership","calldata"]){mode.name=name;await assert.rejects(verifyNftAcquisitionModule(rpc,module),/evidence|provider|call/i,name);}
});
test("funding range proof rejects absent/malformed receipt, canonical disagreement and missing or corrupted native traces",async()=>{
 const{rpc,module,mode,point}=provider(),result=await readNftAcquisitionRange(rpc,module,[point]);assert.equal(result.events.length,1);assert.equal(result.events[0]?.settlement?.kind,"funding");assert.equal(result.events[0]?.settlement?.totalCost,"100");assert.equal(result.states[0]?.nativeBalance,"100");
 for(const name of["header","receipt-block","missing-receipt","missing-log","runtime","removed-log","missing-trace","malformed-trace","trace-recipient","trace-value","reverted-trace","membership"]){mode.name=name;await assert.rejects(readNftAcquisitionRange(rpc,module,[point]),/evidence|provider|trace|settlement/i,name);}
});

test("funding log alone cannot replace exact chain, type, origin, amount and source calldata binding",async()=>{
 for(const mutation of[{chainId:4663},{type:"eip7702"},{authorizationList:[]},{accessList:"malformed"},{accessList:[{address:a(999),storageKeys:[]}]},{hash:h(999)},{blockNumber:12n},{transactionIndex:1},{from:a(999)},{to:a(999)},{nonce:1},{input:encodeFunctionData({abi:vaultAbi,functionName:"fundNative",args:[h(999)]})}]){
  const{rpc,module,point}=provider(),read=rpc.getTransaction.bind(rpc);rpc.getTransaction=(async args=>({...await read(args),...mutation}))as PublicClient["getTransaction"];
  await assert.rejects(readNftAcquisitionRange(rpc,module,[point]),/evidence|caller|trace|settlement/i);
 }
});

function withdrawal(kind:0|1|2,currencyToken=false){
 const{rpc,module,point}=provider(),caller=a(50),recipient=a(51),asset=kind===0?(currencyToken?module.paymentToken:zeroAddress):module.collections[0]!.address,tokenId=kind===0?0n:42n,quantity=kind===1?1n:10n;
 if(kind===2)module.collections[0]!.standard=1155;
 const input=encodeFunctionData({abi:vaultAbi,functionName:"executeWithdrawal",args:[1n]}),knobs={name:""};
 const transferAbi=parseAbi(["event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)","event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)","function safeTransferFrom(address,address,uint256)","function safeTransferFrom(address,address,uint256,uint256,bytes)"]);
 const metadata=(logIndex:number)=>({blockNumber:11n,blockHash:h(11),transactionHash:h(110),transactionIndex:0,logIndex,removed:false});
 const event={address:module.vault,topics:encodeEventTopics({abi:vaultAbi,eventName:"WithdrawalExecuted",args:{id:1n,asset,recipient}}),data:encodeAbiParameters([{type:"uint8"},{type:"uint256"},{type:"uint256"}],[kind,tokenId,quantity]),...metadata(0)};
 const assetLog=()=>kind===0?{address:asset,topics:encodeEventTopics({abi:erc20Abi,eventName:"Transfer",args:{from:module.vault,to:recipient}}),data:encodeAbiParameters([{type:"uint256"}],[quantity]),...metadata(1)}:kind===1?{address:asset,topics:encodeEventTopics({abi:transferAbi,eventName:"Transfer",args:{from:module.vault,to:recipient,tokenId}}),data:"0x",...metadata(1)}:{address:asset,topics:encodeEventTopics({abi:transferAbi,eventName:"TransferSingle",args:{operator:module.vault,from:module.vault,to:recipient}}),data:encodeAbiParameters([{type:"uint256"},{type:"uint256"}],[tokenId,quantity]),...metadata(1)};
 const receipt=()=>({status:"success",transactionHash:h(110),blockNumber:11n,blockHash:h(11),transactionIndex:0,from:caller,to:module.vault,logs:[event,...(kind===0&&!currencyToken?[]:[assetLog()])]});
 rpc.getLogs=(async()=>[event])as PublicClient["getLogs"];rpc.getTransactionReceipt=(async()=>receipt())as unknown as PublicClient["getTransactionReceipt"];
 rpc.getTransaction=(async()=>({type:"eip1559",chainId:31337,hash:h(110),from:caller,to:module.vault,input:knobs.name==="wrong-id"?encodeFunctionData({abi:vaultAbi,functionName:"executeWithdrawal",args:[2n]}):input,value:0n,nonce:0,blockNumber:11n,blockHash:h(11),transactionIndex:0}))as unknown as PublicClient["getTransaction"];
 const originalCode=rpc.getCode.bind(rpc);rpc.getCode=(async args=>args.address===caller?undefined:originalCode(args))as PublicClient["getCode"];
 const read=rpc.readContract.bind(rpc);rpc.readContract=(async args=>{
  if(args.functionName==="withdrawals")return[kind,asset,tokenId,quantity,knobs.name==="recipient-state"&&args.blockNumber===11n?a(99):recipient,knobs.name==="early"?1_800_000_012:1_800_000_010,knobs.name==="expired"?1_800_000_010:1_800_000_100,1n,args.blockNumber===11n?knobs.name==="not-consumed"?1:2:1];
  if(args.functionName==="controllerEpoch"&&knobs.name==="stale-epoch")return 2n;return read(args);
 })as PublicClient["readContract"];
 rpc.request=(async()=>{
  if(knobs.name==="missing-trace")throw Error("trace unavailable");
  const target=knobs.name==="trace-recipient"?a(99):recipient;
  const data=kind===0?encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[target,quantity]}):kind===1?encodeFunctionData({abi:transferAbi,functionName:"safeTransferFrom",args:[module.vault,target,tokenId]}):encodeFunctionData({abi:transferAbi,functionName:"safeTransferFrom",args:[module.vault,target,tokenId,quantity,"0x"]});
  const leaf=kind===0&&!currencyToken?{type:"CALL",from:module.vault,to:target,input:"0x",value:"0x"+quantity.toString(16)}:{type:"CALL",from:module.vault,to:asset,input:data,value:"0x0",output:kind===0?"0x"+"0".repeat(63)+"1":"0x"};
  return{type:"CALL",from:caller,to:module.vault,input,value:"0x0",calls:[leaf]};
 })as PublicClient["request"];
 return{rpc,module,point,knobs,caller,recipient};
}
test("noticed native, ERC20, ERC721 and ERC1155 withdrawals require exact delivery while permitting a non-controller caller",async()=>{
 for(const[kind,token]of[[0,false],[0,true],[1,false],[2,false]]as const){
  const{rpc,module,point,knobs,caller,recipient}=withdrawal(kind,token),range=await readNftAcquisitionRange(rpc,module,[point]),settlement=range.events[0]!.settlement!;
  assert.equal(settlement.kind,"withdrawal");assert.equal(settlement.recipient,recipient);assert.equal(settlement.origin?.actor,caller);assert.notEqual(caller,module.creator);assert.equal(settlement.withdrawalId,"1");
  for(const name of["early","expired","stale-epoch","not-consumed","recipient-state","wrong-id","missing-trace","trace-recipient"]){knobs.name=name;await assert.rejects(readNftAcquisitionRange(rpc,module,[point]),/evidence|trace|settlement/i,name);}
 }
});
