/** Exact owner-copied non-secret recovery record plus freshly re-anchored public
 * transaction and receipt. Never authentication evidence or signing authority.
 * This fixture is test-only and must not enter the delivered client bundle.
 */
import { formatTransaction, formatTransactionReceipt } from "viem";
import type { VNextExecutionRecord } from "../vnext/execution-recovery";
import fixture from "./october27-cannacat-sale.json";
export const october27SaleRpc = { transaction: fixture.transaction, receipt: fixture.receipt };
export const october27SaleTransaction = formatTransaction(fixture.transaction as unknown as Parameters<typeof formatTransaction>[0]);
export const october27SaleReceipt = formatTransactionReceipt(fixture.receipt as unknown as Parameters<typeof formatTransactionReceipt>[0]);
export function october27SaleRecord(): VNextExecutionRecord { return structuredClone(fixture.record) as VNextExecutionRecord; }
