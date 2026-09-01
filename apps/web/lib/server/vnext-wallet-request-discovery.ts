import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isHash,
  isHex,
  keccak256,
  type Address,
  type Hash,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { z } from "zod";

const BLOCKSCOUT_PRO = "https://api.blockscout.com/4663";
const MAX_DISCOVERY_RECORD_AGE_MS = 7 * 24 * 60 * 60_000;
const MAX_TRANSACTION_DELAY_MS = 15 * 60_000;
const MAX_DISCOVERY_BLOCK_SPAN = 1_024n;
const MAX_RESULTS = 50;
const MAX_RPC_BLOCKS = 256;
const RPC_BATCH_SIZE = 16;
const DISCOVERY_TIMEOUT_MS = 8_000;

const addressReferenceSchema = z.union([
  z.string(),
  z.object({ hash: z.string() }).passthrough()
]);

const transactionSchema = z.object({
  hash: z.string(),
  from: addressReferenceSchema,
  to: addressReferenceSchema.nullable(),
  block_number: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
  nonce: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
  raw_input: z.string(),
  value: z.string().regex(/^(0|[1-9][0-9]*)$/),
  timestamp: z.string().optional()
}).passthrough();

const responseSchema = z.object({
  items: z.array(transactionSchema).max(MAX_RESULTS)
}).passthrough();

export const vNextWalletRequestDiscoverySchema = z.object({
  requestId: z.string().uuid(),
  chainId: z.literal(4_663),
  wallet: z.string().refine((value) => isAddress(value, { strict: false })),
  walletNonceBeforeRequest: z.string().regex(/^(0|[1-9][0-9]*)$/),
  target: z.string().refine((value) => isAddress(value, { strict: false })),
  value: z.string().regex(/^(0|[1-9][0-9]*)$/),
  calldataHash: z.string().refine((value) => isHash(value)),
  requestBlockNumber: z.string().regex(/^(0|[1-9][0-9]*)$/),
  requestBlockHash: z.string().refine((value) => isHash(value)).optional(),
  requestedAtMs: z.number().int().positive()
}).strict();

export type VNextWalletRequestDiscovery = z.infer<typeof vNextWalletRequestDiscoverySchema>;

type RpcTransaction = {
  hash: Hash;
  from: Address;
  to: Address | null;
  blockNumber: bigint | null;
  nonce: number;
  input: Hex;
  value: bigint;
};

type RpcBlock = {
  number: bigint | null;
  hash: Hash | null;
  transactions: readonly RpcTransaction[];
};

export type VNextWalletRequestDiscoveryRpc = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(input: { blockNumber: bigint; includeTransactions: true }): Promise<RpcBlock>;
};

type DiscoveryResult = { status: "found"; txHash: Hash } | { status: "not_found" | "unavailable" };

function addressValue(value: z.infer<typeof addressReferenceSchema> | null) {
  const candidate = typeof value === "string" ? value : value?.hash;
  return candidate && isAddress(candidate, { strict: false }) ? getAddress(candidate) : null;
}

export function findExactVNextWalletRequestTransaction(
  request: VNextWalletRequestDiscovery,
  value: unknown
) {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) return null;
  const wallet = getAddress(request.wallet);
  const target = getAddress(request.target);
  const nonce = BigInt(request.walletNonceBeforeRequest);
  const requestBlock = BigInt(request.requestBlockNumber);
  const lastBlock = requestBlock + MAX_DISCOVERY_BLOCK_SPAN;
  const matches = new Map<Hash, { txHash: Hash; blockNumber: bigint }>();
  for (const item of parsed.data.items) {
    const blockNumber = BigInt(item.block_number);
    if (
      !isHash(item.hash)
      || addressValue(item.from) !== wallet
      || addressValue(item.to) !== target
      || BigInt(item.nonce) !== nonce
      || item.value !== request.value
      || blockNumber < requestBlock
      || blockNumber > lastBlock
      || !isHex(item.raw_input)
      || keccak256(item.raw_input as Hex).toLowerCase() !== request.calldataHash.toLowerCase()
    ) continue;
    if (item.timestamp) {
      const timestampMs = Date.parse(item.timestamp);
      if (!Number.isFinite(timestampMs) || timestampMs < request.requestedAtMs - 30_000 || timestampMs > request.requestedAtMs + MAX_TRANSACTION_DELAY_MS) continue;
    }
    const txHash = item.hash.toLowerCase() as Hash;
    matches.set(txHash, { txHash, blockNumber });
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}

