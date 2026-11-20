import assert from "node:assert/strict";
import test from "node:test";
import {safeWalletDiagnosticError,safeRevalidationDiagnostic,safeFailureDiagnostic} from "./browser-safe-diagnostics.mjs";
const secret="0x"+"ab".repeat(32),raw="0x02"+"cd".repeat(200),hash="0x"+"12".repeat(32);
test("wallet diagnostics bound causes and exclude error messages, raw signed bytes and arbitrary names/codes",()=>{
 const error={name:"AssertionError",code:"ERR_ASSERTION",message:secret,actual:raw,cause:{name:secret,code:raw}};error.cause.cause=error;
 const result=safeWalletDiagnosticError(error);assert.equal(result.name,"AssertionError");assert.equal(result.code,"ERR_ASSERTION");assert.equal(result.causes.length,3);assert.deepEqual(result.causes[0],{name:"OTHER_ERROR",code:"OTHER_CODE"});assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(result).includes(raw));
 assert.deepEqual(safeWalletDiagnosticError({get name(){throw Error(secret);},get code(){throw Error(raw);}}),{name:"OTHER_ERROR",code:"NO_CODE",causes:[]});
 let nameReads=0,codeReads=0;const changing=safeWalletDiagnosticError({get name(){return ++nameReads===1?"Error":secret;},get code(){return ++codeReads===1?4001:raw;}});assert.equal(changing.name,"Error");assert.equal(changing.code,4001);assert.equal(nameReads,1);assert.equal(codeReads,1);assert.ok(!JSON.stringify(changing).includes(secret));assert.ok(!JSON.stringify(changing).includes(raw));
});
test("revalidation snapshot identifies exact request equality while omitting unexpected body/SDK payloads",()=>{
 const request={type:"0x2",chainId:"0x7a69",from:"public-from",to:"public-to",data:"public-call",value:"0x0",nonce:"0x1",gas:"0x2",maxFeePerGas:"0x3",maxPriorityFeePerGas:"0x1"},outer={reviewHash:hash,request};
 const result=safeRevalidationDiagnostic({http:200,body:{status:"prepared",reviewHash:hash,request}},outer);assert.equal(result.body.requestMatches,true);assert.equal(result.body.reviewHashMatches,true);
 const invalid=safeRevalidationDiagnostic({http:200,body:{status:secret,reason:secret,request:{...request,data:raw},privateKey:secret}},outer);assert.equal(invalid.body.status,"OTHER_STATUS");assert.equal(invalid.body.requestMatches,false);assert.ok(!JSON.stringify(invalid).includes(secret));assert.ok(!JSON.stringify(invalid).includes(raw));
});
test("failure snapshot retains selected recovery identity and classifies visible SDK errors without copying them",()=>{
 const journal={stage:"awaiting-wallet",proposal:{proposalHash:hash,operation:"fund-token",safeNonce:"9",gasPayerNonce:"9",privateKey:secret},outer:{reviewHash:hash,request:{raw}},transactionHash:null,approvals:[{},{}],result:null};
 const result=safeFailureDiagnostic({journal,message:"AssertionError: "+raw+secret});assert.equal(result.journal.stage,"awaiting-wallet");assert.equal(result.journal.operation,"fund-token");assert.equal(result.journal.approvalCount,2);assert.equal(result.visibleStatus.errorName,"AssertionError");assert.equal(result.visibleStatus.unrecognizedTextOmitted,true);assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(result).includes(raw));
 const known=safeFailureDiagnostic({message:"Error: Outer request or authority is stale"});assert.equal(known.visibleStatus.knownText,"Outer request or authority is stale");assert.equal(known.visibleStatus.errorName,"Error");
});
