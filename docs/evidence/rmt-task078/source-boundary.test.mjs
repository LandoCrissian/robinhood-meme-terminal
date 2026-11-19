import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import test from "node:test";

const root=new URL("../../../",import.meta.url),json=name=>JSON.parse(readFileSync(new URL(name,import.meta.url)));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const normalized=path=>readFileSync(new URL(path,root),"utf8").replaceAll("\r\n","\n");
test("Reclaim preserves all 47 prior Solidity files and the separate compiler boundaries",()=>{
  const frozen=json("frozen-source-manifest.json");assert.equal(frozen.baseCommit,"8d1876daed6449e40388166255f52f13f3c488dd");
  assert.equal(frozen.unchangedBaseSolidityFiles,47);assert.equal(frozen.originalSolidity.length,47);
  for(const source of frozen.originalSolidity){assert.equal(source.unchanged,true);assert.equal(sha(normalized(source.path)),source.sha256,source.path);}
  assert.equal(frozen.core31337InputSha256,"437fb783d7dce558a05317e8b15877f6d08b9571bc12aefec360382469d53648");
  assert.equal(frozen.core4663InputSha256,"66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10");
  assert.equal(frozen.treasuryV1InputSha256,"513609f57dea2fd706ac749999c47119955be16bb0b4f46a54b9fc4283683cf0");
  assert.equal(frozen.treasuryV2PrototypeInputSha256,"02d430dc4018a9a75c9c69f204c4e94c57fa8b94722c90effc79293cad7fff7d");
});
test("all three Reclaim roots bind exact source/compiler/static inputs and honest size limits",()=>{
  const manifest=json("compiler-manifest.json"),input=gunzipSync(readFileSync(new URL("compiler-input.json.gz",import.meta.url))),parsed=JSON.parse(input);
  assert.equal(sha(input),manifest.inputSha256);assert.equal(manifest.inputSha256,json("frozen-source-manifest.json").newReclaimInputSha256);
  assert.equal(manifest.inputSha256,"d3596a541f62f25e579e7f8186e017f678a297f454423a4fa9984c898e720471");
  assert.equal(manifest.sourceCount,3);assert.equal(manifest.coreModified,false);assert.equal(manifest.broadcastAuthorized,false);assert.deepEqual(manifest.transformations,[]);
  assert.deepEqual(Object.keys(parsed.sources).sort(),manifest.roots);assert.equal(manifest.roots.length,3);
  for(const[path,expected]of manifest.sourceSha256){assert.equal(sha(normalized("packages/contracts/"+path)),expected);assert.equal(sha(parsed.sources[path].content),expected);assert.doesNotMatch(parsed.sources[path].content,/slither-disable/);}
  assert.equal(json("security/disposition.json").current.inputSha256,manifest.inputSha256);
  assert.equal(manifest.templates.RMTReclaimFactoryV1.runtimeBytes,24009);assert.equal(manifest.templates.RMTReclaimFactoryV1.creationBytes+64,47050);
  assert.equal(manifest.templates.RMTReclaimCampaignV1.runtimeBytes,21278);
  for(const template of Object.values(manifest.templates)){assert.ok(template.runtimeBytes<24576);assert.ok(template.creationBytes<49152);}
});
test("the separate strict Reclaim gate preserves every prior security job and all browser regressions",()=>{
  const validation=json("workflow-validation.json"),security=normalized(".github/workflows/security-analysis.yml");
  let body=security.slice(security.indexOf("\njobs:\n")+7);const starts=[...body.matchAll(/^  ([a-zA-Z][\w-]*):$/gm)];
  const sections=Object.fromEntries(starts.map((match,index)=>[match[1],body.slice(match.index,starts[index+1]?.index??body.length).trim()]));
  assert.equal(Object.keys(sections).length,Object.keys(validation.preservedSecurityJobTextSha256).length+1);
  for(const[name,expected]of Object.entries(validation.preservedSecurityJobTextSha256))assert.equal(sha(sections[name]),expected,name);
  assert.match(sections["reclaim-v1"],/scripts\/reclaim\/compiler\.mjs/);assert.match(sections["reclaim-v1"],/analyze-rotation\.py/);
  assert.match(sections["reclaim-v1"],/forge test --root packages\/contracts\/reclaim/);
  assert.doesNotMatch(sections["reclaim-v1"],/--filter-paths|--exclude|--detect|continue-on-error/);
  assert.match(normalized(".github/workflows/ci.yml"),/node --test scripts\/reclaim\/\*\.test\.mjs/);
  const web=normalized(".github/workflows/launch-website-review.yml");
  assert.match(web,/--reclaim-only/);assert.match(web,/--profiles-only/);assert.match(web,/--treasury-only --treasury-v2/);
  assert.match(web,/browser: \[chromium, webkit\]/);assert.match(web,/scripts\/reclaim\/browser-public\.mjs/);
  assert.equal(validation.status,"WORKFLOW_STRUCTURE_VALIDATED_NOT_CI_EXECUTION");
});
