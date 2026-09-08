import { decodeEventLog, erc20Abi, keccak256, zeroAddress, type Hex } from "viem";
import type { VNextExecutionRecord } from "./execution-recovery";

export type VNextOutputSettlement = {
  source: "erc20_receipt_net_transfer" | "native_transaction_trace"; chainId: 4663; txHash: string; planId: string;
  payloadHash: string; recipient: string; outputAsset: string; amountAtomic: string; receiptBlockHash: string;
};
const same = (a: string | null | undefined, b: string | null | undefined) =>
  typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

export function validVNextOutputSettlement(record: Pick<VNextExecutionRecord,
  "chainId" | "kind" | "wallet" | "txHash" | "planId" | "payloadHash" | "outputAsset" | "providerNativeFee"
>, proof: VNextOutputSettlement | undefined): proof is VNextOutputSettlement {
  return Boolean(proof && record.kind === "swap" && record.chainId === 4663
    && proof.chainId === 4663
    && (proof.source === "erc20_receipt_net_transfer" ? !same(record.outputAsset, zeroAddress)
      : proof.source === "native_transaction_trace" && same(record.outputAsset, zeroAddress))
    && same(proof.txHash, record.txHash) && proof.planId === record.planId
    && same(proof.payloadHash, record.payloadHash) && same(proof.recipient, record.wallet)
    && same(proof.outputAsset, record.outputAsset)
    && /^0x[0-9a-f]{64}$/i.test(proof.receiptBlockHash) && /^[1-9][0-9]*$/.test(proof.amountAtomic)
    && record.providerNativeFee && BigInt(proof.amountAtomic) >= BigInt(record.providerNativeFee.protectedOutputAtomic));
}

export function hasVerifiedVNextSwapSettlement(record: VNextExecutionRecord): boolean {
  if (record.kind !== "swap" || record.state !== "confirmed"
    || !record.outputAmountAtomic || !/^[1-9][0-9]*$/.test(record.outputAmountAtomic)) return false;
  if (record.provider !== "zero-x-swap") return true;
  const proof = record.outputSettlement;
  return validVNextOutputSettlement(record, proof) && proof.amountAtomic === record.outputAmountAtomic;
}

/** Count exact-token net receipt only after the mined envelope matches saved authority. */
export function verifyVNextErc20OutputSettlement(record: VNextExecutionRecord, receipt: {
  status: "success" | "reverted"; transactionHash: string; blockHash: string; from: string; to: string | null;
  logs: readonly { address: string; data: Hex; topics: readonly Hex[]; removed?: boolean }[];
}, transaction: {
  hash: string; chainId?: number; from: string; to: string | null; input: Hex;
  value: bigint; blockHash: string | null;
}): VNextOutputSettlement | null {
  const authority = record.providerNativeFee;
  if (record.provider !== "zero-x-swap" || record.kind !== "swap" || !authority
    || record.chainId !== 4663 || transaction.chainId !== 4663 || receipt.status !== "success"
    || !same(receipt.transactionHash, record.txHash) || !same(transaction.hash, record.txHash)
    || !same(receipt.blockHash, transaction.blockHash)
    || !same(receipt.from, record.wallet) || !same(transaction.from, record.wallet)
    || !same(receipt.to, authority.transactionTarget) || !same(transaction.to, authority.transactionTarget)
    || !same(keccak256(transaction.input), authority.calldataHash)
    || transaction.value !== (same(record.inputAsset, zeroAddress) ? BigInt(record.inputAmountAtomic) : 0n)
    || same(record.outputAsset, zeroAddress)) return null;
  // WETH withdrawal alone does not prove native delivery. Preserve unknown native settlement.
  let received = 0n;
  for (const log of receipt.logs) {
    if (!same(log.address, record.outputAsset) || log.removed) continue;
    try {
      const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
      if (event.eventName !== "Transfer") continue;
      if (same(event.args.to, record.wallet)) received += event.args.value;
      if (same(event.args.from, record.wallet)) received -= event.args.value;
    } catch { /* Malformed/unrelated events grant no credit. */ }
  }
  const proof: VNextOutputSettlement = { source: "erc20_receipt_net_transfer", chainId: 4663,
    txHash: record.txHash, planId: record.planId, payloadHash: record.payloadHash,
    recipient: record.wallet, outputAsset: record.outputAsset, amountAtomic: received.toString(), receiptBlockHash: receipt.blockHash };
  return validVNextOutputSettlement(record, proof) ? proof : null;
}

