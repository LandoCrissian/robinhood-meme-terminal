import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const proposalFile=new URL("../../docs/evidence/rmt-task079/campaign-policy.proposed.json",import.meta.url);
const schemaFile=new URL("../../docs/evidence/rmt-task079/campaign-policy.schema.json",import.meta.url);
const original=readFileSync(proposalFile),schema=JSON.parse(readFileSync(schemaFile,"utf8"));
const proposal=JSON.parse(original.toString("utf8"));
const digest=value=>createHash("sha256").update(value).digest("hex");
const plain=value=>value!==null&&typeof value==="object"&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const equal=(a,b)=>{try{assert.deepStrictEqual(a,b);return true;}catch{return false;}};
const keywords=new Set(["$schema","$id","title","type","const","required","properties","additionalProperties","maxItems"]);

/** Narrow, dependency-free validator for this deliberately inert proposal.
 * Unknown schema keywords fail instead of silently weakening validation.
 * It never fills defaults, normalizes addresses, converts amounts, admits
 * collections, marks approval, writes a file, or authorizes execution. */
export function validateProposedReclaimPolicy(value,definition=schema,at="$"){
  assert.ok(plain(definition),`${at}: schema object required`);
  for(const key of Object.keys(definition))assert.ok(keywords.has(key),`${at}: unsupported schema keyword ${key}`);
  if(Object.hasOwn(definition,"const"))assert.ok(equal(value,definition.const),`${at}: exact proposed value required`);
  if(definition.type==="null")assert.equal(value,null,`${at}: production input must remain unassigned`);
  else if(definition.type==="array"){
    assert.ok(Array.isArray(value),`${at}: array required`);
    assert.ok(Number.isSafeInteger(definition.maxItems)&&definition.maxItems===0,`${at}: only explicitly empty admission arrays supported`);
    assert.equal(value.length,0,`${at}: no production profiles or collections are approved`);
  }else if(definition.type==="object"){
    assert.ok(plain(value),`${at}: plain JSON object required`);
    assert.equal(definition.additionalProperties,false,`${at}: additional properties must be denied`);
    assert.ok(plain(definition.properties)&&Array.isArray(definition.required),`${at}: explicit properties and requirements required`);
    const declared=Object.keys(definition.properties);
    assert.equal(new Set(definition.required).size,definition.required.length,`${at}: duplicate required property`);
    assert.deepStrictEqual([...definition.required].sort(),[...declared].sort(),`${at}: every declared property must be required`);
    assert.deepStrictEqual(Object.keys(value).sort(),[...declared].sort(),`${at}: exact property set required`);
    for(const key of declared)validateProposedReclaimPolicy(value[key],definition.properties[key],`${at}.${key}`);
  }else assert.ok(definition.type===undefined&&Object.hasOwn(definition,"const"),`${at}: unsupported schema type`);
  return true;
}

test("permanent Reclaim proposal is exact, inert, unapproved and unchanged",()=>{
  const copy=structuredClone(proposal);
  assert.equal(validateProposedReclaimPolicy(copy),true);
  assert.deepStrictEqual(copy,proposal,"validation must not mutate any input");
  assert.deepStrictEqual(proposal,{
    schemaVersion:2,profile:"rmt-reclaim-v2-permanent",status:"PROPOSED_UNAPPROVED",releaseStatus:"BLOCKED_NO_BROADCAST",chainId:4663,productionEnabled:false,
    rewardToken:null,rewardRuntimeHash:null,controller:null,rewardUnitsPerEligibleQuantity:null,manualFundingUnits:null,usdReference:null,
    nominalUsdGoals:{initialReserve:"20",initialReward:"0.05",futureRewardTarget:"0.50",approvedConversion:false},
    allowedRoutes:["reviewed-native-burn","reviewed-immutable-contract-sink"],immutableRuntimeProfiles:[],collections:[],
    returnOrRepaymentAllowed:false,automaticFundingAllowed:false,automaticPurchasesAllowed:false,securityCleared:false,ownerApproved:false,
  });
  assert.equal(digest(readFileSync(proposalFile)),digest(original),"proposal bytes must not change");
});

test("every missing or extra field fails closed",()=>{
  for(const key of Object.keys(proposal)){
    const changed=structuredClone(proposal);delete changed[key];
    assert.throws(()=>validateProposedReclaimPolicy(changed),/exact property set/);
  }
  for(const key of ["approved","recipient","sink","productionWallet","__proto__","constructor"]){
    const changed=JSON.parse(JSON.stringify(proposal));Object.defineProperty(changed,key,{value:true,enumerable:true});
    assert.throws(()=>validateProposedReclaimPolicy(changed),/exact property set/);
  }
  for(const value of [null,[],"PROPOSED_UNAPPROVED",42,Object.create({approved:true})])assert.throws(()=>validateProposedReclaimPolicy(value));
});

test("amounts, USD targets, addresses, flags and routes are never coerced or approved",()=>{
  for(const [key,value] of Object.entries(proposal)){
    if(key==="nominalUsdGoals")continue;
    const changed=structuredClone(proposal);
    changed[key]=value===null?"0x1000000000000000000000000000000000000001":Array.isArray(value)?[...value,"unapproved"]:typeof value==="boolean"?true:typeof value==="number"?String(value):"changed";
    assert.throws(()=>validateProposedReclaimPolicy(changed),undefined,`${key} substitution must fail`);
  }
  for(const key of ["initialReserve","initialReward","futureRewardTarget"]){
    const changed=structuredClone(proposal);changed.nominalUsdGoals[key]=Number(changed.nominalUsdGoals[key]);
    assert.throws(()=>validateProposedReclaimPolicy(changed),/exact proposed value/);
  }
  for(const change of [goal=>{goal.approvedConversion=true;},goal=>{goal.currency="USD";},goal=>{delete goal.initialReward;}]){
    const changed=structuredClone(proposal);change(changed.nominalUsdGoals);assert.throws(()=>validateProposedReclaimPolicy(changed));
  }
  const reordered=structuredClone(proposal);reordered.allowedRoutes.reverse();assert.throws(()=>validateProposedReclaimPolicy(reordered),/exact proposed value/);
});

test("schema cannot silently omit fields, admit production entries, or use ignored keywords",()=>{
  const permissive=structuredClone(schema);permissive.additionalProperties=true;assert.throws(()=>validateProposedReclaimPolicy(proposal,permissive));
  const ignored=structuredClone(schema);ignored.anyOf=[{}];assert.throws(()=>validateProposedReclaimPolicy(proposal,ignored),/unsupported schema keyword/);
  const omitted=structuredClone(schema);omitted.required=omitted.required.slice(1);assert.throws(()=>validateProposedReclaimPolicy(proposal,omitted),/every declared property/);
  const admitted=structuredClone(schema);admitted.properties.collections.maxItems=1;assert.throws(()=>validateProposedReclaimPolicy(proposal,admitted),/explicitly empty admission/);
});
