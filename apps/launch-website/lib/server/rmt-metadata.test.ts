import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {descriptionMetadata,originalRmtMetadataCID,rmtImageURL} from "../rmt-metadata";
import {artworkOrigin,assetPath} from "../token-artwork";
import {approvedMetadataURI} from "./rmt-metadata";
import {readArtwork,type ArtworkStore} from "./token-artwork";

test("draft UTF-8 bytes, original public image and bounded permanent URI are preserved",async()=>{
  const text="  "+ "🍀".repeat(120)+"\n\"end\"  ";
  const m=descriptionMetadata(text);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(m.bytes)),{name:"RMT",description:text,image:rmtImageURL});
  assert.ok(m.bytes.length>512 && Buffer.byteLength(m.projectURI)<=196);
  const store={get:async()=>m.bytes.buffer} as unknown as ArtworkStore;
  const r=await readArtwork(store,m.cid,"metadata.json");
  assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),Buffer.from(m.bytes));
  assert.notEqual(descriptionMetadata(text.trim()).cid,m.cid);
  assert.throws(()=>descriptionMetadata("é".repeat(251)));assert.throws(()=>descriptionMetadata(" "));
});
test("Task 102 record, other CIDs and an altered operational record cannot authorize creation",()=>{
  const m=descriptionMetadata("Fixture only");
  const raw=JSON.stringify({metadataCID:m.cid,operationsEvidenceSha256:"1".repeat(64)});
  const hash=createHash("sha256").update(raw).digest("hex");
  assert.equal(approvedMetadataURI(m.projectURI,hash,raw),true);
  assert.equal(approvedMetadataURI(m.projectURI,"0".repeat(64),raw),false);
  assert.equal(approvedMetadataURI(artworkOrigin+assetPath(originalRmtMetadataCID,"metadata.json"),hash,raw),false);
  assert.equal(approvedMetadataURI(descriptionMetadata("Different").projectURI,hash,raw),false);
});
