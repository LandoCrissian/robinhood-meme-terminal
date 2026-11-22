import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { reportedPng, phoneJpeg } from "./photo-fixtures.cjs";

const require = createRequire(import.meta.url), sharp = require("sharp");
const root = fileURLToPath(new URL("../",import.meta.url));
const origin = "http://localhost:3289";
const files = [
  {name:"still.heic", bytes:await readFile(new URL("./still-photo.heic",import.meta.url)), width:64,height:48},
  {name:"reported.png", bytes:await reportedPng(), width:1024,height:1024},
  {name:"phone.jpg", bytes:await phoneJpeg(), width:768,height:1024},
];
const fixtureDir = new URL("../.next/static/photo-check/",import.meta.url);
await mkdir(fixtureDir,{recursive:true});
for (const {name,bytes} of files) await writeFile(new URL(name,fixtureDir),bytes);
const next = spawn(process.execPath,[require.resolve("next/dist/bin/next"),"start","-H","localhost","-p","3289"],{cwd:root,stdio:"inherit"});
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function driver(path,body) {
  const res = await fetch("http://127.0.0.1:4444"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const {value} = await res.json(); assert.ok(res.ok,JSON.stringify(value)); return value;
}
let session;
try {
  let ready = false;
  for (let i=0;i<60 && !ready;i++) {
    ready = await fetch(origin+"/create-token").then(r=>r.ok).catch(()=>false);
    if (!ready) await delay(500);
  }
  assert.ok(ready);
  const result = await driver("/session",{capabilities:{alwaysMatch:{browserName:"safari"}}});
  session = "/session/"+result.sessionId;
  await driver(session+"/url",{url:origin+"/create-token"});
  const check = [];
  for (const {name,bytes,width,height} of files) {
    const measured = await driver(session+"/execute/async",{args:[name],script:`
      const [name,done]=arguments;
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      (async()=>{
        const deadline=Date.now()+20000;
        const picker=document.querySelector("#token-logo-file");
        while(picker?.disabled && Date.now()<deadline) await sleep(40);
        if(!picker || picker.disabled) throw Error("File picker unavailable");
        const res=await fetch("/_next/static/photo-check/"+name);
        const blob=await res.blob();
        const type={"heic":"image/heic","png":"image/png","jpg":"image/jpeg"}[name.split(".").pop()];
        const dt=new DataTransfer(); dt.items.add(new File([blob],name,{type}));
        picker.files=dt.files; picker.dispatchEvent(new Event("change",{bubbles:true}));
        await sleep(80);
        const notice=()=>document.querySelector(".lpArtworkPicker [role=status]")?.textContent;
        while((picker.disabled || !notice()) && Date.now()<deadline) await sleep(40);
        if(!notice()?.startsWith("Preview ready")) throw Error(notice() || "No preview");
        const image=document.querySelector('img[alt="Token artwork preview"]');
        await image.decode();
        const saved=await new Promise((resolve,reject)=>{
          const open=indexedDB.open("rmt-token-artwork",1);
          open.onerror=()=>reject(open.error);
          open.onsuccess=()=>{const db=open.result, request=db.transaction("draft").objectStore("draft").get("pending");
            request.onsuccess=()=>{resolve(request.result);db.close();};request.onerror=()=>{db.close();reject(request.error);};};
        });
        const file=new Blob([saved.bytes],{type:saved.type});
        const data=new FileReader();const encoded=new Promise((resolve,reject)=>{data.onload=()=>resolve(data.result);data.onerror=reject;});
        let sample;
        if(name==="still.heic"){data.readAsDataURL(file);sample=await encoded;}
        return {width:image.naturalWidth,height:image.naturalHeight,size:file.size,mime:file.type,sample};
      })().then(done,e=>done({error:e.message}));
    `});
    if (measured.sample) {
      const raw=await sharp(Buffer.from(measured.sample.split(",")[1],"base64")).removeAlpha().raw().toBuffer();
      const center=3*(32+24*64);
      measured.centerRGB=[...raw.subarray(center,center+3)]; delete measured.sample;
    }
    console.log(JSON.stringify({safari:result.capabilities.browserVersion,name,originalBytes:bytes.length,...measured}));
    check.push({name,measured,width,height});
  }
  for(const {name,measured,width,height} of check){
    assert.deepEqual([measured.width,measured.height],[width,height],JSON.stringify({name,measured}));
    assert.ok(["image/webp","image/jpeg"].includes(measured.mime) && measured.size>0 && measured.size<=2097152);
    if(name==="still.heic") assert.ok(measured.centerRGB.every((v,i)=>Math.abs(v-[124,64,29][i])<12),"HEIC preview pixels differ from the source");
  }
} finally {
  if(session) await fetch("http://127.0.0.1:4444"+session,{method:"DELETE"});
  next.kill();
}
