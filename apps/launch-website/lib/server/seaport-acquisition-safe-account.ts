import {keccak256,parseAbi,type Address,type Hex,type PublicClient} from "viem";
import {readSeaportRawAccountCode} from "../../../../packages/launchpad-common/seaport-vault-account-code.mjs";
import {readSeaportSafeState,type SeaportSafeState} from "../../../../packages/launchpad-common/seaport-vault-safe.mjs";
import {claimDelegatePin} from "../claim-profiles";
export type SeaportSafeAccount={kind:"eoa"|"metamask-7702";code:Hex}|{kind:"safe-1.4.1";code:Hex;state:SeaportSafeState};
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
/** Task084-only role corroboration. A decoded missing result is never EOA
 * evidence; the protected legacy classifier remains unchanged. */
export async function readSeaportSafeAccount(rpc:PublicClient,address:Address,block:bigint|"pending"):Promise<SeaportSafeAccount>{
 if(await rpc.getChainId()!==31337)throw Error("Local Safe account chain unavailable");
 const code=await readSeaportRawAccountCode(rpc,address,block);
 if(code==="0x")return{kind:"eoa",code};
 if(same(code,claimDelegatePin.designator)){
  const delegate=await readSeaportRawAccountCode(rpc,claimDelegatePin.address,block);
  if(!same(keccak256(delegate),claimDelegatePin.runtimeHash))throw Error("Known delegation runtime unavailable");
  return{kind:"metamask-7702",code};
 }
 const state=await readSeaportSafeState(rpc,address,block,{parseAbi,keccak256});
 if(!same(keccak256(code),state.runtimeHash))throw Error("Exact Safe runtime unavailable");
 return{kind:"safe-1.4.1",code,state};
}
