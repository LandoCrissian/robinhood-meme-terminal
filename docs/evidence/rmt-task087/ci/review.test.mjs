import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
const root=new URL("./",import.meta.url),manifest=JSON.parse(readFileSync(new URL("manifest.json",root)));
test("all three original source-bound CI rosters are complete and strict failures are not waived",()=>{
 assert.equal(manifest.pullRequest,680);assert.equal(manifest.records.length,3);
 const failed=["fixed-supply-4663","project-treasury-v1","reclaim-permanent-v2","reclaim-v1","seaport-vault-strict-security","slither"].sort();
 for(const record of manifest.records){const archive=readFileSync(new URL(record.archive,root));assert.equal(archive.length,record.archiveBytes);assert.equal(createHash("sha256").update(archive).digest("hex"),record.archiveSha256);const bytes=gunzipSync(archive);assert.equal(bytes.length,record.bytes);assert.equal(createHash("sha256").update(bytes).digest("hex"),record.sha256);assert.equal(readFileSync(new URL(record.file,root),"utf8").replaceAll("\r\n","\n"),bytes.toString("utf8").replaceAll("\r\n","\n"));const data=JSON.parse(bytes),rows=data.checks;assert.equal(data.total_count,21);assert.equal(rows.length,21);assert.equal(new Set(rows.map(row=>row.id)).size,21);for(const row of rows){assert.equal(row.head_sha,record.source);assert.equal(row.status,"completed");assert.ok(row.started_at&&row.completed_at&&row.details_url.startsWith("https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/"));}
  assert.equal(rows.filter(row=>row.conclusion==="success").length,record.counts.success);assert.equal(rows.filter(row=>row.conclusion==="failure").length,record.counts.failure);
  if(record.source==="1f7160f5db5d67de348e041a84ccc2889786217e"){assert.equal(record.counts.success,15);assert.equal(record.counts.failure,6);assert.deepEqual(rows.filter(row=>row.conclusion==="failure").map(row=>row.name).sort(),failed);}else{assert.equal(record.counts.success,14);assert.equal(record.counts.failure,7);assert.ok(rows.some(row=>row.name==="repository"&&row.conclusion==="failure"));}
 }
});
