type Address=`0x${string}`;type Hex=`0x${string}`;
export const seaportRawAccountCodeLimits:Readonly<{timeoutMs:5000;maxBytes:65536}>;
/** Exact raw eth_getCode result at one explicit block or pending. Missing,
 * null, malformed, oversized and timed-out responses are unavailable, never EOAs. */
export function readSeaportRawAccountCode(rpc:any,address:Address,heightOrPending:bigint|"pending"):Promise<Hex>;
