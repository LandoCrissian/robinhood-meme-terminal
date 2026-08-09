import { getAddress, isAddress, isHex, keccak256, parseUnits, type Address, type Hex } from "viem";
import { quoteSushiAssetRoute } from "../lib/server/sushi-trade";
import { readRobinhoodTokenIdentity } from "../lib/server/universal-market-resolver";
import { quoteVNextUniswapDirect } from "../lib/server/vnext-uniswap-quote";
import { ROBINHOOD_RMT_ADDRESS } from "../lib/vnext/robinhood-assets";

const CHAIN_ID = 4663;
const RPC_URL = process.env.RMT_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com/";
const ROBINHOOD_ASSETS_URL = "https://api.robinhood.com/rhj/assets";
const PCSX_PRICE_URL = "https://x.pancakeswap.com/order-price/get-price";
const ZEROX_API_URL = "https://api.0x.org";
const DEXSCREENER_PAIRS_URL = "https://api.dexscreener.com/token-pairs/v1/robinhood";
const TIMEOUT_MS = 10_000;

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const NON_FUNDED_BENCHMARK_TAKER = "0x0000000000000000000000000000000000000001";
const BENCHMARK_NOTIONALS_USD = [10, 50, 100, 500, 1_000] as const;

type ProbeStatus =
  | "verified"
  | "mismatch"
  | "quote_returned_unverified"
  | "supported_no_route"
  | "rwa_required"
  | "unsupported"
  | "blocked_missing_key"
  | "available"
  | "unavailable"
  | "timeout"
  | "provider_error"
  | "invalid_response";

type Probe = {
  provider: "market-directory" | "sushi" | "uniswap-v3" | "pancake-onchain" | "pancakeswapx" | "0x";
  probe: string;
  status: ProbeStatus;
  latencyMs: number;
  chainId: number;
  routeAvailable?: boolean;
  errorCategory?: string;
  sourceNames?: string[];
  inputAsset?: string;
  outputAsset?: string;
  inputAmountAtomic?: string;
  expectedOutputAtomic?: string;
  protectedOutputAtomic?: string;
  evidence?: Record<string, string | number | boolean | null>;
};

type JsonObject = Record<string, unknown>;

let readOnlyRequestsValidated = 0;
let writeBoundaryViolation = false;

