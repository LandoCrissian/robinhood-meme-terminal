import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {createRequire} from "node:module";
import {parseArgs} from "node:util";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {makeReadOnlyRpc,ROBINHOOD_SOURCES,agreedObservation} from "../production-readiness/rpc.mjs";

const require=createRequire(new URL("../../apps/launch-website/package.json",import.meta.url));
const{decodeFunctionResult,encodeFunctionData,keccak256,parseAbi,toHex}=require("viem");
const safeAbi=parseAbi(["function VERSION() view returns(string)","function masterCopy() view returns(address)","function getOwners() view returns(address[])",
  "function getThreshold() view returns(uint256)","function nonce() view returns(uint256)","function supportsInterface(bytes4) view returns(bool)"]);
const hashes=/^0x[0-9a-f]{64}$/i,quantities=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i,codePattern=/^0x(?:[0-9a-f]{2})*$/i;
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const json=v=>JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x,2)+"\n";
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==="object"&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const expectedOwners=["0xc447a378cfd8460febc2eef67501d7a5473b9001","0xc3600f2df60929d2ab9ab294cff42eedcb984f51","0x2bcc3fafce77ccc7fdbed46e0b5bb80ba3e76697"];
const safes={operations:"0xAF9F10258b091719618c19D057F9cDAB72eFFd8b",reserve:"0x8D44078642ce938Fd799b23087BcdD6114A302e5"};
const proxyHash="0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c";
function header(raw){assert.ok(raw&&quantities.test(raw.number)&&hashes.test(raw.hash)&&hashes.test(raw.parentHash)&&quantities.test(raw.timestamp));
  return{number:BigInt(raw.number).toString(),hash:raw.hash,parentHash:raw.parentHash,timestamp:new Date(Number(BigInt(raw.timestamp))*1000).toISOString()};}

/** Exactly two fixed public readers, existing bounded transport, no signing,
 * gas estimate, funded simulation, trace, credential or arbitrary endpoint. */
