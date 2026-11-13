import { isHash, type Hash, type PublicClient } from "viem";
import { launchCreatedEvent, type NewLaunchRecord } from "../launchpad/launch-record";
import type { LaunchpadRuntime } from "./new-launchpad-config";
import { sameHex, verifyLaunchReceipt } from "./new-launchpad-receipt";
import { LaunchpadStore, type LaunchCheckpoint } from "./new-launchpad-store";

const rangeSize = 256n;
const rawLogLimit = 512;
const receiptLimit = 128;
const rewindProbeLimit = 16;
type IndexWitness = Pick<PublicClient, "getChainId" | "getBlockNumber" | "getBlock">;

async function canonicalHash(rpc: IndexWitness, blockNumber: bigint): Promise<Hash> {
  const { number, hash } = await rpc.getBlock({ blockNumber, includeTransactions: false });
  if (number !== blockNumber || !hash || !isHash(hash)) throw new Error("RPC did not return the requested canonical block");
  return hash;
}

async function observedHead(rpc: IndexWitness, chainId: number) {
  const [observedChain, height] = await Promise.all([rpc.getChainId(), rpc.getBlockNumber()]);
  if (observedChain !== chainId) throw new Error("Launch index provider chain ID mismatch");
  if (typeof height !== "bigint" || height < 0n) throw new Error("Invalid launch index provider head");
  return height;
}

async function commonCheckpoint(
  store: LaunchpadStore, latest: LaunchCheckpoint | undefined, savedAnchor: LaunchCheckpoint | undefined,
  observed: (number: bigint) => Promise<Hash>,
) {
  let candidate = latest;
  for (let attempt = 0; candidate && attempt < rewindProbeLimit; attempt++) {
    if (sameHex(candidate.hash, await observed(candidate.number))) return candidate;
    candidate = store.checkpoint(candidate.number);
  }
  // A prior store without a pinned deployment ancestor cannot be reset from mismatched observations.
  if (candidate || (latest && !savedAnchor)) throw new Error("Launch index reorg exceeds the verified rewind boundary");
  return undefined;
}

async function boundedLaunchLogs(rpc: PublicClient, config: LaunchpadRuntime, fromBlock: bigint, maximumEnd: bigint) {
  let toBlock = maximumEnd;
  for (;;) {
    const logs = await rpc.getLogs({ address: config.deployment.factory, event: launchCreatedEvent, strict: true, fromBlock, toBlock });
    if (logs.length <= rawLogLimit && new Set(logs.map((log) => log.transactionHash?.toLowerCase())).size <= receiptLimit) {
      return { logs, toBlock };
    }
    if (toBlock === fromBlock) throw new Error("Launch logs exceed the verified single-block limit");
    toBlock = (fromBlock + toBlock) / 2n;
  }
}