const contracts = [
  ["pancakeV2Factory", "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E", 14_075, "0xf57fbed9d08762f47eeac1fb2f25ee0cb166ee4043eed41baa8ff0d13206d76c"],
  ["pancakeV2Router", "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb", 21_937, "0x47b5456ea3c71255d2d7cac5f32979001162ab889319d32d11cc689572e9bb43"],
  ["pancakeV3Factory", "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", 3_859, "0xf6105f5817b3f67dd0f060fa27c1e23a14d9fca13c6ebd695545ca4d5c0fbe06"],
  ["pancakeV3PoolDeployer", "0x41ff9AA7e16B8B1a8a8dc4f0eFacd93D02d071c9", 24_556, "0xedd527f11646c1912dfc51b57ffa0ee27972f8798bcaf7bc68ae6ad054b6022b"],
  ["pancakeQuoterV2", "0x8553AA1615549A86882151784b329B017aA7c832", 8_331, "0xd13c8db0741380e13fca4e7dcc4840dde19f6103dd8ee2a99af0ae058d1ab1e6"],
  ["pancakeMixedRouteQuoter", "0x2b792b99ae08483D45d79833408439674C6Daf1B", 9_002, "0x3cf4d2a66c8ee21005eb7faf7fd20737f9eb1fa2581afe5ce5f8e22158274c03"],
  ["pancakeSmartRouter", "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4", 24_275, "0x7b7d21a7f218720a2439e4b5383f1cdcbfff6c4dde354731626dd618d9df8ad8"],
  ["pancakeUniversalRouter", "0xE28c0e44F4016b073db20cF28971CAc6ce3664D3", 22_314, "0xefe4d5b1302b8ed9e6344b151b0b5eb18405f794e1d18c668b409d8f128b8e11"],
  ["pcsxMultiReactorRouter", "0x3dbca663C889A80ECf476741fDb094ea0c205aE8", 1_529, "0xf875ab8eadcfbcf6204ab7888a4b10e33720144b7700e600f8991bd956d1578c"],
  ["pcsxOrderQuoter", "0x87CB6Bef25861b310E68B200Cc7cBd24110d262d", 4_449, "0xf2479011676f039e56ed0225f554c543c6a34f72f551decaba672e5c96c09959"],
  ["pcsxPermit2", "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768", 7_020, "0xb484a796df5e76f7210becfef1660f35acfaac6c9b5e365bef3425f6621c6a5d"]
] as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function latency(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function assertReadOnlyRequest(url: string, init?: RequestInit) {
  const requested = new URL(url);
  const method = (init?.method ?? "GET").toUpperCase();
  const rpc = new URL(RPC_URL);
  if (requested.href === rpc.href && method === "POST" && typeof init?.body === "string") {
    const body: unknown = JSON.parse(init.body);
    if (isObject(body) && body.method === "eth_getCode") {
      readOnlyRequestsValidated += 1;
      return;
    }
  }
  if (requested.href === ROBINHOOD_ASSETS_URL && method === "GET") {
    readOnlyRequestsValidated += 1;
    return;
  }
  if (requested.href === PCSX_PRICE_URL && method === "POST") {
    readOnlyRequestsValidated += 1;
    return;
  }
  if (requested.origin === "https://api.dexscreener.com" && requested.pathname.startsWith("/token-pairs/v1/robinhood/") && method === "GET") {
    readOnlyRequestsValidated += 1;
    return;
  }
  const zeroXReadOnlyPaths = new Set(["/sources", "/swap/allowance-holder/price", "/gasless/price"]);
  if (requested.origin === ZEROX_API_URL && method === "GET" && zeroXReadOnlyPaths.has(requested.pathname)) {
    readOnlyRequestsValidated += 1;
    return;
  }
  writeBoundaryViolation = true;
  throw new Error("benchmark_write_boundary_rejected_request");
}

async function sushiReadOnlyFetch(input: string | URL, init?: RequestInit) {
  const requested = new URL(input);
  const method = (init?.method ?? "GET").toUpperCase();
  if (requested.origin !== "https://api.sushi.com" || requested.pathname !== "/quote/v7/4663" || method !== "GET") {
    writeBoundaryViolation = true;
    throw new Error("benchmark_write_boundary_rejected_sushi_request");
  }
  readOnlyRequestsValidated += 1;
  return fetch(requested, init);
}

async function fetchJson(url: string, init?: RequestInit) {
  assertReadOnlyRequest(url, init);
  const response = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { response, body, text: text.slice(0, 1_000) };
}

function errorMessage(body: unknown, text: string) {
  if (isObject(body)) {
    for (const key of ["message", "error", "detail"]) {
      if (typeof body[key] === "string") return body[key].slice(0, 500);
    }
  }
  return text.slice(0, 500);
}

async function rpcGetCode(address: string) {
  const { response, body } = await fetchJson(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] })
  });
  if (!response.ok || !isObject(body) || typeof body.result !== "string" || !isHex(body.result)) {
    throw new Error("rpc_invalid_response");
  }
  return body.result as Hex;
}

async function probeContracts(): Promise<Probe[]> {
  return Promise.all(contracts.map(async ([name, address, expectedBytes, expectedHash]): Promise<Probe> => {
    const startedAt = performance.now();
    try {
      const code = await rpcGetCode(address);
      const observedBytes = (code.length - 2) / 2;
      const observedHash = keccak256(code);
      const matches = observedBytes === expectedBytes && observedHash.toLowerCase() === expectedHash;
      return {
        provider: "pancake-onchain" as const,
        probe: name,
        status: matches ? "verified" as const : "mismatch" as const,
        latencyMs: latency(startedAt),
        chainId: CHAIN_ID,
        routeAvailable: false,
        errorCategory: matches ? undefined : "runtime_fingerprint_mismatch",
        evidence: { address: getAddress(address), observedBytes, observedRuntimeHash: observedHash }
      };
    } catch (error) {
      return {
        provider: "pancake-onchain" as const,
        probe: name,
        status: isTimeout(error) ? "timeout" as const : "provider_error" as const,
        latencyMs: latency(startedAt),
        chainId: CHAIN_ID,
        routeAvailable: false,
        errorCategory: isTimeout(error) ? "timeout" : "rpc_unavailable",
        evidence: { address: getAddress(address) }
      };
    }
  }));
}

