import {readSeaportRawAccountCode} from "./seaport-vault-account-code.mjs";
import {seaportVaultSignatures} from "./seaport-vault-runtime.mjs";
// Task084: exact canonical Safe1.4.1 administration; no signing or broadcasting.
export const seaportSafePins=Object.freeze({
 proxyHash:"0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
 singleton:"0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",singletonHash:"0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff",
 handler:"0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",handlerHash:"0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9",
 guardSlot:"0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8",
 handlerSlot:"0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5"
});
export const seaportSafeSignatures=[
 "function VERSION() view returns(string)","function masterCopy() view returns(address)","function getOwners() view returns(address[])",
 "function getThreshold() view returns(uint256)","function nonce() view returns(uint256)",
 "function getModulesPaginated(address,uint256) view returns(address[],address)",
 "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns(bytes32)",
 "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)",
 "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)","event ExecutionFailure(bytes32 indexed txHash,uint256 payment)"
];
export const seaportSafeTxTypes={SafeTx:[
 {name:"to",type:"address"},{name:"value",type:"uint256"},{name:"data",type:"bytes"},{name:"operation",type:"uint8"},
 {name:"safeTxGas",type:"uint256"},{name:"baseGas",type:"uint256"},{name:"gasPrice",type:"uint256"},
 {name:"gasToken",type:"address"},{name:"refundReceiver",type:"address"},{name:"nonce",type:"uint256"}
]};
const zero="0x"+"0".repeat(40),sentinel="0x"+"0".repeat(39)+"1";
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const address=v=>typeof v==="string"&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)>0xffffn;
const bytes=v=>typeof v==="string"&&/^0x(?:[0-9a-f]{2}){0,65536}$/i.test(v);
const uint=v=>typeof v==="string"&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<2n**256n;
const need=v=>{if(!v)throw Error("Exact Seaport Safe authority or CALL evidence unavailable");};
export function seaportSafeTypedData(safe,safeTx){return{domain:{chainId:31337,verifyingContract:safe},types:{EIP712Domain:[{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}],...seaportSafeTxTypes},primaryType:"SafeTx",message:safeTx};}
export function validSeaportSafeTx(tx){
 return !!tx&&Object.keys(tx).length===10&&address(tx.to)&&uint(tx.value)&&bytes(tx.data)&&tx.data.length>=10&&tx.operation===0
 &&tx.safeTxGas==="0"&&tx.baseGas==="0"&&tx.gasPrice==="0"&&same(tx.gasToken,zero)&&same(tx.refundReceiver,zero)&&uint(tx.nonce);
}
export function safeAuthorityIdentity(state){return JSON.stringify({safe:state.safe.toLowerCase(),owners:state.owners.map(a=>a.toLowerCase()).sort(),threshold:state.threshold,runtimeHash:state.runtimeHash.toLowerCase()});}
export async function readSeaportSafeState(rpc,safe,block,codecs){
 need(address(safe)&&await rpc.getChainId()===31337);const at=block==="pending"?{blockTag:"pending"}:{blockNumber:block},p=seaportSafePins,abi=codecs.parseAbi(seaportSafeSignatures);
 const read=(functionName,args=[])=>rpc.readContract({address:safe,abi,functionName,args,...at});
 const [code,singletonCode,handlerCode,version,singleton,owners,threshold,nonce,modules,guard,handler]=await Promise.all([
  rpc.getCode({address:safe,...at}),rpc.getCode({address:p.singleton,...at}),rpc.getCode({address:p.handler,...at}),
  read("VERSION"),read("masterCopy"),read("getOwners"),read("getThreshold"),read("nonce"),read("getModulesPaginated",[sentinel,1n]),
  rpc.getStorageAt({address:safe,slot:p.guardSlot,...at}),rpc.getStorageAt({address:safe,slot:p.handlerSlot,...at})
 ]);
 need(code&&same(codecs.keccak256(code),p.proxyHash)&&singletonCode&&same(codecs.keccak256(singletonCode),p.singletonHash)
  &&handlerCode&&same(codecs.keccak256(handlerCode),p.handlerHash)&&version==="1.4.1"&&same(singleton,p.singleton)
  &&Array.isArray(owners)&&owners.length===3&&owners.every(address)&&new Set(owners.map(a=>a.toLowerCase())).size===3&&threshold===2n&&typeof nonce==="bigint"
  &&Array.isArray(modules)&&Array.isArray(modules[0])&&modules[0].length===0&&same(modules[1],sentinel)
  &&typeof guard==="string"&&/^0x0{64}$/.test(guard)&&typeof handler==="string"&&/^0x0{24}[0-9a-f]{40}$/i.test(handler)&&same("0x"+handler.slice(-40),p.handler));
 for(const owner of owners)need(await readSeaportRawAccountCode(rpc,owner,block)==="0x");
 return{safe,owners,threshold:2,nonce:String(nonce),runtimeHash:p.proxyHash,singleton:p.singleton,handler:p.handler};
}
export async function verifySeaportSafeApprovals(safe,safeTx,owners,approvals,codecs){
 try{
  need(address(safe)&&validSeaportSafeTx(safeTx)&&Array.isArray(owners)&&owners.length===3&&owners.every(address)
   &&Array.isArray(approvals)&&approvals.length===2&&approvals.every(a=>a&&Object.keys(a).length===2&&address(a.signer)
   &&typeof a.signature==="string"&&/^0x[0-9a-f]{130}$/i.test(a.signature)&&[27,28].includes(parseInt(a.signature.slice(-2),16))
   &&BigInt("0x"+a.signature.slice(2,66))>0n&&BigInt("0x"+a.signature.slice(66,130))>0n
   &&BigInt("0x"+a.signature.slice(66,130))<=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n
   &&owners.some(o=>same(o,a.signer))));
  need(BigInt(approvals[0].signer)<BigInt(approvals[1].signer));
  for(const approval of approvals)need(same(await codecs.recoverTypedDataAddress({...seaportSafeTypedData(safe,safeTx),signature:approval.signature}),approval.signer));
  return true;
 }catch{return false;}
}
function safeAdminTrace(raw,origin,inner,reverted){
 need(address(origin.from)&&address(origin.to)&&bytes(origin.input)&&origin.value===0n&&address(inner.safe)&&address(inner.target)&&bytes(inner.data)&&typeof inner.value==="bigint");
 let count=0;const flat=[];
 function visit(n,parent,depth){
  need(++count<=2048&&depth<=48&&n&&typeof n==="object"&&!Array.isArray(n)&&["CALL","STATICCALL","DELEGATECALL"].includes(n.type)
   &&(n.error===undefined||reverted)&&typeof n.from==="string"&&/^0x[0-9a-f]{40}$/i.test(n.from)&&typeof n.to==="string"&&/^0x[0-9a-f]{40}$/i.test(n.to)&&bytes(n.input??"0x")
   &&(n.calls===undefined||Array.isArray(n.calls)));
  const rawValue=n.value??(n.type==="DELEGATECALL"?"0x"+(parent?.amount??0n).toString(16):n.type==="STATICCALL"?"0x0":null);
  need(typeof rawValue==="string"&&/^0x[0-9a-f]{1,64}$/i.test(rawValue));const item={...n,input:n.input??"0x",amount:BigInt(rawValue)};
  need(!parent||same(n.from,parent.type==="DELEGATECALL"?parent.from:parent.to));
  if(n.type==="DELEGATECALL")need(parent&&[inner.safe,...(inner.admittedSafes??[])].some(safe=>same(n.from,safe))&&same(n.to,seaportSafePins.singleton)&&item.amount===parent.amount);
  if(n.type==="STATICCALL")need(item.amount===0n);flat.push(item);for(const child of n.calls??[])visit(child,item,depth+1);return item;
 }
 const root=visit(raw,null,0);need(root.type==="CALL"&&same(origin.to,inner.safe)&&same(root.from,origin.from)&&same(root.to,inner.safe)&&same(root.input,origin.input)&&root.amount===0n);
 const calls=flat.filter(n=>n.type==="CALL"&&same(n.from,inner.safe));
 need(calls.length===1&&same(calls[0].to,inner.target)&&same(calls[0].input,inner.data)&&calls[0].amount===inner.value);
 need(reverted?typeof root.error==="string"&&typeof calls[0].error==="string":root.error===undefined);
 const paid=flat.filter(n=>n.type==="CALL"&&n.amount>0n);
 need(inner.value>0n?paid.length===1&&paid[0]===calls[0]:paid.length===0);
 return{evidence:"canonical-receipt-and-exact-local-call-trace",frames:count,nativeTransfers:reverted?0:paid.length};
}

