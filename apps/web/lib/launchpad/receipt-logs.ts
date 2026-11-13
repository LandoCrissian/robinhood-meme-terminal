import { isAddress, isHash, type TransactionReceipt } from "viem";

const maxLogs = 256;
const maxDataBytes = 64 * 1024;

/** A projected log must belong to this exact receipt and have an unambiguous index. */
export function boundedReceiptLogs(receipt: TransactionReceipt) {
  const { blockHash, blockNumber, transactionHash, transactionIndex, logs } = receipt;
  if (!isHash(blockHash) || typeof blockNumber !== "bigint" || blockNumber < 0n
    || !isHash(transactionHash) || !Number.isSafeInteger(transactionIndex) || transactionIndex < 0
    || !Array.isArray(logs) || logs.length > maxLogs) {
    throw new Error("Receipt identity or log bounds are invalid.");
  }
  const indices = new Set<number>();
  let bytes = 0;
  for (const log of logs) {
    const index = log?.logIndex;
    if (!log || typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || indices.has(index)
      || (log.removed !== undefined && log.removed !== false) || log.blockNumber !== blockNumber || log.transactionIndex !== transactionIndex
      || typeof log.blockHash !== "string" || log.blockHash.toLowerCase() !== blockHash.toLowerCase()
      || typeof log.transactionHash !== "string" || log.transactionHash.toLowerCase() !== transactionHash.toLowerCase()
      || !isAddress(log.address, { strict: false }) || !Array.isArray(log.topics)
      || log.topics.length > 4 || log.topics.some((topic) => typeof topic !== "string" || !isHash(topic))
      || typeof log.data !== "string" || log.data.length > maxDataBytes * 2 + 2
      || !/^0x(?:[0-9a-f]{2})*$/i.test(log.data)) {
      throw new Error("Receipt contains a malformed, duplicate or unbound log.");
    }
    bytes += (log.data.length - 2) / 2;
    if (bytes > maxDataBytes) throw new Error("Receipt log data exceeds the review limit.");
    indices.add(index);
  }
  return logs;
}