function pcsxRequest(tokenOut: string) {
  return {
    tokenInChainId: CHAIN_ID,
    tokenIn: USDG,
    tokenOutChainId: CHAIN_ID,
    tokenOut,
    amount: "1000000",
    type: "EXACT_INPUT",
    configs: [{ routingType: "DUTCH_LIMIT", useSyntheticQuotes: false }]
  };
}

function classifyPcsxError(message: string): { status: ProbeStatus; category: string } {
  const normalized = message.toLowerCase();
  if (normalized.includes("must include a rwa token")) return { status: "rwa_required", category: "rwa_required" };
  if (normalized.includes("no orderbook found") || normalized.includes("no quotes") || normalized.includes("no route")) {
    return { status: "supported_no_route", category: "no_route" };
  }
  if (normalized.includes("unsupported") || normalized.includes("not supported")) {
    return { status: "unsupported", category: "unsupported_chain_or_pair" };
  }
  return { status: "provider_error", category: "provider_rejected_request" };
}

async function probePcsx(name: string, tokenOut: string, symbol: string): Promise<Probe> {
  const startedAt = performance.now();
  try {
    const { response, body, text } = await fetchJson(PCSX_PRICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pcsxRequest(tokenOut))
    });
    if (response.ok) {
      return {
        provider: "pancakeswapx",
        probe: name,
        status: isObject(body) ? "quote_returned_unverified" : "invalid_response",
        latencyMs: latency(startedAt),
        chainId: CHAIN_ID,
        routeAvailable: isObject(body),
        errorCategory: isObject(body) ? "requires_provider_specific_order_verification" : "invalid_json",
        evidence: { inputSymbol: "USDG", outputSymbol: symbol, httpStatus: response.status }
      };
    }
    const classified = classifyPcsxError(errorMessage(body, text));
    return {
      provider: "pancakeswapx",
      probe: name,
      status: classified.status,
      latencyMs: latency(startedAt),
      chainId: CHAIN_ID,
      routeAvailable: false,
      errorCategory: classified.category,
      evidence: { inputSymbol: "USDG", outputSymbol: symbol, httpStatus: response.status }
    };
  } catch (error) {
    return {
      provider: "pancakeswapx",
      probe: name,
      status: isTimeout(error) ? "timeout" : "provider_error",
      latencyMs: latency(startedAt),
      chainId: CHAIN_ID,
      routeAvailable: false,
      errorCategory: isTimeout(error) ? "timeout" : "network_error",
      evidence: { inputSymbol: "USDG", outputSymbol: symbol }
    };
  }
}

type BaselinePair = {
  name: string;
  inputSymbol: string;
  outputSymbol: string;
  inputAsset: Address;
  outputAsset: Address;
  amountIn: bigint;
  notionalUsd?: number;
  segment: "pre_graduation_control" | "core" | "liquid_dynamic";
};

const baselinePairs: BaselinePair[] = [
  { name: "usd-g-to-rmt", inputSymbol: "USDG", outputSymbol: "RMT", inputAsset: USDG, outputAsset: ROBINHOOD_RMT_ADDRESS, amountIn: 1_000_000n, segment: "pre_graduation_control" },
  { name: "rmt-to-usd-g", inputSymbol: "RMT", outputSymbol: "USDG", inputAsset: ROBINHOOD_RMT_ADDRESS, outputAsset: USDG, amountIn: 1_000_000_000_000_000_000n, segment: "pre_graduation_control" },
  { name: "usd-g-to-weth", inputSymbol: "USDG", outputSymbol: "WETH", inputAsset: USDG, outputAsset: WETH, amountIn: 1_000_000n, segment: "core" },
  { name: "weth-to-usd-g", inputSymbol: "WETH", outputSymbol: "USDG", inputAsset: WETH, outputAsset: USDG, amountIn: 1_000_000_000_000_000n, segment: "core" }
];

