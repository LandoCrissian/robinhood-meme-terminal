import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import test from "node:test";
import {encodeAbiParameters, encodeEventTopics, encodeFunctionData, getContractAddress, getCreate2Address, keccak256, parseAbi, zeroAddress, type Address, type Hex} from "viem";
import templates from "./production-project-templates.json";
import {materializeProductionProjectRuntimes, proveProductionProjectBirth, readProductionProjectBirthCode,
  verifyProductionProjectRuntimes, type ProductionProjectPolicy} from "./production-project-birth";
import {productionBootstrap} from "./production-birth";
import {curveProductionDeployment as d, curveProductionPins as pins} from "./curve-production";
import {productionEarningsContext, type EarningsRpc, type EarningsRegistration} from "./earnings-contracts";
import {testCreationSignature} from "../test-creation";
import {launchTokenSupplyWei} from "../launch-terms";
const hash=(n:number)=>`0x${n.toString(16).padStart(64,"0")}` as Hex;
const address=(n:number)=>`0x${((1n<<156n)+BigInt(n)).toString(16).padStart(40,"0")}` as Address;
const abi=parseAbi([testCreationSignature,
  "event CurveCreated(address indexed token,address indexed curve,address indexed creator,bytes32 intentId,uint256 supply,address revenueLedger,address treasury,uint16 treasuryShareBps,string name,string symbol,string projectURI)",
  "event CreationFeePaid(address indexed token,address indexed creator,address indexed recipient,uint256 fee,uint256 refund)"]);
const metadata=(directory:string,name:string)=>JSON.parse(gunzipSync(readFileSync(new URL(`../../../../docs/evidence/rmt-task092/source/${directory}/${name}.metadata.json.gz`,import.meta.url))).toString());
const bootstrap=metadata("current","RMTLaunchCurveDeploymentV2");
const codes=new Map<string,Hex>([[productionBootstrap.address.toLowerCase(),bootstrap.deployed_bytecode],
  [pins.factory[0].toLowerCase(),metadata("current-tail","RMTLaunchCurveFactoryV2").deployed_bytecode],
  [pins.engine[0].toLowerCase(),metadata("current-tail","RMTV4CurveGraduationV1").deployed_bytecode],
  [pins.guard[0].toLowerCase(),metadata("current","RMTV4CurveInitializationGuardV1").deployed_bytecode]]);
