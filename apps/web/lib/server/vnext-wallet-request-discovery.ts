import { getAddress, isAddress, isHash, isHex, keccak256, type Address, type Hash, type Hex } from "viem";
import { z } from "zod";

const BLOCKSCOUT_PRO = "https://api.blockscout.com/4663";
const MAX_DISCOVERY_AGE_MS = 15 * 60_000;
const MAX_DISCOVERY_BLOCK_SPAN = 1_024n;
const MAX_RESULTS = 50;

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
      if (!Number.isFinite(timestampMs) || timestampMs < request.requestedAtMs - 30_000 || timestampMs > request.requestedAtMs + MAX_DISCOVERY_AGE_MS) continue;
    }
    return { txHash: item.hash.toLowerCase() as Hash, blockNumber };
  }
  return null;
}

export async function discoverExactVNextWalletRequestTransaction(
  request: VNextWalletRequestDiscovery,
  dependencies: { fetch?: typeof fetch; apiKey?: string; nowMs?: number } = {}
): Promise<{ status: "found"; txHash: Hash } | { status: "not_found" | "unavailable" }> {
  const nowMs = dependencies.nowMs ?? Date.now();
  if (nowMs < request.requestedAtMs || nowMs - request.requestedAtMs > MAX_DISCOVERY_AGE_MS) return { status: "not_found" };
  const apiKey = dependencies.apiKey ?? (dependencies.fetch ? "test-only-blockscout-key" : process.env.RMT_BLOCKSCOUT_PRO_API_KEY);
  if (!apiKey) return { status: "unavailable" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await (dependencies.fetch ?? fetch)(
      `${BLOCKSCOUT_PRO}/api/v2/addresses/${getAddress(request.wallet)}/transactions?filter=from`,
      {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
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

export const VNEXT_WALLET_REQUEST_DISCOVERY_BOUNDARY = {
  chainId: 4_663,
  maximumResults: MAX_RESULTS,
  maximumBlockSpan: MAX_DISCOVERY_BLOCK_SPAN,
  maximumAgeMs: MAX_DISCOVERY_AGE_MS
} as const;
