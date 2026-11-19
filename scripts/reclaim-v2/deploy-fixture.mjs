import assert from "node:assert/strict";import{createRequire}from"node:module";import{writeFileSync,readFileSync}from"node:fs";import{join}from"node:path";
import{receiptEvidence,reviewTransactionEvidence,verifyRuntime,transact}from"../../packages/contracts/scripts/deploy-fixed-supply-fixture.mjs";
const require=createRequire(new URL("../../apps/launch-website/package.json",import.meta.url));
const{encodeDeployData,encodeAbiParameters,erc20Abi,keccak256,parseAbi,parseEventLogs,toHex,stringToHex,zeroAddress}=require("viem");
const{generatePrivateKey,privateKeyToAccount}=require("viem/accounts");
const json=v=>JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x,2)+"\n";
const safeAbi=parseAbi(["function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)","function nonce() view returns(uint256)"]);
const safeFactoryAbi=parseAbi(["function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns(address)","event ProxyCreation(address indexed proxy,address singleton)"]);
export async function deployReclaimFixture({client,rpc,compilation,assetCompilation,core,coreArtifacts,creator,out}){
 assert.equal(await client.getChainId(),31337);assert.equal(new URL(client.transport.url).hostname,"127.0.0.1");
 const owners=Array.from({length:3},()=>privateKeyToAccount(generatePrivateKey())),signers=new Map([creator,...owners].map(a=>[a.address.toLowerCase(),a]));
 for(const account of[creator,...owners])await rpc("anvil_setBalance",[account.address,toHex(20n*10n**18n)]);
 const receipts=[];
 async function send(request,expected="success",account=creator){
  const nonce=await client.getTransactionCount({address:account.address,blockTag:"pending"});if(request.from)assert.equal(request.from.toLowerCase(),account.address.toLowerCase());
  if(request.chainId!==undefined)assert.equal(BigInt(request.chainId),31337n);if(request.nonce!==undefined)assert.equal(BigInt(request.nonce),BigInt(nonce));
  assert.equal(request.authorizationList,undefined);assert.equal(request.accessList,undefined);
  const gas=request.gas?BigInt(request.gas):expected==="reverted"?10_000_000n:(await client.estimateGas({account:account.address,to:request.to,data:request.data,value:BigInt(request.value??0)}))*125n/100n;
  const head=await client.getBlock(),signed=await account.signTransaction({chainId:31337,type:"eip1559",to:request.to,data:request.data,value:BigInt(request.value??0),nonce,gas,
    maxFeePerGas:BigInt(request.maxFeePerGas??(head.baseFeePerGas??1n)*2n+1n),maxPriorityFeePerGas:BigInt(request.maxPriorityFeePerGas??0)});
  const hash=keccak256(signed);assert.equal(await rpc("eth_sendRawTransaction",[signed]),hash);
  const receipt=await client.waitForTransactionReceipt({hash,checkReplacement:false,timeout:30_000,pollingInterval:100});assert.equal(receipt.status,expected);
  assert.equal((await client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash);receipts.push({...receiptEvidence(receipt),transaction:await reviewTransactionEvidence(client,receipt)});return receipt;
 }
 const archive=JSON.parse(readFileSync(new URL("../../packages/contracts/test/fixtures/safe-1.4.1/runtime.json",import.meta.url)));
 for(const p of Object.values(archive.contracts)){assert.equal(keccak256(p.code),p.runtimeKeccak256);const old=await client.getCode({address:p.address});if(!old||old==="0x")await rpc("anvil_setCode",[p.address,p.code]);assert.equal(keccak256(await client.getCode({address:p.address})),p.runtimeKeccak256);}
 const safeFactory=archive.contracts.safe_proxy_factory.address;
 const initializer=transact(zeroAddress,safeAbi,"setup",[owners.map(a=>a.address),2n,zeroAddress,"0x",archive.contracts.compatibility_fallback_handler.address,zeroAddress,0n,zeroAddress]).data;
 const safeCreated=await send(transact(safeFactory,safeFactoryAbi,"createProxyWithNonce",[archive.contracts.safe_l2.address,initializer,79n]));
 const safeLogs=parseEventLogs({abi:safeFactoryAbi,eventName:"ProxyCreation",strict:true,logs:safeCreated.logs.filter(l=>l.address.toLowerCase()===safeFactory.toLowerCase())});assert.equal(safeLogs.length,1);const safe=safeLogs[0].args.proxy;
 const now=(await client.getBlock()).timestamp,intent=keccak256(stringToHex("reclaim-v2-synthetic-reward-not-live-RMT"));
 const creation=await send({...transact(core.factory,coreArtifacts.RMTLaunchCurveFactoryV2.abi,"create",["Synthetic Reclaim RMT","tRMT","ipfs://local-reclaim-v2",zeroAddress,0,intent,now+300n]),value:BigInt(core.creationFeeWei)});
 const token=await client.readContract({address:core.factory,abi:coreArtifacts.RMTLaunchCurveFactoryV2.abi,functionName:"tokenForIntent",args:[creator.address,intent]});
 const curve=await client.readContract({address:core.factory,abi:coreArtifacts.RMTLaunchCurveFactoryV2.abi,functionName:"originCurveForToken",args:[token]});
 const tokenCode=await client.getCode({address:token});assert.equal(keccak256(tokenCode),keccak256(coreArtifacts.RMTLaunchCurveTokenV2.runtime));
 assert.equal(await client.readContract({address:token,abi:erc20Abi,functionName:"totalSupply"}),1_000_000_000n*10n**18n);
 const[quoted]=await client.readContract({address:curve,abi:coreArtifacts.RMTLaunchBondingCurveV1.abi,functionName:"quoteBuy",args:[10n**17n]});
 await send({...transact(curve,coreArtifacts.RMTLaunchBondingCurveV1.abi,"buy",[quoted,(await client.getBlock()).timestamp+300n]),value:10n**17n});
 const collections=[];
 for(const[name,standard,retirementMode]of[["ReclaimBurn721Fixture",1,1],["ReclaimBurn1155Fixture",2,1],["ReclaimSink721Fixture",1,2],["ReclaimSink1155Fixture",2,2]]){
  const a=assetCompilation.artifacts[name],deployed=await send({data:encodeDeployData({abi:a.abi,bytecode:a.bytecode})}),address=deployed.contractAddress;assert.ok(address);
  const runtimeHash=await verifyRuntime(client,address,a),policyHash=keccak256(encodeAbiParameters([{type:"uint256"},{type:"bytes32"},{type:"bytes32"},{type:"uint8"},{type:"uint8"}],[31337n,"0x"+assetCompilation.manifest.sourceSha256,runtimeHash,standard,retirementMode]));
  const items=standard===1?Array.from({length:12},(_,i)=>({tokenId:String(i+1),maxQuantity:"1"})):[{tokenId:"101",maxQuantity:"10"},{tokenId:"102",maxQuantity:"10"},{tokenId:"103",maxQuantity:"10"}];
  for(const item of items){const recipient=standard===1&&item.tokenId==="11"?safe:creator.address;await send(transact(address,a.abi,"mint",standard===1?[recipient,BigInt(item.tokenId)]:[recipient,BigInt(item.tokenId),BigInt(item.maxQuantity)]));}
  if(standard===2)await send(transact(address,a.abi,"safeTransferFrom",[creator.address,safe,103n,2n,"0x"]));
  collections.push({address,runtimeHash,standard,retirementMode,policyHash,items});
 }
 await send(transact(token,erc20Abi,"transfer",[safe,100n*10n**18n]));
 const negative=[];for(const name of["ReclaimFakeBurn721","ReclaimIssuerRecovery721"]){const a=assetCompilation.artifacts[name],r=await send({data:encodeDeployData({abi:a.abi,bytecode:a.bytecode})});negative.push({name,address:r.contractAddress,runtimeHash:await verifyRuntime(client,r.contractAddress,a),admitted:false});}
 const retirementProfiles=collections.map(a=>({runtimeHash:a.runtimeHash,standard:a.standard,mode:a.retirementMode,policyHash:a.policyHash}));
 const factoryArtifact=compilation.artifacts.RMTReclaimFactoryV2,campaignArtifact=compilation.artifacts.RMTReclaimCampaignV2;
 const factoryCreated=await send({data:encodeDeployData({abi:factoryArtifact.abi,bytecode:factoryArtifact.bytecode,args:[token,keccak256(tokenCode),retirementProfiles]})});
 const factory=factoryCreated.contractAddress;assert.ok(factory);const factoryRuntimeHash=await verifyRuntime(client,factory,factoryArtifact);
 const getter=name=>client.readContract({address:factory,abi:factoryArtifact.abi,functionName:name});
 const campaignDeployer=await getter("campaignDeployer"),permanentSink=await getter("permanentSink"),sinkRuntimeHash=await verifyRuntime(client,permanentSink,compilation.artifacts.RMTReclaimSinkV2),
   deployerRuntimeHash=await verifyRuntime(client,campaignDeployer,compilation.artifacts.RMTReclaimCampaignDeployerV2),creationPart1=await getter("creationPart1"),creationPart2=await getter("creationPart2");
 const p1=await client.getCode({address:creationPart1}),p2=await client.getCode({address:creationPart2});assert.ok(p1.startsWith("0x00")&&p2.startsWith("0x00"));assert.equal("0x"+p1.slice(4)+p2.slice(4),campaignArtifact.bytecode);
 const block=await client.getBlock({blockNumber:factoryCreated.blockNumber});
 const module={schemaVersion:2,profile:"rmt-reclaim-v2-permanent",chainId:31337,reclaimFactory:factory,factoryRuntimeHash,coreFactory:core.factory,coreFactoryRuntimeHash:core.factoryRuntimeHash,rewardToken:token,rewardTokenRuntimeHash:keccak256(tokenCode),
  campaignDeployer,deployerRuntimeHash,permanentSink,sinkRuntimeHash,creationPart1,creationPart1RuntimeHash:keccak256(p1),creationPart2,creationPart2RuntimeHash:keccak256(p2),retirementProfiles,retirementProfilesHash:await getter("retirementProfilesHash"),
  campaignCreationCode:campaignArtifact.bytecode,campaignCreationCodeHash:keccak256(campaignArtifact.bytecode),campaignRuntimeTemplate:campaignArtifact.runtime,campaignImmutableReferences:campaignArtifact.immutableOffsets,
  campaignImmutableNames:Object.fromEntries(Object.keys(campaignArtifact.immutableOffsets).map(id=>[id,compilation.immutableNames[id]])),compilerInputSha256:compilation.manifest.inputSha256,
  deployment:{transactionHash:factoryCreated.transactionHash,blockNumber:factoryCreated.blockNumber.toString(),blockHash:factoryCreated.blockHash,timestamp:new Date(Number(block.timestamp)*1000).toISOString()},collections};
 assert.ok(Buffer.byteLength(json(module))<=180000);writeFileSync(join(out,"reclaim-deployment.json"),json(module));writeFileSync(join(out,"reclaim-compiler-manifest.json"),json(compilation.manifest));
 writeFileSync(join(out,"reclaim-setup.json"),json({schemaVersion:2,profile:"LOCAL_SYNTHETIC_PERMANENT_RECLAIM",chainId:31337,production:false,tokenIssuance:"Synthetic-only existing fixed1B TokenV2 via normal candidate factory, not live RMT",rewardCreation:receiptEvidence(creation),rewardToken:token,curve,
   safe:{address:safe,owners:owners.map(a=>a.address),threshold:2,receipt:receiptEvidence(safeCreated),initializerHash:keccak256(initializer)},compiler:compilation.manifest,nftAssets:assetCompilation.manifest,negative,receipts}));
 return{module,send,token,curve,assets:collections,assetArtifacts:assetCompilation.artifacts,negative,receipts,safe,owners,signers};
}
