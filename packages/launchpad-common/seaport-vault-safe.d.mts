type Address=`0x${string}`;type Hex=`0x${string}`;
export const seaportSafePins:Readonly<{proxyHash:Hex;singleton:Address;singletonHash:Hex;handler:Address;handlerHash:Hex;guardSlot:Hex;handlerSlot:Hex}>;
export const seaportSafeSignatures:string[];
export const seaportSafeTxTypes:Record<string,Array<{name:string;type:string}>>;
export type SeaportSafeTx={to:Address;value:string;data:Hex;operation:0;safeTxGas:"0";baseGas:"0";gasPrice:"0";gasToken:Address;refundReceiver:Address;nonce:string};
export type SeaportSafeState={safe:Address;owners:Address[];threshold:2;nonce:string;runtimeHash:Hex;singleton:Address;handler:Address};
export function seaportSafeTypedData(safe:Address,safeTx:SeaportSafeTx):any;
export function validSeaportSafeTx(value:unknown):value is SeaportSafeTx;
export function safeAuthorityIdentity(state:SeaportSafeState):string;
export function readSeaportSafeState(rpc:any,safe:Address,block:bigint|"pending",codecs:any):Promise<SeaportSafeState>;
export function verifySeaportSafeApprovals(safe:Address,safeTx:SeaportSafeTx,owners:Address[],approvals:Array<{signer:Address;signature:Hex}>,codecs:any):Promise<boolean>;
export function assertSeaportSafeAdminTrace(raw:unknown,origin:{from:Address;to:Address;input:Hex;value:bigint},inner:{safe:Address;target:Address;data:Hex;value:bigint;admittedSafes?:Address[]}):{evidence:string;frames:number;nativeTransfers:number};

export const seaportSafeVaultSignatures:string[];
export const seaportSafeAdminEvents:string[];
export type SeaportSafeCallPins={vault:Address;vaultRuntimeHash:Hex;paymentToken:Address;paymentTokenRuntimeHash:Hex;fee?:Address;collections:Array<{address:Address;runtimeHash:Hex;standard:721|1155}>};
export function compileSeaportSafeCall(pins:SeaportSafeCallPins,operation:string,fields:Record<string,string|boolean>,codecs:any):{to:Address;runtimeHash:Hex;value:string;data:Hex};
export function decodeSeaportSafeCall(pins:SeaportSafeCallPins,target:Address,data:Hex,value:bigint,codecs:any):{operation:string;fields:Record<string,string|boolean>;call:{to:Address;runtimeHash:Hex;value:string;data:Hex}};

export const assertSeaportSafeAdminRevertTrace:typeof assertSeaportSafeAdminTrace;