function fixture(){
 const policy:ProductionProjectPolicy={curve:address(10),creator:address(11),treasury:zeroAddress,treasuryShareBps:0,
  operatingRecipient:d.operating,futureReserveRecipient:d.reserve};
 const name="Synthetic old project",symbol="OLD",projectURI="",intentId=hash(12),born=d.blockNumber+100n,checkpoint=born+30n,timestamp=1795210000n;
 const salt=keccak256(encodeAbiParameters([{type:"address"},{type:"bytes32"}],[policy.creator,intentId]));
 const initcode=`${templates.templates.RMTLaunchCurveTokenV2.creationBytecode}${encodeAbiParameters([{type:"string"},{type:"string"}],[name,symbol]).slice(2)}` as Hex;
 const token=getCreate2Address({from:pins.factory[0],salt,bytecode:initcode}),ledger=getContractAddress({from:policy.curve,nonce:1n});
 const runtime=materializeProductionProjectRuntimes(policy);
 const point={blockNumber:String(checkpoint),blockHash:hash(20),timestamp:new Date(Number(timestamp+30n)*1000).toISOString()};
 const registration:EarningsRegistration={chainId:4663,factory:pins.factory[0],projectRegistry:pins.registry[0],token,initialCurve:policy.curve,revenueLedger:ledger,
  creator:policy.creator,treasury:null,treasuryShareBps:0,totalSupplyWei:String(launchTokenSupplyWei),
  creation:{blockNumber:String(born),blockHash:hash(21),timestamp:new Date(Number(timestamp)*1000).toISOString(),transactionHash:hash(22),logIndex:2}};
 const transaction={chainId:4663,hash:hash(22),from:policy.creator,to:pins.factory[0] as Address,nonce:1,value:d.creationFeeWei as bigint,
  input:encodeFunctionData({abi,functionName:"create",args:[name,symbol,projectURI,zeroAddress,0,intentId,timestamp+300n]}),
  blockNumber:born,blockHash:hash(21),transactionIndex:0};
 const log=(logIndex:number,topics:readonly Hex[],data:Hex)=>({address:pins.factory[0],logIndex,topics,data,blockNumber:born,blockHash:hash(21),transactionHash:hash(22),transactionIndex:0,removed:false});
 const receipt={status:"success",transactionHash:hash(22),from:policy.creator,to:pins.factory[0],blockNumber:born,blockHash:hash(21),transactionIndex:0,logs:[
  log(2,encodeEventTopics({abi,eventName:"CurveCreated",args:{token,curve:policy.curve,creator:policy.creator}}) as Hex[],encodeAbiParameters(
    [{type:"bytes32"},{type:"uint256"},{type:"address"},{type:"address"},{type:"uint16"},{type:"string"},{type:"string"},{type:"string"}],
    [intentId,launchTokenSupplyWei,ledger,zeroAddress,0,name,symbol,projectURI])),
  log(3,encodeEventTopics({abi,eventName:"CreationFeePaid",args:{token,creator:policy.creator,recipient:d.operating}}) as Hex[],encodeAbiParameters([{type:"uint256"},{type:"uint256"}],[d.creationFeeWei,0n])),
 ]};
 const knobs={reorg:false,wrongFactory:false};
 const rpc={getChainId:async()=>4663,
  getTransaction:async({hash:h}:{hash:Hex})=>h===d.transactionHash?{hash:h,chainId:4663,to:null,from:productionBootstrap.sender,nonce:482,value:0n,input:bootstrap.creation_bytecode,
   blockNumber:d.blockNumber,blockHash:d.blockHash,transactionIndex:0}:transaction,
  getTransactionReceipt:async({hash:h}:{hash:Hex})=>h===d.transactionHash?{transactionHash:h,status:"success",contractAddress:productionBootstrap.address,blockNumber:d.blockNumber,blockHash:d.blockHash,transactionIndex:0}:receipt,
  getBlock:async({blockNumber:b}:{blockNumber:bigint})=>({number:b,hash:b===d.blockNumber?d.blockHash:b===born?(knobs.reorg?hash(99):hash(21)):point.blockHash,
    timestamp:b===born?timestamp:timestamp+30n,transactions:b===d.blockNumber?[d.transactionHash]:b===born?[hash(22)]:[]}),
  getCode:async({address:a}:{address:string})=>knobs.wrongFactory?"0x6000":codes.get(a.toLowerCase()),
  readContract:async({functionName}:{functionName:string})=>functionName==="factory"?pins.factory[0]:functionName==="graduationEngine"?pins.engine[0]:pins.guard[0],
 } as unknown as EarningsRpc;
 const context=productionEarningsContext(rpc,point);
 return{policy,runtime,registration,transaction,receipt,knobs,rpc,context};
}
test("compiler-derived public templates retain exact canonical bytecode and only six revenue immutable fields",()=>{
 const report=JSON.parse(readFileSync(new URL("../../../../docs/evidence/rmt-task092/source/project-template-reproduction.json",import.meta.url)).toString());
 assert.equal(createHash("sha256").update(readFileSync(new URL("production-project-templates.json",import.meta.url))).digest("hex"),report.artifactSha256);
 assert.deepEqual(Object.keys(templates.templates.RMTLaunchCurveTokenV2.immutableOffsets),[]);
 assert.deepEqual(Object.keys(templates.templates.RMTLaunchCurveRevenueLedgerV1.immutableOffsets).sort(),["curve","creator","treasury","treasuryShareBps","operatingRecipient","futureReserveRecipient"].sort());
 assert.equal(report.canonicalInputSha256,d.compilerInputSha256);assert.equal(report.networkRequests,0);
});
test("only exact typed pruning selects project proof; empty/wrong code and outages are not substituted",async()=>{
 const f=fixture();
 for(const value of [undefined,"0x","0x6000"]){const rpc={getCode:async()=>value} as unknown as EarningsRpc;assert.deepEqual(await readProductionProjectBirthCode(rpc,address(1),1n),{pruned:false,code:value});}
 const error=Object.assign(new Error("historical state "+"a".repeat(64)+" is not available"),{code:-32000});
 assert.deepEqual(await readProductionProjectBirthCode({getCode:async()=>{throw error;}} as unknown as EarningsRpc,address(1),1n),{pruned:true,code:undefined});
 for(const e of [new Error("timeout"),Object.assign(new Error(error.message),{status:403}),Object.assign(new Error(error.message),{code:-32001})])await assert.rejects(readProductionProjectBirthCode({getCode:async()=>{throw e;}} as unknown as EarningsRpc,address(1),1n));
 assert.throws(()=>verifyProductionProjectRuntimes("0x6000",f.runtime.ledger,f.policy));
 assert.throws(()=>verifyProductionProjectRuntimes(f.runtime.token,f.runtime.ledger,{...f.policy,creator:address(99)}));
});
test("canonical original direct creation, CREATE2 token, CREATE1 ledger and current exact immutable runtimes prove aged project birth",async()=>{
 const f=fixture();await proveProductionProjectBirth(f.context,f.registration,f.runtime.token,f.runtime.ledger,f.policy);
});
test("reject changed transaction, receipt, source policy, deterministic addresses, code and canonicality",async()=>{
 const mutations:((f:ReturnType<typeof fixture>)=>void)[]=[f=>{f.transaction.to=address(99);},f=>{f.transaction.from=address(99);},f=>{f.transaction.chainId=31337;},
  f=>{f.transaction.value=0n;},f=>{f.transaction.input="0x00000000";},f=>{f.transaction.blockHash=hash(99);},f=>{f.transaction.nonce=-1;},
  f=>{f.receipt.blockHash=hash(99);},f=>{f.receipt.logs[0]!.removed=true;},f=>{f.receipt.logs[1]!.data="0x";},
  f=>{f.registration.token=address(99);},f=>{f.registration.revenueLedger=address(99);},f=>{f.policy.creator=address(99);},f=>{f.policy.operatingRecipient=address(99);},
  f=>{f.runtime.token="0x6000";},f=>{f.runtime.ledger="0x6000";},f=>{f.knobs.reorg=true;},f=>{f.knobs.wrongFactory=true;}];
 for(const mutate of mutations){const f=fixture();mutate(f);await assert.rejects(proveProductionProjectBirth(f.context,f.registration,f.runtime.token,f.runtime.ledger,f.policy));}
});