/** Native settlement needs successful transaction-specific delivery, not WETH logs or balance guesses. */
export function verifyVNextNativeOutputSettlement(record: VNextExecutionRecord,
  receipt: Parameters<typeof verifyVNextErc20OutputSettlement>[1],
  transaction: Parameters<typeof verifyVNextErc20OutputSettlement>[2], trace: unknown): VNextOutputSettlement | null {
  const authority = record.providerNativeFee;
  if (record.provider !== "zero-x-swap" || record.kind !== "swap" || !authority || !same(record.outputAsset, zeroAddress)
    || record.chainId !== 4663 || transaction.chainId !== 4663 || receipt.status !== "success"
    || !same(receipt.transactionHash, record.txHash) || !same(transaction.hash, record.txHash)
    || !same(receipt.blockHash, transaction.blockHash) || !same(receipt.from, record.wallet) || !same(transaction.from, record.wallet)
    || !same(receipt.to, authority.transactionTarget) || !same(transaction.to, authority.transactionTarget)
    || !same(keccak256(transaction.input), authority.calldataHash) || transaction.value !== 0n) return null;
  try {
    if (!trace || typeof trace !== "object" || Array.isArray(trace)) return null;
    const root = trace as Record<string, unknown>;
    if (root.type !== "CALL" || root.error || !same(root.from as string, transaction.from)
      || !same(root.to as string, transaction.to) || !same(root.input as string, transaction.input)
      || typeof root.value !== "string" || BigInt(root.value) !== transaction.value) return null;
    let nodes = 0;
    let net = 0n;
    const visit = (value: unknown, depth: number) => {
      if (++nodes > 4096 || depth > 64 || !value || typeof value !== "object" || Array.isArray(value)) throw Error();
      const call = value as Record<string, unknown>;
      if (call.error) return; // Reverted subcalls and all descendants have no settled transfers.
      if (!["CALL", "STATICCALL", "DELEGATECALL", "CALLCODE", "CREATE", "CREATE2", "SELFDESTRUCT"].includes(String(call.type))) throw Error();
      if (["CALL", "CREATE", "CREATE2", "SELFDESTRUCT"].includes(String(call.type))) {
        if (typeof call.from !== "string" || !/^0x[0-9a-f]{40}$/i.test(call.from)
          || typeof call.to !== "string" || !/^0x[0-9a-f]{40}$/i.test(call.to)
          || typeof call.value !== "string" || !/^0x[0-9a-f]+$/i.test(call.value)) throw Error();
        const amount = BigInt(call.value);
        if (same(call.to, record.wallet)) net += amount;
        if (same(call.from, record.wallet)) net -= amount;
      }
      if (call.calls !== undefined && !Array.isArray(call.calls)) throw Error();
      for (const child of (call.calls ?? []) as unknown[]) visit(child, depth + 1);
    };
    visit(root, 0);
    const proof: VNextOutputSettlement = { source: "native_transaction_trace", chainId: 4663,
      txHash: record.txHash, planId: record.planId, payloadHash: record.payloadHash, recipient: record.wallet,
      outputAsset: record.outputAsset, amountAtomic: net.toString(), receiptBlockHash: receipt.blockHash };
    return validVNextOutputSettlement(record, proof) ? proof : null;
  } catch { return null; }
}
