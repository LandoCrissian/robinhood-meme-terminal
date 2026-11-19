import {readFileSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {keccak256,parseAbi,type Address} from "viem";
import {validReclaimAdministrationPolicy,type ReclaimAdministrationPolicy,type ReclaimAdministrationIdentity,type ReclaimAdministrationEvidence} from "../reclaim-administration";
import {sameReclaimHex as same,type ReclaimFields,type ReclaimOperation} from "../reclaim";
import {projectTreasuryControllerKind} from "./project-treasury-fixture";
import {reclaimCampaignAbi,reclaimRead,requireReclaim,verifyReclaimContext,type ReclaimDeployment,type ReclaimFixture,type ReclaimHead,type ReclaimRpc} from "./reclaim-fixture";

const safeAbi=parseAbi(["function getOwners() view returns(address[])","function getThreshold() view returns(uint256)"]);
export function configuredReclaimAdministration(module:ReclaimDeployment):ReclaimAdministrationPolicy|null{
  try{
    const file=process.env.RMT_RECLAIM_ADMIN_POLICY;
    if(!file||!isAbsolute(file)||statSync(file).size>8192)return null;
    const value=JSON.parse(readFileSync(file,"utf8"));return validReclaimAdministrationPolicy(value,module.reclaimFactory,module.factoryRuntimeHash)?value:null;
  }catch{return null;}
}
export function requireReclaimAdministrationPolicy(config:ReclaimFixture){
  requireReclaim(validReclaimAdministrationPolicy(config.administration,config.module.reclaimFactory,config.module.factoryRuntimeHash),"Reclaim dashboard administration is unassigned or unavailable");
  return config.administration;
}
export async function admittedReclaimController(config:ReclaimFixture,rpc:ReclaimRpc,head:ReclaimHead,actor:Address):Promise<ReclaimAdministrationIdentity>{
  const policy=requireReclaimAdministrationPolicy(config),entries=policy.authorizedControllers.filter(c=>same(c.address,actor));
  requireReclaim(entries.length>0,"This controller is not explicitly admitted by the dashboard policy");
  const code=await rpc.getCode({address:actor,blockNumber:head.number});
  requireReclaim(code===undefined||typeof code==="string"&&/^0x(?:[a-f0-9]{2})*$/i.test(code));
  const runtimeHash=keccak256(code??"0x");requireReclaim(entries.some(entry=>same(entry.runtimeHash,runtimeHash)),"The admitted controller runtime changed");
  const kind=await projectTreasuryControllerKind(rpc,actor,head.number);requireReclaim(kind!=="unsupported","Unsupported controller account authority");
  const owners=kind==="safe-1.4.1"?await reclaimRead<Address[]>(rpc,actor,safeAbi,"getOwners",[],head.number):[];
  return{address:actor,runtimeHash,kind,owners};
}
export async function authorizeReclaimAdministration(config:ReclaimFixture,rpc:ReclaimRpc,head:ReclaimHead,actor:Address,campaign:Address,
  operation:ReclaimOperation,fields:ReclaimFields,controller:Address){
  await admittedReclaimController(config,rpc,head,actor);
  if(operation==="create-campaign"){
    await admittedReclaimController(config,rpc,head,fields.controller as Address);return;
  }
  await admittedReclaimController(config,rpc,head,controller);
  const actual=await reclaimRead<Address>(rpc,campaign,reclaimCampaignAbi,"controller",[],head.number);
  requireReclaim(same(actual,controller),"Canonical campaign controller changed");
  if(operation==="accept-controller"){
    const pending=await reclaimRead<readonly[Address,number,number,bigint]>(rpc,campaign,reclaimCampaignAbi,"pendingController",[],head.number);
    const epoch=await reclaimRead<bigint>(rpc,campaign,reclaimCampaignAbi,"controllerEpoch",[],head.number);
    requireReclaim(same(pending[0],actor)&&pending[1]>0&&head.timestamp>=BigInt(pending[1])&&head.timestamp<=BigInt(pending[2])&&pending[3]===epoch,
      "Incoming controller, notice or controller epoch is not current");
  }else requireReclaim(same(actual,actor),"Only the admitted current controller may administer this campaign through RMT");
  if(operation==="propose-controller")await admittedReclaimController(config,rpc,head,fields.next as Address);
}
export async function reclaimAdministrationEvidence(config:ReclaimFixture,rpc:ReclaimRpc,head:ReclaimHead,campaign:Address,controller:Address):Promise<ReclaimAdministrationEvidence>{
  if(!config.administration)return{status:"unassigned",controller:null,incoming:null};
  try{
    const identity=await admittedReclaimController(config,rpc,head,controller);
    const pending=await reclaimRead<readonly[Address,number,number,bigint]>(rpc,campaign,reclaimCampaignAbi,"pendingController",[],head.number);
    let incoming:ReclaimAdministrationEvidence["incoming"]=null;
    if(pending[1]>0&&head.timestamp<=BigInt(pending[2]))try{
      const epoch=await reclaimRead<bigint>(rpc,campaign,reclaimCampaignAbi,"controllerEpoch",[],head.number);
      if(pending[3]===epoch)incoming={...await admittedReclaimController(config,rpc,head,pending[0]),ready:head.timestamp>=BigInt(pending[1])};
    }catch{/* An unadmitted pending address never acquires dashboard privileges. */}
    return{status:"verified",controller:identity,incoming};
  }catch{return{status:"unavailable",controller:null,incoming:null};}
}
export async function reclaimAdministrationCreators(config:ReclaimFixture):Promise<Address[]>{
  if(!config.administration)return[];
  try{
    const{rpc,head}=await verifyReclaimContext(config),identities=await Promise.all(config.administration.authorizedControllers.map(entry=>admittedReclaimController(config,rpc,head,entry.address)));
    return[...new Set(identities.filter(identity=>identity.kind!=="safe-1.4.1").map(identity=>identity.address))];
  }catch{return[];}
}
