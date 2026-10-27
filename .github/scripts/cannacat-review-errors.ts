import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {zeroAddress} from 'viem';
import {createCannaCatClient,CannaCatClientError,type CannaCatQuote} from '../../apps/web/lib/embed/cannacat-client';
import {createVNextZeroXProviderNativeFee} from '../../apps/web/lib/vnext/zero-x-settlement';
import {parseVNextPreSignEvidence} from '../../apps/web/lib/vnext/pre-sign-evidence';
import {syntheticCannaCatBundle} from './cannacat-firm-fixture';

const wallet='0x0000000000000000000000000000000000000123';
const token='0x1139d423C1706BDeaD91f03507F521635591eD92';
const reference='synthetic-review-request-120';const checks:object[]=[];
function intent(){const now=Date.now(),requestId=randomUUID();return {side:'sell',tokenAmountAtomic:'1000000000000000000',requestId,inputAsset:token,
 outputAsset:zeroAddress,inputAmountAtomic:'1000000000000000000',recipient:wallet,attempt:{expiresAtMs:now+10000,protectedOutputAtomic:'99000000000'}} as CannaCatQuote;}
function bundle(quote:CannaCatQuote){return syntheticCannaCatBundle({quoteRequestId:quote.requestId,inputAsset:quote.inputAsset,outputAsset:quote.outputAsset,
 inputAmountAtomic:quote.inputAmountAtomic,recipient:quote.recipient,protectedOutputFloorAtomic:quote.attempt.protectedOutputAtomic!},{approvalAlreadyGranted:true});}
