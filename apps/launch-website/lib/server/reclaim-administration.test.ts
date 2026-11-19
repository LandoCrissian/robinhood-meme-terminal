import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,writeFileSync,rmSync,rmdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {keccak256,zeroAddress,type Address,type Hex} from "viem";
import {reclaimAdministrationOperation,reclaimAdministrationWallet,validReclaimAdministrationPolicy,validReclaimAdministrationEvidence,
  type ReclaimAdministrationPolicy} from "../reclaim-administration";
import {configuredReclaimAdministration,admittedReclaimController,authorizeReclaimAdministration,reclaimAdministrationEvidence} from "./reclaim-administration";
import type {ReclaimFixture,ReclaimHead,ReclaimRpc} from "./reclaim-fixture";
import {prepareReclaim} from "./reclaim-actions";

const address=(n:number)=>("0x"+(0x2000000000000000000000000000000000000000n+BigInt(n)).toString(16))as Address;
const hash=(n:number)=>("0x"+n.toString(16).padStart(64,"0"))as Hex;
const factory=address(1),controller=address(2),incoming=address(3),unrelated=address(4),campaign=address(5);
const policy=():ReclaimAdministrationPolicy=>({schemaVersion:1,profile:"rmt-reclaim-administration-policy-v1",scope:"isolated-local",chainId:31337,
  reclaimFactory:factory,factoryRuntimeHash:hash(1),authorizedControllers:[controller,incoming].map(address=>({address,runtimeHash:keccak256("0x")}))});
function fixture(){
  const config={module:{reclaimFactory:factory,factoryRuntimeHash:hash(1)},administration:policy()}as ReclaimFixture;
  const state={controller,epoch:7n,pending:[incoming,100,300,7n]as readonly[Address,number,number,bigint],code:new Map<Address,Hex>()};
  const rpc={getCode:async({address}:{address:Address})=>state.code.get(address),readContract:async({functionName}:{functionName:string})=>{
    if(functionName==="controller")return state.controller;if(functionName==="pendingController")return state.pending;if(functionName==="controllerEpoch")return state.epoch;
    throw Error("Unexpected mock read: "+functionName);
  }}as unknown as ReclaimRpc;
  const head={number:10n,timestamp:200n,hash:hash(10)}as ReclaimHead;return{config,state,rpc,head};
}

test("dashboard policy is explicit, bounded, deployment-bound and cannot infer a production owner",()=>{
  assert.ok(validReclaimAdministrationPolicy(policy(),factory,hash(1)));
  for(const value of[null,{}, {...policy(),chainId:4663},{...policy(),scope:"production"},{...policy(),reclaimFactory:unrelated},
    {...policy(),factoryRuntimeHash:hash(9)},{...policy(),authorizedControllers:[]},{...policy(),authorizedControllers:Array(9).fill(policy().authorizedControllers[0])},
    {...policy(),authorizedControllers:[...policy().authorizedControllers,policy().authorizedControllers[0]]},
    {...policy(),authorizedControllers:[{address:zeroAddress,runtimeHash:hash(1)}]},{...policy(),ownerOverride:true}])assert.equal(validReclaimAdministrationPolicy(value,factory,hash(1)),false);
  const before=process.env.RMT_RECLAIM_ADMIN_POLICY,folder=mkdtempSync(join(tmpdir(),"rmt-admin-policy-")),file=join(folder,"policy.json"),module=fixture().config.module;
  try{
    delete process.env.RMT_RECLAIM_ADMIN_POLICY;assert.equal(configuredReclaimAdministration(module),null);
    process.env.RMT_RECLAIM_ADMIN_POLICY="relative.json";assert.equal(configuredReclaimAdministration(module),null);
    process.env.RMT_RECLAIM_ADMIN_POLICY=file;writeFileSync(file,JSON.stringify(policy()));assert.deepEqual(configuredReclaimAdministration(module),policy());
    for(const text of["not-json"," ".repeat(8193),JSON.stringify({...policy(),chainId:4663})]){writeFileSync(file,text);assert.equal(configuredReclaimAdministration(module),null);}
  }finally{if(before===undefined)delete process.env.RMT_RECLAIM_ADMIN_POLICY;else process.env.RMT_RECLAIM_ADMIN_POLICY=before;rmSync(file);rmdirSync(folder);}
});

