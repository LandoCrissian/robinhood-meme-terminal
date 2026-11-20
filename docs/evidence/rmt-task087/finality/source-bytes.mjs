import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root=new URL('../../../../',import.meta.url),here=new URL('./',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const eolPaths=new Set(['docs/evidence/fixed-supply-release/l1-batches.json','docs/evidence/mobile-signing/factory-publication-scheduled.json']);
const executedProducer='docs/evidence/rmt-task087/finality/corroborate-exact-receipt.mjs';
const normalized=b=>Buffer.from(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b).replaceAll('\r\n','\n'));
export function compareCapturedBytes(expected,current,capsule,raw,{allowArchivedProducer=false}={}){
 if(sha(current)===expected.sha256)return{path:expected.path,identity:'CURRENT_EXACT_BYTES',sha256:expected.sha256};
 assert.ok(capsule,'No exact captured source capsule');assert.equal(capsule.path,expected.path);assert.equal(capsule.capturedSha256,expected.sha256);assert.equal(sha(raw),expected.sha256);assert.equal(sha(normalized(raw)),capsule.canonicalLfSha256);
 if(capsule.kind==='JSON_EOL_ONLY'){assert.ok(eolPaths.has(expected.path),'EOL equivalence is restricted to the two exact inherited JSON paths');assert.equal(sha(normalized(current)),capsule.canonicalLfSha256,'Source differs beyond CRLF/LF');return{path:expected.path,identity:'EXACT_CAPTURED_JSON_WITH_ONLY_CRLF_LF_DIFFERENCE',sha256:expected.sha256,canonicalLfSha256:capsule.canonicalLfSha256};}
 assert.equal(capsule.kind,'EXECUTED_PRODUCER');assert.equal(expected.path,executedProducer);assert.equal(allowArchivedProducer,true,'Archived producer verification must be explicit');return{path:expected.path,identity:'RETAINED_EXACT_EXECUTED_PRODUCER',sha256:expected.sha256,currentFileDiffers:true};
}
export function verifyCapturedSource(expected,options={}){
 const current=readFileSync(new URL(expected.path,root));if(sha(current)===expected.sha256)return compareCapturedBytes(expected,current);
 const index=JSON.parse(readFileSync(new URL('source-capsules.json',here))),capsule=index.entries.find(x=>x.path===expected.path&&x.capturedSha256===expected.sha256);assert.ok(capsule,'Missing exact captured source capsule');assert.ok(/^source-capsules\/[A-Za-z0-9.-]+\.gz$/.test(capsule.storedPath));const stored=readFileSync(new URL(capsule.storedPath,here));assert.equal(sha(stored),capsule.storedSha256);return compareCapturedBytes(expected,current,capsule,gunzipSync(stored),options);
}
