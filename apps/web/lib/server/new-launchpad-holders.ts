import { parseAbiItem, zeroAddress, type Address, type Hash, type PublicClient } from "viem";
import type { NewLaunchRecord } from "../launchpad/launch-record";

const transfer = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");
const maximumBlocks = 48n;
const maximumTransfers = 512;

type BlockEvidence = { number: bigint; hash: Hash; timestamp: bigint };
type TransferLog = {
  address: Address;
  blockNumber: bigint | null;
  blockHash: Hash | null;
  logIndex: number | null;
  transactionHash: Hash | null;
  removed: boolean;
  args: { from: Address; to: Address; value: bigint };
};

function projectHolders(launch: NewLaunchRecord, head: BlockEvidence, logs: TransferLog[]) {
  if (logs.length === 0 || logs.length > maximumTransfers) return;
  const opening = BigInt(launch.blockNumber);
  const supply = BigInt(launch.totalSupply);
  const balances = new Map<string, bigint>();
  const canonicalHashes = new Map<bigint, Hash>([[opening, launch.blockHash], [head.number, head.hash]]);
  let previousBlock = opening;
  let previousLogIndex = -1;
  let openingHolders: number | undefined;
  let minted = false;
  for (const log of logs) {
    const { blockNumber, blockHash, logIndex } = log;
    if (log.removed || log.address.toLowerCase() !== launch.token.toLowerCase() || blockNumber === null || !blockHash
      || logIndex === null || blockNumber < previousBlock || blockNumber > head.number) return;
    const expectedHash = canonicalHashes.get(blockNumber);
    if (expectedHash && expectedHash !== blockHash) return;
    canonicalHashes.set(blockNumber, blockHash);
    if (blockNumber > previousBlock) {
      if (previousBlock === opening) openingHolders = balances.size;
      previousBlock = blockNumber;
      previousLogIndex = -1;
    }
    if (logIndex <= previousLogIndex) return;
    previousLogIndex = logIndex;
    const { from, to, value } = log.args;
    const sender = from.toLowerCase();
    const recipient = to.toLowerCase();
    if (value < 0n || recipient === zeroAddress) return;
    if (sender === zeroAddress) {
      if (minted || blockNumber !== opening || log.transactionHash !== launch.transactionHash
        || logIndex >= launch.logIndex || recipient !== launch.factory.toLowerCase() || value !== supply) return;
      minted = true;
    } else {
      const balance = balances.get(sender) ?? 0n;
      if (!minted || balance < value) return;
      if (balance === value) balances.delete(sender);
      else balances.set(sender, balance - value);
    }
    if (value > 0n) balances.set(recipient, (balances.get(recipient) ?? 0n) + value);
  }
  if (!minted) return;
  return { opening: openingHolders ?? balances.size, current: balances.size };
}

export async function readLaunchHolderTrend(rpc: PublicClient, launch: NewLaunchRecord, head: BlockEvidence) {
  const fromBlock = BigInt(launch.blockNumber);
  const unknown = (reason: string) => ({ status: "unknown" as const, reason });
  const distance = head.number - fromBlock;
  if (distance < 2n || distance >= maximumBlocks) {
    return unknown("Holder history needs two separated blocks within the bounded launch window.");
  }
  try {
    const logs = await rpc.getLogs({ address: launch.token, event: transfer, fromBlock, toBlock: head.number, strict: true });
    const inventory = projectHolders(launch, head, logs);
    if (!inventory) return unknown("Transfer evidence could not reconstruct a complete fixed-supply holder history.");
    const [opening, canonicalHead] = await Promise.all([
      rpc.getBlock({ blockNumber: fromBlock }), rpc.getBlock({ blockNumber: head.number }),
    ]);
    if (opening.hash !== launch.blockHash || canonicalHead.hash !== head.hash || opening.timestamp >= head.timestamp) {
      return unknown("Comparable holder evidence changed or has no elapsed time.");
    }
    return {
      status: "observed" as const,
      from: {
        blockNumber: fromBlock.toString(), blockHash: launch.blockHash,
        timestampUnixSeconds: opening.timestamp.toString(), holders: inventory.opening,
      },
      to: {
        blockNumber: head.number.toString(), blockHash: head.hash,
        timestampUnixSeconds: head.timestamp.toString(), holders: inventory.current,
      },
    };
  } catch {
    return unknown("The provider could not return complete holder evidence.");
  }
}