function finitePositive(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function discoverLiquidBaseline(): Promise<{ probe: Probe; pairs: BaselinePair[] }> {
  const startedAt = performance.now();
  try {
    const snapshots = await Promise.all([USDG, WETH].map(async (quoteAsset) => {
      const { response, body } = await fetchJson(`${DEXSCREENER_PAIRS_URL}/${quoteAsset}`);
      if (!response.ok || !Array.isArray(body)) throw new Error("directory_unavailable");
      return body;
    }));
    const excluded = new Set([USDG, WETH, ROBINHOOD_RMT_ADDRESS].map((address) => address.toLowerCase()));
    const candidates = snapshots.flat().flatMap((pair) => {
      if (!isObject(pair) || pair.chainId !== "robinhood") return [];
      const baseToken = isObject(pair.baseToken) ? pair.baseToken : null;
      const quoteToken = isObject(pair.quoteToken) ? pair.quoteToken : null;
      if (!baseToken || !quoteToken || typeof baseToken.address !== "string" || typeof quoteToken.address !== "string") return [];
      if (!isAddress(baseToken.address, { strict: false }) || !isAddress(quoteToken.address, { strict: false })) return [];
      const baseAddress = getAddress(baseToken.address);
      const quoteAddress = getAddress(quoteToken.address);
      if (excluded.has(baseAddress.toLowerCase()) || ![USDG.toLowerCase(), WETH.toLowerCase()].includes(quoteAddress.toLowerCase())) return [];
      const liquidity = isObject(pair.liquidity) ? finitePositive(pair.liquidity.usd) : null;
      const priceUsd = finitePositive(pair.priceUsd);
      if (liquidity === null || priceUsd === null) return [];
      return [{ address: baseAddress, liquidity, priceUsd }];
    }).sort((left, right) => right.liquidity - left.liquidity);
    const unique = [...new Map(candidates.map((candidate) => [candidate.address.toLowerCase(), candidate])).values()];
    for (const candidate of unique.slice(0, 12)) {
      const identity = await readRobinhoodTokenIdentity(candidate.address);
      if (!identity || identity.decimals > 36) continue;
      const precision = Math.min(identity.decimals, 12);
      const slug = identity.symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "liquid-token";
      const pairs = BENCHMARK_NOTIONALS_USD.flatMap((notionalUsd): BaselinePair[] => {
        const displayAmount = notionalUsd / candidate.priceUsd;
        if (!Number.isFinite(displayAmount) || displayAmount <= 0) return [];
        try {
          const tokenAmount = parseUnits(displayAmount.toFixed(precision), identity.decimals);
          if (tokenAmount <= 0n || tokenAmount > BigInt(identity.totalSupply)) return [];
          return [{
            name: `usd-g-to-${slug}-${notionalUsd}`,
            inputSymbol: "USDG",
            outputSymbol: identity.symbol,
            inputAsset: getAddress(USDG),
            outputAsset: getAddress(identity.address),
            amountIn: BigInt(notionalUsd) * 1_000_000n,
            notionalUsd,
            segment: "liquid_dynamic"
          }, {
            name: `${slug}-to-usd-g-${notionalUsd}`,
            inputSymbol: identity.symbol,
            outputSymbol: "USDG",
            inputAsset: getAddress(identity.address),
            outputAsset: getAddress(USDG),
            amountIn: tokenAmount,
            notionalUsd,
            segment: "liquid_dynamic"
          }];
        } catch {
          return [];
        }
      });
      if (pairs.length !== BENCHMARK_NOTIONALS_USD.length * 2) continue;
      return {
        probe: {
          provider: "market-directory",
          probe: "highest-liquidity-live-asset",
          status: "available",
          latencyMs: latency(startedAt),
          chainId: CHAIN_ID,
          routeAvailable: false,
          evidence: {
            symbol: identity.symbol,
            address: identity.address,
            decimals: identity.decimals,
            observedLiquidityUsd: Math.round(candidate.liquidity),
            observedPriceUsd: candidate.priceUsd
          }
        },
        pairs
      };
    }
    throw new Error("no_verified_liquid_asset");
  } catch (error) {
    return {
      probe: {
        provider: "market-directory",
        probe: "highest-liquidity-live-asset",
        status: isTimeout(error) ? "timeout" : "unavailable",
        latencyMs: latency(startedAt),
        chainId: CHAIN_ID,
        routeAvailable: false,
        errorCategory: isTimeout(error) ? "timeout" : "no_verified_liquid_asset"
      },
      pairs: []
    };
  }
}

function baselineFailure(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/no route|does not have a route/.test(message)) return { status: "unavailable" as const, category: "no_route" };
  if (/unavailable/.test(message)) return { status: "unavailable" as const, category: "provider_unavailable" };
  if (/timed out|timeout/.test(message)) return { status: "timeout" as const, category: "timeout" };
  return { status: "provider_error" as const, category: "provider_or_validation_error" };
}

