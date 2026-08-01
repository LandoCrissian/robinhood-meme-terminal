import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  zeroAddress,
  type Address
} from "viem";
import { z } from "zod";
import { robinhoodChain } from "@rmt/shared/chains";
import { activeChain } from "../network";
import {
  SUSHI_NATIVE_TOKEN,
  SUSHI_QUOTE_SLIPPAGE_BPS,
  SUSHI_RED_SNWAPPER,
  type SushiExecutableQuote,
  type SushiIndicativeQuote,
  type SushiTokenMetadata
} from "../sushi";
import { PRICE_IMPACT_BLOCK } from "../trade-ticket";
import {
  auditSushiSwapCandidate,
  hashSushiContractCode
} from "./sushi-swap-validation";

const SUSHI_QUOTE_API = "https://api.sushi.com/quote/v7";
const SUSHI_SWAP_API = "https://api.sushi.com/swap/v7";
const MAX_UINT256 = (1n << 256n) - 1n;
const QUOTE_LIFETIME_SECONDS = 90;
const decimalString = z.string().regex(/^\d+$/);
const tokenMetadataSchema = z.object({
  address: z.string(),
  symbol: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  decimals: z.number().int().min(0).max(255)
});
const quoteResponseSchema = z.object({
  status: z.enum(["Success", "Partial", "NoWay"]),
  amountIn: decimalString.optional(),
  assumedAmountOut: decimalString.optional(),
  amountOut: decimalString.optional(),
  priceImpact: z.union([z.number(), z.string()]).optional(),
  tokenFrom: z.number().int().nonnegative().optional(),
  tokenTo: z.number().int().nonnegative().optional(),
  tokens: z.array(tokenMetadataSchema).max(64).optional()
}).passthrough();

type SushiFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 3, timeout: 12_000 }
  )
});

export function sushiQuotesEnabled(environment: Readonly<Record<string, string | undefined>> = process.env) {
  return environment.RMT_SUSHI_QUOTES_ENABLED === "true";
}

export async function sushiExecutionAllowance(token: Address, owner: Address) {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, SUSHI_RED_SNWAPPER]
  });
}

function parsePriceImpact(value: number | string | undefined) {
  if (value === undefined) return 0;
  if (typeof value === "string" && value.trim() === "") throw new Error("Sushi returned an invalid price impact.");
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error("Sushi returned an invalid price impact.");
  return parsed;
}

function quoteTokenMetadata(
  tokens: z.infer<typeof tokenMetadataSchema>[] | undefined,
  index: number | undefined,
  expectedAddress: Address
): SushiTokenMetadata | undefined {
  if (!tokens || index === undefined) return undefined;
  const token = tokens[index];
  if (!token) throw new Error("Sushi returned invalid token metadata.");
  let address: Address;
  try {
    address = getAddress(token.address);
  } catch {
    throw new Error("Sushi returned invalid token metadata.");
  }
  if (address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error("Sushi returned token metadata for a different route.");
  }
  return { ...token, address };
}

export async function quoteSushiRoute(
  params: { token: Address; recipient: Address; side: "buy" | "sell"; amountIn: bigint },
  dependencies: {
    fetch?: SushiFetch;
    enabled?: boolean;
    timeoutMs?: number;
    chainId?: number;
    requireTokenMetadata?: boolean;
  } = {}
): Promise<SushiIndicativeQuote> {
  const chainId = dependencies.chainId ?? activeChain.id;
  if (chainId !== 4663) throw new Error("Sushi quotes are available only on Robinhood Chain mainnet.");
  if (!(dependencies.enabled ?? sushiQuotesEnabled())) throw new Error("Sushi quote discovery is not enabled.");
  if (params.amountIn <= 0n || params.amountIn > MAX_UINT256) throw new Error("Trade amount is outside the supported range.");
  if (params.recipient.toLowerCase() === zeroAddress) throw new Error("A valid wallet recipient is required.");

  const tokenIn = params.side === "buy" ? SUSHI_NATIVE_TOKEN : params.token;
  const tokenOut = params.side === "buy" ? params.token : SUSHI_NATIVE_TOKEN;
  const url = new URL(`${SUSHI_QUOTE_API}/${chainId}`);
  url.searchParams.set("tokenIn", tokenIn);
  url.searchParams.set("tokenOut", tokenOut);
  url.searchParams.set("amount", params.amountIn.toString());
  url.searchParams.set("maxSlippage", (SUSHI_QUOTE_SLIPPAGE_BPS / 10_000).toString());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 8_000);
  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
  } catch (cause) {
    if (controller.signal.aborted) throw new Error("Sushi quote discovery timed out.");
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error("Sushi quote discovery is unavailable.");

  const parsed = quoteResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Sushi returned an invalid quote response.");
  if (parsed.data.status === "NoWay") throw new Error("Sushi does not have a route for this trade yet.");
  if (parsed.data.status !== "Success") throw new Error("Sushi cannot fill the complete trade amount.");
  if (parsed.data.amountIn !== undefined && BigInt(parsed.data.amountIn) !== params.amountIn) throw new Error("Sushi returned a quote for a different input amount.");

  const rawQuoteOut = parsed.data.assumedAmountOut ?? parsed.data.amountOut;
  if (!rawQuoteOut) throw new Error("Sushi returned an invalid quote response.");
  const quoteOut = BigInt(rawQuoteOut);
  const minimumOut = quoteOut * BigInt(10_000 - SUSHI_QUOTE_SLIPPAGE_BPS) / 10_000n;
  if (quoteOut <= 0n || minimumOut <= 0n) throw new Error("Sushi returned an invalid quote amount.");
  const inputToken = quoteTokenMetadata(parsed.data.tokens, parsed.data.tokenFrom, tokenIn);
  const outputToken = quoteTokenMetadata(parsed.data.tokens, parsed.data.tokenTo, tokenOut);
  if (dependencies.requireTokenMetadata && (!inputToken || !outputToken)) {
    throw new Error("Sushi returned incomplete token metadata.");
  }

  return {
    chainId,
    venue: "sushi-aggregator",
    protocol: "SUSHI",
    token: getAddress(params.token),
    recipient: getAddress(params.recipient),
    side: params.side,
    amountIn: params.amountIn.toString(),
    quoteOut: quoteOut.toString(),
    minimumOut: minimumOut.toString(),
    priceImpact: parsePriceImpact(parsed.data.priceImpact),
    inputToken,
    outputToken,
    executable: false,
    verifiedInput: true
  };
}