function rpcTransactionMatches(
  request: VNextWalletRequestDiscovery,
  transaction: RpcTransaction,
  canonicalBlockNumber: bigint
) {
  return transaction.blockNumber === canonicalBlockNumber
    && getAddress(transaction.from) === getAddress(request.wallet)
    && transaction.to !== null
    && getAddress(transaction.to) === getAddress(request.target)
    && BigInt(transaction.nonce) === BigInt(request.walletNonceBeforeRequest)
    && transaction.value.toString() === request.value
    && keccak256(transaction.input).toLowerCase() === request.calldataHash.toLowerCase();
}

function configuredRpcClient(): VNextWalletRequestDiscoveryRpc {
  const rpcUrl = process.env.RMT_RPC_URL?.trim()
    || process.env.RMT_MAINNET_RPC_URL?.trim()
    || process.env.ROBINHOOD_MAINNET_RPC_URL?.trim()
    || robinhoodChain.rpcUrls.default.http[0];
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(rpcUrl, { retryCount: 1, timeout: DISCOVERY_TIMEOUT_MS })
  }) as unknown as VNextWalletRequestDiscoveryRpc;
}

async function discoverViaCanonicalRpc(
  request: VNextWalletRequestDiscovery,
  rpc: VNextWalletRequestDiscoveryRpc,
  deadlineAtMs: number
): Promise<DiscoveryResult> {
  try {
    if (await rpc.getChainId() !== robinhoodChain.id) return { status: "unavailable" };
    const requestBlock = BigInt(request.requestBlockNumber);
    const currentBlock = await rpc.getBlockNumber();
    if (currentBlock < requestBlock) return { status: "unavailable" };
    const maximumRequestBlock = requestBlock + MAX_DISCOVERY_BLOCK_SPAN;
    const lastBlock = currentBlock < maximumRequestBlock ? currentBlock : maximumRequestBlock;
    const rpcLastBlock = requestBlock + BigInt(MAX_RPC_BLOCKS - 1);
    const scannedLastBlock = lastBlock < rpcLastBlock ? lastBlock : rpcLastBlock;
    const matches = new Map<Hash, true>();

    for (let start = requestBlock; start <= scannedLastBlock; start += BigInt(RPC_BATCH_SIZE)) {
      if (Date.now() >= deadlineAtMs) return { status: "unavailable" };
      const end = start + BigInt(RPC_BATCH_SIZE - 1) < scannedLastBlock
        ? start + BigInt(RPC_BATCH_SIZE - 1)
        : scannedLastBlock;
      const blocks = await Promise.all(Array.from(
        { length: Number(end - start + 1n) },
        async (_, offset) => {
          const expectedBlockNumber = start + BigInt(offset);
          return {
            expectedBlockNumber,
            block: await rpc.getBlock({ blockNumber: expectedBlockNumber, includeTransactions: true })
          };
        }
      ));
      for (const { expectedBlockNumber, block } of blocks) {
        if (block.number !== expectedBlockNumber || block.hash === null) return { status: "unavailable" };
        if (
          block.number === requestBlock
          && request.requestBlockHash
          && block.hash.toLowerCase() !== request.requestBlockHash.toLowerCase()
        ) return { status: "unavailable" };
        for (const transaction of block.transactions) {
          if (rpcTransactionMatches(request, transaction, expectedBlockNumber)) {
            matches.set(transaction.hash.toLowerCase() as Hash, true);
          }
        }
      }
    }
    if (matches.size === 1) return { status: "found", txHash: [...matches.keys()][0] };
    if (matches.size > 1 || scannedLastBlock < lastBlock) return { status: "unavailable" };
    return { status: "not_found" };
  } catch {
    return { status: "unavailable" };
  }
}