export async function observeReclaim4663({fetcher=fetch}={}){
  const sourcePaths=["scripts/reclaim/read-only-4663.mjs","scripts/production-readiness/rpc.mjs","packages/contracts/test/fixtures/safe-1.4.1/runtime.json"];
  const archive=JSON.parse(readFileSync(new URL("../../"+sourcePaths[2],import.meta.url),"utf8"));
  const pins={...Object.fromEntries(Object.entries(archive.contracts).map(([role,p])=>[role,{address:p.address,runtimeHash:p.runtimeKeccak256}])),
    operations:{address:safes.operations,runtimeHash:proxyHash},reserve:{address:safes.reserve,runtimeHash:proxyHash}};
  const readers=Object.fromEntries(["official","pocket"].map(name=>[name,makeReadOnlyRpc({name,url:ROBINHOOD_SOURCES[name]},{fetcher})]));
  const report={schemaVersion:1,scope:"READ_ONLY_4663_SAFE_CONFIGURATION_NOT_RECLAIM_ACTIVATION",observedAt:new Date().toISOString(),chainId:4663,
    signing:false,broadcast:false,productionChanges:false,sourceUrls:{network:"https://docs.robinhood.com/chain/connecting/",safe:"https://docs.safe.global/advanced/smart-account-supported-networks"},
    sourceBindings:sourcePaths.map(path=>({path,sha256:createHash("sha256").update(readFileSync(new URL("../../"+path,import.meta.url),"utf8").replaceAll("\r\n","\n")).digest("hex"),encoding:"UTF8_CRLF_TO_LF_ONLY"})),
    expectedOwners,threshold:2,pins,providers:{},anchor:null,corroboration:{status:"UNVERIFIED",providers:[]},
    limits:{providers:2,timeoutMs:8000,attempts:2,responseBytes:196608,publicFixedTargetsOnly:true},
    limitations:["Two L2 providers do not verify Ethereum L1 finality or independent market prices.","This checks existing Safe configuration, not phone control, new Reclaim execution or a security audit.",
      "No live RMT reward token, USD reference, NFT eligibility policy, campaign or reserve is admitted.","Receiver interface responses are observations, not arbitrary NFT contract compatibility or safe custody evidence."],
    releaseStatus:"BLOCKED_NO_BROADCAST",reclaimActivation:false};
  await Promise.all(Object.entries(readers).map(async([name,read])=>{report.providers[name]={source:ROBINHOOD_SOURCES[name],
    chain:await read("eth_chainId",[],v=>{assert.equal(v,"0x1237");return 4663;}),head:await read("eth_getBlockByNumber",["latest",false],header)};}));
  const starts=Object.values(report.providers).filter(p=>p.chain.status==="observed"&&p.head.status==="observed");
  if(!starts.length){report.completedAt=new Date().toISOString();return report;}
  const height=starts.reduce((n,p)=>BigInt(p.head.value.number)<n?BigInt(p.head.value.number):n,BigInt(starts[0].head.value.number))-5n;assert.ok(height>0n);const tag=toHex(height);
  report.anchor={number:height.toString(),policy:"minimum available provider head minus five blocks; L2 observation only"};
  await Promise.all(Object.entries(readers).map(async([name,read])=>{
    const provider=report.providers[name];if(provider.chain.status!=="observed"){provider.status="UNKNOWN_WRONG_OR_UNAVAILABLE_CHAIN";return;}
    provider.anchor=await read("eth_getBlockByNumber",[tag,false],v=>{const b=header(v);assert.equal(b.number,height.toString());return b;});
    if(provider.anchor.status!=="observed"){provider.status="UNKNOWN_ANCHOR_UNAVAILABLE";return;}
    provider.runtimes={};provider.safes={};provider.governanceOwnerCode={};
    await Promise.all(Object.entries(pins).map(async([role,pin])=>{provider.runtimes[role]=await read("eth_getCode",[pin.address,tag],raw=>{assert.ok(codePattern.test(raw));
      return{address:pin.address,bytes:(raw.length-2)/2,runtimeHash:keccak256(raw),matches:same(keccak256(raw),pin.runtimeHash)};});}));
    await Promise.all(expectedOwners.map(async owner=>{provider.governanceOwnerCode[owner]=await read("eth_getCode",[owner,tag],raw=>{assert.ok(codePattern.test(raw));return{empty:raw==="0x",bytes:(raw.length-2)/2,runtimeHash:keccak256(raw)};});}));
    for(const[role,address]of Object.entries(safes)){
      const record=provider.safes[role]={address,views:{}};
      await Promise.all(["VERSION","masterCopy","getOwners","getThreshold","nonce"].map(async functionName=>{record.views[functionName]=await read("eth_call",[{to:address,data:encodeFunctionData({abi:safeAbi,functionName})},tag],raw=>{
        assert.ok(codePattern.test(raw));const result=decodeFunctionResult({abi:safeAbi,functionName,data:raw});return typeof result==="bigint"?result.toString():result;});}));
      for(const[label,id]of Object.entries({erc721Receiver:"0x150b7a02",erc1155Receiver:"0x4e2312e0"}))record.views[label]=await read("eth_call",[{to:address,data:encodeFunctionData({abi:safeAbi,functionName:"supportsInterface",args:[id]})},tag],raw=>decodeFunctionResult({abi:safeAbi,functionName:"supportsInterface",data:raw}));
      const v=record.views,ownerList=v.getOwners.status==="observed"?v.getOwners.value:[];
      record.approvedConfigurationObserved=provider.runtimes[role].status==="observed"&&provider.runtimes[role].value.matches
        &&v.VERSION.status==="observed"&&v.VERSION.value==="1.4.1"&&v.masterCopy.status==="observed"&&same(v.masterCopy.value,pins.safe_l2.address)
        &&v.getThreshold.status==="observed"&&v.getThreshold.value==="2"&&Array.isArray(ownerList)&&ownerList.length===3&&new Set(ownerList.map(a=>a.toLowerCase())).size===3
        &&expectedOwners.every(a=>ownerList.some(b=>same(a,b)));
    }
    provider.recheckedAnchor=await read("eth_getBlockByNumber",[tag,false],header);
    provider.status=provider.recheckedAnchor.status==="observed"&&same(provider.recheckedAnchor.value.hash,provider.anchor.value.hash)?"ANCHORED_L2_OBSERVATION":"UNKNOWN_ANCHOR_CHANGED_OR_UNAVAILABLE";
  }));
  report.corroboration=agreedObservation(Object.entries(report.providers).map(([name,p])=>({name,observation:p.status==="ANCHORED_L2_OBSERVATION"?{status:"observed",value:{anchor:p.anchor.value,
    runtimeHashes:Object.fromEntries(Object.entries(p.runtimes).map(([k,r])=>[k,r.status==="observed"?r.value.runtimeHash:null])),safes:Object.fromEntries(Object.entries(p.safes).map(([k,r])=>[k,{approved:r.approvedConfigurationObserved,
      views:Object.fromEntries(Object.entries(r.views).map(([view,value])=>[view,value.status==="observed"?value.value:null]))}]))}}:{status:"unavailable"}})),canonical);
  report.configurationStatus=report.corroboration.status==="CORROBORATED"&&Object.values(report.providers).every(p=>Object.values(p.runtimes??{}).length===5&&Object.values(p.runtimes).every(r=>r.status==="observed"&&r.value.matches)
    &&Object.values(p.safes??{}).length===2&&Object.values(p.safes).every(s=>s.approvedConfigurationObserved))?"BOTH_EXISTING_SAFES_APPROVED_CONFIGURATION_CORROBORATED":"UNKNOWN_OR_CONFLICTING_CONFIGURATION";
  report.completedAt=new Date().toISOString();return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const{values}=parseArgs({options:{output:{type:"string"}}});assert.ok(values.output&&!existsSync(values.output),"Choose a new --output JSON path; never overwrite prior observations");
  const report=await observeReclaim4663();writeFileSync(values.output,json(report),{flag:"wx"});console.log(json({configurationStatus:report.configurationStatus??"UNKNOWN",anchor:report.anchor,corroboration:report.corroboration.status,signing:false,broadcast:false}));
}
