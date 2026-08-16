import { createPublicClient, http, type Address } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  readCcff00PublicSnapshotV1,
  validateCcff00Canaries,
  type Ccff00ReadClient
} from "../lib/vnext/distribution-ccff00";

const fullPublic = process.argv.includes("--full-public-snapshot");
const blockArgument = process.argv.find((argument) => argument.startsWith("--block="));
const requestedBlock = blockArgument ? BigInt(blockArgument.slice("--block=".length)) : undefined;
const rpc = process.env.RMT_MAINNET_RPC_URL?.trim()
  || process.env.ROBINHOOD_MAINNET_RPC_URL?.trim()
  || robinhoodChain.rpcUrls.default.http[0];
const publicClient = createPublicClient({ chain: robinhoodChain, transport: http(rpc, { retryCount: 2, timeout: 15_000 }) });

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function withRetry<T>(task: () => Promise<T>, attempts = 8): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (cause) {
      lastError = cause;
      if (attempt < attempts) await sleep(Math.min(8_000, 500 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

const reader: Ccff00ReadClient = {
  async getBlockNumber() { return withRetry(() => publicClient.getBlockNumber()); },
  async getBlock({ blockNumber }) {
    const block = await withRetry(() => publicClient.getBlock({ blockNumber }));
    return { number: block.number, hash: block.hash };
  },
  async getBytecode({ address, blockNumber }) {
    return withRetry(() => publicClient.getBytecode({ address, blockNumber }));
  },
  async readContract(input) {
    return withRetry(() => publicClient.readContract({
      address: input.address as Address,
      abi: input.abi,
      functionName: input.functionName,
      args: input.args,
      blockNumber: input.blockNumber
    } as never));
  }
};

async function main() {
  const snapshot = await readCcff00PublicSnapshotV1(reader, {
    coverage: fullPublic ? "full_public" : "canaries",
    snapshotBlock: requestedBlock,
    concurrency: fullPublic ? 1 : 3,
    interChunkDelayMs: fullPublic ? 750 : 0
  });
  const canaries = validateCcff00Canaries(snapshot);
  const exactConfiguredCcff00Accounts = snapshot.rows.filter(
    (row) => row.ccff00BalanceAtomic === snapshot.tokensPerNftAtomic
  ).length;
  const rmtHoldingAccounts = snapshot.rows.filter((row) => BigInt(row.rmtBalanceAtomic) > 0n).length;
  const activatedAccounts = snapshot.rows.filter((row) => row.activated).length;
  console.log(JSON.stringify({
    mode: "read_only",
    chainId: snapshot.chainId,
    snapshotBlock: snapshot.snapshotBlock,
    snapshotBlockHash: snapshot.snapshotBlockHash,
    coverage: snapshot.coverage,
    publicMinted: snapshot.publicMinted,
    reserveMinted: snapshot.reserveMinted,
    totalSupply: snapshot.totalSupply,
    collection: snapshot.collection,
    collectionRuntimeHash: snapshot.collectionRuntimeHash,
    accountImplementation: snapshot.accountImplementation,
    accountImplementationRuntimeHash: snapshot.accountImplementationRuntimeHash,
    snapshotHash: snapshot.snapshotHash,
    inspectedAccounts: snapshot.rows.length,
    uniqueTokenBoundAccounts: new Set(snapshot.rows.map((row) => row.tokenBoundAccount.toLowerCase())).size,
    exactConfiguredCcff00Accounts,
    rmtHoldingAccounts,
    activatedAccounts,
    canaries: canaries.canaries.map((row) => ({
      tokenId: row.tokenId,
      owner: row.owner,
      tokenBoundAccount: row.tokenBoundAccount,
      activated: row.activated,
      ccff00BalanceAtomic: row.ccff00BalanceAtomic,
      rmtBalanceAtomic: row.rmtBalanceAtomic
    })),
    canaryGate: {
      oneRmtEachVerified: canaries.oneRmtEachVerified,
      activatedCanaryCount: canaries.activatedCanaryCount,
      ownerWithdrawalProofVerified: canaries.ownerWithdrawalProofVerified,
      massDistributionEligible: canaries.massDistributionEligible,
      blockers: canaries.blockers
    },
    walletSubmissionEnabled: false,
    serverSubmissionEnabled: false
  }, null, 2));
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
