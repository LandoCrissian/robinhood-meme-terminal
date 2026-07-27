import { createPublicClient, erc20Abi, getAddress, http, isAddress, zeroAddress, type Address } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { z } from "zod";
import type { TokenRiskEvidence } from "../token-risk-evidence";

const BLOCKSCOUT = "https://robinhoodchain.blockscout.com";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
const MAX_TIMEOUT_MS = 8_000;

const contractSchema = z.object({
  is_verified: z.boolean(),
  proxy_type: z.string().nullable().optional(),
  implementations: z.array(z.unknown()).optional(),
  is_changed_bytecode: z.boolean().nullable().optional()
}).passthrough();

const tokenSchema = z.object({
  address_hash: z.string(),
  holders_count: z.string().regex(/^\d+$/).nullable().optional(),
  total_supply: z.string().regex(/^\d+$/)
}).passthrough();

const holderSchema = z.object({
  address: z.object({
    hash: z.string(),
    is_scam: z.boolean().optional()
  }).passthrough(),
  value: z.string().regex(/^\d+$/)
}).passthrough();

const holdersSchema = z.object({
  items: z.array(holderSchema).max(100)
}).passthrough();

type RiskFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ReadCreatorBalance = (token: Address, creator: Address) => Promise<bigint>;

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 3, timeout: 12_000 }
  )
});

async function readCreatorBalance(token: Address, creator: Address) {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [creator]
  });
}

async function fetchJson(
  path: string,
  dependencies: { fetch?: RiskFetch; timeoutMs?: number },
  optional = false
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? MAX_TIMEOUT_MS);
  try {
    const response = await (dependencies.fetch ?? fetch)(`${BLOCKSCOUT}${path}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error("Blockscout risk evidence is unavailable.");
    return await response.json();
  } catch (cause) {
    if (controller.signal.aborted) throw new Error("Blockscout risk evidence timed out.");
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}

function safeAddress(value: string) {
  return isAddress(value) ? getAddress(value) : null;
}

function shareBps(value: bigint, totalSupply: bigint) {
  if (value <= 0n || totalSupply <= 0n) return 0;
  const bps = value * 10_000n / totalSupply;
  return Number(bps > 10_000n ? 10_000n : bps);
}

function evidenceWarnings(evidence: Omit<TokenRiskEvidence, "warnings">) {
  const warnings: string[] = [];
  if (evidence.contract.sourcePublished === false) {
    warnings.push("Contract source is not published on Robinhood Chain Blockscout.");
  } else if (evidence.contract.sourcePublished === null) {
    warnings.push("Contract source publication could not be verified.");
  }
  if (evidence.contract.bytecodeChanged) {
    warnings.push("Blockscout reports that deployed bytecode differs from the published source.");
  }
  if (evidence.contract.isProxy) {
    warnings.push("This token is a proxy and its behavior may depend on an implementation contract.");
  }
  const largest = evidence.holders.largestNonPoolHolder?.shareBps;
  if (largest !== undefined && largest >= 2_000) {
    warnings.push("One non-pool address controls at least 20% of the token supply.");
  } else if (largest !== undefined && largest >= 1_000) {
    warnings.push("One non-pool address controls at least 10% of the token supply.");
  }
  const creator = evidence.holders.creatorShareBps;
  if (creator !== null && creator >= 2_000) {
    warnings.push("The reported creator controls at least 20% of the token supply.");
  } else if (creator !== null && creator >= 1_000) {
    warnings.push("The reported creator controls at least 10% of the token supply.");
  }
  return warnings;
}

export async function fetchTokenRiskEvidence(
  params: { token: Address; pair: Address; creator?: Address },
  dependencies: {
    fetch?: RiskFetch;
    timeoutMs?: number;
    now?: () => number;
    readCreatorBalance?: ReadCreatorBalance;
  } = {}
): Promise<TokenRiskEvidence> {
  const tokenPath = `/api/v2/tokens/${params.token}`;
  const [rawToken, rawHolders, rawContract, rawCreatorBalance] = await Promise.all([
    fetchJson(tokenPath, dependencies),
    fetchJson(`${tokenPath}/holders`, dependencies),
    fetchJson(`/api/v2/smart-contracts/${params.token}`, dependencies, true),
    params.creator
      ? (dependencies.readCreatorBalance ?? readCreatorBalance)(params.token, params.creator)
      : Promise.resolve(null)
  ]);
  const token = tokenSchema.safeParse(rawToken);
  const holders = holdersSchema.safeParse(rawHolders);
  const contract = rawContract === null
    ? { success: true as const, data: null }
    : contractSchema.safeParse(rawContract);
  if (!token.success || !holders.success || !contract.success) {
    throw new Error("Blockscout returned invalid token risk evidence.");
  }
  if (safeAddress(token.data.address_hash)?.toLowerCase() !== params.token.toLowerCase()) {
    throw new Error("Blockscout returned risk evidence for a different token.");
  }
  const totalSupply = BigInt(token.data.total_supply);
  if (totalSupply <= 0n) throw new Error("Token supply evidence is unavailable.");

  const ignored = new Set([
    zeroAddress.toLowerCase(),
    DEAD_ADDRESS,
    params.pair.toLowerCase()
  ]);
  let poolShareBps: number | null = null;
  let largestNonPoolHolder: TokenRiskEvidence["holders"]["largestNonPoolHolder"] = null;
  const creatorShareBps = rawCreatorBalance === null
    ? null
    : shareBps(rawCreatorBalance, totalSupply);
  for (const holder of holders.data.items) {
    const address = safeAddress(holder.address.hash);
    if (!address) continue;
    const value = BigInt(holder.value);
    const normalized = address.toLowerCase();
    if (normalized === params.pair.toLowerCase()) poolShareBps = shareBps(value, totalSupply);
    if (!ignored.has(normalized)) {
      const candidate = { address, shareBps: shareBps(value, totalSupply) };
      if (!largestNonPoolHolder || candidate.shareBps > largestNonPoolHolder.shareBps) {
        largestNonPoolHolder = candidate;
      }
    }
  }

  const contractEvidence = contract.data
    ? {
        sourcePublished: contract.data.is_verified,
        isProxy: Boolean(
          contract.data.proxy_type
          || (contract.data.implementations && contract.data.implementations.length > 0)
        ),
        bytecodeChanged: contract.data.is_changed_bytecode ?? null
      }
    : {
        sourcePublished: false,
        isProxy: null,
        bytecodeChanged: null
      };
  const partial = poolShareBps === null
    || largestNonPoolHolder === null
    || token.data.holders_count === null
    || token.data.holders_count === undefined;
  const base = {
    token: getAddress(params.token),
    pair: getAddress(params.pair),
    marketVerified: true as const,
    coverage: partial ? "partial" as const : "complete" as const,
    contract: contractEvidence,
    holders: {
      count: token.data.holders_count ? Number(token.data.holders_count) : null,
      poolShareBps,
      largestNonPoolHolder,
      creator: params.creator ? getAddress(params.creator) : null,
      creatorShareBps
    },
    checkedAt: new Date(dependencies.now?.() ?? Date.now()).toISOString()
  };
  return { ...base, warnings: evidenceWarnings(base) };
}
