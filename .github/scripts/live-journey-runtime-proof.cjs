// Build a short-lived PREVIEW-ONLY read-only diagnostic, never a web release artifact.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const out = path.join(os.tmpdir(), 'rmt-live-journey-preview-proof');
const req = createRequire(path.join(root, 'apps/web/package.json'));
const esbuild = createRequire(req.resolve('tsx/package.json'))('esbuild');
const original = JSON.parse(fs.readFileSync(path.join(root, 'evidence/trading-hardening/zero-x-50-token-matrix.json'), 'utf8'));
const sample = original.rows.filter(r => r.direction === 'BUY').map(buy => ({ buy,
  sell: original.rows.find(r => r.sampleIndex === buy.sampleIndex && r.direction === 'SELL') }));
if (original.seed !== 5272840 || sample.length !== 50 || new Set(sample.map(r => r.buy.assetContract.toLowerCase())).size !== 50) throw Error('FROZEN_SAMPLE_INVALID');
fs.mkdirSync(out + '/.vercel/output', { recursive: true });
fs.mkdirSync(out + '/apps/web', { recursive: true });
fs.writeFileSync(out + '/.vercel/project.json', JSON.stringify({ projectId: 'prj_ko6YOghK5vgJuK2S2MICn1pRNZMD', orgId: 'team_S3IkMdoAkIRdvDsXY5XZni0w' }));
fs.writeFileSync(out + '/.vercel/output/config.json', '{"version":3}');
const source = `
import {getAddress,zeroAddress} from 'viem';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createZeroXSwapDiagnosticAdapter} from './lib/server/vnext-zero-x-adapter';
import {verifyZeroXSwapFirmQuote} from './lib/server/vnext-zero-x-firm-quote-verifier';
import {readVNextVerifiedAssetIdentity} from './lib/server/vnext-asset-identity';
import {requireProjectIdentityDirectoryAdmitted} from './lib/server/project-identity-admission';
import {VNEXT_PROVIDER_NATIVE_INPUT_FEE} from './lib/vnext/execution-settlement';
import {zeroXIntegratorFeeAmount} from './lib/vnext/zero-x-settlement';
import {simulateFundedZeroXEnvelope} from './scripts/zero-x-read-only-funded-simulation';
const sample=${JSON.stringify(sample)};
const peep=${JSON.stringify(original.peepCases)};
const wallet=getAddress('0x1111111111111111111111111111111111111111');
const requestEvidence=new AsyncLocalStorage();
const originalFetch=globalThis.fetch;
globalThis.fetch=async function(input,init){
 const evidence=requestEvidence.getStore();const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 const provider=url.origin==='https://api.0x.org';
 if(provider){await new Promise(resolve=>setTimeout(resolve,650));if(evidence)evidence.providerRequestCount++;}
 try{const response=await originalFetch(input,init);if(provider&&evidence)evidence.providerHttpStatuses.push(response.status);return response;}
 catch(error){if(evidence)evidence.transportFailure=provider?'PROVIDER_TRANSPORT_UNAVAILABLE':'READ_RPC_UNAVAILABLE';throw error;}
};
function firmReason(error){
 const message=error instanceof Error?error.message:'';
 const reasons={
  '0x returned the wrong integrator fee amount.':'WRONG_INTEGRATOR_FEE_AMOUNT',
  '0x omitted the RMT integrator fee.':'MISSING_INTEGRATOR_FEE',
  '0x returned the integrator fee in the wrong token.':'WRONG_INTEGRATOR_FEE_TOKEN',
  '0x returned duplicate integrator fees.':'DUPLICATE_INTEGRATOR_FEE',
  '0x firm minimum violates the requested slippage envelope.':'INVALID_EXECUTABLE_MINIMUM',
  '0x changed the requested firm-quote economics.':'CHANGED_FIRM_ECONOMICS',
  '0x returned incomplete firm-quote validation evidence.':'INCOMPLETE_FIRM_VALIDATION',
  '0x returned an invalid transaction envelope.':'INVALID_TRANSACTION_ENVELOPE',
  '0x returned an invalid AllowanceHolder transaction envelope.':'INVALID_ALLOWANCEHOLDER_ENVELOPE',
  '0x did not return a complete firm quote.':'INCOMPLETE_FIRM_QUOTE',
  '0x Swap firm-quote verification is not configured.':'FIRM_CONFIGURATION_UNAVAILABLE'
 };
 if(error?.name==='ZeroXRepriceRequiredError')return 'QUOTE_EXPIRED_REPRICE_REQUIRED';
 if(/^0x firm-quote request failed with [0-9]{3}[.]$/.test(message))return 'PROVIDER_HTTP_UNAVAILABLE';
 if(/^Robinhood RPC [a-zA-Z_]+ failed[.]$/.test(message))return 'READ_RPC_UNAVAILABLE';
 return reasons[message]??'OTHER_FIRM_VERIFICATION_REJECTION';
}
async function probe(template,amount,simulate){
 const evidence={providerRequestCount:0,providerHttpStatuses:[]};
 return requestEvidence.run(evidence,async()=>{const row=await probeImpl(template,amount,simulate);
  return {...row,...evidence,providerRequestAttempted:evidence.providerRequestCount>0};});
}
async function probeImpl(template,amount,simulate){
 const row={sampleIndex:template.sampleIndex,randomSeed:5272840,token:template.assetContract,symbol:template.tokenSymbol,
  canonicalProtocol:template.canonicalProtocol,canonicalVersion:template.canonicalVersion,canonicalPool:template.canonicalPool,
  direction:template.direction,inputAsset:template.inputAsset,outputAsset:template.outputAsset,inputAmountAtomic:amount,
  observedAt:new Date().toISOString(),identityStatus:'IDENTITY_UNAVAILABLE',providerRequestAttempted:false,
  provider:'zero-x-swap',chainId:4663,feeBps:25,feeToken:template.inputAsset,feeAtomic:zeroXIntegratorFeeAmount(amount),
  slippagePpm:9900,hardMaxPpm:10000,simulation:'NOT_REACHED'};
 let identities;
 try{identities=await Promise.all([readVNextVerifiedAssetIdentity(getAddress(template.inputAsset)),readVNextVerifiedAssetIdentity(getAddress(template.outputAsset))]);}catch{return {...row,status:'IDENTITY_UNAVAILABLE'};}
 if(identities.some(i=>!i))return {...row,status:'IDENTITY_UNAVAILABLE'};
 row.identityStatus='IDENTITY_READY';
 if(!process.env.RMT_ZEROX_API_KEY)return {...row,status:'PROVIDER_NOT_REQUESTED',configuration:'ZEROX_CREDENTIAL_NOT_PRESENT'};
 try{await requireProjectIdentityDirectoryAdmitted([{address:getAddress(template.inputAsset)},{address:getAddress(template.outputAsset)}]);}
 catch{return {...row,status:'IDENTITY_ADMISSION_UNAVAILABLE'};}
 const diagnostics=[];
 const request={chainId:4663,inputAsset:getAddress(template.inputAsset),outputAsset:getAddress(template.outputAsset),
  inputIdentity:identities[0],outputIdentity:identities[1],inputAmountAtomic:amount,amountIn:BigInt(amount),recipient:wallet};
 row.providerRequestAttempted=true;
 const attempt=await createZeroXSwapDiagnosticAdapter(d=>diagnostics.push(d)).quote(request);
 Object.assign(row,{indicativeStatus:attempt.status,expectedOutputAtomic:attempt.expectedOutputAtomic??null});
 if(attempt.status!=='indicative')return {...row,status:attempt.status==='no_route'?'ZEROX_NO_ROUTE':attempt.status==='invalid_response'?'POLICY_REJECTED_'+(diagnostics.at(-1)?.reason??'OTHER_SCHEMA_VIOLATION'):'ZEROX_UNAVAILABLE'};
 try{const nowMs=Date.now();const firm=await verifyZeroXSwapFirmQuote({...request,indicativeProtectedOutputFloorAtomic:BigInt(attempt.protectedOutputAtomic),
  settlementMode:VNEXT_PROVIDER_NATIVE_INPUT_FEE,nowMs,deadlineSeconds:BigInt(Math.floor(nowMs/1000)+120)});
  return {...row,status:'FIRM_VERIFIED',firmStatus:firm.status,recipient:firm.recipient,protectedOutput:firm.encodedExecutableMinBuyAmount,
   transactionTarget:firm.router,allowanceTarget:firm.approvalSpender,settler:firm.executableSettlerTarget,
   targetHash:firm.routerRuntimeHash,settlerHash:firm.executableSettlerRuntimeHash,requestHash:firm.calldataHash,
   simulation:firm.exactSimulationPassed?'SIMULATION_PASS':'NOT_REACHED_UNFUNDED_WALLET',
   fundedSimulation:simulate?await simulateFundedZeroXEnvelope(firm):undefined};
 }catch(error){const reason=firmReason(error);return {...row,status:reason==='PROVIDER_HTTP_UNAVAILABLE'?'ZEROX_UNAVAILABLE':'FIRM_VERIFY_FAILED',reason,simulation:'NOT_REACHED'};}
}
async function paired(buyTemplate,sellTemplate,simulate){
 const buy=await probe(buyTemplate,buyTemplate.testAmount,simulate);
 const sell=await probe(sellTemplate,buy.expectedOutputAtomic??sellTemplate.testAmount,simulate);
 return [buy,sell];
}
export default async function(req,res){
 res.setHeader('Cache-Control','private,no-store');res.setHeader('X-Robots-Tag','noindex');
 const match=/^\\/api\\/journey-proof\\/(matrix|peep)\\/(\\d{1,2})$/.exec(req.url);
 if(process.env.VERCEL_ENV!=='preview'||Date.now()>${Date.now()+6*3600000}||req.method!=='GET'||!match
   ||Number(match[2])>=(match[1]==='matrix'?50:20)){res.statusCode=404;res.end();return;}
 try{const index=Number(match[2]);const rows=match[1]==='matrix'?await paired(sample[index].buy,sample[index].sell,true)
   :[...await paired(peep[0],peep[1],false),...await paired(peep[2],peep[3],false)];
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({diagnosticOnly:true,seed:5272840,index,rows,
   walletRequests:0,signatures:0,transactions:0},(_,v)=>typeof v==='bigint'?v.toString():v));
 }catch{res.statusCode=503;res.end('{"status":"PROBE_UNAVAILABLE"}');}
}`;
const dir=out+'/.vercel/output/functions/api/journey-proof.func';
fs.mkdirSync(dir,{recursive:true});
esbuild.buildSync({stdin:{contents:source,resolveDir:root+'/apps/web',sourcefile:'preview-journey-proof.ts',loader:'ts'},bundle:true,platform:'node',format:'cjs',target:'node22',outfile:dir+'/index.js',logLevel:'silent'});
fs.writeFileSync(dir+'/.vc-config.json',JSON.stringify({runtime:'nodejs22.x',handler:'index.js',launcherType:'Nodejs',shouldAddHelpers:true,maxDuration:300}));
fs.writeFileSync(out+'/.vercel/output/config.json',JSON.stringify({version:3,routes:[{src:'/api/journey-proof/(.*)',dest:'/api/journey-proof'}]}));
console.log(JSON.stringify({artifact:out,scope:'PREVIEW_ONLY',secretOutput:false}));
