import { getAddress, isAddress, isHex, keccak256, type Hex } from "viem";

const CHAIN_ID = 4663;
const RPC_URL = process.env.RMT_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com/";
const ROBINHOOD_ASSETS_URL = "https://api.robinhood.com/rhj/assets";
const PCSX_PRICE_URL = "https://x.pancakeswap.com/order-price/get-price";
const ZEROX_API_URL = "https://api.0x.org";
const TIMEOUT_MS = 10_000;

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const NON_FUNDED_BENCHMARK_TAKER = "0x0000000000000000000000000000000000000001";

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
  provider: "pancake-onchain" | "pancakeswapx" | "0x";
  probe: string;
  status: ProbeStatus;
  latencyMs: number;
  chainId: number;
  routeAvailable?: boolean;
  errorCategory?: string;
  sourceNames?: string[];
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
  const zeroXReadOnlyPaths = new Set(["/sources", "/swap/allowance-holder/price", "/gasless/price"]);
  if (requested.origin === ZEROX_API_URL && method === "GET" && zeroXReadOnlyPaths.has(requested.pathname)) {
    readOnlyRequestsValidated += 1;
    return;
  }
  writeBoundaryViolation = true;
  throw new Error("benchmark_write_boundary_rejected_request");
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
  const contractProbes = await probeContracts();
  const pcsxCryptoProbe = await probePcsx("usd-g-to-weth", WETH, "WETH");
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

  const probes = [...contractProbes, pcsxCryptoProbe, pcsxRwaProbe, ...zeroXProbes];
  const noWriteAssertion = readOnlyRequestsValidated > 0 && !writeBoundaryViolation;
  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    chainId: CHAIN_ID,
    mode: "read-only",
    noWriteAssertion,
    credentials: { zeroX: apiKey ? "configured" : "missing" },
    probes
  }, null, 2)}\n`);
  if (!noWriteAssertion || probes.some((probe) => probe.status === "mismatch")) process.exitCode = 1;
}

void main();