test("public surrender and NFT approvals stay separate from owner dashboard preparation",async()=>{
  for(const operation of["redeem","approve-721","approve-1155","revoke-1155"]as const)assert.equal(reclaimAdministrationOperation(operation),false);
  for(const operation of["create-campaign","fund","pause","execute-collection","cancel-rate","execute-recovery","accept-controller"]as const)assert.equal(reclaimAdministrationOperation(operation),true);
  const{config,rpc,head}=fixture();config.administration=null;
  assert.deepEqual(await reclaimAdministrationEvidence(config,rpc,head,campaign,controller),{status:"unassigned",controller:null,incoming:null});
  await assert.rejects(prepareReclaim(config,{operation:"pause",account:controller,campaign,fields:{}}),/unassigned/);
});

test("an admitted address alone cannot administer another campaign or bypass changed runtime",async()=>{
  const{config,rpc,head,state}=fixture();
  await authorizeReclaimAdministration(config,rpc,head,controller,campaign,"pause",{},controller);
  await assert.rejects(authorizeReclaimAdministration(config,rpc,head,unrelated,campaign,"pause",{},controller),/not explicitly admitted/);
  await assert.rejects(authorizeReclaimAdministration(config,rpc,head,incoming,campaign,"execute-collection",{},controller),/Only the admitted current/);
  state.controller=incoming;await assert.rejects(authorizeReclaimAdministration(config,rpc,head,controller,campaign,"fund",{amountWei:"1"},controller),/Canonical campaign controller changed/);
  state.controller=controller;state.code.set(controller,"0x6000");await assert.rejects(admittedReclaimController(config,rpc,head,controller),/runtime changed/);
  state.code.delete(controller);await assert.rejects(authorizeReclaimAdministration(config,rpc,head,controller,campaign,"propose-controller",{next:unrelated},controller),/not explicitly admitted/);
  await assert.rejects(authorizeReclaimAdministration(config,rpc,head,controller,campaign,"create-campaign",{controller:unrelated},unrelated),/not explicitly admitted/);
});

test("incoming controller acceptance requires both admitted identities plus the actual current notice and epoch",async()=>{
  const{config,rpc,head,state}=fixture();
  await authorizeReclaimAdministration(config,rpc,head,incoming,campaign,"accept-controller",{},controller);
  for(const pending of[[unrelated,100,300,7n],[incoming,201,300,7n],[incoming,100,199,7n],[incoming,100,300,6n],[incoming,0,300,7n]]as const){
    state.pending=pending;await assert.rejects(authorizeReclaimAdministration(config,rpc,head,incoming,campaign,"accept-controller",{},controller),/not current/);
  }
  state.pending=[incoming,100,300,7n];config.administration!.authorizedControllers=config.administration!.authorizedControllers.filter(entry=>entry.address!==controller);
  await assert.rejects(authorizeReclaimAdministration(config,rpc,head,incoming,campaign,"accept-controller",{},controller),/not explicitly admitted/);
});

test("dashboard evidence does not promote an unapproved controller, payer or arbitrary claimed Safe identity",async()=>{
  const{config,rpc,head,state}=fixture(),evidence=await reclaimAdministrationEvidence(config,rpc,head,campaign,controller);
  assert.equal(evidence.status,"verified");assert.ok(validReclaimAdministrationEvidence(evidence));assert.equal(evidence.incoming?.ready,true);
  assert.ok(reclaimAdministrationWallet(evidence.controller,controller,controller));assert.equal(reclaimAdministrationWallet(evidence.controller,controller,unrelated),false);
  const safe={address:incoming,runtimeHash:hash(8),kind:"safe-1.4.1"as const,owners:[address(10),address(11),address(12)]};
  assert.ok(reclaimAdministrationWallet(safe,incoming,address(10)));assert.equal(reclaimAdministrationWallet(safe,incoming,controller),false,"A gas payer is not a Safe owner");
  assert.equal(reclaimAdministrationWallet(safe,unrelated,address(10)),false);assert.equal(validReclaimAdministrationEvidence({status:"verified",controller:safe,incoming:null}),true);
  assert.equal(validReclaimAdministrationEvidence({status:"unassigned",controller:safe,incoming:null}),false);
  state.code.set(controller,"0x6000");assert.deepEqual(await reclaimAdministrationEvidence(config,rpc,head,campaign,controller),{status:"unavailable",controller:null,incoming:null});
});
