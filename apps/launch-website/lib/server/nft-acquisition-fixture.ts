import {readFileSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {concatHex,decodeFunctionData,encodeFunctionData,erc20Abi,getAddress,keccak256,parseAbi,parseEventLogs,zeroAddress,type Address,type Hex} from "viem";
import {materializeNftAcquisitionRuntime,nftAcquisitionFactorySignatures,nftAcquisitionVaultSignatures,nftAcquisitionVenueSignatures} from "../../../../packages/launchpad-common/nft-acquisition-runtime.mjs";
import {nftAcquisitionFixtureFlag,nftAcquisitionProfile,nftAddress,nftHash,nftPoint,type NftAcquisitionCollection,type NftAcquisitionPoint,type NftAcquisitionSnapshot} from "../nft-acquisition";
import {configuredCurveFixture,fixtureRpc,verifyCurveFixture,sameHex as same,type CurveFixture} from "./curve-fixture";
import {projectTreasuryControllerKind} from "./project-treasury-fixture";

export const nftVaultAbi=parseAbi(nftAcquisitionVaultSignatures),nftFactoryAbi=parseAbi(nftAcquisitionFactorySignatures),nftVenueAbi=parseAbi(nftAcquisitionVenueSignatures);
export const nft721Abi=parseAbi(["function ownerOf(uint256) view returns(address)","function getApproved(uint256) view returns(address)","function isApprovedForAll(address,address) view returns(bool)","event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)"]);
export const nft1155Abi=parseAbi(["function balanceOf(address,uint256) view returns(uint256)","function isApprovedForAll(address,address) view returns(bool)","event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)"]);
export type NftAcquisitionDeployment={schemaVersion:1;profile:typeof nftAcquisitionProfile;chainId:31337;coreFactory:Address;coreFactoryRuntimeHash:Hex;
  factory:Address;factoryRuntimeHash:Hex;venue:Address;venueRuntimeHash:Hex;paymentToken:Address;paymentTokenRuntimeHash:Hex;
  projectToken:Address;creator:Address;vault:Address;vaultRuntimeHash:Hex;collections:(NftAcquisitionCollection&{slug?:string})[];
  deployment:NftAcquisitionPoint&{transactionHash:Hex};compilerInputSha256:string;
  vaultCreationCode:Hex;vaultRuntimeTemplate:Hex;vaultImmutableReferences:Record<string,{start:number;length:number}[]>;vaultImmutableNames:Record<string,string>;
  factoryRuntimeTemplate:Hex;factoryImmutableReferences:Record<string,{start:number;length:number}[]>;factoryImmutableNames:Record<string,string>};
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
      ||new Set(m.collections.map(c=>c.address.toLowerCase())).size!==m.collections.length
      ||![m.vaultCreationCode,m.vaultRuntimeTemplate,m.factoryRuntimeTemplate].every(code=>typeof code==="string"&&/^0x(?:[0-9a-f]{2}){4,49152}$/i.test(code))
      ||![m.vaultImmutableReferences,m.vaultImmutableNames,m.factoryImmutableReferences,m.factoryImmutableNames].every(v=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).length>0&&Object.keys(v).length<=32))return null;
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
  const birth=created[0]?.args as unknown as {vault:Address;creator:Address;projectToken:Address;controller:Address;intent:Hex};requireNft(created.length===1&&same(birth.vault,m.vault)&&same(birth.creator,m.creator)&&same(birth.projectToken,m.projectToken));
  const factoryGet=<T>(fn:string,args:readonly unknown[]=[])=>nftRead<T>(rpc,m.factory,nftFactoryAbi,fn,args,head.number);
  const curveAbi=parseAbi(["function creator() view returns(address)","function token() view returns(address)","function factory() view returns(address)"]);
  const [fChain,fCore,fCoreHash,fTokenHash,fVenue,fVenueHash,fPayment,fPaymentHash,part1,part2,vaultDeployer,creationHash,vaultOrigin,vaultIntent,curveCreator,curveToken,curveFactory,tokenCode,vaultTokenHash,mapped,predicted,birthController,creationTx]=await Promise.all([
    factoryGet<bigint>("deploymentChainId"),factoryGet<Address>("coreFactory"),factoryGet<Hex>("coreFactoryHash"),factoryGet<Hex>("tokenRuntimeHash"),factoryGet<Address>("venue"),factoryGet<Hex>("venueHash"),factoryGet<Address>("paymentToken"),factoryGet<Hex>("paymentTokenHash"),
    factoryGet<Address>("creationPart1"),factoryGet<Address>("creationPart2"),factoryGet<Address>("vaultDeployer"),factoryGet<Hex>("vaultCreationCodeHash"),get<Address>(m.vault,nftVaultAbi,"originCurve"),get<Hex>(m.vault,nftVaultAbi,"intentId"),
    get<Address>(originalCurve,curveAbi,"creator"),get<Address>(originalCurve,curveAbi,"token"),get<Address>(originalCurve,curveAbi,"factory"),rpc.getCode({address:m.projectToken,blockNumber:head.number}),get<Hex>(m.vault,nftVaultAbi,"tokenRuntimeHash"),
    factoryGet<Address>("vaultForIntent",[m.creator,birth.intent]),factoryGet<Address>("predict",[m.creator,m.projectToken,birth.controller,birth.intent]),nftRead<Address>(rpc,m.vault,nftVaultAbi,"controller",[],receipt.blockNumber),rpc.getTransaction({hash:m.deployment.transactionHash})]);
  requireNft(fChain===31337n&&same(fCore,m.coreFactory)&&same(fCoreHash,m.coreFactoryRuntimeHash)&&same(fVenue,m.venue)&&same(fVenueHash,m.venueRuntimeHash)&&same(fPayment,m.paymentToken)&&same(fPaymentHash,m.paymentTokenRuntimeHash)
    &&same(vaultOrigin,originalCurve)&&same(vaultIntent,birth.intent)&&same(curveCreator,m.creator)&&same(curveToken,m.projectToken)&&same(curveFactory,m.coreFactory)&&tokenCode&&same(keccak256(tokenCode),fTokenHash)&&same(fTokenHash,vaultTokenHash)
    &&same(mapped,m.vault)&&same(predicted,m.vault)&&same(birthController,birth.controller)&&same(creationHash,keccak256(m.vaultCreationCode)));
  const [part1Code,part2Code,fCode,vCode,birthVCode]=await Promise.all([rpc.getCode({address:part1,blockNumber:head.number}),rpc.getCode({address:part2,blockNumber:head.number}),rpc.getCode({address:m.factory,blockNumber:head.number}),rpc.getCode({address:m.vault,blockNumber:head.number}),rpc.getCode({address:m.vault,blockNumber:receipt.blockNumber})]);
  requireNft(part1Code?.startsWith("0x00")&&part2Code?.startsWith("0x00")&&same(concatHex([("0x"+part1Code.slice(4))as Hex,("0x"+part2Code.slice(4))as Hex]),m.vaultCreationCode));
  const common={coreFactory:m.coreFactory,coreFactoryHash:m.coreFactoryRuntimeHash,tokenRuntimeHash:fTokenHash,venue:m.venue,venueHash:m.venueRuntimeHash,paymentToken:m.paymentToken,paymentTokenHash:m.paymentTokenRuntimeHash,deploymentChainId:31337};
  const expectedFactory=materializeNftAcquisitionRuntime(m.factoryRuntimeTemplate,m.factoryImmutableReferences,m.factoryImmutableNames,{...common,vaultDeployer,creationPart1:part1,creationPart2:part2,vaultCreationCodeHash:creationHash});
  const expectedVault=materializeNftAcquisitionRuntime(m.vaultRuntimeTemplate,m.vaultImmutableReferences,m.vaultImmutableNames,{...common,creator:m.creator,projectToken:m.projectToken,intentId:birth.intent,deploymentFactory:m.factory,originCurve:originalCurve});
  requireNft(fCode&&vCode&&birthVCode&&same(fCode,expectedFactory)&&same(vCode,expectedVault)&&same(birthVCode,expectedVault)&&same(keccak256(expectedFactory),m.factoryRuntimeHash)&&same(keccak256(expectedVault),m.vaultRuntimeHash));
  const decoded=decodeFunctionData({abi:nftFactoryAbi,data:creationTx.input});requireNft(decoded.functionName==="create"&&same(encodeFunctionData({abi:nftFactoryAbi,functionName:"create",args:[m.projectToken,birth.controller,birth.intent]}as never),creationTx.input)
    &&creationTx.type==="eip1559"&&!creationTx.authorizationList&&!creationTx.accessList?.length&&creationTx.chainId===31337&&same(creationTx.from,m.creator)&&same(creationTx.to!,m.factory)&&creationTx.value===0n
    &&same(receipt.transactionHash,m.deployment.transactionHash)&&receipt.blockNumber===creationTx.blockNumber&&receipt.transactionIndex===creationTx.transactionIndex&&same(creationTx.blockHash!,receipt.blockHash)&&same(block.transactions[receipt.transactionIndex]as Hex,receipt.transactionHash)
    &&same(receipt.from,m.creator)&&same(receipt.to!,m.factory)&&receipt.logs.length<=128&&new Set(receipt.logs.map(l=>l.logIndex)).size===receipt.logs.length&&receipt.logs.every(l=>!l.removed&&same(l.transactionHash,receipt.transactionHash)&&same(l.blockHash,receipt.blockHash)&&l.blockNumber===receipt.blockNumber&&l.transactionIndex===receipt.transactionIndex)
    &&created[0].blockNumber===receipt.blockNumber&&same(created[0].transactionHash!,receipt.transactionHash)&&same(created[0].blockHash!,receipt.blockHash));
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