export async function syncNewLaunchpadRange(store: LaunchpadStore, rpc: PublicClient, config: LaunchpadRuntime, witness?: IndexWitness) {
  const { startBlock, confirmations, deployment } = config;
  store.assertScope(config.scope);
  const latest = store.checkpoint();
  try {
    const heads = await Promise.all([observedHead(rpc, deployment.chainId), ...(witness ? [observedHead(witness, deployment.chainId)] : [])]);
    const head = heads.reduce((least, height) => height < least ? height : least);
    const atObservedTip = heads.every((height) => height === head);
    if (latest && head < latest.number) throw new Error("Launch index provider is behind the durable checkpoint");
    const safeHead = head - confirmations;
    if (latest && safeHead < latest.number) throw new Error("Launch index provider is behind the required observation depth");
    const observe = async (number: bigint) => {
      const hashes = await Promise.all([canonicalHash(rpc, number), ...(witness ? [canonicalHash(witness, number)] : [])]);
      if (hashes.some((hash) => !sameHex(hash, hashes[0]))) throw new Error("Launch index providers disagree on a canonical block");
      return hashes[0];
    };
    const anchorHeight = startBlock - 1n;
    if (anchorHeight < 0n || head < anchorHeight) throw new Error("Launch index provider is behind the deployment anchor");
    const anchor = { number: anchorHeight, hash: await observe(anchorHeight) };
    const savedAnchor = store.anchor();
    if (savedAnchor && !sameHex(savedAnchor.hash, anchor.hash)) throw new Error("Launch deployment anchor is no longer canonical");
    const checkpoint = await commonCheckpoint(store, latest, savedAnchor, observe);
    const fromBlock = checkpoint ? checkpoint.number + 1n : startBlock;

    const observed = new Map<bigint, Hash>([[anchor.number, anchor.hash]]);
    if (checkpoint) observed.set(checkpoint.number, checkpoint.hash);
    async function observeOnce(number: bigint) {
      const prior = observed.get(number);
      if (prior) return prior;
      const hash = await observe(number);
      observed.set(number, hash);
      return hash;
    }

    // Receipts ahead of the provider are not disproved by a missing block.
    const orphaned = [];
    const provisional = store.provisional();
    const provisionalTip = provisional.length ? await observeOnce(head) : undefined;
    for (const record of provisional) {
      if (record.blockNumber <= head && !sameHex(record.blockHash, await observeOnce(record.blockNumber))) orphaned.push(record);
    }

    if (fromBlock > safeHead) {
      if (!sameHex(anchor.hash, await observe(anchor.number)) || (checkpoint && !sameHex(checkpoint.hash, await observe(checkpoint.number)))
        || (provisionalTip && !sameHex(provisionalTip, await observe(head)))) {
        throw new Error("Launch index range changed during verification");
      }
      const caughtUp = atObservedTip && safeHead >= anchor.number;
      store.commitIndex(latest, { anchor, keep: checkpoint, records: [], orphaned, caughtUp });
      return { caughtUp, indexedThrough: checkpoint?.number };
    }

    const maximumEnd = fromBlock + rangeSize - 1n < safeHead ? fromBlock + rangeSize - 1n : safeHead;
    // Pin the range before the log query, including when over-limit responses force a smaller range.
    const maximumHash = await observeOnce(maximumEnd);
    const { logs, toBlock } = await boundedLaunchLogs(rpc, config, fromBlock, maximumEnd);
    const endingHash = await observeOnce(toBlock);
    const grouped = new Map<Hash, (typeof logs)[number]>();
    const slots = new Set<string>();
    for (const log of logs) {
      if (!log.transactionHash || !isHash(log.transactionHash) || !log.blockHash || !isHash(log.blockHash)
        || log.blockNumber === null || log.blockNumber < fromBlock || log.blockNumber > toBlock || log.logIndex === null
        || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0 || log.removed || !sameHex(log.address, deployment.factory)) {
        throw new Error("RPC returned a launch log outside the canonical range");
      }
      const hash = log.transactionHash.toLowerCase() as Hash;
      const prior = grouped.get(hash);
      if (prior) {
        if (log.blockNumber !== prior.blockNumber || !sameHex(log.blockHash, prior.blockHash) || log.logIndex !== prior.logIndex
          || !sameHex(log.data, prior.data) || log.topics.length !== prior.topics.length
          || log.topics.some((topic, index) => !sameHex(topic, prior.topics[index]))) {
          throw new Error("RPC returned conflicting duplicate launch logs");
        }
        continue;
      }
      const slot = `${log.blockNumber}:${log.logIndex}`;
      if (slots.has(slot)) throw new Error("RPC returned multiple launch logs at one canonical event slot");
      slots.add(slot);
      grouped.set(hash, log);
    }

    const records: NewLaunchRecord[] = [];
    for (const [hash, event] of grouped) {
      const record = await verifyLaunchReceipt(rpc, deployment, hash, { event });
      const height = BigInt(record.blockNumber);
      if (!sameHex(event.blockHash, record.blockHash) || event.logIndex !== record.logIndex || event.blockNumber !== height
        || !sameHex(record.blockHash, await observeOnce(height))) {
        throw new Error("RPC launch logs and transaction receipt disagree");
      }
      records.push(record);
    }
    if (provisional.some((record) => record.blockNumber >= fromBlock && record.blockNumber <= toBlock
      && sameHex(record.blockHash, observed.get(record.blockNumber))
      && !records.some((indexed) => sameHex(indexed.token, record.token) && sameHex(indexed.blockHash, record.blockHash)))) {
      throw new Error("RPC launch log range omits a verified provisional receipt");
    }
    if (!sameHex(maximumHash, await observe(maximumEnd)) || !sameHex(anchor.hash, await observe(anchor.number))
      || (provisionalTip && head !== maximumEnd && !sameHex(provisionalTip, await observe(head)))
      || (toBlock !== maximumEnd && !sameHex(endingHash, await observe(toBlock)))
      || (checkpoint && !sameHex(checkpoint.hash, await observe(checkpoint.number)))) {
      throw new Error("Launch index range changed during verification");
    }

    const caughtUp = atObservedTip && toBlock === safeHead;
    store.commitIndex(latest, { anchor, keep: checkpoint, next: { number: toBlock, hash: endingHash }, records, orphaned, caughtUp });
    return { caughtUp, indexedThrough: toBlock };
  } catch (error) {
    store.markDelayed(latest);
    throw error;
  }
}
