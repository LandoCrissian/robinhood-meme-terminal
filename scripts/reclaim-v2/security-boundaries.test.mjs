import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";
import test from "node:test";

const root=fileURLToPath(new URL("../../",import.meta.url));
const folder=new URL("../../docs/evidence/rmt-task079/security/",import.meta.url);
const read=name=>readFileSync(new URL(name,folder));
const json=name=>JSON.parse(read(name));
const zipped=name=>JSON.parse(gunzipSync(read(name)));
const sha=value=>createHash("sha256").update(value).digest("hex");
const data=json("disposition.json"),manifest=json("compiler-manifest.json"),compiled=zipped("compiler-asts.json.gz");
const visit=(value,fn)=>{if(value&&typeof value==="object"){fn(value);for(const item of Object.values(value))if(item&&typeof item==="object")visit(item,fn);}};
function contract(name){const definitions=[];for(const ast of Object.values(compiled.sourceAsts))visit(ast,node=>{if(node.nodeType==="ContractDefinition"&&node.name===name)definitions.push(node);});assert.equal(definitions.length,1);return definitions[0];}

test("all production roots/imports and raw all-detector before/after reports remain exact",()=>{
  assert.equal(manifest.sourceCount,6);assert.equal(manifest.roots.length,6);assert.deepEqual(manifest.transformations,[]);
  assert.deepEqual(data.detectorFilters,[]);assert.deepEqual(data.sourceFilters,[]);assert.deepEqual(data.sourceTransformations,[]);
  for(const entry of data.snapshots){const raw=gunzipSync(read(entry.input)),reportRaw=gunzipSync(read(entry.report));assert.equal(sha(raw),entry.inputSha256);assert.equal(sha(reportRaw),entry.reportSha256);
    const input=JSON.parse(raw),report=JSON.parse(reportRaw);assert.equal(report.detectorCount,101);assert.equal(report.sources,6);assert.equal(report.detectors.length,entry.total);assert.equal(report.inputSha256,entry.inputSha256);
    assert.equal(Object.keys(input.sources).length,6);const counts={};for(const item of report.detectors)counts[item.impact]=(counts[item.impact]??0)+1;assert.deepEqual(counts,entry.counts);assert.equal(entry.strictExit,1);
  }
  const input=zipped("compiler-final.json.gz");assert.equal(sha(gunzipSync(read("compiler-final.json.gz"))),manifest.inputSha256);assert.equal(compiled.inputSha256,manifest.inputSha256);
  for(const[file,expected]of manifest.sourceSha256){const source=readFileSync(new URL("../../packages/contracts/"+file,import.meta.url),"utf8").replaceAll("\r\n","\n");assert.equal(sha(source),expected,file);assert.equal(input.sources[file].content,source);}
});

test("all53 prior Solidity blobs remain unchanged, including unapproved historical V1",()=>{
  assert.equal(data.preservedExistingSolidity.length,53);
  const paths=execFileSync("git",["ls-tree","-r","--name-only",data.baseCommit],{cwd:root,encoding:"utf8",windowsHide:true}).trim().split("\n").filter(file=>file.endsWith(".sol")).sort();
  assert.deepEqual(data.preservedExistingSolidity.map(row=>row.file).sort(),paths);
  for(const row of data.preservedExistingSolidity){const baseline=execFileSync("git",["show",data.baseCommit+":"+row.file],{cwd:root,windowsHide:true});assert.equal(sha(baseline),row.sha256);assert.equal(sha(readFileSync(new URL("../../"+row.file,import.meta.url),"utf8").replaceAll("\r\n","\n")),row.sha256,row.file);}
  const old=JSON.parse(gunzipSync(readFileSync(new URL("../../docs/evidence/rmt-task078/security/slither-current.json.gz",import.meta.url))));
  assert.equal(old.detectors.filter(d=>d.impact==="High").length,4);assert.deepEqual(data.previousV1.findings.map(f=>f.id),old.detectors.filter(d=>d.impact==="High").map(f=>f.id));assert.ok(data.previousV1.findings.every(f=>f.cleared===false));
});

