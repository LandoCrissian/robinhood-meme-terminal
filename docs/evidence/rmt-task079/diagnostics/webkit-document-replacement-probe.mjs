import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createRequire} from "node:module";
import {existsSync,writeFileSync} from "node:fs";
import {isAbsolute,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";

// Standalone diagnostic, independently written for the pinned RMT toolchain.
// Related upstream classification report: microsoft/playwright#43120.
// This never starts the application, connects a wallet or reads a database.
const require=createRequire(new URL("../../../../package.json",import.meta.url));
const {webkit,devices}=require("playwright");
const {values}=parseArgs({options:{output:{type:"string"}}});
assert.ok(values.output&&isAbsolute(values.output),"Supply --output with a fresh absolute path outside the repository");
const repository=fileURLToPath(new URL("../../../../",import.meta.url)),output=resolve(values.output);
const relation=relative(repository,output);
assert.ok(relation===".."||relation.startsWith(".."+sep)||isAbsolute(relation),"Diagnostic output must stay outside the repository");
assert.equal(existsSync(output),false,"Never overwrite retained evidence");

const requests=[];
let replacementSeen,releaseReplacement,holdReplacement=false;
const server=createServer((request,response)=>{
  const path=new URL(request.url,"http://fixture.invalid").pathname;
  requests.push({method:request.method,path});request.resume();
  const send=()=>{
    const api=path==="/api/launchpad/test-lifecycle";
    response.setHeader("content-type",api?"application/json":"text/html");
    response.end(api?JSON.stringify({status:"read-only-probe"}):`<meta name="viewport" content="width=device-width"><title>${path}</title>`);
  };
  if(path==="/replacement"&&holdReplacement){releaseReplacement=send;replacementSeen();}
  else send();
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base="http://127.0.0.1:"+server.address().port;
const report={scope:"PINNED_PLAYWRIGHT_LOCAL_DOCUMENT_REPLACEMENT_DIAGNOSTIC_NOT_APP_ACCEPTANCE",
  version:require("playwright/package.json").version,platform:process.platform,cells:[]};
const browser=await webkit.launch();
try{
  assert.equal(report.version,"1.55.1","Use the existing pinned Playwright version");
  report.browserVersion=browser.version();
  for(const navigation of[false,true]){
    const context=await browser.newContext({...devices["iPhone 13"],serviceWorkers:"block"});
    try{
      const page=await context.newPage(),errors=[];
      page.on("pageerror",error=>errors.push({name:error.name,message:error.message}));
      await page.goto(base+"/initial");
      const original=await page.evaluateHandle(()=>({
        id:crypto.randomUUID(),origin:location.origin,
        async read(){
          try{
            const response=await fetch("/api/launchpad/test-lifecycle",{method:"POST",headers:{"content-type":"application/json"},
              body:"{}",cache:"no-store",redirect:"error"});
            return{id:this.id,sameOrigin:this.origin===location.origin,caught:false,status:response.status,body:await response.json()};
          }catch(error){return{id:this.id,sameOrigin:this.origin===location.origin,caught:true,name:error.name,message:error.message};}
        },
      }));
      const id=await original.evaluate(object=>object.id),before=requests.length;
      let navigationResult;
      if(navigation){
        holdReplacement=true;
        const seen=new Promise(resolve=>{replacementSeen=resolve;});
        navigationResult=page.goto(base+"/replacement");
        await seen; // The owned HTTP request, not a sleep/retry, establishes overlap.
      }
      let result,timer;
      try{
        result=await Promise.race([original.evaluate(object=>object.read()),new Promise((_,reject)=>{
          timer=setTimeout(()=>reject(Error("Bounded diagnostic read timeout")),5000);
        })]);
      }finally{clearTimeout(timer);releaseReplacement?.();releaseReplacement=undefined;}
      if(navigation)await navigationResult;
      assert.equal(result.id,id);assert.equal(result.sameOrigin,true);
      report.cells.push({navigation,result,pageErrors:errors,serverRequests:requests.slice(before)});
    }finally{await context.close();}
  }
  const [control,navigation]=report.cells;
  assert.equal(control.result.status,200);assert.equal(control.result.caught,false);assert.deepEqual(control.pageErrors,[]);
  assert.ok(control.serverRequests.some(request=>request.method==="POST"&&request.path==="/api/launchpad/test-lifecycle"));
  report.controlValid=true;
  report.mechanismReproduced=navigation.result.caught===true
    &&navigation.pageErrors.some(error=>error.message.includes("due to access control checks."))
    &&!navigation.serverRequests.some(request=>request.path==="/api/launchpad/test-lifecycle");
  // A completed diagnostic without reproduction never counts as app acceptance.
  writeFileSync(output,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify(report));
}finally{
  releaseReplacement?.();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
