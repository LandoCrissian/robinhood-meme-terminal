// Task084: preserve explicit raw account-code evidence; Viem decodes "0x" to
// undefined, which must never be confused with a missing/null RPC result.
export const seaportRawAccountCodeLimits=Object.freeze({timeoutMs:5000,maxBytes:65536});
const need=value=>{if(!value)throw Error("Exact raw Seaport account code evidence unavailable");};
export async function readSeaportRawAccountCode(rpc,address,heightOrPending){
 need(rpc&&typeof rpc.request==="function"&&typeof address==="string"&&/^0x[0-9a-f]{40}$/i.test(address)&&BigInt(address)>0xffffn);
 need(heightOrPending==="pending"||typeof heightOrPending==="bigint"&&heightOrPending>=0n&&heightOrPending<2n**256n);
 const block=heightOrPending==="pending"?"pending":"0x"+heightOrPending.toString(16);
 const controller=new AbortController();let timer;
 try{
  const raw=await Promise.race([
   rpc.request({method:"eth_getCode",params:[address,block]},{retryCount:0,signal:controller.signal}),
   new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error("Raw Seaport account code evidence timeout"));},seaportRawAccountCodeLimits.timeoutMs);})
  ]);
  need(typeof raw==="string"&&raw.length<=2+seaportRawAccountCodeLimits.maxBytes*2&&/^0x(?:[0-9a-fA-F]{2})*$/.test(raw));
  return raw;
 }finally{clearTimeout(timer);controller.abort();}
}
