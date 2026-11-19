import {createRequire} from "node:module";
const require=createRequire(new URL("../../apps/indexer/package.json",import.meta.url));
const {decodeErrorResult,encodeErrorResult,parseAbi}=require("viem");
const errorAbi=parseAbi(["error Error(string reason)"]);

/** Preserve actual bounded Error(string) execution evidence from local Anvil.
 * An outage, arbitrary RPC failure, panic or malformed revert is not proof that
 * an NFT owner is absent. Never invent a successful eth_call response. */
export function fixtureCallRevert(method,body){
  if(method!=="eth_call"||!body||body.jsonrpc!=="2.0"||body.id!==1||Object.hasOwn(body,"result")
    ||!body.error||typeof body.error!=="object"||Array.isArray(body.error))return null;
  const e=body.error;
  if(![3,-32603].includes(e.code)||typeof e.message!=="string"||e.message.length>512||!/^execution reverted(?::|$)/i.test(e.message)
    ||typeof e.data!=="string"||!/^0x08c379a0(?:[0-9a-f]{2}){64,4096}$/i.test(e.data))return null;
  try{
    const decoded=decodeErrorResult({abi:errorAbi,data:e.data});
    if(decoded.errorName!=="Error"||decoded.args.length!==1||typeof decoded.args[0]!=="string"||decoded.args[0].length>256
      ||encodeErrorResult({abi:errorAbi,errorName:"Error",args:decoded.args}).toLowerCase()!==e.data.toLowerCase())return null;
    return{code:e.code,message:"execution reverted",data:e.data};
  }catch{return null;}
}
