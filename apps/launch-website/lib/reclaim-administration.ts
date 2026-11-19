import type {Address,Hex} from "viem";
import {reclaimAddress,reclaimHash,sameReclaimHex,type ReclaimOperation} from "./reclaim";

export const reclaimAdministrationProfile="rmt-reclaim-administration-policy-v1";
export type ReclaimAdministrationPolicy={schemaVersion:1;profile:typeof reclaimAdministrationProfile;scope:"isolated-local";chainId:31337;
  reclaimFactory:Address;factoryRuntimeHash:Hex;authorizedControllers:{address:Address;runtimeHash:Hex}[]};
export type ReclaimAdministrationIdentity={address:Address;runtimeHash:Hex;kind:"eoa"|"metamask-7702"|"safe-1.4.1";owners:Address[]};
export type ReclaimAdministrationEvidence={status:"unassigned"|"verified"|"unavailable";controller:ReclaimAdministrationIdentity|null;
  incoming:ReclaimAdministrationIdentity&{ready:boolean}|null};
export const reclaimAdministrationOperation=(operation:ReclaimOperation)=>!["redeem","approve-721","approve-1155","revoke-1155"].includes(operation);
export function validReclaimAdministrationPolicy(value:unknown,factory:Address,runtimeHash:Hex):value is ReclaimAdministrationPolicy{
  try{
    const p=value as ReclaimAdministrationPolicy;
    return !!p&&Object.keys(p).length===7&&p.schemaVersion===1&&p.profile===reclaimAdministrationProfile&&p.scope==="isolated-local"&&p.chainId===31337
      &&reclaimAddress(p.reclaimFactory)&&sameReclaimHex(p.reclaimFactory,factory)&&reclaimHash(p.factoryRuntimeHash)&&sameReclaimHex(p.factoryRuntimeHash,runtimeHash)
      &&Array.isArray(p.authorizedControllers)&&p.authorizedControllers.length>=1&&p.authorizedControllers.length<=8
      &&p.authorizedControllers.every(c=>!!c&&Object.keys(c).length===2&&reclaimAddress(c.address)&&reclaimHash(c.runtimeHash))
      &&new Set(p.authorizedControllers.map(c=>c.address.toLowerCase()+":"+c.runtimeHash.toLowerCase())).size===p.authorizedControllers.length;
  }catch{return false;}
}
export function reclaimAdministrationWallet(identity:ReclaimAdministrationIdentity|null|undefined,actor:string,wallet:string):boolean{
  if(!identity||!reclaimAddress(actor)||!reclaimAddress(wallet)||!sameReclaimHex(identity.address,actor))return false;
  return identity.kind==="safe-1.4.1"?identity.owners.some(owner=>sameReclaimHex(owner,wallet)):sameReclaimHex(actor,wallet);
}
export function validReclaimAdministrationEvidence(value:unknown):value is ReclaimAdministrationEvidence{
  try{
    const e=value as ReclaimAdministrationEvidence;
    const identity=(v:ReclaimAdministrationIdentity)=>!!v&&reclaimAddress(v.address)&&reclaimHash(v.runtimeHash)
      &&["eoa","metamask-7702","safe-1.4.1"].includes(v.kind)&&Array.isArray(v.owners)&&v.owners.every(reclaimAddress)
      &&(v.kind==="safe-1.4.1"?v.owners.length===3&&new Set(v.owners.map(a=>a.toLowerCase())).size===3:v.owners.length===0);
    return !!e&&Object.keys(e).length===3&&["unassigned","unavailable","verified"].includes(e.status)
      &&(e.status==="verified"?identity(e.controller!)&&(e.incoming===null||identity(e.incoming)&&typeof e.incoming.ready==="boolean"):e.controller===null&&e.incoming===null);
  }catch{return false;}
}
