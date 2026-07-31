import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbiItem,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { z } from "zod";
import {
  decodeUniswapV4HookPermissions,
  isUniswapV4PoolId,
  type ExternalV4HookEvidence
} from "../external-v4-evidence";
import { RUNNER_THRESHOLDS } from "../external-market-ranking";
import {
  ROBINHOOD_UNIVERSAL_ROUTER,
  ROBINHOOD_V4_POOL_MANAGER,
  ROBINHOOD_V4_QUOTER,
  ROBINHOOD_V4_STATE_VIEW
} from "../uniswap-v4";

const DEXSCREENER_TOKEN_PAIRS_API = "https://api.dexscreener.com/token-pairs/v1/robinhood";
const DEXSCREENER_PAGE = "https://dexscreener.com/robinhood/";
const BLOCKSCOUT = "https://robinhoodchain.blockscout.com";
const DYNAMIC_FEE_FLAG = 0x800000;
const TIMEOUT_MS = 10_000;
const MAX_HOOK_FUNCTIONS = 2_000;

const rawTokenSchema = z.object({ address: z.string() }).passthrough();
const rawPairSchema = z.object({
  chainId: z.string(),
  dexId: z.string(),
  url: z.string(),
  pairAddress: z.string(),
  baseToken: rawTokenSchema,
  quoteToken: rawTokenSchema,
  liquidity: z.object({ usd: z.union([z.number(), z.string()]) }).optional()
}).passthrough();
const hookContractSchema = z.object({
  name: z.string().nullable().optional(),
  is_verified: z.boolean(),
  proxy_type: z.string().nullable().optional(),
  implementations: z.array(z.unknown()).optional(),
  is_changed_bytecode: z.boolean().nullable().optional(),
  abi: z.array(z.unknown()).max(MAX_HOOK_FUNCTIONS).optional()
}).passthrough();
const abiFunctionSchema = z.object({
  type: z.literal("function"),
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}$/),
  stateMutability: z.enum(["pure", "view", "nonpayable", "payable"])
}).passthrough();

const initializeEvent = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)"
);
const stateViewAbi = [{
  type: "function",
  name: "getSlot0",
  stateMutability: "view",
  inputs: [{ name: "poolId", type: "bytes32" }],
  outputs: [
    { name: "sqrtPriceX96", type: "uint160" },
    { name: "tick", type: "int24" },
    { name: "protocolFee", type: "uint24" },
    { name: "lpFee", type: "uint24" }
  ]
}] as const;
const poolKeyParameters = [{
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" }
  ]
}] as const;

const HOOK_CALLBACKS = new Set([
  "afteraddliquidity",
  "afterdonate",
  "afterinitialize",
  "afterremoveliquidity",
  "afterswap",
  "beforeaddliquidity",
  "beforedonate",
  "beforeinitialize",
  "beforeremoveliquidity",
  "beforeswap",
  "unlockcallback"
]);

type V4InitializeLog = {
  args: {
    id?: Hex;
    currency0?: Address;
    currency1?: Address;
    fee?: number;
    tickSpacing?: number;
    hooks?: Address;
    sqrtPriceX96?: bigint;
    tick?: number;
  };
  blockNumber: bigint | null;
};

type V4MarketDependencies = {
  fetch?: typeof fetch;
  getInitializeLogs?: (poolId: Hex) => Promise<V4InitializeLog[]>;
  readSlot0?: (poolId: Hex) => Promise<readonly [bigint, number, number, number]>;
  getBytecode?: (address: Address) => Promise<Hex | undefined>;
  timeoutMs?: number;
};

export type VerifiedExternalUniswapV4Market = {
  protocol: "uniswap-v4";
  token: Address;
  poolId: Hex;
  poolManager: Address;
  stateView: Address;
  quoter: Address;
  router: Address;
  poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
  poolState: {
    sqrtPriceX96: bigint;
    tick: number;
    protocolFee: number;
    lpFee: number;
    initializedAtBlock: bigint;
  };
  hook: ExternalV4HookEvidence;
  liquidityUsd: number;
  url: string;
};

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL
      ?? process.env.ROBINHOOD_MAINNET_RPC_URL
      ?? process.env.NEXT_PUBLIC_RMT_RPC_URL
      ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 2, timeout: 12_000 }
  )
});

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function hasContractCode(code: Hex | undefined) {
  return Boolean(code && code !== "0x");
}

