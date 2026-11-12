import type { Hash, PublicClient } from "viem";
import { launchCreatedEvent } from "../launchpad/launch-record";
import type { LaunchpadRuntime } from "./new-launchpad-config";
import { sameHex, verifyLaunchReceipt } from "./new-launchpad-receipt";
import { LaunchpadStore, type LaunchCheckpoint } from "./new-launchpad-store";

const rangeSize = 256n;

async function canonicalHash(rpc: PublicClient, blockNumber: bigint): Promise<Hash> {
  const { hash } = await rpc.getBlock({ blockNumber, includeTransactions: false });
  if (!hash) throw new Error("RPC did not return a canonical block hash");
  return hash;
}

async function rollbackIfNeeded(
  store: LaunchpadStore, rpc: PublicClient, head: bigint, startBlock: bigint,
): Promise<LaunchCheckpoint | undefined> {
  const latest = store.checkpoint();
  let candidate = latest;
  for (let attempt = 0; candidate && attempt < 16; attempt++) {
    if (candidate.number <= head && sameHex(candidate.hash, await canonicalHash(rpc, candidate.number))) {
      if (latest && latest.number !== candidate.number) store.rewind(latest, candidate, startBlock);
      return candidate;
    }
    candidate = store.checkpoint(candidate.number);
  }
  if (latest) store.rewind(latest, undefined, startBlock);
  return undefined;
}

export async function syncNewLaunchpadRange(store: LaunchpadStore, rpc: PublicClient, config: LaunchpadRuntime) {
  const { startBlock, confirmations, deployment } = config;
  try {
    const head = await rpc.getBlockNumber();
    const safeHead = head - confirmations;
    const checkpoint = await rollbackIfNeeded(store, rpc, head, startBlock);
    const fromBlock = checkpoint ? checkpoint.number + 1n : startBlock;

    // Revalidate provisional receipts even if the confirmed block cursor has not moved.
    const provisional = store.provisional();
    const provisionalHashes = new Map<bigint, Hash>();
    for (const record of provisional) {
      if (record.blockNumber <= head && !provisionalHashes.has(record.blockNumber)) {
        provisionalHashes.set(record.blockNumber, await canonicalHash(rpc, record.blockNumber));
      }
      if (!sameHex(record.blockHash, provisionalHashes.get(record.blockNumber))) store.removeProvisional(record);
    }

    if (fromBlock > safeHead) {
      const caughtUp = !!checkpoint || safeHead >= startBlock - 1n;
      store.markHealth(caughtUp);
      return { caughtUp, indexedThrough: checkpoint?.number };
    }
    const toBlock = fromBlock + rangeSize - 1n < safeHead ? fromBlock + rangeSize - 1n : safeHead;
    const endingHash = await canonicalHash(rpc, toBlock);
    const logs = await rpc.getLogs({ address: deployment.factory, event: launchCreatedEvent, strict: true, fromBlock, toBlock });
    const grouped = new Map<Hash, typeof logs>();
    for (const log of logs) {
      if (!log.transactionHash || !log.blockHash || log.blockNumber === null || log.logIndex === null || log.removed
        || log.blockNumber < fromBlock || log.blockNumber > toBlock || !sameHex(log.address, deployment.factory)) {
        throw new Error("RPC returned a launch log outside the canonical range");
      }
      const transactionLogs = grouped.get(log.transactionHash) ?? [];
      transactionLogs.push(log);
      grouped.set(log.transactionHash, transactionLogs);
    }

    const records = [];
    for (const [hash, candidates] of grouped) {
      const record = await verifyLaunchReceipt(rpc, deployment, hash);
      if (candidates.some((log) => !sameHex(log.blockHash, record.blockHash) || log.logIndex !== record.logIndex
        || log.blockNumber?.toString() !== record.blockNumber)) {
        throw new Error("RPC launch logs and transaction receipt disagree");
      }
      records.push(record);
    }
    if (!sameHex(endingHash, await canonicalHash(rpc, toBlock)) ||
      (checkpoint && !sameHex(checkpoint.hash, await canonicalHash(rpc, checkpoint.number)))) {
      throw new Error("Launch index range changed during verification");
    }

    store.advance(checkpoint, { number: toBlock, hash: endingHash }, records);
    const caughtUp = toBlock === safeHead;
    store.markHealth(caughtUp);
    return { caughtUp, indexedThrough: toBlock };
  } catch (error) {
    store.markHealth(false);
    throw error;
  }
}
