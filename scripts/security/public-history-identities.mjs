import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";

const repository=fileURLToPath(new URL("../../",import.meta.url));
const policyPath="docs/evidence/rmt-task082/history/exact-public-identities.json";
const policySha="2f213f9e480c4fe89c7926caec316228494fa6f0b65a2d85727ac912c49f42e3";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const git=(commit,path)=>execFileSync("git",["show",`${commit}:${path}`],{cwd:repository,windowsHide:true,maxBuffer:4*1024*1024});
const fail=()=>{throw Error("Exact public Git identity proof is unavailable or changed");};

/** This is report adjudication AFTER an unchanged full-history raw scan.
 * It never changes scanner rules, ignores, findings or financial release gates.
 * Every permitted identity is bound to an immutable commit, blob and source line.
 */
export function verifyHistoryPublicIdentities(findings,{readGit=git,configuration=readFileSync(new URL("../../.gitleaks.toml",import.meta.url)),policyBytes=readFileSync(new URL("../../"+policyPath,import.meta.url)),ignoreBytes=readFileSync(new URL("../../.gitleaksignore",import.meta.url))}={}){
  try{
    assert.equal(sha(Buffer.from(policyBytes).toString().replaceAll("\r\n","\n")),policySha);const policy=JSON.parse(policyBytes);assert.equal(policy.records.length,5);
    assert.equal(Buffer.from(ignoreBytes).toString().replaceAll("\r\n","\n"),readGit(policy.baselineCommit,".gitleaksignore").toString());
    const originalConfig=readGit(policy.baselineCommit,".gitleaks.toml");assert.equal(sha(originalConfig),policy.scannerConfigurationSha256);
    assert.equal(Buffer.from(configuration).toString().replaceAll("\r\n","\n"),originalConfig.toString());
    const proof=new Map();
    for(const record of policy.records){
      assert.match(record.commit,/^[0-9a-f]{40}$/);assert.match(record.path,/^(?:scripts\/nft-marketplace\/probe-4663\.mjs|apps\/launch-website\/lib\/server\/nft-acquisition-snapshot\.test\.json|docs\/evidence\/rmt-task082\/seaport-marketplace\/source-manifest\.json)$/);
      const blob=readGit(record.commit,record.path);assert.ok(blob.length<=65536);assert.equal(sha(blob),record.blobSha256);
      const gitBlob=createHash("sha1").update(Buffer.from(`blob ${blob.length}\0`)).update(blob).digest("hex");assert.equal(gitBlob,record.gitBlobSha1);
      const lines=blob.toString().split(/(?<=\n)/),line=lines[record.line-1];assert.equal(sha(line),record.lineSha256);
      let value;
      if(record.field==="conduitKey"){
        const match=line.match(/conduitKey:"(0x[0-9a-f]{64})"/);assert.ok(match);value=match[1];
        const old=JSON.parse(readGit(policy.baselineCommit,"docs/evidence/rmt-task081/marketplace/git-history-disposition.json"));
        assert.equal(old.finding.fingerprint,record.fingerprint);assert.equal(old.binding.valueSha256Utf8Lowercase,record.publicValueSha256);
        const market=JSON.parse(gunzipSync(readGit(policy.baselineCommit,"docs/evidence/rmt-task081/marketplace/robinhood-4663.json.gz"),{maxOutputLength:1024*1024}));
        assert.equal(market.pins.conduitKey,value);assert.equal(market.bindingsObserved,true);
        assert.equal(market.sources.sdkConstants.sha256,old.binding.officialSourceSha256);
        for(const name of ["official","pocket"]){const p=market.providers[name];assert.equal(p.chain.value,4663);assert.equal(p.conduitBinding.status,"observed");assert.equal(p.conduitBinding.value[0].toLowerCase(),market.pins.conduit.toLowerCase());assert.equal(p.conduitBinding.value[1],true);}
      }else if(record.publicKind==="PUBLIC_SOURCE_RESPONSE_SHA256"){
        assert.equal(record.field,"sourceApiRawSha256");assert.ok(["seaport","controller"].includes(record.sourceInput));
        const manifest=JSON.parse(blob),entry=manifest.inputs[record.sourceInput];value=entry.sourceApiRawSha256;assert.match(value,/^[0-9a-f]{64}$/);
        assert.equal(entry.sourceApi,record.publicSourceUrl);const url=new URL(entry.sourceApi);assert.equal(url.protocol,"https:");assert.equal(url.host,"sourcify.dev");assert.equal(url.username,"");assert.equal(url.password,"");
        assert.ok(line.includes(`"sourceApiRawSha256": "${value}"`));
        assert.match(record.responseArchive,/^docs\/evidence\/rmt-task082\/seaport-marketplace\/(?:sourcify-seaport-4663|controller-mainnet)\.json\.gz$/);
        const response=gunzipSync(readGit(record.commit,record.responseArchive),{maxOutputLength:8*1024*1024});assert.equal(sha(response),value);assert.ok(JSON.parse(response));
      }else{
        assert.ok(["projectToken","paymentToken"].includes(record.field));const snapshot=JSON.parse(blob);
        assert.equal(snapshot.profile,"rmt-nft-acquisition-local-v1");assert.equal(snapshot.chainId,31337);assert.equal(snapshot.executionEnabled,false);
        value=snapshot[record.field];assert.match(value,/^0x[0-9a-f]{40}$/i);
        assert.ok(line.includes(`"${record.field}": "${value}"`));
      }
      assert.equal(sha(value.toLowerCase()),record.publicValueSha256);proof.set(record.fingerprint,record);
    }
    assert.ok(Array.isArray(findings)&&findings.length<=1024);const classified=[],unclassified=[],seen=new Set();
    for(const row of findings){const record=proof.get(row.Fingerprint);const valid=record&&!seen.has(row.Fingerprint)&&row.RuleID===record.ruleId&&row.Commit===record.commit&&row.File===record.path&&row.StartLine===record.line&&row.EndLine===record.line&&row.Secret==="REDACTED"&&typeof row.Match==="string"&&row.Match.includes(record.field)&&row.Match.includes("REDACTED");
      if(valid){seen.add(row.Fingerprint);classified.push({fingerprint:record.fingerprint,kind:record.publicKind,commit:record.commit,gitBlobSha1:record.gitBlobSha1,lineSha256:record.lineSha256,publicValueSha256:record.publicValueSha256});}
      else unclassified.push({fingerprint:typeof row?.Fingerprint==="string"?row.Fingerprint.slice(0,400):"invalid",ruleId:typeof row?.RuleID==="string"?row.RuleID.slice(0,80):"invalid"});
    }
    const missing=[...proof.keys()].filter(key=>!seen.has(key));
    return{schemaVersion:1,scope:"FULL_HISTORY_RAW_SCAN_EXACT_PUBLIC_DATA_ADJUDICATION",status:unclassified.length||missing.length?"BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING":"PASSED_EXACT_PUBLIC_DATA_ONLY",rawFindingCount:findings.length,classified,unclassified,missing,rawScanPassed:findings.length===0,detectorsChanged:false,ignoreAdded:false,financialSecurityClearance:false,productionAuthorization:false};
  }catch{fail();}
}
