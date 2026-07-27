import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  zeroAddress,
  type Abi,
  type Address
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { z } from "zod";
import type { TokenRiskEvidence } from "../token-risk-evidence";
import {
  resolveRegisteredLiquidityPosition,
  type RegisteredLiquiditySource
} from "./registered-liquidity-position";

const BLOCKSCOUT = "https://robinhoodchain.blockscout.com";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
const MAX_TIMEOUT_MS = 12_000;
const abiParameterSchema = z.object({ type: z.string().min(1).max(80) }).passthrough();
const abiFunctionSchema = z.object({
  type: z.literal("function"),
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}$/),
  stateMutability: z.enum(["pure", "view", "nonpayable", "payable"]),
  inputs: z.array(abiParameterSchema).max(32),
  outputs: z.array(abiParameterSchema).max(32)
}).passthrough();

const contractSchema = z.object({
  is_verified: z.boolean(),
  proxy_type: z.string().nullable().optional(),
  implementations: z.array(z.unknown()).optional(),
  is_changed_bytecode: z.boolean().nullable().optional(),
  abi: z.array(z.unknown()).max(2_000).optional()
}).passthrough();
const contractAbiEnvelopeSchema = z.object({
  status: z.string(),
  message: z.string(),
  result: z.string()
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
type ControlState = {
  administrator: Address | null;
  currentBlock: bigint | null;
  restrictionEndBlock: bigint | null;
  maxTransactionBps: number | null;
  maxWalletBps: number | null;
};
type ReadControlState = (
  token: Address,
  functions: z.infer<typeof abiFunctionSchema>[]
) => Promise<ControlState>;

const STANDARD_TOKEN_WRITES = new Set([
  "approve",
  "burn",
  "decreaseallowance",
  "increaseallowance",
  "permit",
  "transfer",
  "transferfrom"
]);
const CONTROL_PATTERNS: Array<{
  category: TokenRiskEvidence["contract"]["controls"]["detected"][number]["category"];
  pattern: RegExp;
}> = [
  { category: "supply", pattern: /(mint|issue|rebase|setsupply)/ },
  { category: "transfer", pattern: /(pause|blacklist|blocklist|whitelist|settrading|enabletrading|disabletrading|setmax|setlimit|excludefrom)/ },
  { category: "fees", pattern: /(tax|setfee|updatefee|treasury|marketingwallet|liquidityfee)/ },
  { category: "upgrade", pattern: /(upgrade|implementation|changeadmin)/ },
  { category: "access", pattern: /(ownership|setowner|grantrole|revokerole|setadmin)/ },
  { category: "launch", pattern: /(initialbuy|restriction|antibot|cooldown)/ }
];

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

export function scanPublishedTokenControls(rawAbi: unknown[] | undefined) {
  const functions = (rawAbi ?? [])
    .map((entry) => abiFunctionSchema.safeParse(entry))
    .filter((entry): entry is { success: true; data: z.infer<typeof abiFunctionSchema> } => entry.success)
    .map((entry) => entry.data);
  const writes = functions.filter((entry) =>
    entry.stateMutability === "nonpayable" || entry.stateMutability === "payable"
  );
  const customWriteFunctions = Array.from(new Set(
    writes
      .filter((entry) => !STANDARD_TOKEN_WRITES.has(entry.name.toLowerCase()))
      .map((entry) => entry.name)
  )).sort();
  const detected = customWriteFunctions.flatMap((functionName) => {
    const normalized = functionName.toLowerCase().replaceAll("_", "");
    const match = CONTROL_PATTERNS.find((candidate) => candidate.pattern.test(normalized));
    return match ? [{ category: match.category, functionName }] : [];
  });
  return { functions, customWriteFunctions, detected };
}

async function readControlState(
  token: Address,
  functions: z.infer<typeof abiFunctionSchema>[]
): Promise<ControlState> {
  const findView = (names: string[], outputType: string) => functions.find((entry) =>
    names.includes(entry.name.toLowerCase())
    && (entry.stateMutability === "view" || entry.stateMutability === "pure")
    && entry.inputs.length === 0
    && entry.outputs.length === 1
    && entry.outputs[0]?.type === outputType
  );
  const ownerFunction = findView(["owner", "getowner", "admin", "administrator"], "address");
  const restrictionFunction = findView(["restrictionendblock"], "uint256");
  const maxTransactionFunction = findView(["maxtxbps", "maxtransactionbps"], "uint16")
    ?? findView(["maxtxbps", "maxtransactionbps"], "uint256");
  const maxWalletFunction = findView(["maxwalletbps"], "uint16")
    ?? findView(["maxwalletbps"], "uint256");
  const read = async (abiFunction: z.infer<typeof abiFunctionSchema> | undefined) => {
    if (!abiFunction) return null;
    try {
      return await client.readContract({
        address: token,
        abi: [abiFunction] as Abi,
        functionName: abiFunction.name
      });
    } catch {
      return null;
    }
  };
  const [administrator, restrictionEndBlock, maxTransactionBps, maxWalletBps, currentBlock] = await Promise.all([
    read(ownerFunction),
    read(restrictionFunction),
    read(maxTransactionFunction),
    read(maxWalletFunction),
    restrictionFunction ? client.getBlockNumber().catch(() => null) : Promise.resolve(null)
  ]);
  const safeBps = (value: unknown) => {
    if (typeof value === "bigint" && value >= 0n && value <= 10_000n) return Number(value);
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000) return value;
    return null;
  };
  return {
    administrator: typeof administrator === "string" && isAddress(administrator)
      ? getAddress(administrator)
      : null,
    currentBlock: typeof currentBlock === "bigint" ? currentBlock : null,
    restrictionEndBlock: typeof restrictionEndBlock === "bigint" ? restrictionEndBlock : null,
    maxTransactionBps: safeBps(maxTransactionBps),
    maxWalletBps: safeBps(maxWalletBps)
  };
}

async function fetchJson(
  path: string,
  dependencies: { fetch?: RiskFetch; timeoutMs?: number },
  optional = false,
  timeoutOverrideMs?: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutOverrideMs ?? dependencies.timeoutMs ?? MAX_TIMEOUT_MS
  );
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
    if (optional) return undefined;
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
  const controls = evidence.contract.controls;
  if (controls.assessment === "unknown") {
    warnings.push("Privileged token controls cannot be assessed without a published contract ABI.");
  }
  if (controls.detected.length > 0) {
    const categories = Array.from(new Set(controls.detected.map((control) => control.category))).join(", ");
    warnings.push(`Published ABI exposes privileged control surfaces requiring review: ${categories}.`);
  }
  const unclassifiedWrites = controls.customWriteFunctions.filter((name) =>
    !controls.detected.some((control) => control.functionName === name)
  );
  if (unclassifiedWrites.length > 0) {
    warnings.push(`Published ABI exposes custom write functions requiring review: ${unclassifiedWrites.slice(0, 4).join(", ")}.`);
  }
  if (controls.activeLaunchRestrictions) {
    warnings.push("Onchain launch restrictions are currently active and may limit buys or wallet balances.");
  }
  if (evidence.liquidity.controlStatus === "not-proven") {
    warnings.push("Pool-held token supply does not prove the liquidity position is locked or outside creator control.");
  } else if (evidence.liquidity.controlStatus === "creator-controlled") {
    warnings.push("The reported creator can currently transfer the verified liquidity-position NFT.");
  } else if (evidence.liquidity.controlStatus === "contract-held") {
    warnings.push("The verified liquidity-position NFT is contract-held, but RMT has not proven that contract prevents withdrawal.");
  } else if (evidence.liquidity.controlStatus === "third-party-wallet") {
    warnings.push("The verified liquidity-position NFT is held by another wallet; this does not prove a time lock or permanent lock.");
  } else if (evidence.liquidity.controlStatus === "burn-address") {
    warnings.push("The verified liquidity-position NFT is currently held by the standard burn address.");
  }
  if (evidence.liquidity.approvedOperator) {
    warnings.push("The verified liquidity-position NFT has an approved transfer operator.");
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
  params: {
    token: Address;
    pair: Address;
    creator?: Address;
    sourceId?: RegisteredLiquiditySource;
  },
  dependencies: {
    fetch?: RiskFetch;
    timeoutMs?: number;
    now?: () => number;
    readCreatorBalance?: ReadCreatorBalance;
    readControlState?: ReadControlState;
    readLiquidityPosition?: typeof resolveRegisteredLiquidityPosition;
  } = {}
): Promise<TokenRiskEvidence> {
  const tokenPath = `/api/v2/tokens/${params.token}`;
  const [rawToken, rawHolders, rawContract, rawContractAbi, rawCreatorBalance, liquidity] = await Promise.all([
    fetchJson(tokenPath, dependencies),
    fetchJson(`${tokenPath}/holders`, dependencies),
    fetchJson(`/api/v2/smart-contracts/${params.token}`, dependencies, true, 3_000),
    fetchJson(`/api?module=contract&action=getabi&address=${params.token}`, dependencies, true, 12_000),
    params.creator
      ? (dependencies.readCreatorBalance ?? readCreatorBalance)(params.token, params.creator)
      : Promise.resolve(null),
    (dependencies.readLiquidityPosition ?? resolveRegisteredLiquidityPosition)({
      token: params.token,
      pair: params.pair,
      creator: params.creator,
      sourceId: params.sourceId
    })
  ]);
  const token = tokenSchema.safeParse(rawToken);
  const holders = holdersSchema.safeParse(rawHolders);
  const contract = rawContract === null || rawContract === undefined
    ? { success: true as const, data: null }
    : contractSchema.safeParse(rawContract);
  const abiEnvelope = rawContractAbi === null || rawContractAbi === undefined
    ? { success: true as const, data: null }
    : contractAbiEnvelopeSchema.safeParse(rawContractAbi);
  if (!token.success || !holders.success || !contract.success || !abiEnvelope.success) {
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

  let publishedAbi: unknown[] | undefined;
  if (abiEnvelope.data?.status === "1") {
    try {
      const parsedAbi = JSON.parse(abiEnvelope.data.result);
      if (Array.isArray(parsedAbi)) publishedAbi = parsedAbi;
    } catch {
      publishedAbi = undefined;
    }
  }
  const contractDetailsUnavailable = rawContract === undefined;
  const abiUnavailable = rawContractAbi === undefined;
  const controlScan = scanPublishedTokenControls(publishedAbi ?? contract.data?.abi);
  const publishedAbiAvailable = Boolean(controlScan.functions.length > 0);
  const controlState = publishedAbiAvailable
    ? await (dependencies.readControlState ?? readControlState)(params.token, controlScan.functions)
    : {
        administrator: null,
        currentBlock: null,
        restrictionEndBlock: null,
        maxTransactionBps: null,
        maxWalletBps: null
      };
  const activeLaunchRestrictions = controlState.restrictionEndBlock === null
    || controlState.currentBlock === null
    ? null
    : controlState.restrictionEndBlock > controlState.currentBlock;
  const controlsEvidence = {
    assessment: !publishedAbiAvailable
      ? "unknown" as const
      : controlScan.customWriteFunctions.length > 0
        ? "review-required" as const
        : "no-common-controls-found" as const,
    detected: controlScan.detected,
    customWriteFunctions: controlScan.customWriteFunctions,
    administrator: controlState.administrator,
    activeLaunchRestrictions,
    restrictionEndBlock: controlState.restrictionEndBlock?.toString() ?? null,
    maxTransactionBps: controlState.maxTransactionBps,
    maxWalletBps: controlState.maxWalletBps
  };
  const contractEvidence = contract.data
    ? {
        sourcePublished: publishedAbiAvailable || contract.data.is_verified,
        isProxy: Boolean(
          contract.data.proxy_type
          || (contract.data.implementations && contract.data.implementations.length > 0)
        ),
        bytecodeChanged: contract.data.is_changed_bytecode ?? null,
        controls: controlsEvidence
      }
    : {
        sourcePublished: publishedAbiAvailable
          ? true
          : abiUnavailable
            ? null
            : false,
        isProxy: null,
        bytecodeChanged: null,
        controls: controlsEvidence
      };
  const partial = poolShareBps === null
    || largestNonPoolHolder === null
    || token.data.holders_count === null
    || token.data.holders_count === undefined
    || contractDetailsUnavailable
    || abiUnavailable;
  const base = {
    token: getAddress(params.token),
    pair: getAddress(params.pair),
    marketVerified: true as const,
    coverage: partial ? "partial" as const : "complete" as const,
    contract: contractEvidence,
    liquidity,
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
