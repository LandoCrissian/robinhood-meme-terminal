import {readFileSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {erc20Abi,getAddress,keccak256,parseAbi,parseEventLogs,zeroAddress,type Address,type Hex} from "viem";
import {nftAcquisitionFactorySignatures,nftAcquisitionVaultSignatures,nftAcquisitionVenueSignatures} from "../../../../packages/launchpad-common/nft-acquisition-runtime.mjs";
import {nftAcquisitionFixtureFlag,nftAcquisitionProfile,nftAddress,nftHash,nftPoint,type NftAcquisitionCollection,type NftAcquisitionPoint,type NftAcquisitionSnapshot} from "../nft-acquisition";
import {configuredCurveFixture,fixtureRpc,verifyCurveFixture,sameHex as same,type CurveFixture} from "./curve-fixture";
import {projectTreasuryControllerKind} from "./project-treasury-fixture";

export const nftVaultAbi=parseAbi(nftAcquisitionVaultSignatures),nftFactoryAbi=parseAbi(nftAcquisitionFactorySignatures),nftVenueAbi=parseAbi(nftAcquisitionVenueSignatures);
export const nft721Abi=parseAbi(["function ownerOf(uint256) view returns(address)","function getApproved(uint256) view returns(address)","function isApprovedForAll(address,address) view returns(bool)","event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)"]);
export const nft1155Abi=parseAbi(["function balanceOf(address,uint256) view returns(uint256)","function isApprovedForAll(address,address) view returns(bool)","event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)"]);
export type NftAcquisitionDeployment={schemaVersion:1;profile:typeof nftAcquisitionProfile;chainId:31337;coreFactory:Address;coreFactoryRuntimeHash:Hex;
  factory:Address;factoryRuntimeHash:Hex;venue:Address;venueRuntimeHash:Hex;paymentToken:Address;paymentTokenRuntimeHash:Hex;
  projectToken:Address;creator:Address;vault:Address;vaultRuntimeHash:Hex;collections:(NftAcquisitionCollection&{slug?:string})[];
  deployment:NftAcquisitionPoint&{transactionHash:Hex};compilerInputSha256:string};
export type NftAcquisitionFixture={curve:CurveFixture;module:NftAcquisitionDeployment};
export type NftAcquisitionRpc=ReturnType<typeof fixtureRpc>;
export type NftAcquisitionHead=Awaited<ReturnType<NftAcquisitionRpc["getBlock"]>>&{number:bigint;hash:Hex};
export function requireNft(value:unknown,reason="NFT acquisition evidence unavailable or conflicting"):asserts value{if(!value)throw Error(reason);}
export const normalizeNft=(v:string)=>getAddress(v.toLowerCase());
export const nftAcquisitionPoint=(head:NftAcquisitionHead):NftAcquisitionPoint=>({blockNumber:head.number.toString(),blockHash:head.hash,timestamp:new Date(Number(head.timestamp)*1000).toISOString()});
export function configuredNftAcquisitionFixture(headers:Headers):NftAcquisitionFixture|null{
  const curve=configuredCurveFixture(headers);if(!curve||headers.has("forwarded")||process.env.RMT_NFT_ACQUISITION_FIXTURE!==nftAcquisitionFixtureFlag)return null;
  try{const path=process.env.RMT_NFT_ACQUISITION_DEPLOYMENT;if(!path||!isAbsolute(path)||statSync(path).size>160_000)return null;
    const m=JSON.parse(readFileSync(path,"utf8"))as NftAcquisitionDeployment;
    if(m.schemaVersion!==1||m.profile!==nftAcquisitionProfile||m.chainId!==31337||![m.coreFactory,m.factory,m.venue,m.paymentToken,m.projectToken,m.creator,m.vault].every(nftAddress)
      ||![m.coreFactoryRuntimeHash,m.factoryRuntimeHash,m.venueRuntimeHash,m.paymentTokenRuntimeHash,m.vaultRuntimeHash,m.deployment.transactionHash].every(nftHash)
      ||!same(m.coreFactory,curve.factory)||!same(m.coreFactoryRuntimeHash,curve.factoryRuntimeHash)||!nftPoint(m.deployment)||BigInt(m.deployment.blockNumber)<curve.deploymentBlock||!/^[0-9a-f]{64}$/i.test(m.compilerInputSha256)
      ||!Array.isArray(m.collections)||m.collections.length<1||m.collections.length>16||!m.collections.every(c=>nftAddress(c.address)&&[721,1155].includes(c.standard)&&nftHash(c.runtimeHash)&&nftHash(c.sourceInputSha256)&&typeof c.name==="string"&&c.name.length<=120)
      ||new Set(m.collections.map(c=>c.address.toLowerCase())).size!==m.collections.length)return null;
    return{curve,module:m};
  }catch{return null;}
}
export async function nftRead<T>(rpc:NftAcquisitionRpc,target:Address,abi:readonly unknown[],functionName:string,args:readonly unknown[],blockNumber:bigint):Promise<T>{return rpc.readContract({address:target,abi,functionName,args,blockNumber}as never)as Promise<T>;}
export async function verifyNftAcquisitionContext(config:NftAcquisitionFixture){
  const rpc=fixtureRpc(config.curve),head=await verifyCurveFixture(config.curve,rpc)as NftAcquisitionHead,m=config.module;
  requireNft(head.number!==null&&head.hash&&await rpc.getChainId()===31337);
  const pins=[[m.factory,m.factoryRuntimeHash],[m.venue,m.venueRuntimeHash],[m.paymentToken,m.paymentTokenRuntimeHash],[m.vault,m.vaultRuntimeHash]]as const;
  for(const[target,hash]of pins){const code=await rpc.getCode({address:target,blockNumber:head.number});requireNft(code&&same(keccak256(code),hash));}
  const get=<T>(target:Address,abi:readonly unknown[],fn:string)=>nftRead<T>(rpc,target,abi,fn,[],head.number);
  const [chain,core,coreHash,venue,venueHash,payment,paymentHash,creator,project,deployer,production,originalCurve,receipt,block]=await Promise.all([
    get<bigint>(m.vault,nftVaultAbi,"deploymentChainId"),get<Address>(m.vault,nftVaultAbi,"coreFactory"),get<Hex>(m.vault,nftVaultAbi,"coreFactoryHash"),get<Address>(m.vault,nftVaultAbi,"venue"),get<Hex>(m.vault,nftVaultAbi,"venueHash"),
    get<Address>(m.vault,nftVaultAbi,"paymentToken"),get<Hex>(m.vault,nftVaultAbi,"paymentTokenHash"),get<Address>(m.vault,nftVaultAbi,"creator"),get<Address>(m.vault,nftVaultAbi,"projectToken"),get<Address>(m.vault,nftVaultAbi,"deploymentFactory"),get<boolean>(m.vault,nftVaultAbi,"productionExecutionAvailable"),
    nftRead<Address>(rpc,m.coreFactory,parseAbi(["function originCurveForToken(address) view returns(address)"]),"originCurveForToken",[m.projectToken],head.number),
    rpc.getTransactionReceipt({hash:m.deployment.transactionHash}),rpc.getBlock({blockNumber:BigInt(m.deployment.blockNumber)})]);
  requireNft(chain===31337n&&same(core,m.coreFactory)&&same(coreHash,m.coreFactoryRuntimeHash)&&same(venue,m.venue)&&same(venueHash,m.venueRuntimeHash)&&same(payment,m.paymentToken)&&same(paymentHash,m.paymentTokenRuntimeHash)
    &&same(creator,m.creator)&&same(project,m.projectToken)&&same(deployer,m.factory)&&production===false&&nftAddress(originalCurve)&&receipt.status==="success"&&same(receipt.to!,m.factory)&&receipt.blockNumber===BigInt(m.deployment.blockNumber)&&same(receipt.blockHash,m.deployment.blockHash)&&same(block.hash!,receipt.blockHash));
  const created=parseEventLogs({abi:nftFactoryAbi,eventName:"VaultCreated",logs:receipt.logs.filter(l=>same(l.address,m.factory)),strict:true});
  const birth=created[0]?.args as unknown as {vault:Address;creator:Address;projectToken:Address};requireNft(created.length===1&&same(birth.vault,m.vault)&&same(birth.creator,m.creator)&&same(birth.projectToken,m.projectToken));
  for(const c of m.collections){const code=await rpc.getCode({address:c.address,blockNumber:head.number});requireNft(code&&same(keccak256(code),c.runtimeHash));}
  return{rpc,head};
}
export async function readNftAcquisitionSnapshot(config:NftAcquisitionFixture,context?:Awaited<ReturnType<typeof verifyNftAcquisitionContext>>):Promise<NftAcquisitionSnapshot>{
  const{rpc,head}=context??await verifyNftAcquisitionContext(config),m=config.module;
  const get=<T>(fn:string,args:readonly unknown[]=[])=>nftRead<T>(rpc,m.vault,nftVaultAbi,fn,args,head.number);
  const [controller,ce,pe,enabled,policy,nativeReserve,tokenReserve,nativeSpent,tokenSpent]=await Promise.all([get<Address>("controller"),get<bigint>("controllerEpoch"),get<bigint>("policyEpoch"),get<boolean>("purchasesEnabled"),
    get<readonly[Address,bigint,bigint,bigint,number]>("policy"),get<bigint>("available",[zeroAddress]),get<bigint>("available",[m.paymentToken]),get<bigint>("totalSpent",[zeroAddress]),get<bigint>("totalSpent",[m.paymentToken])]);
  const logs=await rpc.getLogs({address:m.vault,events:nftVaultAbi.filter(e=>e.type==="event"),fromBlock:BigInt(m.deployment.blockNumber),toBlock:head.number});requireNft(logs.length<=512&&head.number-BigInt(m.deployment.blockNumber)<=4096n);
  const purchases=parseEventLogs({abi:nftVaultAbi,eventName:"PurchaseExecuted",logs,strict:true});requireNft(purchases.length<=128);
  const identities=new Map<string,{collection:Address;standard:721|1155;tokenId:string}>();
  for(const log of purchases){const args=log.args as unknown as {collection:Address;tokenId:bigint};const collection=m.collections.find(c=>same(c.address,args.collection));requireNft(collection);identities.set(`${collection.address}:${args.tokenId}`,{collection:collection.address,standard:collection.standard,tokenId:String(args.tokenId)});}
  const custody:NftAcquisitionSnapshot["custody"]=[];
  for(const c of identities.values()){const held=await get<bigint>("nftHeld",[c.collection,BigInt(c.tokenId)]);
    if(held===0n)continue;const actual=c.standard===721?(same(await nftRead<Address>(rpc,c.collection,nft721Abi,"ownerOf",[BigInt(c.tokenId)],head.number),m.vault)?1n:0n):await nftRead<bigint>(rpc,c.collection,nft1155Abi,"balanceOf",[m.vault,BigInt(c.tokenId)],head.number);
    requireNft(actual===held);custody.push({...c,quantity:String(held),status:"verified"});}
  let history:NftAcquisitionSnapshot["history"]={indexed:false,status:"unavailable"};
  try{const url=new URL("/nft-acquisitions",config.curve.indexerUrl);url.searchParams.set("vault",m.vault);
    const response=await fetch(url,{headers:{"x-rmt-fixture-key":process.env.RMT_CURVE_FIXTURE_READ_KEY!},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3000)});
    const text=await response.text();requireNft(text.length<=131072&&response.ok);const data=JSON.parse(text);
    requireNft(data.profile===nftAcquisitionProfile&&data.chainId===31337&&same(data.vault,m.vault)&&same(data.projectToken,m.projectToken)&&data.productionExecution===false&&nftPoint(data.checkpoint)&&BigInt(data.checkpoint.blockNumber)<=head.number&&Array.isArray(data.states)&&Array.isArray(data.events));
    const checkpoint=await rpc.getBlock({blockNumber:BigInt(data.checkpoint.blockNumber)});requireNft(same(checkpoint.hash!,data.checkpoint.blockHash));history={indexed:data.status==="ready",status:data.status==="ready"?"ready":"pending",checkpoint:data.checkpoint};
  }catch{ /* unavailable indexing never removes chain evidence or invents finality */ }
  return{schemaVersion:1,profile:nftAcquisitionProfile,chainId:31337,scope:"isolated-local",executionEnabled:false,status:"ready",vault:m.vault,runtimeHash:m.vaultRuntimeHash,projectToken:m.projectToken,creator:m.creator,controller,controllerEpoch:String(ce),policyEpoch:String(pe),controllerKind:await projectTreasuryControllerKind(rpc,controller,head.number),venue:m.venue,venueRuntimeHash:m.venueRuntimeHash,paymentToken:m.paymentToken,collections:m.collections,enabled,
    policy:{currency:policy[0],perNftCap:String(policy[1]),totalBudget:String(policy[2]),periodBudget:String(policy[3]),cooldownSeconds:String(policy[4])},nativeReserveWei:String(nativeReserve),tokenReserveWei:String(tokenReserve),nativeSpentWei:String(nativeSpent),tokenSpentWei:String(tokenSpent),custody,history,observed:nftAcquisitionPoint(head),
    notices:["Synthetic chain 31337 only. This listing adapter cannot deploy on 4663.","Settled manual funds only; original V1 fee entitlements are unchanged.","Collection identity is separate from listing verification and route support."]};
}
