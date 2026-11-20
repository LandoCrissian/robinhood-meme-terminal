import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,realpathSync,lstatSync,rmSync} from "node:fs";
import {gunzipSync,gzipSync} from "node:zlib";
import {tmpdir} from "node:os";
import {join,dirname,basename} from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../../../../",import.meta.url)),out=name=>new URL(name,import.meta.url),sha=bytes=>createHash("sha256").update(bytes).digest("hex"),json=value=>JSON.stringify(value,null,2)+"\n";
const temporaryRoot=realpathSync(tmpdir()),temporary=realpathSync(mkdtempSync(join(temporaryRoot,"rmt-task087-binding-scan-"))),scan=join(temporary,"scan");mkdirSync(scan);
try{
 const files=[];
 for(const [attempt,path]of[["initial","initial-attempt/raw-binding-responses.json.gz"],["final","raw-binding-responses.json.gz"]]){
  const raw=gunzipSync(readFileSync(out(path)),{maxOutputLength:8*1024*1024}),rows=JSON.parse(raw);assert.ok(rows.length<=512);
  let line=2;const ranges=[],parts=[];for(const[rowIndex,row]of rows.entries()){assert.ok(row.method==="GET"||row.method==="POST"&&["eth_chainId","eth_getBlockByNumber","eth_getCode","eth_call"].includes(row.request?.method));assert.equal(row.authorizationUsed,false);const part=JSON.stringify(row,null,2).split("\n").map(text=>"  "+text).join("\n"),count=part.split("\n").length;ranges.push({attempt,path,rowIndex,row,start:line,end:line+count-1});parts.push(part);line+=count;}
  assert.equal(Buffer.from("[\n"+parts.join(",\n")+"\n]\n").compare(raw),0,"Exact original envelope bytes must be scanned");
  const envelopeName=attempt+"-envelopes.json";writeFileSync(join(scan,envelopeName),raw);files.push({name:envelopeName,bytes:raw.length,sha256:sha(raw),ranges});
  let text="",bodyLine=1;const bodyRanges=[];for(const[rowIndex,row]of rows.entries())if(typeof row.rawUtf8==="string"){assert.equal(sha(Buffer.from(row.rawUtf8)),row.sha256);const part=`PUBLIC_READ ${attempt} ROW ${rowIndex} ${row.url}\n`+row.rawUtf8+"\n\n",count=part.split("\n").length-1;bodyRanges.push({attempt,path,rowIndex,row,start:bodyLine,end:bodyLine+count-1});text+=part;bodyLine+=count;}
  const bodyName=attempt+"-http-bodies.txt",body=Buffer.from(text);writeFileSync(join(scan,bodyName),body);files.push({name:bodyName,bytes:body.length,sha256:sha(body),ranges:bodyRanges});
 }
 const scanner="C:/Users/RMT/.codex/tools/gitleaks-v8.30.1/gitleaks.exe",version=execFileSync(scanner,["version"],{encoding:"utf8",windowsHide:true}).trim();assert.equal(version,"8.30.1");const reportPath=join(temporary,"report.json");let exitCode=0;
 try{execFileSync(scanner,["dir",scan,"--config",join(root,".gitleaks.toml"),"--report-format","json","--report-path",reportPath,"--no-banner"],{cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"],timeout:60000});}catch(error){exitCode=error.status??-1;}
 const rawReport=readFileSync(reportPath),findings=JSON.parse(rawReport),classified=[];let unknown=0;
 for(const[index,finding]of findings.entries()){const file=files.find(file=>file.name===basename(finding.File)),range=file?.ranges.find(range=>finding.StartLine>=range.start&&finding.EndLine<=range.end),row=range?.row,secret=finding.Secret,publicValue=typeof secret==="string"&&secret.length>0&&row&&(row.rawUtf8?.includes(secret)||JSON.stringify(row.request??null).includes(secret));
  if(!publicValue){unknown++;classified.push({index,ruleId:finding.RuleID,status:"UNKNOWN_REQUIRES_REVIEW"});continue;}
  classified.push({index,ruleId:finding.RuleID,status:"EXACT_PUBLIC_READ_VALUE",scanFile:file.name,startLine:finding.StartLine,endLine:finding.EndLine,secretSha256:sha(Buffer.from(secret)),originalArchive:range.path,rowIndex:range.rowIndex,responseSha256:row.sha256??null,url:row.url,method:row.request?.method??"PUBLIC_GET",classification:row.request?.method==="eth_getCode"?"PUBLIC_RUNTIME_BYTECODE":row.request?.method==="eth_call"?"PUBLIC_GETTER_RESPONSE_OR_FIXED_READ_REQUEST":row.request?.method==="eth_getBlockByNumber"?"PUBLIC_BLOCK_HEADER":row.method==="GET"?"PUBLIC_HTTP403_BODY":"PUBLIC_FIXED_READ_REQUEST"});
 }
 writeFileSync(out("raw-gitleaks-report.json.gz"),gzipSync(rawReport,{level:9}));const classificationBytes=Buffer.from(json({schemaVersion:1,findings:findings.length,classifiedFindings:classified.length-unknown,unknown,classifications:classified}));writeFileSync(out("privacy-classifications.json.gz"),gzipSync(classificationBytes,{level:9}));
 writeFileSync(out("privacy-manifest.json"),json({schemaVersion:1,scope:"ORIGINAL_ENVELOPES_AND_UNESCAPED_PUBLIC_HTTP_BODIES",scanner:{name:"Gitleaks",version,executableSha256:sha(readFileSync(scanner)),configurationSha256:sha(readFileSync(join(root,".gitleaks.toml"))),suppressionsAdded:false,exitCode},files:files.map(({name,bytes,sha256})=>({name,bytes,sha256})),rawFindings:findings.length,classifiedPublicFindings:classified.length-unknown,unknown,originalReportRawSha256:sha(rawReport),originalReportStoredSha256:sha(readFileSync(out("raw-gitleaks-report.json.gz"))),classificationsRawSha256:sha(classificationBytes),classificationsStoredSha256:sha(readFileSync(out("privacy-classifications.json.gz"))),producerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),limitations:["A classified public-byte match does not change the original scanner exit or suppress a detector.","Only credential-free, fixed public read responses are classified; unknown matches remain review blockers."]}));
 console.log(json({exitCode,findings:findings.length,classified:classified.length-unknown,unknown,files:files.length}));assert.equal(unknown,0,"UNKNOWN_PRIVACY_MATCHES");assert.ok(exitCode===0||exitCode===1&&findings.length>0);
}finally{assert.equal(dirname(temporary),temporaryRoot);assert.ok(/^rmt-task087-binding-scan-[A-Za-z0-9]+$/.test(basename(temporary)));assert.equal(lstatSync(temporary).isSymbolicLink(),false);assert.equal(realpathSync(temporary),temporary);rmSync(temporary,{recursive:true,force:true});}
