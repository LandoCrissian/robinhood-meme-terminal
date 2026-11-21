import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { artworkCID, artworkOrigin, artworkProof, assetCID, inspectArtwork } from "../token-artwork";
import { acceptArtwork, readArtwork, uploadArtwork, type ArtworkStore } from "./token-artwork";

test("canonical raw CIDv1 and exact same-origin metadata URLs",()=>{
  const cid=artworkCID(new Uint8Array());
  assert.equal(cid,"bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku");
  const uri=artworkOrigin+"/api/artwork/"+cid+"/metadata.json";
  assert.equal(assetCID(uri,"metadata.json"),cid);
  for (const bad of [uri+"?x",uri+"#x",uri.replace("www.","other."),uri.replace("metadata","../metadata")]) assert.equal(assetCID(bad,"metadata.json"),undefined);
});

test("signed single-file writes enforce origin, signer, replay scope, quota, integrity and normalization",async()=>{
  const wallet=privateKeyToAccount(generatePrivateKey()), other=privateKeyToAccount(generatePrivateKey());
  const values=new Map<string,ArrayBuffer|string>();
  const store={ async set(key:string,data:ArrayBuffer|string) { if(values.has(key))return {modified:false}; values.set(key,data);return {modified:true}; },
    async get(key:string) { return values.get(key) ?? null; } } as unknown as ArtworkStore;
  const policy={origin:artworkOrigin,owner:wallet.address,store:()=>store};
  async function make(bytes:Buffer,mime:string,signer=wallet,time=Date.now(),alter:Record<string,string>={}) {
    const cid=artworkCID(bytes),proof=await signer.signMessage({message:artworkProof(artworkOrigin,signer.address,cid,time)});
    return new Request(artworkOrigin+"/api/artwork/upload",{method:"POST",body:new Uint8Array(bytes),headers:{
      host:"www.rmtlaunch.fun",origin:artworkOrigin,"content-type":mime,"x-artwork-cid":cid,"x-artwork-issued":String(time),"x-artwork-proof":proof,...alter}});
  }
  const input=()=>sharp({create:{width:17,height:41,channels:3,background:"green"}});
  const jpeg=await input().jpeg().withMetadata({orientation:6}).toBuffer();
  assert.equal((await uploadArtwork(await make(jpeg,"image/jpeg"))).status,404);
  assert.equal((await acceptArtwork(await make(jpeg,"image/jpeg",other),policy)).status,401);
  assert.equal((await acceptArtwork(await make(jpeg,"image/jpeg",wallet,Date.now()-300001),policy)).status,401);
  assert.equal((await acceptArtwork(await make(jpeg,"image/jpeg",wallet,Date.now(),{origin:"https://invalid.example"}),policy)).status,403);
  const png=await input().png().toBuffer(), oversized=Buffer.from(png); oversized.writeUInt32BE(100_000,16);
  for(const [bytes,mime] of [[jpeg,"image/png"],[png.subarray(0,33),"image/png"],[Buffer.from("<svg/>"),"image/svg+xml"],
    [oversized,"image/png"],[Buffer.alloc(2*1024*1024+1),"image/png"]] as const)
    assert.ok((await acceptArtwork(await make(bytes,mime),policy)).status>=400);
  assert.equal(values.size,0);
  let metaCID="";
  for(const [bytes,mime] of [[jpeg,"image/jpeg"],[png,"image/png"],[await input().webp({lossless:true}).toBuffer(),"image/webp"]] as const) {
    const receipts=await Promise.all([1,2].map(async()=>{ const r=await acceptArtwork(await make(bytes,mime),policy); assert.equal(r.status,200);return r.json(); }));
    assert.deepEqual(receipts[0],receipts[1]);
    const {projectURI,artworkURL}=receipts[0]; metaCID=assetCID(projectURI,"metadata.json")!;
    const metadata=await readArtwork(store,metaCID,"metadata.json"), image=await readArtwork(store,metaCID,"logo.webp");
    assert.deepEqual(await metadata.json(),{image:artworkURL}); assert.equal(image.headers.get("Content-Type"),"image/webp");
    const output=Buffer.from(await image.arrayBuffer());assert.equal(artworkCID(output),assetCID(artworkURL,"image.webp"));
    if(mime==="image/jpeg") {const m=await sharp(output).metadata();assert.equal(m.width,41);assert.equal(m.height,17);assert.equal(m.exif,undefined);}
  }
  for(let i=0;i<6;i++){
    const bytes=await sharp({create:{width:12+i,height:13,channels:3,background:"red"}}).png().toBuffer();
    assert.equal((await acceptArtwork(await make(bytes,"image/png"),policy)).status,i===5?429:200);
  }
  values.set("objects/"+metaCID,new Uint8Array([42]).buffer);
  assert.equal((await readArtwork(store,metaCID,"metadata.json")).status,503);
  assert.throws(()=>inspectArtwork(oversized,"image/png"),/megapixels/);
});
