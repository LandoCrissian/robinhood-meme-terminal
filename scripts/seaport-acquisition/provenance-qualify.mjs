import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {createRequire} from "node:module";
import {resolve,join,posix} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {execFileSync} from "node:child_process";
import {verify4663Sources,controllerMetadata} from "../seaport-verification/provenance-rebuild.mjs";
import {verifyWrappedNativeProxy} from "../seaport-verification/provenance-proxy.mjs";
import {ROBINHOOD_SOURCES,makeReadOnlyRpc} from "../production-readiness/rpc.mjs";
import {marketplacePins} from "../nft-marketplace/probe-4663.mjs";
import {fetchCurrentSeaportListing} from "./listing-source.mjs";
const require=createRequire(new URL("../../apps/indexer/package.json",import.meta.url)),{keccak256}=require("viem");
const sha=b=>createHash("sha256").update(b).digest("hex"),json=v=>JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x,2)+"\n";
const root=new URL("../../docs/evidence/rmt-task082/seaport-marketplace/",import.meta.url);
const paymentCompilerPins={implementation:{version:"0.8.16+commit.07a7930e",win32:"84976fb1fc2b29267020d2ca0a3a877f0ec6f88018307d32bfbb43bece865767",linux:"1632786c6c1f856a4a899232ec975a12f305118f43cce90e724ed0b2eebfeee1"},admin:{version:"0.8.19+commit.7dd6d404",win32:"00d3b5ca64b097964ed6d70d9805a63fdd27113b07c1b2559dbfdd579f994508",linux:"7a5c1d3dc9a8eba62bb2ec37192c9178ae5fe8a54a56e5573fd3c9c17cd9eb48"}};
paymentCompilerPins.proxy=paymentCompilerPins.implementation;
export function validatePaymentInput(input){
 const portable=p=>typeof p==="string"&&p.length>0&&!p.includes("\\")&&!p.includes(":")&&!p.startsWith("/")&&!p.split("/").includes("..");
 assert.equal(input.language,"Solidity");assert.ok(input.sources&&Object.keys(input.sources).length<=64);
 const mappings=(input.settings.remappings??[]).map(r=>{const i=r.indexOf("=");assert.ok(i>0&&portable(r.slice(0,i))&&portable(r.slice(i+1)));return[r.slice(0,i),r.slice(i+1)];}).sort((a,b)=>b[0].length-a[0].length);
 for(const [file,unit]of Object.entries(input.sources)){assert.ok(portable(file)&&file.endsWith(".sol"));assert.deepEqual(Object.keys(unit),["content"],"Source URLs/import callbacks are forbidden");assert.equal(typeof unit.content,"string");const declarations=unit.content.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/[^\n]*/g,"");for(const match of declarations.matchAll(/\bimport\s+(?:[^;]*?\bfrom\s+)?["']([^"']+)["']\s*;/g)){const path=match[1];assert.ok(!path.includes(":")&&!path.startsWith("/")&&!path.includes("\\"));let target=path.startsWith(".")?posix.normalize(posix.join(posix.dirname(file),path)):path;const mapping=mappings.find(([prefix])=>target.startsWith(prefix));if(mapping)target=mapping[1]+target.slice(mapping[0].length);assert.ok(portable(target)&&Object.hasOwn(input.sources,target),"All imports must be present in the explicit source closure: "+target);}}
 return true;
}
export function reproducePaymentSource(name,source,executable){
 const pin=paymentCompilerPins[name];assert.ok(pin);assert.equal(source.compilation.compilerVersion,pin.version);assert.equal(sha(readFileSync(executable)),pin[process.platform],"Exact payment compiler checksum");
 const input=structuredClone(source.stdJsonInput);input.settings.outputSelection={"*":{"*":["evm.deployedBytecode","metadata"]}};validatePaymentInput(input);const serialized=JSON.stringify(input);
 // solc0.8.16 predates --no-import-callback. Reject URL-based sources, paths
 // outside the source unit namespace and every unresolved import beforehand.
 const output=JSON.parse(execFileSync(executable,["--standard-json"],{input:serialized,maxBuffer:8*1024*1024,timeout:120000,windowsHide:true}));assert.deepEqual((output.errors??[]).filter(e=>e.severity==="error"),[]);
 const [file,contract]=source.compilation.fullyQualifiedName.split(":"),compiled="0x"+output.contracts[file][contract].evm.deployedBytecode.object;
 assert.equal(compiled,source.runtimeBytecode.recompiledBytecode,"Independent compiler/source reproduction differs");
 let materialized=compiled;const metadata=[];for(const change of source.runtimeBytecode.transformations){assert.equal(change.reason,"cborAuxdata","No executable substitution admitted");const value=source.runtimeBytecode.transformationValues.cborAuxdata[change.id];assert.match(value,/^0xa2646970667358221220[0-9a-f]{64}64736f6c6343[0-9a-f]{6}0033$/);materialized=materialized.slice(0,2+change.offset*2)+value.slice(2)+materialized.slice(2+change.offset*2+value.length-2);metadata.push({offset:change.offset,bytes:(value.length-2)/2,originalCbor:value});}
 assert.equal(materialized,source.runtimeBytecode.onchainBytecode,"Original metadata-qualified complete runtime differs");
 const suffix=source.runtimeBytecode.onchainBytecode.slice(-10,-4),originalCompilerFromCbor=`${parseInt(suffix.slice(0,2),16)}.${parseInt(suffix.slice(2,4),16)}.${parseInt(suffix.slice(4,6),16)}`;
 return{compiler:pin.version,compilerSha256:pin[process.platform],originalCompilerFromCbor,inputSha256:sha(serialized),independentlyRecompiled:true,fullyReproducedExecutable:true,originalMetadataInputReproduced:compiled===materialized,metadataOnlyDifferences:metadata,compiledRuntimeHash:keccak256(compiled),actualRuntimeHash:keccak256(materialized),runtimeBytes:(compiled.length-2)/2};
}
export async function corroborateVenueAtProxyAnchor(proof){
 assert.equal(proof.proxy.bindingsCorroborated,true);const fresh={anchor:proof.proxy.anchor,providers:{},allSourceRuntimeHashesMatch:true},tag="0x"+BigInt(proof.proxy.anchor).toString(16);
 for(const name of["official","pocket"]){const rpc=makeReadOnlyRpc({name,url:ROBINHOOD_SOURCES[name]}),contracts={};for(const[key,address]of Object.entries({seaport:marketplacePins.seaport,controller:marketplacePins.conduitController,conduit:marketplacePins.conduit})){const code=await rpc("eth_getCode",[address,tag]);const observed=code.status==="observed"?keccak256(code.value):null;contracts[key]={address,status:code.status,runtimeHash:observed,independentReproductionMatches:observed===proof.source.identities[key].runtimeHash};fresh.allSourceRuntimeHashesMatch&&=contracts[key].independentReproductionMatches;}const header=await rpc("eth_getBlockByNumber",[tag,false]);contracts.canonical=header.status==="observed"&&header.value.hash===proof.proxy.providers[name].block.hash;fresh.allSourceRuntimeHashesMatch&&=contracts.canonical;fresh.providers[name]=contracts;}
 return fresh;
}
function cid(bytes){let n=BigInt("0x"+bytes.toString("hex")),out="";const alphabet="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";while(n){out=alphabet[Number(n%58n)]+out;n/=58n;}return out;}
export function originalMetadataIdentities(){return Object.entries(controllerMetadata()).map(([id,record])=>{assert.match(record,/^0xa2646970667358221220[0-9a-f]{64}64736f6c634300080e0033$/);const digest=record.slice(22,86);return{id,sha256:digest,cid:cid(Buffer.from("1220"+digest,"hex")),compiler:"0.8.14+commit.80d49f37",cborBytes:53};});}
async function publicGet(url,maxBytes=1048576){
 const allowed=/^https:\/\/(?:ipfs\.io|dweb\.link)\/ipfs\/Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(url)||/^https:\/\/sourcify\.dev\/server\/v2\/contract\/4663\/0x[0-9a-f]{40}\?fields=all$/.test(url)||["https://reservoirprotocol.readme.io/reference/supported-chains","https://docs.rarible.org/docs/supported-chains","https://www.robinhoodnfts.com/marketplace/"].includes(url);assert.ok(allowed);
 try{const response=await fetch(url,{redirect:"error",credentials:"omit",headers:{accept:"application/json,text/plain,text/html"},signal:AbortSignal.timeout(8000)});if(!response.ok){await response.body?.cancel();return{url,status:"unavailable",httpStatus:response.status};}assert.ok(response.body);const reader=response.body.getReader(),parts=[];let bytes=0;try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;assert.ok(bytes<=maxBytes);parts.push(part.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}const raw=Buffer.concat(parts);return{url,status:"observed",httpStatus:response.status,bytes,sha256:sha(raw),raw};}catch(error){return{url,status:"unavailable",reason:String(error.message).slice(0,200)};}
}
export async function qualifyMarketplace({solcSeaport,solcController,solcImplementation,solcAdmin,output}){
 assert.ok(!existsSync(output),"Fresh evidence output required");mkdirSync(output,{recursive:true});
 const proof={schemaVersion:1,status:"BLOCKED_NO_BROADCAST",observedAt:new Date().toISOString(),broadcast:false,ownerSignatures:false,productionChanged:false,currentOrderIndependentlyVerified:false,productionPaymentAdmitted:false};
 const save=()=>writeFileSync(join(output,"marketplace-qualification.json"),json(proof));
 proof.source=await verify4663Sources({solcSeaport,solcController,offline:true});
 const source=JSON.parse(gunzipSync(readFileSync(new URL("controller-mainnet.json.gz",root))));
 const input=JSON.parse(gunzipSync(readFileSync(new URL("controller-input.json.gz",root))));
 proof.originalMetadata={records:originalMetadataIdentities(),sourceHashesMatchPublishedMetadata:Object.entries(source.metadata.sources).every(([path,item])=>keccak256(Buffer.from(input.sources[path].content))===item.keccak256),sourcifyMetadataObjectSha256:sha(JSON.stringify(source.metadata)),originalInputReproduced:false,fetches:[]};
 for(const item of proof.originalMetadata.records){const url=`https://ipfs.io/ipfs/${item.cid}`,found=await publicGet(url);const {raw,...summary}=found;proof.originalMetadata.fetches.push({...summary,contentHashMatched:raw?sha(raw)===item.sha256:false});if(raw&&sha(raw)===item.sha256)writeFileSync(join(output,`original-metadata-${item.id}.json`),raw);if(found.httpStatus===429){proof.originalMetadata.rateLimitStopped=true;break;}}
 // A retrieved metadata record is necessary but not sufficient: recompilation
 // must reproduce the original full code without applying recorded CBOR edits.
 try{proof.proxy=await verifyWrappedNativeProxy("latest");}catch(error){proof.proxy={status:"unavailable",reason:String(error.message).slice(0,300)};}
 if(proof.proxy.bindingsCorroborated)proof.freshVenue=await corroborateVenueAtProxyAnchor(proof);
 proof.assets={native:{asset:"native ETH",erc20:false,allowance:false,productionPaymentAdmitted:false,policy:"Exact prefunded vault value; complete signed consideration and per-recipient balance deltas; no caller value is a royalty override."},wrappedNative:{asset:"aeWETH transparent proxy",productionPaymentAdmitted:false,sourceRecords:{},upgradePolicyAdmitted:false}};
 const provider=proof.proxy.providers?.official;
 const proxySource=JSON.parse(gunzipSync(readFileSync(new URL("sourcify-weth-4663.json.gz",root))));
 proof.assets.wrappedNative.sourceRecords.proxy={source:"Preserved Task082 Sourcify source response",responseSha256:sha(gunzipSync(readFileSync(new URL("sourcify-weth-4663.json.gz",root)))),reproduction:solcImplementation?reproducePaymentSource("proxy",proxySource,solcImplementation):null,currentProviderRuntimeHash:provider?.proxyRuntimeHash??null,sourceRuntimeEqualsCurrentProvider:provider?keccak256(proxySource.runtimeBytecode.onchainBytecode)===provider.proxyRuntimeHash:false};
 for(const [name,address]of Object.entries({implementation:provider?.slots.implementation.address??"0xc6b81b429797e0f555440b70cd99e032d7ae947e",admin:provider?.slots.admin.address??"0xa3acd31afb851b4eb9dad00f5204c01d924267df"})){
   const found=await publicGet(`https://sourcify.dev/server/v2/contract/4663/${address.toLowerCase()}?fields=all`);const{raw,...summary}=found;let record={...summary,address};
   if(raw){const data=JSON.parse(raw);writeFileSync(join(output,`weth-${name}-source.json`),raw);const runtime=data.runtimeBytecode?.onchainBytecode;record={...record,compiler:data.compilation?.compilerVersion,name:data.compilation?.name,match:data.runtimeMatch,sourceFiles:Object.entries(data.sources??{}).map(([path,s])=>({path,sha256:sha(s.content)})),sourceApiOnchainRuntimeHash:runtime?keccak256(runtime):null,currentProviderRuntimeHash:provider?.[name+"RuntimeHash"]??null,independentlyRecompiled:false};record.sourceRuntimeEqualsCurrentProvider=record.sourceApiOnchainRuntimeHash!==null&&record.sourceApiOnchainRuntimeHash===record.currentProviderRuntimeHash;const executable=name==="implementation"?solcImplementation:solcAdmin;if(executable)record.reproduction=reproducePaymentSource(name,data,executable);}
   record.independentlyRecompiled=record.reproduction?.independentlyRecompiled===true;proof.assets.wrappedNative.sourceRecords[name]=record;
 }
 proof.assets.wrappedNative.policyFindings=["Source records identify aeWETH 0.8.16 and OpenZeppelin ProxyAdmin 0.8.19. Independently reproduced executable bytes retain their exact original-CBOR qualification; metadata replacement is not full original-input reproduction.","ProxyAdmin upgrade, upgradeAndCall and changeProxyAdmin are onlyOwner; this source adds no immutable delay or quorum.","An observed owner address is not independently established signer/quorum or reviewed upgrade policy.","aeWETH includes onlyGateway bridgeBurn as well as native depositTo and withdrawTo; immutable WETH9 behavior must not be inferred.","A pinned proxy codehash cannot freeze its implementation or future payment behavior; this candidate does not admit production aeWETH."];
 proof.currentListing=await fetchCurrentSeaportListing({collection:{verified:true,chainId:4663,address:"0x7a543c61c021e9a5c7949faBdc2f4e0a58088daf",slug:"lammbs-59693791"},tokenId:"1"});
 proof.alternativePublicSources=[];
 for(const url of["https://reservoirprotocol.readme.io/reference/supported-chains","https://docs.rarible.org/docs/supported-chains","https://www.robinhoodnfts.com/marketplace/"]){const {raw,...summary}=await publicGet(url);proof.alternativePublicSources.push({...summary,robinhoodMention:raw?raw.toString().toLowerCase().includes("robinhood"):null,admittedCurrentSignedOrder:false,assessment:url.includes("robinhoodnfts")?"Published marketplace landing page only; no documented bounded current Seaport order API established. No private backend or restricted scraping attempted.":"Published supported-chain list does not establish a documented Robinhood current Seaport order endpoint."});}
 proof.verdict="SEAPORT_RECOMPILED_CONTROLLER_ORIGINAL_METADATA_AND_PROXY_AUTHORITY_GAPS_CURRENT_ORDER_UNAVAILABLE_NO_GO";
 proof.limitations=["No current order or acquisition is authorized.","Original Task082 source/evidence remains unchanged.","Original CBOR inputs remain unreproduced; exact byte substitutions are not claimed as full original-input reproduction.","Public listing GET failure does not authorize bypassing credentials, rate limits, scraping restrictions or buying an API plan.","No native or ERC20 production payment admission, L1 finality or owner funds approval follows from read-only evidence."];
 save();return proof;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const{values}=parseArgs({options:{"solc-seaport":{type:"string"},"solc-controller":{type:"string"},"solc-implementation":{type:"string"},"solc-admin":{type:"string"},output:{type:"string"}}});assert.ok(values["solc-seaport"]&&values["solc-controller"]&&values.output);const r=await qualifyMarketplace({solcSeaport:resolve(values["solc-seaport"]),solcController:resolve(values["solc-controller"]),solcImplementation:values["solc-implementation"]&&resolve(values["solc-implementation"]),solcAdmin:values["solc-admin"]&&resolve(values["solc-admin"]),output:resolve(values.output)});console.log(JSON.stringify({status:r.status,verdict:r.verdict,currentOrderIndependentlyVerified:r.currentOrderIndependentlyVerified}));}
