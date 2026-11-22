import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { reportedPng, phoneJpeg } from "./photo-fixtures.cjs";

// Use Apple's installed Safari/HEVC decoder and the same optimizer imported by both pickers.
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const bundle = await build({ entryPoints:[fileURLToPath(new URL("../lib/prepare-upload-image.ts",import.meta.url))],
  platform:"browser",format:"iife",globalName:"photo",bundle:true,write:false });
const files = new Map([
  ["/", ["text/html", '<script src="/intake.js"></script>']],
  ["/intake.js", ["text/javascript",bundle.outputFiles[0].contents]],
  ["/still.heic", ["image/heic",await readFile(new URL("./still-photo.heic",import.meta.url))]],
  ["/reported.png", ["image/png",await reportedPng()]],
  ["/phone.jpg", ["image/jpeg",await phoneJpeg()]],
]);
const server = createServer((req,res) => {
  const file = files.get(req.url);
  if (!file) { res.writeHead(404).end(); return; }
  res.writeHead(200,{"Content-Type":file[0]}).end(file[1]);
});
server.listen(0,"127.0.0.1"); await once(server,"listening");
const origin = "http://127.0.0.1:" + server.address().port;
async function driver(path, body) {
  const response = await fetch("http://127.0.0.1:4444"+path, { method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body) });
  const { value } = await response.json();
  assert.ok(response.ok, JSON.stringify(value)); return value;
}
let session;
try {
  const result = await driver("/session",{capabilities:{alwaysMatch:{browserName:"safari"}}});
  session = "/session/" + result.sessionId;
  await driver(session + "/url",{url:origin});
  for (const [path,kind,width,height] of [
    ["/still.heic","artwork",64,48],["/reported.png","avatar",512,512],["/phone.jpg","artwork",768,1024],
  ]) {
    const measured = await driver(session + "/execute/async",{args:[path,kind],script:`
      const [path,kind,done] = arguments;
      (async () => {
        const original = await (await fetch(path)).blob();
        const prepared = await photo.prepareUploadImage(new File([original],path,{type:original.type}),kind);
        const image = new Image(); image.src = URL.createObjectURL(prepared);
        try { await image.decode(); return {sourceBytes:original.size,mime:prepared.type,bytes:prepared.size,width:image.naturalWidth,height:image.naturalHeight}; }
        finally { URL.revokeObjectURL(image.src); }
      })().then(done,e=>done({error:e.message}));
    `});
    assert.deepEqual([measured.width,measured.height],[width,height],JSON.stringify(measured));
    assert.ok(["image/webp","image/jpeg"].includes(measured.mime) && measured.bytes > 0 && measured.bytes <= 2*1024*1024);
    console.log(JSON.stringify({safari:result.capabilities.browserVersion,path,kind,...measured}));
  }
} finally {
  if (session) await fetch("http://127.0.0.1:4444"+session,{method:"DELETE"});
  server.close();
}