export async function quoteAndBuildSushiSwap(
  params: { token: Address; recipient: Address; side: "buy" | "sell"; amountIn: bigint; maxPriceImpact?: number },
  dependencies: {
    fetch?: SushiFetch;
    enabled?: boolean;
    timeoutMs?: number;
    chainId?: number;
    now?: () => number;
    codeHash?: (address: Address) => Promise<`0x${string}`>;
  } = {}
): Promise<SushiExecutableQuote> {
  const chainId = dependencies.chainId ?? activeChain.id;
  if (chainId !== 4663) throw new Error("Sushi execution is available only on Robinhood Chain mainnet.");
  if (!(dependencies.enabled ?? sushiQuotesEnabled())) throw new Error("Sushi quote discovery is not enabled.");
  if (params.amountIn <= 0n || params.amountIn > MAX_UINT256) throw new Error("Trade amount is outside the supported range.");
  if (params.recipient.toLowerCase() === zeroAddress) throw new Error("A valid wallet recipient is required.");

  const tokenIn = params.side === "buy" ? SUSHI_NATIVE_TOKEN : params.token;
  const tokenOut = params.side === "buy" ? params.token : SUSHI_NATIVE_TOKEN;
  const maxPriceImpact = params.maxPriceImpact ?? PRICE_IMPACT_BLOCK;
  if (!Number.isFinite(maxPriceImpact) || maxPriceImpact <= 0 || maxPriceImpact > 1) {
    throw new Error("The selected maximum price impact is invalid.");
  }
  const url = new URL(`${SUSHI_SWAP_API}/${chainId}`);
  url.searchParams.set("tokenIn", tokenIn);
  url.searchParams.set("tokenOut", tokenOut);
  url.searchParams.set("amount", params.amountIn.toString());
  url.searchParams.set("maxSlippage", (SUSHI_QUOTE_SLIPPAGE_BPS / 10_000).toString());
  url.searchParams.set("maxPriceImpact", maxPriceImpact.toString());
  url.searchParams.set("sender", params.recipient);
  url.searchParams.set("recipient", params.recipient);
  url.searchParams.set("simulate", "true");
  url.searchParams.set("validate", "true");
  url.searchParams.set("referrer", "rmt");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 10_000);
  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
  } catch (cause) {
    if (controller.signal.aborted) throw new Error("Sushi swap simulation timed out.");
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error("Sushi could not simulate this trade.");
  const payload = await response.json();
  const audit = await auditSushiSwapCandidate(params, payload, {
    codeHash: dependencies.codeHash ?? (async (address) => {
      const code = await client.getBytecode({ address });
      if (!code) throw new Error("Sushi contract bytecode is unavailable.");
      return hashSushiContractCode(code);
    })
  });

  const parsed = quoteResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.status !== "Success") throw new Error("Sushi returned an invalid executable swap response.");
  const priceImpact = parsePriceImpact(parsed.data.priceImpact);
  if (priceImpact > maxPriceImpact) throw new Error("Trade exceeds your selected maximum price impact.");
  const inputToken = quoteTokenMetadata(parsed.data.tokens, parsed.data.tokenFrom, tokenIn);
  const outputToken = quoteTokenMetadata(parsed.data.tokens, parsed.data.tokenTo, tokenOut);
  if (!inputToken || !outputToken) throw new Error("Sushi returned incomplete token metadata.");
  const now = dependencies.now?.() ?? Date.now();

  return {
    chainId,
    venue: "sushi-aggregator",
    protocol: "SUSHI",
    token: getAddress(params.token),
    recipient: getAddress(params.recipient),
    side: params.side,
    amountIn: audit.amountIn.toString(),
    quoteOut: audit.assumedAmountOut.toString(),
    minimumOut: audit.minimumOut.toString(),
    priceImpact,
    inputToken,
    outputToken,
    router: audit.router,
    executor: audit.executor,
    calldata: audit.calldata,
    value: audit.value.toString(),
    quoteExpiresAt: String(Math.floor(now / 1000) + QUOTE_LIFETIME_SECONDS),
    executable: true,
    onchainDeadline: false,
    verifiedInput: true
  };
}