async function probeSushiBaseline(pair: BaselinePair): Promise<Probe> {
  const startedAt = performance.now();
  try {
    const quote = await quoteSushiAssetRoute({
      inputAsset: pair.inputAsset,
      outputAsset: pair.outputAsset,
      amountIn: pair.amountIn
    }, {
      chainId: CHAIN_ID,
      enabled: true,
      requireTokenMetadata: true,
      fetch: sushiReadOnlyFetch
    });
    return {
      provider: "sushi",
      probe: pair.name,
      status: "available",
      latencyMs: latency(startedAt),
      chainId: CHAIN_ID,
      routeAvailable: true,
      inputAsset: pair.inputAsset,
      outputAsset: pair.outputAsset,
      inputAmountAtomic: pair.amountIn.toString(),
      expectedOutputAtomic: quote.quoteOut,
      protectedOutputAtomic: quote.minimumOut,
      evidence: { inputSymbol: pair.inputSymbol, outputSymbol: pair.outputSymbol, benchmarkNotionalUsd: pair.notionalUsd ?? null, benchmarkSegment: pair.segment, indicativeOnly: true }
    };
  } catch (error) {
    const failure = baselineFailure(error);
    return {
      provider: "sushi",
      probe: pair.name,
      status: failure.status,
      latencyMs: latency(startedAt),
      chainId: CHAIN_ID,
      routeAvailable: false,
      errorCategory: failure.category,
      inputAsset: pair.inputAsset,
      outputAsset: pair.outputAsset,
      inputAmountAtomic: pair.amountIn.toString(),
      evidence: { inputSymbol: pair.inputSymbol, outputSymbol: pair.outputSymbol, benchmarkNotionalUsd: pair.notionalUsd ?? null, benchmarkSegment: pair.segment, indicativeOnly: true }
    };
  }
}

async function probeUniswapBaseline(pair: BaselinePair): Promise<Probe> {
  const startedAt = performance.now();
  try {
    const quote = await quoteVNextUniswapDirect({
      inputAsset: pair.inputAsset,
      outputAsset: pair.outputAsset,
      amountIn: pair.amountIn
    });
    if (!quote) {
      return {
        provider: "uniswap-v3",
        probe: pair.name,
        status: "unavailable",
        latencyMs: latency(startedAt),
        chainId: CHAIN_ID,
        routeAvailable: false,
        errorCategory: "no_route",
        inputAsset: pair.inputAsset,
        outputAsset: pair.outputAsset,
        inputAmountAtomic: pair.amountIn.toString(),
        evidence: { inputSymbol: pair.inputSymbol, outputSymbol: pair.outputSymbol, benchmarkNotionalUsd: pair.notionalUsd ?? null, benchmarkSegment: pair.segment, indicativeOnly: true }
      };
    }
    return {
      provider: "uniswap-v3",
      probe: pair.name,
      status: "available",
      latencyMs: latency(startedAt),
      chainId: CHAIN_ID,
      routeAvailable: true,
      sourceNames: quote.route === "direct" ? ["UniswapV3"] : ["UniswapV3", "WETH-hop"],
      inputAsset: pair.inputAsset,
      outputAsset: pair.outputAsset,
      inputAmountAtomic: pair.amountIn.toString(),
      expectedOutputAtomic: quote.quoteOut.toString(),
      protectedOutputAtomic: quote.minimumOut.toString(),
      evidence: {
        inputSymbol: pair.inputSymbol,
        outputSymbol: pair.outputSymbol,
        benchmarkNotionalUsd: pair.notionalUsd ?? null,
        benchmarkSegment: pair.segment,
        route: quote.route,
        poolCount: quote.pools.length,
        indicativeOnly: true
      }
    };
  } catch (error) {
    const failure = baselineFailure(error);
    return {
      provider: "uniswap-v3",
      probe: pair.name,
      status: failure.status,
      latencyMs: latency(startedAt),
      chainId: CHAIN_ID,
      routeAvailable: false,
      errorCategory: failure.category,
      inputAsset: pair.inputAsset,
      outputAsset: pair.outputAsset,
      inputAmountAtomic: pair.amountIn.toString(),
      evidence: { inputSymbol: pair.inputSymbol, outputSymbol: pair.outputSymbol, benchmarkNotionalUsd: pair.notionalUsd ?? null, benchmarkSegment: pair.segment, indicativeOnly: true }
    };
  }
}

