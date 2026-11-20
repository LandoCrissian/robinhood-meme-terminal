import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {gzipSync,gunzipSync} from "node:zlib";
import {deriveDelegatedConstructors} from "../../../../packages/contracts/scripts/delegated-mobile-constructors.mjs";
import {buildFixedSupplyInput} from "../../../../packages/contracts/scripts/fixed-supply-profile.mjs";
const root=fileURLToPath(new URL("../../../../",import.meta.url));
const sha=b=>createHash("sha256").update(b).digest("hex");
const load=p=>JSON.parse(readFileSync(resolve(root,p)));
export function sourcePublicationPayloads({compilation,input,original,protocol,current}) {
 assert.equal(sha(input),protocol.compiler.inputSha256);assert.equal(compilation.manifest.inputSha256,sha(input));
 assert.equal(original.planSha256,protocol.planSha256);assert.equal(compilation.manifest.chainId,4663);
 const materialized=deriveDelegatedConstructors(compilation,{sender:original.sender,
  createDestinations:original.constructors.map(p=>({id:p.id,address:p.predictedAddress,nonce:p.nonce})),
  signers:load("docs/evidence/mobile-signing/factory-publication-scheduled.json").currentDirectory[0].state? ["signerA","signerB","signerC"].map(k=>load("docs/evidence/mobile-signing/factory-publication-scheduled.json").currentDirectory[0].state[k]):[],
  safeAddresses:original.safes.map(s=>s.safe)},{includePrivateInitcode:true});
 const all=[...materialized.constructors,...materialized.bootstrapChildren],frozen=[...original.constructors,...original.bootstrapChildren];
 assert.equal(all.length,8);
 for(const [i,item]of all.entries()){
  const expected=frozen[i];assert.equal(item.contract,expected.contract);assert.equal(item.address.toLowerCase(),expected.predictedAddress.toLowerCase());
  assert.equal(item.initcodeHash,expected.initcodeHash);assert.equal(item.runtimeHash,expected.runtimeHash);
  assert.ok(current.expectedPins.some(p=>p.address===item.address.toLowerCase()&&p.runtimeHash===item.runtimeHash));
 }
 assert.equal(materialized.bootstrapChildren[0].create2Salt,original.bootstrapChildren[0].create2Salt,"ORIGINAL_GUARD_SALT_CHANGED");
 const ids=new Set(["RMTLaunchCurveDeploymentV2","RMTV4CurveInitializationGuardV1","RMTV4CurveGraduationV1","RMTLaunchCurveFactoryV2"]);
 return all.filter(p=>ids.has(p.contract)).map(p=>({
  id:p.contract,address:p.address,fullyQualifiedName:compilation.manifest.templates[p.contract].file+":"+p.contract,
  initcodeHash:p.initcodeHash,runtimeHash:p.runtimeHash,constructorArguments:p.constructorData,
  transport:{method:"POST",url:"https://robinhoodchain.blockscout.com/api?module=contract&action=verifysourcecode",contentType:"multipart/form-data"},
  fields:{contractaddress:p.address,contractname:compilation.manifest.templates[p.contract].file+":"+p.contract,
   codeformat:"solidity-standard-json-input",compilerversion:"v"+compilation.manifest.compilerVersion,
   sourceCode:input,constructorArguments:p.constructorData.slice(2),autodetectConstructorArguments:"false",licenseType:"3"},
  compilerInputSha256:sha(input),sourcePlanSha256:original.planSha256,currentRuntimeAnchor:current.anchor,
  submitted:false,preparationOnly:true,createsContract:false,createsToken:false,signingAuthorized:false,broadcastAuthorized:false,
 }));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const {values}=parseArgs({options:{solc:{type:"string"},"output-dir":{type:"string"}}});assert.ok(values.solc&&values["output-dir"]);
 const output=resolve(values["output-dir"]);assert.ok(!existsSync(output),"Use a fresh output directory");
 const archive=readFileSync(resolve(root,"docs/evidence/rmt-task090/migration/canonical-compilation.json.gz"));
 const digestRecord=load("docs/evidence/rmt-task090/migration/evidence-manifest.json").entries.find(r=>r.relativePath.endsWith("canonical-compilation.json.gz"));assert.equal(sha(archive),digestRecord.contentDigest.hex);
 const compilation=JSON.parse(gunzipSync(archive));compilation.immutableNames=new Map(compilation.immutableNames);
 const {input}=buildFixedSupplyInput({solc:values.solc,chainId:4663});
 const payloads=sourcePublicationPayloads({compilation,input,original:load("docs/evidence/mobile-signing/protocol-owner-plan.json"),protocol:load("docs/evidence/mobile-signing/protocol-mainnet.json"),
  current:JSON.parse(gunzipSync(readFileSync(resolve(root,"docs/evidence/rmt-task091/governance/current/capture.json.gz"))))});
 mkdirSync(output);const files=[];
 const put=(name,bytes)=>{writeFileSync(resolve(output,name),bytes,{flag:"wx"});files.push({path:name,bytes:bytes.length,sha256:sha(bytes)});};
 put("solc-standard-input-4663.json.gz",gzipSync(input));
 for(const payload of payloads)put(payload.id+".request.json.gz",gzipSync(JSON.stringify(payload,null,2)+"\n"));
 put("manifest.json",Buffer.from(JSON.stringify({schemaVersion:1,scope:"OFFLINE_ONLY_EXACT_FOUR_PRODUCTION_SOURCE_PUBLICATION_REQUESTS",preparedAt:new Date().toISOString(),
  compilerInputSha256:sha(input),compilerArchiveSha256:sha(archive),sourcePlanSha256:payloads[0].sourcePlanSha256,
  submitted:false,networkRequests:0,proof:"All8 original production initcode and runtime hashes, addresses and original guard salt reconstruct unchanged; current14pin public runtime capture corroborates each target.",
  sourcePublicationCreatesContracts:false,sourcePublicationFinancialActivation:false,
  officialApiDocumentation:"https://docs.blockscout.com/devs/verification/blockscout-smart-contract-verification-api",
  workflow:"Existing per-instance Contract -> Verify & publish -> Solidity Standard JSON input, or reviewed per-instance contract API form. Upload original decompressed Standard JSON and use exact request constructor arguments. No duplicate contract deployment.",
  authentication:"No API key included. Current central Blockscout API requires an API key; do not use or create one. Per-instance UI/API current auth, rate limits and acceptance remain untested. Stop on403/429/CAPTCHA/paywall; do not bypass or replay rapidly.",
  acceptance:"A verification-started/job/pass response alone is insufficient. Require current canonical metadata full-match, original compiler/source/constructor input, and matching deployed runtime. Existing4 unverified records remain unresolved until observed.",
  requests:payloads.map(({id,address,fullyQualifiedName,constructorArguments,initcodeHash,runtimeHash,transport})=>({id,address,fullyQualifiedName,constructorArguments,initcodeHash,runtimeHash,transport})),files,
 },null,2)+"\n"));
 console.log(JSON.stringify({status:"EXACT_FOUR_PRODUCTION_REQUESTS_PREPARED_OFFLINE",requests:payloads.length,compilerInputSha256:sha(input),output,networkRequests:0}));
}
