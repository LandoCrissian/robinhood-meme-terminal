export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type NativePayment = { from: Address; to: Address; amount: bigint };
export type NativeOrigin = { from: Address; to: Address; value: bigint; input: Hex };
export function assertNativeTransferProof(raw: unknown, origin: NativeOrigin, payments: NativePayment[]): void;
export function treasuryClaimInput(raw: unknown, origin: NativeOrigin, ledger: Address, nativeAmount: bigint): Hex;