async function probeBaselinePairs(pairs: readonly BaselinePair[]) {
  const probes: Probe[] = [];
  for (const pair of pairs) {
    probes.push(...await Promise.all([probeSushiBaseline(pair), probeUniswapBaseline(pair)]));
  }
  return probes;
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarizeBaseline(probes: readonly Probe[]) {
  const providers = ["sushi", "uniswap-v3"] as const;
  const eligibleProbes = probes.filter((probe) => probe.evidence?.benchmarkSegment !== "pre_graduation_control");
  const comparable = new Map<string, Probe[]>();
  for (const probe of eligibleProbes) {
    if (!providers.includes(probe.provider as typeof providers[number]) || !probe.routeAvailable || !probe.protectedOutputAtomic) continue;
    const sample = comparable.get(probe.probe) ?? [];
    sample.push(probe);
    comparable.set(probe.probe, sample);
  }
  const comparableSamples = [...comparable.values()].filter((sample) => sample.length === providers.length);
  const wins = new Map<string, number>(providers.map((provider) => [provider, 0]));
  for (const sample of comparableSamples) {
    const best = sample.reduce((maximum, probe) => {
      const output = BigInt(probe.protectedOutputAtomic!);
      return output > maximum ? output : maximum;
    }, 0n);
    for (const probe of sample) {
      if (BigInt(probe.protectedOutputAtomic!) === best) wins.set(probe.provider, (wins.get(probe.provider) ?? 0) + 1);
    }
  }
  return providers.map((provider) => {
    const attempts = eligibleProbes.filter((probe) => probe.provider === provider);
    const available = attempts.filter((probe) => probe.routeAvailable);
    return {
      provider,
      samples: attempts.length,
      routesAvailable: available.length,
      routeAvailabilityPct: attempts.length === 0 ? 0 : Number((available.length * 100 / attempts.length).toFixed(1)),
      latencyP50Ms: percentile(attempts.map((probe) => probe.latencyMs), 0.5),
      latencyP95Ms: percentile(attempts.map((probe) => probe.latencyMs), 0.95),
      comparableSamples: comparableSamples.length,
      protectedOutputWins: wins.get(provider) ?? 0,
      preGraduationControlSamplesExcluded: probes.filter((probe) => (
        probe.provider === provider && probe.evidence?.benchmarkSegment === "pre_graduation_control"
      )).length
    };
  });
}

async function firstActiveRobinhoodRwa() {
  const { response, body } = await fetchJson(ROBINHOOD_ASSETS_URL);
  if (!response.ok || !isObject(body) || !Array.isArray(body.assets)) throw new Error("invalid_asset_registry");
  for (const asset of body.assets) {
    if (!isObject(asset) || asset.status !== "ASSET_STATUS_ACTIVE" || typeof asset.tokenSymbol !== "string") continue;
    const deployments = Array.isArray(asset.deployments) ? asset.deployments : [];
    const deployment = deployments.find((item) => isObject(item) && item.chainId === CHAIN_ID && typeof item.contractAddress === "string" && isAddress(item.contractAddress));
    if (isObject(deployment) && typeof deployment.contractAddress === "string") {
      return { symbol: asset.tokenSymbol.slice(0, 24), address: getAddress(deployment.contractAddress) };
    }
  }
  throw new Error("no_active_chain_4663_rwa");
}

function collectSourceNames(body: unknown) {
  if (!isObject(body)) return [];
  if (Array.isArray(body.sources)) return body.sources.filter((item): item is string => typeof item === "string");
  const route = isObject(body.route) ? body.route : null;
  const fills = route && Array.isArray(route.fills) ? route.fills : [];
  return [...new Set(fills.flatMap((fill) => isObject(fill) && typeof fill.source === "string" ? [fill.source] : []))];
}

async function probeZeroX(name: string, path: string, params: Record<string, string>, apiKey?: string): Promise<Probe> {
  if (!apiKey) {
    return {
      provider: "0x",
      probe: name,
      status: "blocked_missing_key",
      latencyMs: 0,
      chainId: CHAIN_ID,
      routeAvailable: false,
      errorCategory: "missing_server_only_api_key"
    };
  }
  const startedAt = performance.now();
  try {
    const url = new URL(path, ZEROX_API_URL);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const { response, body, text } = await fetchJson(url.toString(), {
      headers: { "0x-api-key": apiKey, "0x-version": "v2" }
    });
    if (!response.ok) {
      return {
        provider: "0x",
        probe: name,
        status: response.status === 401 || response.status === 403 ? "provider_error" : "unavailable",
        latencyMs: latency(startedAt),
        chainId: CHAIN_ID,
        routeAvailable: false,
        errorCategory: response.status === 401 || response.status === 403 ? "credential_rejected" : "provider_rejected_request",
        evidence: { httpStatus: response.status, responseClass: errorMessage(body, text) ? "structured_error" : "empty_error" }
      };
    }
    const sourceNames = collectSourceNames(body);
    const isSourcesProbe = name === "liquidity-sources";
    const liquidityAvailable = isObject(body) && body.liquidityAvailable === true;
    const valid = isObject(body) && (isSourcesProbe ? Array.isArray(body.sources) : typeof body.liquidityAvailable === "boolean");
    return {
      provider: "0x",
      probe: name,
      status: valid ? "available" : "invalid_response",
      latencyMs: latency(startedAt),
      chainId: CHAIN_ID,
      routeAvailable: isSourcesProbe ? false : liquidityAvailable,
      errorCategory: valid ? undefined : "invalid_json_schema",
      sourceNames
    };
  } catch (error) {
    return {
      provider: "0x",
      probe: name,
      status: isTimeout(error) ? "timeout" : "provider_error",
      latencyMs: latency(startedAt),
      chainId: CHAIN_ID,
      routeAvailable: false,
      errorCategory: isTimeout(error) ? "timeout" : "network_error"
    };
  }
}

async function main() {
  const apiKey = process.env.RMT_ZEROX_API_KEY?.trim();
  const liquidBaseline = await discoverLiquidBaseline();
  const activeBaselinePairs = [...baselinePairs, ...liquidBaseline.pairs];
  const contractProbes = await probeContracts();
  const [baselineProbes, pcsxCryptoProbe] = await Promise.all([
    probeBaselinePairs(activeBaselinePairs),
    probePcsx("usd-g-to-weth", WETH, "WETH")
  ]);
  let pcsxRwaProbe: Probe;
  try {
    const rwa = await firstActiveRobinhoodRwa();
    pcsxRwaProbe = await probePcsx("usd-g-to-first-active-rwa", rwa.address, rwa.symbol);
  } catch (error) {
    pcsxRwaProbe = {
      provider: "pancakeswapx",
      probe: "usd-g-to-first-active-rwa",
      status: isTimeout(error) ? "timeout" : "provider_error",
      latencyMs: 0,
      chainId: CHAIN_ID,
      routeAvailable: false,
      errorCategory: isTimeout(error) ? "asset_registry_timeout" : "asset_registry_unavailable"
    };
  }

  const common = { chainId: String(CHAIN_ID), sellToken: USDG, buyToken: WETH, sellAmount: "1000000" };
  const zeroXProbes = await Promise.all([
    probeZeroX("liquidity-sources", "/sources", { chainId: String(CHAIN_ID) }, apiKey),
    probeZeroX("allowance-holder-price", "/swap/allowance-holder/price", common, apiKey),
    probeZeroX("gasless-price", "/gasless/price", { ...common, taker: NON_FUNDED_BENCHMARK_TAKER }, apiKey)
  ]);

  const probes = [liquidBaseline.probe, ...baselineProbes, ...contractProbes, pcsxCryptoProbe, pcsxRwaProbe, ...zeroXProbes];
  const noWriteAssertion = readOnlyRequestsValidated > 0 && !writeBoundaryViolation;
  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    chainId: CHAIN_ID,
    mode: "read-only",
    noWriteAssertion,
    credentials: { zeroX: apiKey ? "configured" : "missing" },
    baselineSummary: summarizeBaseline(baselineProbes),
    probes
  }, null, 2)}\n`);
  if (!noWriteAssertion || probes.some((probe) => probe.status === "mismatch")) process.exitCode = 1;
}

void main();
