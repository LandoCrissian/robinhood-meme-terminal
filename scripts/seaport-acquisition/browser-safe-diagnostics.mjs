// Test-only, bounded diagnostics. Never retain SDK messages, nested payloads,
// arbitrary error codes or raw signed transactions from a wallet callback.
const names=new Set(["Error","AssertionError","TypeError","RangeError","SyntaxError","TimeoutError","RpcRequestError","HttpRequestError","TransactionReceiptNotFoundError","WaitForTransactionReceiptTimeoutError","TransactionExecutionError","ExecutionRevertedError"]);
const codes=new Set(["ERR_ASSERTION",4001,3,-32600,-32601,-32602,-32603,-32000,-32005]);
const hash=value=>typeof value==="string"&&/^0x[0-9a-f]{64}$/i.test(value)?value:null;
const uint=value=>typeof value==="string"&&/^(?:0|[1-9][0-9]{0,77})$/.test(value)?value:null;
const operations=new Set(["configure","disable","configure-collection","configure-fee-recipient","fund-native","approve-funding","fund-token","propose-controller","cancel-controller","accept-controller"]);
const stages=new Set(["proposal","approvals-ready","awaiting-wallet","wallet-rejected","hash-missing","pending","confirmed","reverted","unavailable","reorged"]);
const statuses=new Set(["prepared","pending","unavailable","rejected","confirmed","reverted","reorged"]);
const messages=new Set(["Original Safe outer transaction retained; recover without another submission","Outer request or authority is stale","Connect the reviewed distinct gas payer","This original authorization cannot submit twice","Chain changed","Synthetic payer rejected before signing","Synthetic owner rejected before signing"]);
const field=(value,key)=>{try{return value?.[key];}catch{return undefined;}};
const errorPart=error=>{const name=field(error,"name"),code=field(error,"code");return{name:names.has(name)?name:"OTHER_ERROR",code:codes.has(code)?code:code==null?"NO_CODE":"OTHER_CODE"};};
export function safeWalletDiagnosticError(error){
 const result={...errorPart(error),causes:[]};let cause=field(error,"cause");
 for(let count=0;cause&&count<3;count++){result.causes.push(errorPart(cause));cause=field(cause,"cause");}
 return result;
}
/** The full prepared request is already retained in outerReviews. Diagnostic
 * equality flags identify API drift without copying an unexpected response. */
export function safeRevalidationDiagnostic(result,outer){
 const body=result?.body,request=body?.request,expected=outer?.request;
 const keys=["type","chainId","from","to","data","value","nonce","gas","maxFeePerGas","maxPriorityFeePerGas"];
 const exactRequest=!!request&&typeof request==="object"&&!Array.isArray(request)&&Object.keys(request).length===keys.length&&keys.every(key=>typeof request[key]==="string"&&request[key]===expected?.[key])&&Buffer.byteLength(JSON.stringify(expected))<=65536;
 return{http:Number.isInteger(result?.http)&&result.http>=100&&result.http<=599?result.http:null,body:{status:statuses.has(body?.status)?body.status:"OTHER_STATUS",reviewHash:hash(body?.reviewHash),reviewHashMatches:!!outer&&body?.reviewHash===outer.reviewHash,requestMatches:exactRequest,request:exactRequest?structuredClone(expected):null,reason:body?.reason==="Evidence or simulation unavailable; no submission attempted"?body.reason:null},bodyBytes:Math.min(Buffer.byteLength(JSON.stringify(body??null)),65537)};
}
/** Selected public recovery identity only; do not copy arbitrary localStorage
 * objects or the UI's String(SDKError), which can contain raw RPC payloads. */
export function safeFailureDiagnostic({journal,message}){
 const proposal=journal?.proposal,outer=journal?.outer,result=journal?.result,text=typeof message==="string"?message:"",plain=text.startsWith("Error: ")?text.slice(7):text;
 const errorName=text.match(/^((?:[A-Za-z]+)?Error):/)?.[1];
 return{journal:journal?{stage:stages.has(journal.stage)?journal.stage:"OTHER_STAGE",proposalHash:hash(proposal?.proposalHash),operation:operations.has(proposal?.operation)?proposal.operation:null,safeNonce:uint(proposal?.safeNonce),gasPayerNonce:uint(proposal?.gasPayerNonce),reviewHash:hash(outer?.reviewHash),transactionHash:hash(journal.transactionHash),approvalCount:Array.isArray(journal.approvals)?Math.min(journal.approvals.length,33):null,resultStatus:statuses.has(result?.status)?result.status:null}:null,visibleStatus:{knownText:messages.has(plain)?plain:null,errorName:names.has(errorName)?errorName:null,unrecognizedTextOmitted:!messages.has(plain),characters:Math.min(text.length,65537)}};
}
