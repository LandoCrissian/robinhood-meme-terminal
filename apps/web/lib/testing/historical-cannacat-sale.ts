/** Exact public mined transaction/receipt; representative journal authority.
 * The owner's private Safari journal is not available to this fixture. UUID,
 * payload hash and minimum are deliberately test-only, not claimed to be the
 * original quote. Physical-device acceptance remains a separate requirement.
 */
import { formatTransaction, formatTransactionReceipt, getAddress, keccak256, zeroAddress } from "viem";
import type { VNextExecutionRecord } from "../vnext/execution-recovery";
import transaction from "./historical-cannacat-sale/transaction.json";
import receipt from "./historical-cannacat-sale/receipt.json";

export const historicalSaleRpc = { transaction, receipt };
export const historicalSaleTransaction = formatTransaction(transaction as unknown as Parameters<typeof formatTransaction>[0]);
export const historicalSaleReceipt = formatTransactionReceipt(receipt as unknown as Parameters<typeof formatTransactionReceipt>[0]);
export function historicalSaleRecord(nowMs = Date.now()): VNextExecutionRecord {
  return {
    schemaVersion: 1, chainId: 4663, wallet: getAddress(transaction.from), provider: "zero-x-swap", kind: "swap",
    inputAsset: getAddress("0x1139d423c1706bdead91f03507f521635591ed92"), outputAsset: zeroAddress,
    inputAmountAtomic: "1000000000000000000", planId: "117c117c-0000-4000-8000-000000000001",
    payloadHash: keccak256("0x117c"), txHash: transaction.hash as `0x${string}`,
    deadline: String(Math.floor(nowMs / 1000) - 3600), state: "submitted",
    submittedAtMs: nowMs - 3_600_000, updatedAtMs: nowMs - 3_600_000,
    providerNativeFee: { provider: "zero-x-swap", treasury: getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC"),
      feeAsset: zeroAddress, feeBps: 25, feeAmountAtomic: "0", expectedOutputAtomic: "137068094858",
      protectedOutputAtomic: "137068094858", providerFeeAsset: null, providerFeeAtomic: null,
      transactionTarget: getAddress(transaction.to), calldataHash: keccak256(transaction.input as `0x${string}`) },
  };
}