function numberFrom(value: number | string | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function v4PoolId(poolKey: VerifiedExternalUniswapV4Market["poolKey"]) {
  return keccak256(encodeAbiParameters(poolKeyParameters, [poolKey]));
}

function hookCustomWrites(rawAbi: unknown[] | undefined) {
  return Array.from(new Set((rawAbi ?? [])
    .map((entry) => abiFunctionSchema.safeParse(entry))
    .filter((entry): entry is { success: true; data: z.infer<typeof abiFunctionSchema> } => entry.success)
    .map((entry) => entry.data)
    .filter((entry) => entry.stateMutability === "nonpayable" || entry.stateMutability === "payable")
    .filter((entry) => !HOOK_CALLBACKS.has(entry.name.toLowerCase()))
    .map((entry) => entry.name)))
    .sort()
    .slice(0, 16);
}

async function fetchHookEvidence(
  hook: Address,
  code: Hex | undefined,
  fee: number,
  fetcher: typeof fetch,
  timeoutMs: number
): Promise<ExternalV4HookEvidence> {
  const permissions = decodeUniswapV4HookPermissions(hook);
  const base = {
    address: getAddress(hook),
    permissions,
    affectsSwap: permissions.some((permission) => (
      permission === "before-swap"
      || permission === "after-swap"
      || permission === "before-swap-return-delta"
      || permission === "after-swap-return-delta"
    )),
    returnsSwapDelta: permissions.includes("before-swap-return-delta")
      || permissions.includes("after-swap-return-delta"),
    dynamicFee: (fee & DYNAMIC_FEE_FLAG) !== 0,
    codePresent: hook === zeroAddress || hasContractCode(code)
  };
  if (hook === zeroAddress) {
    return {
      ...base,
      sourcePublished: null,
      isProxy: null,
      bytecodeChanged: null,
      contractName: null,
      customWriteFunctions: []
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${BLOCKSCOUT}/api/v2/smart-contracts/${hook}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Hook source evidence is unavailable.");
    const parsed = hookContractSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Hook source evidence is malformed.");
    return {
      ...base,
      sourcePublished: parsed.data.is_verified,
      isProxy: Boolean(
        parsed.data.proxy_type
        || (parsed.data.implementations && parsed.data.implementations.length > 0)
      ),
      bytecodeChanged: parsed.data.is_changed_bytecode ?? null,
      contractName: parsed.data.name?.trim().slice(0, 100) || null,
      customWriteFunctions: hookCustomWrites(parsed.data.abi)
    };
  } catch {
    return {
      ...base,
      sourcePublished: null,
      isProxy: null,
      bytecodeChanged: null,
      contractName: null,
      customWriteFunctions: []
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyExternalUniswapV4Market(
  params: { token: Address; poolId: Hex },
  dependencies: V4MarketDependencies = {}
): Promise<VerifiedExternalUniswapV4Market> {
  if (!isUniswapV4PoolId(params.poolId)) throw new Error("The Uniswap v4 pool ID is invalid.");
  const fetcher = dependencies.fetch ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(`${DEXSCREENER_TOKEN_PAIRS_API}/${params.token}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
  } catch (cause) {
    if (controller.signal.aborted) throw new Error("Uniswap v4 market verification timed out.");
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error("Uniswap v4 market verification is unavailable.");
  const payload = z.array(rawPairSchema).safeParse(await response.json());
  if (!payload.success) throw new Error("Uniswap v4 market verification returned invalid data.");
  const candidate = payload.data.find((pair) => pair.pairAddress.toLowerCase() === params.poolId.toLowerCase());
  const liquidityUsd = numberFrom(candidate?.liquidity?.usd);
  if (
    !candidate
    || candidate.chainId !== "robinhood"
    || !(candidate.dexId.toLowerCase() === "uniswap" || candidate.dexId.toLowerCase().startsWith("uniswap-"))
    || !candidate.url.startsWith(DEXSCREENER_PAGE)
    || (
      candidate.baseToken.address.toLowerCase() !== params.token.toLowerCase()
      && candidate.quoteToken.address.toLowerCase() !== params.token.toLowerCase()
    )
    || liquidityUsd < RUNNER_THRESHOLDS.minimumDisplayLiquidityUsd
  ) {
    throw new Error("This Uniswap v4 pool is no longer eligible for RMT evidence.");
  }

  const getLogs = dependencies.getInitializeLogs ?? (async (poolId: Hex) => {
    return client.getLogs({
      address: ROBINHOOD_V4_POOL_MANAGER,
      event: initializeEvent,
      args: { id: poolId },
      fromBlock: 0n,
      toBlock: "latest"
    }) as Promise<V4InitializeLog[]>;
  });
  const logs = await getLogs(params.poolId);
  if (logs.length !== 1) throw new Error("RMT could not prove one canonical initialization for this v4 pool.");
  const log = logs[0];
  const { currency0, currency1, fee, tickSpacing, hooks } = log.args;
  if (
    !currency0
    || !currency1
    || fee === undefined
    || tickSpacing === undefined
    || !hooks
    || log.blockNumber === null
    || !isAddress(currency0)
    || !isAddress(currency1)
    || !isAddress(hooks)
    || tickSpacing <= 0
    || tickSpacing > 32_767
  ) {
    throw new Error("The canonical v4 initialization evidence is incomplete.");
  }
  const poolKey = {
    currency0: getAddress(currency0),
    currency1: getAddress(currency1),
    fee,
    tickSpacing,
    hooks: getAddress(hooks)
  };
  if (
    v4PoolId(poolKey).toLowerCase() !== params.poolId.toLowerCase()
    || (
      !sameAddress(poolKey.currency0, params.token)
      && !sameAddress(poolKey.currency1, params.token)
    )
  ) {
    throw new Error("The displayed token does not match the canonical v4 pool key.");
  }

  const readSlot0 = dependencies.readSlot0 ?? ((poolId: Hex) => client.readContract({
    address: ROBINHOOD_V4_STATE_VIEW,
    abi: stateViewAbi,
    functionName: "getSlot0",
    args: [poolId]
  }));
  const getBytecode = dependencies.getBytecode ?? ((address: Address) => client.getBytecode({ address }));
  const [slot0, managerCode, stateViewCode, quoterCode, routerCode, hookCode] = await Promise.all([
    readSlot0(params.poolId),
    getBytecode(ROBINHOOD_V4_POOL_MANAGER),
    getBytecode(ROBINHOOD_V4_STATE_VIEW),
    getBytecode(ROBINHOOD_V4_QUOTER),
    getBytecode(ROBINHOOD_UNIVERSAL_ROUTER),
    poolKey.hooks === zeroAddress ? Promise.resolve(undefined) : getBytecode(poolKey.hooks)
  ]);
  if (
    !hasContractCode(managerCode)
    || !hasContractCode(stateViewCode)
    || !hasContractCode(quoterCode)
    || !hasContractCode(routerCode)
    || slot0[0] <= 0n
    || (poolKey.hooks !== zeroAddress && !hasContractCode(hookCode))
  ) {
    throw new Error("The canonical Uniswap v4 execution contracts or pool state are unavailable.");
  }
  const hook = await fetchHookEvidence(poolKey.hooks, hookCode, poolKey.fee, fetcher, timeoutMs);

  return {
    protocol: "uniswap-v4",
    token: getAddress(params.token),
    poolId: params.poolId,
    poolManager: ROBINHOOD_V4_POOL_MANAGER,
    stateView: ROBINHOOD_V4_STATE_VIEW,
    quoter: ROBINHOOD_V4_QUOTER,
    router: ROBINHOOD_UNIVERSAL_ROUTER,
    poolKey,
    poolState: {
      sqrtPriceX96: slot0[0],
      tick: Number(slot0[1]),
      protocolFee: Number(slot0[2]),
      lpFee: Number(slot0[3]),
      initializedAtBlock: log.blockNumber
    },
    hook,
    liquidityUsd,
    url: candidate.url.slice(0, 300)
  };
}