test("compiler AST and ABI expose no return, repayment, NFT rescue or arbitrary execution",()=>{
  const c=contract("RMTReclaimCampaignV2"),abi=compiled.abis.RMTReclaimCampaignV2;
  const forbidden=/returnTradeIn|repay|withdrawNFT|rescueNFT|executeCall|executeTransaction/i;
  for(const item of abi)assert.equal(forbidden.test(item.name??""),false,item.name);
  const functions=c.nodes.filter(n=>n.nodeType==="FunctionDefinition");assert.ok(functions.every(f=>!forbidden.test(f.name)&&f.kind!=="fallback"&&f.kind!=="receive"));
  for(const item of abi.filter(a=>a.type==="event"))assert.notEqual(item.name,"TradeInReturned");
  assert.equal(abi.some(a=>a.type==="function"&&a.name==="repaid"),false);
  const expected=new Set(["reconcileSurplus","fund","quoteUsd","pause","resume","proposeCollection","executeCollection","cancelCollection","disableCollection","proposeRate","executeRate","cancelRate","proposeClose","executeClose","cancelClose","proposeRecovery","executeRecovery","cancelRecovery","proposeController","acceptController","cancelController","eligibilityLeaf","receiptItems","quote","redeem","onERC721Received","onERC1155Received","onERC1155BatchReceived"]);
  assert.deepEqual(new Set(functions.filter(f=>f.kind==="function"&&["public","external"].includes(f.visibility)).map(f=>f.name)),expected);
});

test("permanent sink AST has only pure receiver/read functions and no escape calls or state authority",()=>{
  const sink=contract("RMTReclaimSinkV2");assert.deepEqual(sink.baseContracts,[]);assert.equal(sink.nodes.some(n=>n.nodeType==="VariableDeclaration"),false);
  const functions=sink.nodes.filter(n=>n.nodeType==="FunctionDefinition");assert.deepEqual(functions.map(f=>f.name).sort(),["onERC1155BatchReceived","onERC1155Received","onERC721Received","supportsInterface"]);
  assert.ok(functions.every(f=>f.stateMutability==="pure"&&f.visibility==="external"&&f.kind==="function"));
  visit(sink,node=>{assert.notEqual(node.nodeType,"InlineAssembly");assert.notEqual(node.nodeType,"FunctionCall");assert.notEqual(node.nodeType,"FunctionCallOptions");assert.notEqual(node.nodeType,"ModifierDefinition");});
});

test("factory profile authority is constructor-only and deployer has no arbitrary initcode parameter",()=>{
  const f=contract("RMTReclaimFactoryV2"),functions=f.nodes.filter(n=>n.nodeType==="FunctionDefinition");
  assert.deepEqual(functions.filter(n=>n.kind==="function"&&["public","external"].includes(n.visibility)).map(n=>n.name).sort(),["create","predict","retirementPolicy","saltFor"]);
  for(const fn of functions)visit(fn,node=>{if(node.nodeType==="Assignment"&&node.leftHandSide?.nodeType==="IndexAccess"&&node.leftHandSide.baseExpression?.name==="retirementPolicies")assert.equal(fn.kind,"constructor");});
  const deploy=compiled.abis.RMTReclaimCampaignDeployerV2.find(a=>a.type==="function"&&a.name==="deploy");assert.deepEqual(deploy.inputs.map(i=>i.type),["address","bytes32","address","uint128","uint32"]);
  visit(contract("RMTReclaimCampaignDeployerV2"),node=>{if(node.nodeType==="MemberAccess")assert.ok(!["call","delegatecall","callcode","send","transfer"].includes(node.memberName));});
});

test("sizes use actual encoded initcode and STOP data-runtime lengths; unresolved highs stay blocked",()=>{
  assert.equal(manifest.templates.RMTReclaimFactoryV2.creationBytes+640,32538);assert.equal(manifest.templates.RMTReclaimCampaignV2.creationBytes+256,23932);
  assert.equal(manifest.templates.RMTReclaimFactoryV2.runtimeBytes,2132);assert.equal(manifest.templates.RMTReclaimCampaignV2.runtimeBytes,22077);
  assert.deepEqual(data.sizes.actualCodePartRuntimeBytes,[11839,11839]);assert.equal((manifest.templates.RMTReclaimCampaignV2.creationBytes/2)+1,11839);
  for(const template of Object.values(manifest.templates)){assert.ok(template.runtimeBytes<=24576);assert.ok(template.creationBytes<=49152);}
  assert.equal(data.currentV2.findings.length,7);assert.ok(data.currentV2.findings.every(f=>f.cleared===false));assert.equal(data.status,"BLOCKED_NO_BROADCAST");assert.equal(data.independentAudit,false);
});
