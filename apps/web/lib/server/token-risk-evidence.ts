import {
  BaseError,
  ExecutionRevertedError,
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
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

const BLOCKSCOUT_PRO = "https://api.blockscout.com/4663";
const BLOCKSCOUT_CHAIN_ID = 4663;
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
const MAX_TIMEOUT_MS = 12_000;
const EVIDENCE_CACHE_TTL_MS = 5 * 60_000;
const EVIDENCE_STALE_TTL_MS = 30 * 60_000;
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
  is_changed_bytecode: z.boolean().nullable().optional()
}).passthrough();
const contractAbiSchema = z.array(z.unknown()).max(2_000);

const tokenSchema = z.object({
  address_hash: z.string(),
  holders_count: z.string().regex(/^\d+$/).nullable().optional(),
  total_supply: z.string().regex(/^\d+$/)
}).passthrough();

const holderSchema = z.object({
  address: z.object({
    hash: z.string(),
    is_scam: z.boolean().optional(),
    is_contract: z.boolean().optional()
  }).passthrough(),
  value: z.string().regex(/^\d+$/)
}).passthrough();

const holdersSchema = z.object({
  items: z.array(holderSchema).max(100)
}).passthrough();
const chainBlockSchema = z.object({
  number: z.union([z.bigint(), z.string().regex(/^0x[0-9a-fA-F]+$/)]),
  l1BlockNumber: z.union([
    z.bigint(),
    z.string().regex(/^0x[0-9a-fA-F]+$/)
  ]).optional()
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
type SellSimulation = TokenRiskEvidence["sellSimulation"];
type SimulateSellTransfer = (
  token: Address,
  holder: Address,
  pair: Address,
  amount: bigint
) => Promise<SellSimulation>;
type RiskEvidenceDependencies = {
  fetch?: RiskFetch;
  timeoutMs?: number;
  now?: () => number;
  apiKey?: string;
  readCreatorBalance?: ReadCreatorBalance;
  readControlState?: ReadControlState;
  readLiquidityPosition?: typeof resolveRegisteredLiquidityPosition;
  simulateSellTransfer?: SimulateSellTransfer;
  useCache?: boolean;
};
type BlockscoutRead<T = unknown> =
  | { status: "ready"; value: T }
  | { status: "unavailable"; reason: "configuration" | "rate-limited" | "provider" | "timeout" | "malformed" };

const evidenceCache = new Map<string, {
  evidence: TokenRiskEvidence;
  freshUntil: number;
  staleUntil: number;
}>();
const evidenceInflight = new Map<string, Promise<TokenRiskEvidence>>();

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

export async function simulateSellDirectionTransfer(
  token: Address,
  holder: Address,
  pair: Address,
  amount: bigint,
  dependencies: {
    call?: (request: {
      account: Address;
      to: Address;
      data: `0x${string}`;
      gas: bigint;
    }) => Promise<{ data?: `0x${string}` }>;
  } = {}
): Promise<SellSimulation> {
  const base = {
    method: "holder-to-pool-transfer" as const,
    holder,
    amount: amount.toString()
  };
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [pair, amount]
  });
  try {
    const result = await (dependencies.call ?? ((request) => client.call(request)))({
      account: holder,
      to: token,
      data,
      gas: 500_000n
    });
    if (!result.data || result.data === "0x") {
      return { ...base, status: "passed", returnStyle: "no-return-data" };
    }
    try {
      const transferred = decodeFunctionResult({
        abi: erc20Abi,
        functionName: "transfer",
        data: result.data
      });
      return transferred === true
        ? { ...base, status: "passed", returnStyle: "boolean-true" }
        : { ...base, status: "blocked", returnStyle: null };
    } catch {
      return { ...base, status: "blocked", returnStyle: null };
    }
  } catch (cause) {
    const reverted = cause instanceof BaseError
      && cause.walk((entry) => entry instanceof ExecutionRevertedError);
    return {
      ...base,
      status: reverted ? "blocked" : "unavailable",
      returnStyle: null
    };
  }
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

export function solidityBlockNumber(block: unknown) {
  const parsed = chainBlockSchema.safeParse(block);
  if (!parsed.success) return null;
  return BigInt(parsed.data.l1BlockNumber ?? parsed.data.number);
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
    restrictionFunction
      ? client.getBlock()
          .then((block) => solidityBlockNumber(block))
          .catch(() => null)
      : Promise.resolve(null)
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
  dependencies: RiskEvidenceDependencies,
  timeoutOverrideMs?: number
): Promise<BlockscoutRead> {
  const apiKey = dependencies.apiKey
    ?? (dependencies.fetch ? "test-only-blockscout-key" : process.env.RMT_BLOCKSCOUT_PRO_API_KEY);
  if (!apiKey) return { status: "unavailable", reason: "configuration" };
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutOverrideMs ?? dependencies.timeoutMs ?? MAX_TIMEOUT_MS
  );
  try {
    const response = await (dependencies.fetch ?? fetch)(`${BLOCKSCOUT_PRO}${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      cache: "no-store",
      signal: controller.signal
    });
    if (response.status === 429 || response.status === 402) {
      return { status: "unavailable", reason: "rate-limited" };
    }
    if (response.status === 404 || !response.ok) {
      return { status: "unavailable", reason: "provider" };
    }
    try {
      return { status: "ready", value: await response.json() };
    } catch {
      return { status: "unavailable", reason: "malformed" };
    }
  } catch {
    return {
      status: "unavailable",
      reason: controller.signal.aborted ? "timeout" : "provider"
    };
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
  if (controls.assessment === "known-launch-controls") {
    warnings.push("Known Pons factory-only launch protection is documented and its two-block restriction window has expired.");
  } else if (controls.detected.length > 0) {
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
  if (evidence.marketVerified && evidence.liquidity.controlStatus === "not-proven") {
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
  if (evidence.marketVerified && evidence.liquidity.approvedOperator) {
    warnings.push("The verified liquidity-position NFT has an approved transfer operator.");
  }
  if (!evidence.marketVerified) {
    // Token-scoped evidence does not imply an address-pool sell path.
  } else if (evidence.sellSimulation.status === "blocked") {
    warnings.push("A read-only holder-to-pool transfer simulation failed. RMT has blocked buys for this market.");
  } else if (evidence.sellSimulation.status === "unavailable") {
    warnings.push("Sell-direction transfer simulation is temporarily unavailable. Treat sellability as unknown.");
  } else if (evidence.sellSimulation.status === "not-run") {
    warnings.push("No eligible non-contract holder was available for sell-direction simulation. Treat sellability as unknown.");
  } else {
    warnings.push("A read-only holder-to-pool transfer passed now; this does not guarantee a future sale, output amount, tax, or unchanged token behavior.");
  }
  const largest = evidence.marketVerified
    ? evidence.holders.largestNonPoolHolder?.shareBps
    : evidence.holders.largestHolder?.shareBps;
  if (largest !== undefined && largest >= 2_000) {
    warnings.push(`One ${evidence.marketVerified ? "non-pool address" : "visible holder"} controls at least 20% of the token supply.`);
  } else if (largest !== undefined && largest >= 1_000) {
    warnings.push(`One ${evidence.marketVerified ? "non-pool address" : "visible holder"} controls at least 10% of the token supply.`);
  }
  const creator = evidence.holders.creatorShareBps;
  if (creator !== null && creator >= 2_000) {
    warnings.push("The reported creator controls at least 20% of the token supply.");
  } else if (creator !== null && creator >= 1_000) {
    warnings.push("The reported creator controls at least 10% of the token supply.");
  }
  return warnings;
}

async function fetchTokenRiskEvidenceUncached(
  params: {
    token: Address;
    pair?: Address;
    creator?: Address;
    sourceId?: RegisteredLiquiditySource;
  },
  dependencies: RiskEvidenceDependencies = {}
): Promise<TokenRiskEvidence> {
  const tokenPath = `/api/v2/tokens/${params.token}`;
  const emptyLiquidity: TokenRiskEvidence["liquidity"] = {
    controlStatus: "not-proven",
    evidenceSource: "none",
    positionManager: null,
    positionId: null,
    owner: null,
    approvedOperator: null,
    creatorCanTransfer: null,
    positionLiquidity: null
  };
  const [tokenRead, holdersRead, contractRead, creatorRead, liquidityRead] = await Promise.all([
    fetchJson(tokenPath, dependencies),
    fetchJson(`${tokenPath}/holders`, dependencies),
    fetchJson(`/api/v2/smart-contracts/${params.token}`, dependencies, 6_000),
    params.creator
      ? (dependencies.readCreatorBalance ?? readCreatorBalance)(params.token, params.creator)
          .then((value) => ({ status: "ready" as const, value }))
          .catch(() => ({ status: "unavailable" as const }))
      : Promise.resolve({ status: "not-applicable" as const }),
    params.pair
      ? (dependencies.readLiquidityPosition ?? resolveRegisteredLiquidityPosition)({
          token: params.token,
          pair: params.pair,
          creator: params.creator,
          sourceId: params.sourceId
        })
          .then((value) => ({ status: "ready" as const, value }))
          .catch(() => ({ status: "unavailable" as const }))
      : Promise.resolve({ status: "not-applicable" as const })
  ]);

  const token = tokenRead.status === "ready" ? tokenSchema.safeParse(tokenRead.value) : null;
  const holders = holdersRead.status === "ready" ? holdersSchema.safeParse(holdersRead.value) : null;
  const contractObject = contractRead.status === "ready"
    && contractRead.value !== null
    && typeof contractRead.value === "object"
      ? contractRead.value as Record<string, unknown>
      : null;
  const contract = contractObject ? contractSchema.safeParse(contractObject) : null;
  const abi = contractObject && "abi" in contractObject
    ? contractAbiSchema.safeParse(contractObject.abi)
    : null;
  if (token?.success && safeAddress(token.data.address_hash)?.toLowerCase() !== params.token.toLowerCase()) {
    throw new Error("Blockscout returned risk evidence for a different token.");
  }
  const totalSupply = token?.success ? BigInt(token.data.total_supply) : null;
  const tokenReady = Boolean(token?.success && totalSupply && totalSupply > 0n);
  const holdersReady = Boolean(holders?.success && tokenReady);
  const contractReady = Boolean(contract?.success);
  const abiReady = Boolean(abi?.success);
  if (!tokenReady && !holdersReady && !contractReady && !abiReady) {
    throw new Error("Token-scoped risk evidence is unavailable.");
  }

  const ignored = new Set([
    zeroAddress.toLowerCase(),
    DEAD_ADDRESS
  ]);
  const pair = params.pair?.toLowerCase() ?? null;
  let poolShareBps: number | null = null;
  let largestNonPoolHolder: TokenRiskEvidence["holders"]["largestNonPoolHolder"] = null;
  const topNonPoolHolders: TokenRiskEvidence["holders"]["topNonPoolHolders"] = [];
  const topHolders: TokenRiskEvidence["holders"]["topHolders"] = [];
  let largestHolder: TokenRiskEvidence["holders"]["largestHolder"] = null;
  let sellProbeCandidate: { address: Address; value: bigint } | null = null;
  const creatorShareBps = creatorRead.status === "ready" && totalSupply && totalSupply > 0n
    ? shareBps(creatorRead.value, totalSupply)
    : null;
  const holderSupply = holdersReady ? totalSupply ?? 0n : 0n;
  for (const holder of holderSupply > 0n && holders?.success ? holders.data.items : []) {
    const address = safeAddress(holder.address.hash);
    if (!address) continue;
    const value = BigInt(holder.value);
    const normalized = address.toLowerCase();
    if (normalized === pair) poolShareBps = shareBps(value, holderSupply);
    if (!ignored.has(normalized)) {
      const candidate = { address, shareBps: shareBps(value, holderSupply) };
      const holderEvidence = {
        ...candidate,
        isContract: holder.address.is_contract === true,
        isScam: holder.address.is_scam === true
      };
      topHolders.push(holderEvidence);
      if (!largestHolder || candidate.shareBps > largestHolder.shareBps) {
        largestHolder = candidate;
      }
      if (normalized === pair) continue;
      topNonPoolHolders.push({
        ...holderEvidence
      });
      if (!largestNonPoolHolder || candidate.shareBps > largestNonPoolHolder.shareBps) {
        largestNonPoolHolder = candidate;
      }
      if (
        holder.address.is_contract === false
        && holder.address.is_scam !== true
        && value > 0n
        && (!sellProbeCandidate || value > sellProbeCandidate.value)
      ) {
        sellProbeCandidate = { address, value };
      }
    }
  }
  topHolders.sort((left, right) =>
    right.shareBps - left.shareBps || left.address.localeCompare(right.address)
  );
  const visibleTopHolders = topHolders.slice(0, 10);
  const topHolderShareBps = visibleTopHolders.length
    ? Math.min(10_000, visibleTopHolders.reduce((total, holder) => total + holder.shareBps, 0))
    : null;
  topNonPoolHolders.sort((left, right) =>
    right.shareBps - left.shareBps || left.address.localeCompare(right.address)
  );
  const visibleTopNonPoolHolders = topNonPoolHolders.slice(0, 10);
  const topNonPoolShareBps = visibleTopNonPoolHolders.length
    ? Math.min(10_000, visibleTopNonPoolHolders.reduce((total, holder) => total + holder.shareBps, 0))
    : null;
  const probeAmount = sellProbeCandidate && totalSupply
    ? [sellProbeCandidate.value, totalSupply / 1_000_000n || 1n]
        .reduce((smallest, value) => value < smallest ? value : smallest)
    : null;
  const sellSimulation = params.pair && sellProbeCandidate && probeAmount
    ? await (dependencies.simulateSellTransfer ?? simulateSellDirectionTransfer)(params.token, sellProbeCandidate.address, params.pair, probeAmount)
        .catch(() => ({
          status: "unavailable" as const,
          method: "holder-to-pool-transfer" as const,
          holder: sellProbeCandidate.address,
          amount: probeAmount.toString(),
          returnStyle: null
        }))
    : {
        status: "not-run" as const,
        method: "holder-to-pool-transfer" as const,
        holder: null,
        amount: null,
        returnStyle: null
      };

  const publishedAbi = abi?.success ? abi.data : undefined;
  const controlScan = scanPublishedTokenControls(publishedAbi);
  const publishedAbiAvailable = Boolean(controlScan.functions.length > 0);
  const controlState = publishedAbiAvailable
    ? await (dependencies.readControlState ?? readControlState)(params.token, controlScan.functions).catch(() => ({
        administrator: null,
        currentBlock: null,
        restrictionEndBlock: null,
        maxTransactionBps: null,
        maxWalletBps: null
      }))
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
  const knownExpiredPonsLaunchControl = params.sourceId === "pons"
    && liquidityRead.status === "ready"
    && liquidityRead.value.evidenceSource === "launchpad-registry"
    && activeLaunchRestrictions === false
    && controlScan.customWriteFunctions.length === 1
    && controlScan.customWriteFunctions[0] === "setInitialBuyRecipient"
    && controlScan.detected.length === 1
    && controlScan.detected[0]?.category === "launch"
    && controlScan.detected[0]?.functionName === "setInitialBuyRecipient";
  const controlsEvidence = {
    assessment: !publishedAbiAvailable
      ? "unknown" as const
      : knownExpiredPonsLaunchControl
        ? "known-launch-controls" as const
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
  const contractEvidence = contract?.success
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
          : null,
        isProxy: null,
        bytecodeChanged: null,
        controls: controlsEvidence
      };
  const domains = {
    token: tokenReady ? "ready" as const : "unavailable" as const,
    holders: holdersReady ? "ready" as const : "unavailable" as const,
    contract: contractReady ? "ready" as const : "unavailable" as const,
    abi: abiReady && publishedAbiAvailable ? "ready" as const : "unavailable" as const,
    creator: creatorRead.status,
    liquidity: liquidityRead.status,
    sell: !params.pair ? "not-applicable" as const
      : sellSimulation.status === "passed" || sellSimulation.status === "blocked" ? "ready" as const
        : "unavailable" as const
  };
  const partial = Object.values(domains).some((status) => status === "unavailable")
    || largestHolder === null
    || !token?.success
    || token.data.holders_count === null
    || token.data.holders_count === undefined
    || (Boolean(params.pair) && (
      poolShareBps === null
      || largestNonPoolHolder === null
      || sellSimulation.status === "unavailable"
      || sellSimulation.status === "not-run"
    ));
  const base = {
    token: getAddress(params.token),
    pair: params.pair ? getAddress(params.pair) : null,
    marketVerified: Boolean(params.pair),
    coverage: partial ? "partial" as const : "complete" as const,
    contract: contractEvidence,
    liquidity: liquidityRead.status === "ready" ? liquidityRead.value : emptyLiquidity,
    holders: {
      count: token?.success && token.data.holders_count ? Number(token.data.holders_count) : null,
      poolShareBps,
      topNonPoolShareBps,
      topNonPoolHolders: visibleTopNonPoolHolders,
      largestNonPoolHolder,
      topHolderShareBps,
      topHolders: visibleTopHolders,
      largestHolder,
      creator: params.creator ? getAddress(params.creator) : null,
      creatorShareBps
    },
    sellSimulation,
    domains,
    freshness: "fresh" as const,
    checkedAt: new Date(dependencies.now?.() ?? Date.now()).toISOString()
  };
  return { ...base, warnings: evidenceWarnings(base) };
}

function evidenceKey(params: { token: Address; pair?: Address; creator?: Address; sourceId?: RegisteredLiquiditySource }) {
  return [
    BLOCKSCOUT_CHAIN_ID,
    params.token.toLowerCase(),
    params.pair?.toLowerCase() ?? "none",
    params.creator?.toLowerCase() ?? "none",
    params.sourceId ?? "none"
  ].join(":");
}

function mergeLastGoodEvidence(current: TokenRiskEvidence, previous: TokenRiskEvidence) {
  if (!current.domains || !previous.domains) return current;
  const domains = { ...current.domains };
  let holders = current.holders;
  let contract = current.contract;
  let liquidity = current.liquidity;
  let sellSimulation = current.sellSimulation;
  if (domains.token === "unavailable" && previous.domains.token !== "unavailable") {
    domains.token = "stale";
    holders = { ...holders, count: previous.holders.count };
  }
  if (domains.holders === "unavailable" && previous.domains.holders !== "unavailable") {
    domains.holders = "stale";
    holders = previous.holders;
  }
  if (domains.contract === "unavailable" && previous.domains.contract !== "unavailable") {
    domains.contract = "stale";
    contract = previous.contract;
  }
  if (domains.abi === "unavailable" && previous.domains.abi !== "unavailable") {
    domains.abi = "stale";
    contract = { ...contract, controls: previous.contract.controls };
  }
  if (domains.creator === "unavailable" && previous.domains.creator !== "unavailable") {
    domains.creator = "stale";
    holders = { ...holders, creator: previous.holders.creator, creatorShareBps: previous.holders.creatorShareBps };
  }
  if (domains.liquidity === "unavailable" && previous.domains.liquidity !== "unavailable") {
    domains.liquidity = "stale";
    liquidity = previous.liquidity;
  }
  if (domains.sell === "unavailable" && previous.domains.sell !== "unavailable") {
    domains.sell = "stale";
    sellSimulation = previous.sellSimulation;
  }
  const usedStale = Object.values(domains).some((status) => status === "stale");
  return usedStale ? {
    ...current,
    coverage: "partial" as const,
    freshness: "stale" as const,
    domains,
    holders,
    contract,
    liquidity,
    sellSimulation,
    warnings: [...new Set([...current.warnings, ...previous.warnings, "Some evidence is last-loaded while Blockscout refresh is delayed."])]
  } : current;
}

export async function fetchTokenRiskEvidence(
  params: {
    token: Address;
    pair?: Address;
    creator?: Address;
    sourceId?: RegisteredLiquiditySource;
  },
  dependencies: RiskEvidenceDependencies = {}
): Promise<TokenRiskEvidence> {
  if (Object.keys(dependencies).length > 0 && !dependencies.useCache) {
    return fetchTokenRiskEvidenceUncached(params, dependencies);
  }
  const key = evidenceKey(params);
  const now = dependencies.now?.() ?? Date.now();
  const cached = evidenceCache.get(key);
  if (cached && cached.freshUntil > now) return cached.evidence;
  const existing = evidenceInflight.get(key);
  if (existing) return existing;
  const request = fetchTokenRiskEvidenceUncached(params, dependencies)
    .then((evidence) => {
      const merged = cached && cached.staleUntil > now
        ? mergeLastGoodEvidence(evidence, cached.evidence)
        : evidence;
      evidenceCache.set(key, {
        evidence: merged,
        freshUntil: now + EVIDENCE_CACHE_TTL_MS,
        staleUntil: now + EVIDENCE_STALE_TTL_MS
      });
      return merged;
    })
    .catch((cause) => {
      if (cached && cached.staleUntil > now) {
        return {
          ...cached.evidence,
          coverage: "partial" as const,
          freshness: "stale" as const,
          warnings: [...new Set([...cached.evidence.warnings, "Blockscout refresh is delayed; showing last-loaded evidence."])]
        };
      }
      throw cause;
    })
    .finally(() => evidenceInflight.delete(key));
  evidenceInflight.set(key, request);
  return request;
}

export function resetTokenRiskEvidenceCacheForTesting() {
  evidenceCache.clear();
  evidenceInflight.clear();
}
