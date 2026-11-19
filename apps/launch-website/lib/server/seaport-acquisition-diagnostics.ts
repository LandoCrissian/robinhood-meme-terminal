const stages=new Set(["VALIDATE_PREPARE","LOCAL_CONTEXT","CALLER_CODE","FRESHNESS","BUILD_BUY","BUILD_CONFIGURE","BUILD_DISABLE","ORDER_HASH","SIMULATE_PENDING","ESTIMATE_GAS_NONCE_FEES","FEE_BOUNDS","PRIOR_REVIEW","PAYER_BALANCE"]);
const names=new Set(["Error","TypeError","CallExecutionError","EstimateGasExecutionError","ContractFunctionExecutionError","ContractFunctionRevertedError","ExecutionRevertedError","RpcRequestError","HttpRequestError","TimeoutError","UnknownRpcError","AbiDecodingDataSizeTooSmallError","ContractFunctionZeroDataError"]);
/** Operator diagnostics for an already admitted loopback fixture request.
 * Never serialize provider messages, URLs, headers, calldata or stacks. */
export function seaportFixturePreparationDiagnostic(stage:string,error:unknown){
 const value=error as {name?:unknown};const errorName=typeof value?.name==="string"&&names.has(value.name)?value.name:"Error";
 let revertSelector:string|undefined;const queue:unknown[]=[error],seen=new Set<unknown>();
 for(let index=0;index<queue.length&&index<12;index++){const item=queue[index];if(!item||typeof item!=="object"||seen.has(item))continue;seen.add(item);const record=item as Record<string,unknown>;
  for(const key of["data","cause","error"]){const child=record[key];if(key==="data"&&typeof child==="string"&&/^0x[0-9a-f]{8,2048}$/i.test(child)){revertSelector=child.slice(0,10).toLowerCase();break;}if(child&&typeof child==="object"&&queue.length<12)queue.push(child);}if(revertSelector)break;
 }
 return{stage:stages.has(stage)?stage:"UNAVAILABLE",errorName,...(revertSelector&&{revertSelector})};
}
