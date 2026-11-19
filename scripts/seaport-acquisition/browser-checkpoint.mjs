const height=value=>typeof value==="string"&&/^(?:0|[1-9][0-9]{0,19})$/.test(value);
const hash=value=>typeof value==="string"&&/^0x[0-9a-f]{64}$/i.test(value);
const reached=(value,required)=>height(value)&&typeof required==="bigint"&&required>=0n&&BigInt(value)>=required;

/** A successful poll started before mining does not cover the newly confirmed
 * transaction. Require its actual post-mine confirmation boundary. */
export function checkpointReached(diagnostics,required){return diagnostics?.status==="ready"&&reached(diagnostics.targetHeight,required)&&reached(diagnostics.checkpointHeight,required)&&diagnostics.targetHeight===diagnostics.checkpointHeight&&diagnostics.lastFailure===null;}

/** Pending must come from the intended transaction's settlement verification,
 * rather than an old poll or a different provider/database failure. */
export function traceFailureReached(diagnostics,required,receipt,stage="SETTLEMENT_PROOF"){const failure=diagnostics?.lastFailure;return diagnostics?.status==="pending"&&reached(diagnostics.targetHeight,required)&&["SETTLEMENT_PROOF","SAFE_ADMIN_PROOF"].includes(stage)&&failure?.stage===stage&&height(receipt?.blockNumber)&&failure.blockNumber===receipt.blockNumber&&hash(receipt.transactionHash)&&typeof failure.transactionHash==="string"&&failure.transactionHash.toLowerCase()===receipt.transactionHash.toLowerCase();}
