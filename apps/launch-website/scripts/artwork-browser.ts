import { createServer, request as forward } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { chromium, devices, webkit } from "playwright";
import { createRequire } from "node:module";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getStore } from "@netlify/blobs";
import { artworkCID, assetCID, assetPath } from "../lib/token-artwork";
import { acceptArtwork, artworkReviewStore, readArtwork } from "../lib/server/token-artwork";

async function main(){
  const next="http://127.0.0.1:"+(Number(process.env.ARTWORK_TEST_PORT) || 3189), wallet=privateKeyToAccount(generatePrivateKey());
  const scope={siteID:process.env.ARTWORK_REVIEW_SITE,token:process.env.ARTWORK_REVIEW_ACCESS,
    name:artworkReviewStore,consistency:"strong" as const};
  assert.ok(scope.siteID && scope.token,"Review-store access required in test process only.");
  const { reportedPng, phoneJpeg } = createRequire(import.meta.url)("./photo-fixtures.cjs");
  const png: Buffer = await reportedPng(), jpeg: Buffer = await phoneJpeg();
  for(const engine of ["chromium","webkit"] as const){
    const browser=await (engine==="chromium"?chromium:webkit).launch();
    let failed=true,receipt:{projectURI:string;artworkURL:string}|undefined;
    let origin="";
    const server=createServer(async (incoming,out)=>{
      try{
        const url=new URL(incoming.url!,origin);
        if(!url.pathname.startsWith("/api/artwork/")){
          const upstream=forward(next+url.pathname+url.search,{method:incoming.method,
            headers:{...incoming.headers,host:new URL(next).host,...(incoming.headers.origin?{origin:next}:{})}},r=>{
            out.writeHead(r.statusCode!,r.headers);r.pipe(out);
          });
          upstream.on("error",()=>out.destroy());incoming.pipe(upstream);return;
        }
        let res:Response;
        if(url.pathname==="/api/artwork/upload"){
          if(failed){failed=false;incoming.resume();out.writeHead(503,{"content-type":"application/json"});out.end(JSON.stringify({error:"Storage temporarily unavailable. Retry."}));return;}
          const chunks:Buffer[]=[];for await(const chunk of incoming) chunks.push(chunk);
          const req=new Request(url,{method:"POST",headers:incoming.headers as Record<string,string>,body:new Uint8Array(Buffer.concat(chunks))});
          res=await acceptArtwork(req,{origin,owner:wallet.address,store:()=>getStore(scope)});
          if(res.ok)receipt=await res.clone().json();
        }else{const [, , ,cid,file]=url.pathname.split("/");res=await readArtwork(getStore(scope),cid,file);}
        out.writeHead(res.status,Object.fromEntries(res.headers));out.end(Buffer.from(await res.arrayBuffer()));
      }catch{out.writeHead(500);out.end();}
    });
    server.listen(0,"127.0.0.1");await once(server,"listening");
    origin="http://127.0.0.1:"+(server.address() as {port:number}).port;
    try{
      const context=await browser.newContext(engine==="webkit"?devices["iPhone 13"]:{viewport:{width:1440,height:900}});
      const page=await context.newPage(); page.setDefaultTimeout(30000);
      const methods:string[]=[];
      await page.exposeFunction("artworkWallet",async(method:string,params:string[])=>{
        methods.push(method);
        if(["eth_accounts","eth_requestAccounts"].includes(method))return [wallet.address];
        if(method==="eth_chainId")return "0x1237";
        assert.equal(method,"personal_sign");
        const message=Buffer.from(params[0].slice(2),"hex").toString();
        assert.ok(message.startsWith("Save public token artwork to "+origin)); assert.match(message,/No transaction/);
        return wallet.signMessage({message});
      });
      await page.addInitScript({content: `(() => {
        const listeners=new Map(), w=window;
        w.ethereum={isMetaMask:true,request:({method,params})=>w.artworkWallet(method,params),
          on:(e,f)=>{if(!listeners.has(e))listeners.set(e,new Set());listeners.get(e).add(f);},
          removeListener:(e,f)=>listeners.get(e)?.delete(f)};
        w.artworkDisconnect=()=>listeners.get("disconnect")?.forEach(f=>f());
      })();`});
      await page.goto(origin+"/create-token",{timeout:120000});
      const picker=page.getByLabel("Token image",{exact:true}),save=page.getByRole("button",{name:"Save artwork",exact:true});
      await page.waitForFunction(() => document.querySelector<HTMLInputElement>("#token-logo-file")?.disabled === false);
      await picker.setInputFiles({name:"unsupported.svg",mimeType:"image/svg+xml",buffer:Buffer.from("<svg/>")});
      await page.getByText("Choose a still JPEG, PNG, WebP or HEIC photo.").waitFor();
      await picker.setInputFiles({name:"large.png",mimeType:"image/png",buffer:Buffer.alloc(24*1024*1024+1)});
      await page.getByText("Choose a photo up to 24 MiB.",{exact:true}).waitFor();
      await picker.setInputFiles({name:"photo.heic",mimeType:"image/heic",buffer:readFileSync(new URL("./still-photo.heic",import.meta.url))});
      await page.getByText(/Preview ready|This browser could not open this HEIC photo/).waitFor();
      const heic = await page.locator(".lpArtworkPicker [role=status]").innerText();
      await picker.setInputFiles({name:"incomplete.png",mimeType:"image/png",buffer:png.subarray(0,45)});
      await page.getByText("Incomplete PNG image.").waitFor();
      await picker.setInputFiles({name:"reported.png",mimeType:"image/png",buffer:png});
      await page.getByText(/Preview ready/).waitFor();
      assert.equal(await page.getByAltText("Token artwork preview").evaluate(async img => {
        const image = img as HTMLImageElement; await image.decode(); return image.naturalWidth;
      }),1024);
      const original = engine === "webkit" ? jpeg : png;
      if (engine === "webkit") await picker.setInputFiles({name:"phone.jpg",mimeType:"image/jpeg",buffer:original});
      else await picker.evaluate((input, encoded) => {
        const data = new DataTransfer(), bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
        data.items.add(new File([bytes],"dropped.png",{type:"image/png"}));
        input.dispatchEvent(new DragEvent("drop",{dataTransfer:data,bubbles:true,cancelable:true}));
      }, png.toString("base64"));
      await page.waitForFunction(() => !(document.querySelector("#token-logo-file") as HTMLInputElement).disabled);
      await page.getByAltText("Token artwork preview").waitFor(); assert.equal(await page.getByRole("button",{name:"Review draft"}).isDisabled(),true);
      await page.reload();await save.waitFor();
      await save.click();
      await page.getByRole("button",{name:"Connect MetaMask",exact:true}).click();
      await page.waitForFunction(()=>!document.body.innerText.includes("Connect MetaMask"));
      await save.click();await page.getByText("Storage temporarily unavailable. Retry.").waitFor();
      await page.evaluate(()=>(window as any).artworkDisconnect());await page.getByRole("button",{name:"Connect MetaMask",exact:true}).click();
      await page.waitForFunction(()=>!document.body.innerText.includes("Connect MetaMask"));
      await save.click();await page.getByText("Artwork saved and verified.").waitFor({timeout:90000}).catch(async(e)=>{throw Error(e.message+" "+await page.locator(".lpArtworkPicker").innerText());});
      assert.ok(receipt);const cid=assetCID(receipt.projectURI,"metadata.json")!;
      await page.reload(); await page.getByAltText("Token artwork preview").waitFor();
      await page.getByLabel("Token name",{exact:true}).fill("Artwork Fixture");await page.getByLabel("Ticker",{exact:true}).fill("ART");
      await page.getByRole("button",{name:"Review draft"}).click();
      await page.getByRole("heading",{name:"Review token draft"}).waitFor();
      if(process.env.ARTWORK_EVIDENCE) await page.screenshot({path:join(process.env.ARTWORK_EVIDENCE,engine+"-artwork-review.png")});
      const dimensions = await page.locator('img[src="'+assetPath(cid,"logo.webp")+'"]').evaluate(async (el)=>{
        const img = el as HTMLImageElement; await img.decode(); return [img.naturalWidth,img.naturalHeight];
      });
      assert.deepEqual(dimensions,engine==="webkit"?[768,1024]:[1024,1024]);
      await page.getByRole("button",{name:"Edit draft"}).click();
      await page.getByRole("button",{name:"Remove draft image"}).click();
      await page.getByText("Project information",{exact:true}).click();
      await page.getByText("Advanced URLs",{exact:true}).click();
      await page.getByLabel("Artwork URL",{exact:true}).fill(receipt.artworkURL);
      await page.getByRole("button",{name:"Use saved image URL"}).click();
      await page.getByRole("button",{name:"Remove draft image"}).waitFor();
      const persisted=await readArtwork(getStore(scope),cid,"logo.webp");
      assert.equal(artworkCID(new Uint8Array(await persisted.arrayBuffer())),assetCID(receipt.artworkURL,"image.webp"));
      assert.ok(methods.every(m=>["eth_accounts","eth_chainId","eth_requestAccounts","personal_sign"].includes(m)));
      console.log(JSON.stringify({engine,mobile:engine==="webkit",metadata:receipt.projectURI,image:receipt.artworkURL,storage:artworkReviewStore,
        pngBytes:png.length,phoneJpegBytes:jpeg.length,dimensions,heic,retry:true,reconnected:true,restored:true,reviewed:true,transactionRequests:0}));
    }finally{await browser.close(); server.closeAllConnections(); server.close();}
  }
}
main().catch(err=>{console.error(err.message);process.exitCode=1;});
