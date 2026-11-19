type Address = `0x${string}`;
export function assertNftAcquisitionTrace(raw: unknown,
  origin: { from: Address; to: Address; input: Address; value: bigint },
  expected: { vault: Address; venue: Address; collection: Address; purchaseInput: Address; fillInput: Address;
    nftTransferInput: Address; totalCost: bigint; native: boolean; payments: { recipient: Address; amount: bigint }[]; safeSingleton?: Address }
): { evidence: "canonical-receipt-and-exact-local-call-trace"; nativeTransfers: number; frames: number };