export const assertSeaportSafeAdminTrace=(raw,origin,inner)=>safeAdminTrace(raw,origin,inner,false);
export const assertSeaportSafeAdminRevertTrace=(raw,origin,inner)=>safeAdminTrace(raw,origin,inner,true);
export const seaportSafeVaultSignatures=[
 ...seaportVaultSignatures,
 "function configureCollection(address asset,uint8 standard,bytes32 hash,bool enabled,bool any,uint256[] selected)",
 "function configureFeeRecipient(address recipient,uint16 maxBps)","function feeRecipientMaxBps(address) view returns(uint16)","function collectionIds(address) view returns(uint256[])","function fundToken(uint256 amount,bytes32 source)",
 "function proposeController(address next,uint48 expiry)","function cancelController()","function acceptController()",
 "function pendingController() view returns(address next,uint48 validAfter,uint48 expiresAt,uint64 epoch)",
 "function NOTICE() view returns(uint48)","function WINDOW() view returns(uint48)","function accountedHeld(address) view returns(uint256)","function funded(address) view returns(uint256)",
 "event CollectionConfigured(address indexed collection,bytes32 runtimeHash,uint8 standard,bool enabled,bool anyTokenId,uint256[] ids,uint64 policyEpoch)",
 "event FeeRecipientConfigured(address indexed recipient,uint16 maxBps,uint64 policyEpoch)",
 "event PurchasePolicyChanged(uint64 indexed policyEpoch,uint64 controllerEpoch,bool enabled,address currency,uint128 perNftCap,uint128 totalBudget,uint128 periodBudget,uint32 cooldownSeconds)",
 "event ControllerProposed(address indexed next,uint48 validAfter,uint48 expiresAt,uint64 epoch)",
 "event ControllerChanged(address indexed previous,address indexed next,uint64 epoch)",
 "event ControllerCancelled(address indexed next,uint64 epoch)"
];
export const seaportSafeAdminEvents=["FundingReceived","CollectionConfigured","FeeRecipientConfigured","PurchasePolicyChanged","ControllerProposed","ControllerChanged","ControllerCancelled"];
const exact=(f,keys)=>f&&typeof f==="object"&&!Array.isArray(f)&&Object.keys(f).length===keys.length&&keys.every(k=>Object.hasOwn(f,k));
const positive=(v,bits=256)=>uint(v)&&BigInt(v)>0n&&BigInt(v)<2n**BigInt(bits);
export function compileSeaportSafeCall(pins,operation,fields,codecs){
 need(address(pins.vault)&&address(pins.paymentToken));const abi=codecs.parseAbi(seaportSafeVaultSignatures);
 let target=pins.vault,runtimeHash=pins.vaultRuntimeHash,value="0",name,args;
 const amount=()=>{need(positive(fields.amountWei)&&BigInt(fields.amountWei)<=100n*10n**18n);return BigInt(fields.amountWei);};
 if(operation==="configure"){
  need(exact(fields,["currency","perNftCap","totalBudget","periodBudget","cooldownSeconds","enabled"])
   &&(same(fields.currency,zero)||same(fields.currency,pins.paymentToken))&&["perNftCap","totalBudget","periodBudget"].every(k=>positive(fields[k],128))
   &&positive(fields.cooldownSeconds,32)&&typeof fields.enabled==="boolean");
  name="configurePolicy";args=[{currency:fields.currency,perNftCap:BigInt(fields.perNftCap),totalBudget:BigInt(fields.totalBudget),periodBudget:BigInt(fields.periodBudget),cooldownSeconds:Number(fields.cooldownSeconds)},fields.enabled];
 }else if(operation==="disable"){need(exact(fields,[]));name="disablePurchases";args=[];}
 else if(operation==="configure-collection"){
  need(exact(fields,["collection","enabled","anyTokenId","ids"])&&typeof fields.enabled==="boolean"&&typeof fields.anyTokenId==="boolean"&&typeof fields.ids==="string");
  const collection=pins.collections.find(c=>same(c.address,fields.collection));need(collection);
  const ids=fields.ids===""?[]:fields.ids.split(",");need(ids.length<=32&&ids.every(uint)&&ids.every((v,i)=>i===0||BigInt(v)>BigInt(ids[i-1]))
   &&(fields.anyTokenId?ids.length===0:!fields.enabled||ids.length>0));
  name="configureCollection";args=[collection.address,collection.standard===721?1:2,collection.runtimeHash,fields.enabled,fields.anyTokenId,ids.map(BigInt)];
 }else if(operation==="configure-fee-recipient"){
  need(exact(fields,["recipient","maxBps"])&&address(fields.recipient)&&address(pins.fee)&&same(fields.recipient,pins.fee)&&uint(fields.maxBps)&&BigInt(fields.maxBps)<=1000n);
  name="configureFeeRecipient";args=[fields.recipient,Number(fields.maxBps)];
 }else if(operation==="fund-native"){
  need(exact(fields,["amountWei","source"])&&/^0x[0-9a-f]{64}$/i.test(fields.source)&&BigInt(fields.source)>0n);value=String(amount());name="fundNative";args=[fields.source];
 }else if(operation==="fund-token"){
  need(exact(fields,["amountWei","source"])&&/^0x[0-9a-f]{64}$/i.test(fields.source)&&BigInt(fields.source)>0n);name="fundToken";args=[amount(),fields.source];
 }else if(operation==="approve-funding"){
  need(exact(fields,["amountWei"]));target=pins.paymentToken;runtimeHash=pins.paymentTokenRuntimeHash;
  return{to:target,runtimeHash,value:"0",data:codecs.encodeFunctionData({abi:codecs.erc20Abi,functionName:"approve",args:[pins.vault,amount()]})};
 }else if(operation==="propose-controller"){
  need(exact(fields,["incoming","expiresAt"])&&address(fields.incoming)&&positive(fields.expiresAt,48));name="proposeController";args=[fields.incoming,Number(fields.expiresAt)];
 }else if(operation==="cancel-controller"){need(exact(fields,[]));name="cancelController";args=[];}
 else if(operation==="accept-controller"){need(exact(fields,[]));name="acceptController";args=[];}
 else throw Error("Unsupported Seaport Safe operation; Safe vault CREATE is unavailable");
 return{to:target,runtimeHash,value,data:codecs.encodeFunctionData({abi,functionName:name,args})};
}
export function decodeSeaportSafeCall(pins,target,data,value,codecs){
 let operation,fields;
 if(same(target,pins.paymentToken)){
  const d=codecs.decodeFunctionData({abi:codecs.erc20Abi,data});need(d.functionName==="approve"&&same(d.args[0],pins.vault));operation="approve-funding";fields={amountWei:String(d.args[1])};
 }else{
  need(same(target,pins.vault));const d=codecs.decodeFunctionData({abi:codecs.parseAbi(seaportSafeVaultSignatures),data}),a=d.args??[];
  if(d.functionName==="configurePolicy"){operation="configure";fields={currency:a[0].currency,perNftCap:String(a[0].perNftCap),totalBudget:String(a[0].totalBudget),periodBudget:String(a[0].periodBudget),cooldownSeconds:String(a[0].cooldownSeconds),enabled:a[1]};}
  else if(d.functionName==="disablePurchases"){operation="disable";fields={};}
  else if(d.functionName==="configureCollection"){operation="configure-collection";fields={collection:a[0],enabled:a[3],anyTokenId:a[4],ids:a[5].map(String).join(",")};}
  else if(d.functionName==="configureFeeRecipient"){operation="configure-fee-recipient";fields={recipient:a[0],maxBps:String(a[1])};}
  else if(d.functionName==="fundNative"){operation="fund-native";fields={amountWei:String(value),source:a[0]};}
  else if(d.functionName==="fundToken"){operation="fund-token";fields={amountWei:String(a[0]),source:a[1]};}
  else if(d.functionName==="proposeController"){operation="propose-controller";fields={incoming:a[0],expiresAt:String(a[1])};}
  else if(d.functionName==="cancelController"){operation="cancel-controller";fields={};}
  else if(d.functionName==="acceptController"){operation="accept-controller";fields={};}
  else throw Error("Unknown Seaport Safe inner call");
 }
 const call=compileSeaportSafeCall(pins,operation,fields,codecs);need(same(call.to,target)&&same(call.data,data)&&BigInt(call.value)===value);
 return{operation,fields,call};
}
