import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {receiptEvidence,reviewTransactionEvidence,verifyRuntime,transact} from "../../packages/contracts/scripts/deploy-fixed-supply-fixture.mjs";

const require=createRequire(new URL("../../apps/launch-website/package.json",import.meta.url));
const{encodeDeployData,erc20Abi,keccak256,toHex,zeroAddress}=require("viem");
const json=value=>JSON.stringify(value,(_,v)=>typeof v==="bigint"?v.toString():v,2)+"\n";

export async function deployReclaimFixture({client,rpc,compilation,assetCompilation,core,coreArtifacts,creator,out}){
  assert.equal(await client.getChainId(),31337);assert.equal(new URL(client.transport.url).hostname,"127.0.0.1");
  await rpc("anvil_setBalance",[creator.address,toHex(20n*10n**18n)]);
  const receipts=[];
  async function send(request,expected="success",account=creator){
    const nonce=await client.getTransactionCount({address:account.address,blockTag:"pending"});
    if(request.from)assert.equal(request.from.toLowerCase(),account.address.toLowerCase());
    if(request.chainId!==undefined)assert.equal(BigInt(request.chainId),31337n);
    if(request.nonce!==undefined)assert.equal(BigInt(request.nonce),BigInt(nonce));
    assert.equal(request.authorizationList,undefined);assert.equal(request.accessList,undefined);
    const gas=request.gas?BigInt(request.gas):expected==="reverted"?8_000_000n:(await client.estimateGas({account:account.address,...request}))*125n/100n;
    const head=await client.getBlock(),signed=await account.signTransaction({chainId:31337,type:"eip1559",to:request.to,data:request.data,value:BigInt(request.value??0),nonce,gas,
      maxFeePerGas:BigInt(request.maxFeePerGas??(head.baseFeePerGas??1n)*2n+1n),maxPriorityFeePerGas:BigInt(request.maxPriorityFeePerGas??0)});
    const hash=keccak256(signed);assert.equal(await rpc("eth_sendRawTransaction",[signed]),hash);
    const receipt=await client.waitForTransactionReceipt({hash,checkReplacement:false,timeout:30_000,pollingInterval:100});assert.equal(receipt.status,expected);
    assert.equal((await client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash);receipts.push({...receiptEvidence(receipt),transaction:await reviewTransactionEvidence(client,receipt)});return receipt;
  }
  const now=(await client.getBlock()).timestamp,intent=keccak256("0x7265636c61696d2d73796e7468657469632d726577617264");
  const creation=await send({...transact(core.factory,coreArtifacts.RMTLaunchCurveFactoryV2.abi,"create",["Reclaim Synthetic RMT","tRMT","ipfs://local-reclaim-fixture",zeroAddress,0,intent,now+300n]),value:BigInt(core.creationFeeWei)});
  const token=await client.readContract({address:core.factory,abi:coreArtifacts.RMTLaunchCurveFactoryV2.abi,functionName:"tokenForIntent",args:[creator.address,intent]});
  const curve=await client.readContract({address:core.factory,abi:coreArtifacts.RMTLaunchCurveFactoryV2.abi,functionName:"originCurveForToken",args:[token]});
  const code=await client.getCode({address:token});assert.equal(keccak256(code),keccak256(coreArtifacts.RMTLaunchCurveTokenV2.runtime));
  assert.equal(await client.readContract({address:token,abi:erc20Abi,functionName:"totalSupply"}),1_000_000_000n*10n**18n);
  const [quoted]=await client.readContract({address:curve,abi:coreArtifacts.RMTLaunchBondingCurveV1.abi,functionName:"quoteBuy",args:[10n**17n]});
  await send({...transact(curve,coreArtifacts.RMTLaunchBondingCurveV1.abi,"buy",[quoted,(await client.getBlock()).timestamp+300n]),value:10n**17n});
  assert.ok(await client.readContract({address:token,abi:erc20Abi,functionName:"balanceOf",args:[creator.address]})>=2000n*10n**18n);
  const factoryArtifact=compilation.artifacts.RMTReclaimFactoryV1,campaignArtifact=compilation.artifacts.RMTReclaimCampaignV1;
  const assets=[];
  for(const[name,standard,items]of[["Reclaim721Fixture",1,Array.from({length:12},(_,i)=>({tokenId:String(i+1),maxQuantity:"1"}))],
    ["Reclaim1155Fixture",2,[{tokenId:"101",maxQuantity:"10"},{tokenId:"102",maxQuantity:"10"},{tokenId:"103",maxQuantity:"10"}]]]){
    const a=assetCompilation.artifacts[name],receipt=await send({data:encodeDeployData({abi:a.abi,bytecode:a.bytecode})}),address=receipt.contractAddress;assert.ok(address);
    const runtimeHash=await verifyRuntime(client,address,a);assets.push({address,runtimeHash,standard,items});
    for(const item of items)await send(transact(address,a.abi,"mint",standard===1?[creator.address,BigInt(item.tokenId)]:[creator.address,BigInt(item.tokenId),BigInt(item.maxQuantity)]));
  }
  const hostile=assetCompilation.artifacts.ReclaimHostile721,hostileReceipt=await send({data:encodeDeployData({abi:hostile.abi,bytecode:hostile.bytecode})});
  // The immutable fixture manifest admits only assets already present at the
  // factory's canonical birth block. Do not relax that historical code check.
  const factoryCreation=await send({data:encodeDeployData({abi:factoryArtifact.abi,bytecode:factoryArtifact.bytecode,args:[token,keccak256(code)]})});
  const factory=factoryCreation.contractAddress;assert.ok(factory);const factoryRuntimeHash=await verifyRuntime(client,factory,factoryArtifact);
  assert.equal(await client.readContract({address:factory,abi:factoryArtifact.abi,functionName:"rewardToken"}),token);
  const block=await client.getBlock({blockNumber:factoryCreation.blockNumber});
  const module={schemaVersion:1,profile:"rmt-reclaim-v1",chainId:31337,reclaimFactory:factory,factoryRuntimeHash,coreFactory:core.factory,coreFactoryRuntimeHash:core.factoryRuntimeHash,
    rewardToken:token,rewardTokenRuntimeHash:keccak256(code),campaignCreationCode:campaignArtifact.bytecode,campaignCreationCodeHash:keccak256(campaignArtifact.bytecode),
    campaignRuntimeTemplate:campaignArtifact.runtime,campaignImmutableReferences:campaignArtifact.immutableOffsets,
    campaignImmutableNames:Object.fromEntries(Object.keys(campaignArtifact.immutableOffsets).map(id=>[id,compilation.immutableNames[id]])),
    deployment:{transactionHash:factoryCreation.transactionHash,blockNumber:factoryCreation.blockNumber.toString(),blockHash:factoryCreation.blockHash,timestamp:new Date(Number(block.timestamp)*1000).toISOString()},
    compilerInputSha256:compilation.manifest.inputSha256,collections:assets};
  assert.ok(Buffer.byteLength(json(module))<=180000);writeFileSync(join(out,"reclaim-deployment.json"),json(module));
  writeFileSync(join(out,"reclaim-compiler-manifest.json"),json(compilation.manifest));
  writeFileSync(join(out,"reclaim-setup.json"),json({schemaVersion:1,profile:"LOCAL_SYNTHETIC_RECLAIM_SETUP",chainId:31337,production:false,tokenIssuance:"Synthetic-only existing fixed-supply TokenV2 via the normal factory; NOT the live RMT token",rewardCreation:receiptEvidence(creation),rewardToken:token,curve,compiler:compilation.manifest,nftAssets:assetCompilation.manifest,receipts}));
  return{module,send,token,curve,assets,assetArtifacts:assetCompilation.artifacts,hostile721:hostileReceipt.contractAddress,receipts};
}