async function rejects(name:string,status:number,code:string,expected:RegExp){
 const q=intent();let calls=0;
 const api=createCannaCatClient({baseUrl:'https://fixture.invalid/api/embed/cannacat',identityToken:'synthetic-only',fetch:async()=>{calls++;return Response.json({code},{status,headers:{'x-rmt-request-id':reference,'retry-after':'1'}});}});
 await assert.rejects(()=>api.prepare(q),error=>error instanceof CannaCatClientError&&error.code===code&&error.requestId===reference&&expected.test(error.message));
 assert.equal(calls,1);checks.push({name,code,httpStatus:status,authorizationCalls:0,passed:true});
}
async function main(){
 for(const [status,code,message] of [[401,'AUTH_FAILURE',/sign-in expired/i],[429,'RATE_LIMITED',/provider is busy/i],[422,'NO_ROUTE',/no route/i],
  [503,'PILOT_CONFIGURATION_UNAVAILABLE',/configuration is not ready/i],[422,'FIRM_VERIFY_FAILED',/failed RMT verification/i],
  [503,'PROVIDER_UNAVAILABLE',/0x could not provide/i],[409,'QUOTE_EXPIRED',/expired/i],[422,'INSUFFICIENT_GAS',/insufficient native ETH/i],
  [422,'GAS_UNAVAILABLE',/gas could not be verified/i],[422,'SIMULATION_FAILED',/failed simulation/i],
  [422,'APPROVAL_SIMULATION_FAILED',/approval failed simulation/i]] as const)await rejects('Specific failure '+code,status,code,message);
 for(const state of ['insufficient_balance','insufficient_gas'] as const){
  const q=intent(),full=bundle(q),e=full.evidence,fee=e.providerNativeFee!,{identity:_,...firmQuote}=fee.firmQuote!;
  const blocked={...e,status:state,authorizationReady:false,nextAction:null,nextActionTarget:null,nextActionCalldataHash:null,
    sufficientBalance:state!=='insufficient_balance',balanceAtomic:state==='insufficient_balance'?'0':null,
    nativeBalanceWei:state==='insufficient_gas'?'0':e.nativeBalanceWei,gasState:state==='insufficient_gas'?'insufficient':e.gasState,
    providerNativeFee:createVNextZeroXProviderNativeFee({inputAsset:e.inputAsset,outputAsset:e.outputAsset,userGrossInputAtomic:e.inputAmountAtomic,
      expectedOutputAtomic:e.expectedOutputAtomic,protectedOutputAtomic:e.protectedOutputAtomic,recipient:e.recipient,quotedFeeAmountAtomic:fee.feeAmountAtomic,
      transactionTarget:fee.transactionTarget!,transactionCalldataHash:fee.transactionCalldataHash!,transactionValueAtomic:fee.transactionValueAtomic!,authorizationState:'blocked',firmQuote})};
  parseVNextPreSignEvidence(blocked,{quoteRequestId:q.requestId,inputAsset:q.inputAsset,outputAsset:q.outputAsset,inputAmountAtomic:q.inputAmountAtomic,
    provider:'zero-x-swap',recipient:q.recipient,protectedOutputFloorAtomic:q.attempt.protectedOutputAtomic!},Date.now());
  let calls=0;
  const api=createCannaCatClient({baseUrl:'https://fixture.invalid/api/embed/cannacat',identityToken:'synthetic-only',fetch:async()=>{calls++;return Response.json(blocked,{headers:{'x-rmt-request-id':reference}});}});
  await assert.rejects(()=>api.prepare(q),error=>error instanceof CannaCatClientError&&error.code===state.toUpperCase()&&error.requestId===reference
    && (state==='insufficient_balance'?/Insufficient CannaCat/.test(error.message):/Insufficient native ETH/.test(error.message)));
  assert.equal(calls,1);checks.push({name:'HTTP 200 business result '+state,passed:true,authorizationCalls:0});
 }
 {
  const q=intent(),full=bundle(q);let calls=0;
  const api=createCannaCatClient({baseUrl:'https://fixture.invalid/api/embed/cannacat',identityToken:'synthetic-only',fetch:async input=>{calls++;return Response.json(String(input).endsWith('/verify')?full.evidence:full,{headers:{'x-rmt-request-id':reference}});}});
  const prepared=await api.prepare(q);assert.equal(prepared.plan.kind,'swap');assert.equal(prepared.evidence.providerNativeFee?.feeBps,25);assert.equal(calls,2);
  checks.push({name:'One CannaCat sell can prepare without invented minimum or signing',passed:true});
 }
 for(const stage of ['verify','authorize'] as const){
  const q=intent(),full=bundle(q);let calls=0;
  const api=createCannaCatClient({baseUrl:'https://fixture.invalid/api/embed/cannacat',identityToken:'synthetic-only',fetch:async input=>{
    calls++;return Response.json(stage==='verify'||String(input).endsWith('/authorize')?{}:full.evidence,{headers:{'x-rmt-request-id':reference}});
  }});
  await assert.rejects(()=>api.prepare(q),error=>error instanceof CannaCatClientError&&error.code===(stage==='verify'?'PRE_SIGN_EVIDENCE_REJECTED':'AUTHORIZATION_EVIDENCE_REJECTED')&&error.requestId===reference);
  checks.push({name:'Malformed '+stage+' evidence fails closed with reference',passed:true,calls});
 }
 {
  const q=intent();let calls=0;const api=createCannaCatClient({baseUrl:'https://fixture.invalid/api/embed/cannacat',identityToken:'synthetic-only',fetch:async()=>{calls++;throw new TypeError('Failed to fetch');}});
  await assert.rejects(()=>api.prepare(q),error=>error instanceof CannaCatClientError&&error.code==='TRADING_NETWORK_UNAVAILABLE');assert.equal(calls,1);
  checks.push({name:'Network failure has specific reason and no retry or signing',passed:true});
 }
 const result={result:'PASS',checks,synthetic:true,realWalletSignatures:0,fundedTransactions:0,feeBps:25};
 await writeFile(path.join(process.env.GITHUB_WORKSPACE??process.cwd(),'cannacat-review-evidence.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({result:'PASS',checks:checks.length,signatures:0,transactions:0}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
