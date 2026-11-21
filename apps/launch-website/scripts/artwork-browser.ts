import { join } from "node:path";
import assert from "node:assert/strict";
import { chromium, devices, webkit } from "playwright";
import sharp from "sharp";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getStore } from "@netlify/blobs";
import { artworkCID, assetCID, assetPath } from "../lib/token-artwork";
import { acceptArtwork, artworkReviewStore, readArtwork } from "../lib/server/token-artwork";

async function main(){
  const origin="http://127.0.0.1:3189", wallet=privateKeyToAccount(generatePrivateKey());
  const scope={siteID:process.env.ARTWORK_REVIEW_SITE,token:process.env.ARTWORK_REVIEW_ACCESS,
    name:artworkReviewStore,consistency:"strong" as const};
  assert.ok(scope.siteID && scope.token,"Review-store access required in test process only.");
  const logo=await sharp({create:{width:43,height:27,channels:3,background:"#bc6014"}}).png().toBuffer();
  for(const engine of ["chromium","webkit"] as const){
    const browser=await (engine==="chromium"?chromium:webkit).launch();
    try{
      const context=await browser.newContext(engine==="webkit"?devices["iPhone 13"]:{viewport:{width:1440,height:900}});
      const page=await context.newPage(); page.setDefaultTimeout(30000);
      let failed=true,receipt:{projectURI:string;artworkURL:string}|undefined;
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
      await page.route(origin+"/api/artwork/**",async route=>{
        const r=route.request(),u=new URL(r.url());let res:Response;
        if(u.pathname==="/api/artwork/upload"){
          if(failed){failed=false;await route.fulfill({status:503,json:{error:"Storage temporarily unavailable. Retry."}});return;}
          const h=await r.allHeaders();
          const req=new Request(u,{method:"POST",headers:{...h,host:u.host,origin},body:new Uint8Array(r.postDataBuffer()!)});
          res=await acceptArtwork(req,{origin,owner:wallet.address,store:()=>getStore(scope)});
          if(res.ok)receipt=await res.clone().json();
        }else{const [, , ,cid,file]=u.pathname.split("/");res=await readArtwork(getStore(scope),cid,file);}
        await route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body:Buffer.from(await res.arrayBuffer())});
      });
      await page.goto(origin+"/create-token",{timeout:120000});
      const picker=page.getByLabel("Token image",{exact:true}),save=page.getByRole("button",{name:"Save artwork",exact:true});
      await picker.setInputFiles({name:"unsupported.svg",mimeType:"image/svg+xml",buffer:Buffer.from("<svg/>")});
      await page.getByText("Choose a valid, still PNG, JPEG or WebP image.").waitFor();
      await picker.setInputFiles({name:"large.png",mimeType:"image/png",buffer:Buffer.alloc(2097153)});
      await page.getByText("Choose an image up to 2 MiB.",{exact:true}).waitFor();
      if(engine==="chromium"){
        await picker.evaluate((el,bytes)=>{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(bytes)],"art.png",{type:"image/png"}));
          el.dispatchEvent(new DragEvent("drop",{dataTransfer:dt,bubbles:true,cancelable:true}));},[...logo]);
      }else await picker.setInputFiles({name:"art.png",mimeType:"image/png",buffer:logo});
      await page.getByAltText("Token artwork preview").waitFor(); assert.equal(await page.getByRole("button",{name:"Review draft"}).isDisabled(),true);
      await page.reload();await save.waitFor();
      await save.click();
      await page.getByRole("button",{name:"Connect MetaMask",exact:true}).click();
      await page.waitForFunction(()=>!document.body.innerText.includes("Connect MetaMask"));
      await save.click();await page.getByText("Storage temporarily unavailable. Retry.").waitFor();
      await page.evaluate(()=>(window as any).artworkDisconnect());await page.getByRole("button",{name:"Connect MetaMask",exact:true}).click();
      await page.waitForFunction(()=>!document.body.innerText.includes("Connect MetaMask"));
      await save.click();await page.getByText("Artwork saved and verified.").waitFor({timeout:90000});
      assert.ok(receipt);const cid=assetCID(receipt.projectURI,"metadata.json")!;
      await page.reload(); await page.getByAltText("Token artwork preview").waitFor();
      await page.getByLabel("Token name",{exact:true}).fill("Artwork Fixture");await page.getByLabel("Ticker",{exact:true}).fill("ART");
      await page.getByRole("button",{name:"Review draft"}).click();
      await page.getByRole("heading",{name:"Review token draft"}).waitFor();
      if(process.env.ARTWORK_EVIDENCE) await page.screenshot({path:join(process.env.ARTWORK_EVIDENCE,engine+"-artwork-review.png")});
      assert.ok(await page.locator('img[src="'+assetPath(cid,"logo.webp")+'"]').evaluate((img:any)=>img.decode().then(()=>img.naturalWidth===43)));
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
        files:"unsupported/oversize/valid",retry:true,reconnected:true,restored:true,reviewed:true,transactionRequests:0}));
    }finally{await browser.close();}
  }
}
main().catch(err=>{console.error(err.message);process.exitCode=1;});