async function withDiscoveryTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), DISCOVERY_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function discoverViaBlockscout(
  request: VNextWalletRequestDiscovery,
  input: { fetch: typeof fetch; apiKey: string }
): Promise<DiscoveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await input.fetch(
      `${BLOCKSCOUT_PRO}/api/v2/addresses/${getAddress(request.wallet)}/transactions?filter=from`,
      {
        headers: { Accept: "application/json", Authorization: `Bearer ${input.apiKey}` },
        cache: "no-store",
        signal: controller.signal
      }
    );
    if (!response.ok) return { status: "unavailable" };
    const match = findExactVNextWalletRequestTransaction(request, await response.json());
    return match ? { status: "found", txHash: match.txHash } : { status: "not_found" };
  } catch {
    return { status: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverExactVNextWalletRequestTransaction(
  request: VNextWalletRequestDiscovery,
  dependencies: {
    fetch?: typeof fetch;
    apiKey?: string;
    nowMs?: number;
    rpc?: VNextWalletRequestDiscoveryRpc | null;
  } = {}
): Promise<DiscoveryResult> {
  const nowMs = dependencies.nowMs ?? Date.now();
  if (nowMs < request.requestedAtMs || nowMs - request.requestedAtMs > MAX_DISCOVERY_RECORD_AGE_MS) return { status: "not_found" };
  const apiKey = dependencies.apiKey ?? (dependencies.fetch ? "test-only-blockscout-key" : process.env.RMT_BLOCKSCOUT_PRO_API_KEY);
  const rpc = dependencies.rpc === null ? null : dependencies.rpc ?? configuredRpcClient();
  const deadlineAtMs = Date.now() + DISCOVERY_TIMEOUT_MS;
  const unavailable = { status: "unavailable" as const };
  const [blockscout, rpcResult] = await withDiscoveryTimeout(Promise.all([
    apiKey
      ? discoverViaBlockscout(request, { fetch: dependencies.fetch ?? fetch, apiKey })
      : Promise.resolve(unavailable),
    rpc
      ? discoverViaCanonicalRpc(request, rpc, deadlineAtMs)
      : Promise.resolve(unavailable)
  ]), [unavailable, unavailable] as const);
  if (blockscout.status === "found" && rpcResult.status === "found") {
    return blockscout.txHash === rpcResult.txHash ? blockscout : { status: "unavailable" };
  }
  if (blockscout.status === "found") {
    return rpcResult.status === "not_found" ? { status: "unavailable" } : blockscout;
  }
  if (rpcResult.status === "found") return rpcResult;
  if (rpcResult.status === "not_found") return rpcResult;
  if (rpc === null && blockscout.status === "not_found") return blockscout;
  return { status: "unavailable" };
}

export const VNEXT_WALLET_REQUEST_DISCOVERY_BOUNDARY = {
  chainId: 4_663,
  maximumResults: MAX_RESULTS,
  maximumBlockSpan: MAX_DISCOVERY_BLOCK_SPAN,
  maximumRecordAgeMs: MAX_DISCOVERY_RECORD_AGE_MS,
  maximumTransactionDelayMs: MAX_TRANSACTION_DELAY_MS,
  maximumRpcBlocks: MAX_RPC_BLOCKS,
  rpcBatchSize: RPC_BATCH_SIZE,
  discoveryTimeoutMs: DISCOVERY_TIMEOUT_MS,
  blockscoutCredentialRequired: false,
  canonicalRpcFallback: true
} as const;
