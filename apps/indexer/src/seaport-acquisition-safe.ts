import {keccak256,parseAbi,type Address,type PublicClient} from "viem";
import {reclaimCallerPins} from "./reclaim-fixture-origin.js";
const abi=parseAbi(["function VERSION() view returns(string)","function masterCopy() view returns(address)","function getOwners() view returns(address[])","function getThreshold() view returns(uint256)","function getModulesPaginated(address,uint256) view returns(address[],address)"]);
const same=(a:unknown,b:unknown)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
/** This admits only the already reviewed canonical Safe1.4.1 signature path.
 * An arbitrary proxy, token implementation or delegate frame is unsupported. */
export async function seaportSafeSellerDelegates(rpc:PublicClient,seller:Address,height:bigint){
 const before=height-1n,code=await rpc.getCode({address:seller,blockNumber:before});if(!code||code==="0x")return[];
 if(!same(keccak256(code),reclaimCallerPins.safeProxyHash))throw Error("Seaport V2 seller wallet unsupported");
 let ownerIdentity:string|undefined;
 for(const blockNumber of[before,height]){
  const current=await rpc.getCode({address:seller,blockNumber}),singleton=await rpc.getCode({address:reclaimCallerPins.singleton,blockNumber}),handler=await rpc.getCode({address:reclaimCallerPins.handler,blockNumber});
  if(!same(current,code)||!singleton||!same(keccak256(singleton),reclaimCallerPins.singletonHash)||!handler||!same(keccak256(handler),reclaimCallerPins.handlerHash))throw Error("Seaport V2 Safe source/runtime changed");
  const read=async(name:string,args:readonly unknown[]=[])=>rpc.readContract({address:seller,abi,functionName:name,args,blockNumber}as never);
  const[version,master,owners,threshold,modules,guard,handlerSlot]=await Promise.all([read("VERSION"),read("masterCopy"),read("getOwners"),read("getThreshold"),read("getModulesPaginated",["0x0000000000000000000000000000000000000001",1n]),rpc.getStorageAt({address:seller,blockNumber,slot:"0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8"}),rpc.getStorageAt({address:seller,blockNumber,slot:"0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5"})]);
  if(version!=="1.4.1"||!same(master,reclaimCallerPins.singleton)||threshold!==2n||!Array.isArray(owners)||owners.length!==3||new Set(owners.map(x=>String(x).toLowerCase())).size!==3||!Array.isArray(modules)||!Array.isArray(modules[0])||modules[0].length!==0||!same(modules[1],"0x0000000000000000000000000000000000000001")||!guard||!/^0x0{64}$/.test(guard)||!handlerSlot||!same("0x"+handlerSlot.slice(-40),reclaimCallerPins.handler))throw Error("Seaport V2 Safe authority unavailable");
  const identity=JSON.stringify(owners.map(x=>String(x).toLowerCase()));if(ownerIdentity&&ownerIdentity!==identity)throw Error("Seaport V2 Safe authority changed");ownerIdentity=identity;
  for(const owner of owners){if(typeof owner!=="string"||!/^0x[a-f0-9]{40}$/i.test(owner)||BigInt(owner)<=0xffffn||(await rpc.getCode({address:owner as Address,blockNumber})??"0x")!=="0x")throw Error("Seaport V2 Safe owner unsupported");}
 }
 return[{proxy:seller,singleton:reclaimCallerPins.singleton}];
}
