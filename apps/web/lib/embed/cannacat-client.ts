/** RMT-owned browser integration; the terminal's verifier and journal remain authority. */
import { getAddress, parseUnits, zeroAddress, type Address } from "viem";
import { parseVNextQuoteResponse, type VNextQuoteAttempt } from "../vnext/quote-observation";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "../vnext/pre-sign-evidence";
import { parseVNextAuthorizationBundle, type VNextAuthorizationPlan } from "../vnext/authorization-plan";
import { VNEXT_PROVIDER_NATIVE_INPUT_FEE } from "../vnext/execution-settlement";
import { RMT_ZERO_X_FEE_BPS, RMT_ZERO_X_MAX_SLIPPAGE_PPM } from "../vnext/zero-x-settlement";
export { prepareVNextWalletTransaction, vNextWalletRpcTransaction, assessVNextWalletGasReadiness } from "../vnext/wallet-submission";
export {
  findBlockingVNextWalletRequest, findUnresolvedVNextExecution,
  readVNextExecutionJournal, readVNextWalletRequestJournal,
  recordPreparedVNextWalletRequest, transitionVNextWalletRequest,
  promoteVNextWalletRequestToSubmitted, resolveVNextExecution,
  reconcileExpiredVNextWalletRequest, promoteDiscoveredVNextWalletRequestToSubmitted
} from "../vnext/execution-recovery";
export { verifyVNextErc20OutputSettlement, boundVNextNativeSettlementEnvelope, verifyVNextNativeOutputSettlement, hasVerifiedVNextSwapSettlement } from "../vnext/output-settlement";
export { externalEthereumWallets, resolveActiveExternalWallet, walletGatewayKey } from "../wallet-gateway";
export type { VNextExecutionRecord, VNextWalletRequestRecord, VNextExecutionStorage } from "../vnext/execution-recovery";
export type { VNextAuthorizationPlan, VNextPreSignEvidence };

export const CANNACAT_EMBED = Object.freeze({
  version: "rmt-cannacat-embed-v1", chainId: 4663 as const,
  token: getAddress("0x1139d423c1706bdead91f03507f521635591ed92"),
  native: zeroAddress, decimals: 18, feeBps: RMT_ZERO_X_FEE_BPS,
  maximumSlippagePpm: RMT_ZERO_X_MAX_SLIPPAGE_PPM,
  rpc: "https://rpc.mainnet.chain.robinhood.com/"
});
export type CannaCatSide = "buy" | "sell";
export type CannaCatQuote = {
  side: CannaCatSide; tokenAmountAtomic: string; requestId: string;
  buyInputMode?: "token" | "eth";
  inputAsset: Address; outputAsset: Address; inputAmountAtomic: string;
  recipient: Address; attempt: VNextQuoteAttempt;
};
export type CannaCatPrepared = { quote: CannaCatQuote; evidence: VNextPreSignEvidence; plan: VNextAuthorizationPlan };

export class CannaCatClientError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) { super(message); this.name = "CannaCatClientError"; }
}
export function parseCannaCatAmount(value: string) {
  if (!/^(?:0|[1-9][0-9]{0,40})(?:\.[0-9]{1,18})?$/.test(value)) throw new CannaCatClientError("INVALID_AMOUNT", "Enter a positive token amount with at most 18 decimal places.");
  const atomic = parseUnits(value, 18);
  if (atomic <= 0n || atomic >= 2n ** 256n) throw new CannaCatClientError("INVALID_AMOUNT", "Enter a positive token amount.");
  return atomic.toString();
}
/** Exact integer scaling, including a bounded 0.2% search margin, never a fee or extra slippage. */
export function nextCannaCatBuyInput(input: bigint, protectedOutput: bigint, target: bigint, maximum: bigint) {
  if (input <= 0n || protectedOutput <= 0n || target <= 0n || maximum <= 0n) throw new CannaCatClientError("INVALID_QUOTE", "The quote cannot be used to estimate this amount.");
  const next = (input * target * 10_020n + protectedOutput * 10_000n - 1n) / (protectedOutput * 10_000n);
  const amount = next > input ? next : input + 1n;
  if (amount > maximum) throw new CannaCatClientError("INSUFFICIENT_BALANCE", "This amount exceeds your ETH spending limit. Keep ETH available for network fees.");
  return amount;
}
function assertPreparedTarget(quote: CannaCatQuote, evidence: VNextPreSignEvidence) {
  if (evidence.provider !== "zero-x-swap" || evidence.settlementMode !== VNEXT_PROVIDER_NATIVE_INPUT_FEE
    || evidence.providerNativeFee?.feeBps !== 25 || evidence.chainId !== 4663
    || (quote.side === "buy" && quote.buyInputMode !== "eth" && BigInt(evidence.protectedOutputAtomic) < BigInt(quote.tokenAmountAtomic))) {
    throw new CannaCatClientError("TARGET_REPRICE_REQUIRED", "The verified minimum no longer covers your token target. Refresh the quote before continuing.");
  }
}

export function createCannaCatClient(options: {
  baseUrl: string; identityToken: string; fetch?: typeof fetch; now?: () => number;
}) {
  const base = new URL(options.baseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash
    || base.pathname !== "/api/embed/cannacat" || !options.identityToken || options.identityToken.length > 16_384) {
    throw new CannaCatClientError("INVALID_CLIENT_CONFIGURATION", "Secure CannaCat trading is not configured.");
  }
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? fetch;
  async function post(operation: string, body: object, signal?: AbortSignal) {
    const response = await fetcher(`${base.href}/${operation}`, {
      method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
      headers: { "content-type": "application/json", "privy-id-token": options.identityToken, "x-rmt-client": CANNACAT_EMBED.version },
      body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
    });
    if (Number(response.headers.get("content-length") ?? 0) > 1_048_576) throw new CannaCatClientError("RESPONSE_TOO_LARGE", "The trading response exceeded its safety limit.");
    const reader = response.body?.getReader();
    if (!reader) throw new CannaCatClientError("INVALID_RESPONSE", "The trading service returned an empty response.");
    let size = 0;
    let text = "";
    const decoder = new TextDecoder();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1_048_576) throw new CannaCatClientError("RESPONSE_TOO_LARGE", "The trading response exceeded its safety limit.");
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally { await reader.cancel().catch(() => undefined); }
    let bodyValue: unknown;
    try { bodyValue = JSON.parse(text); } catch { throw new CannaCatClientError("INVALID_RESPONSE", "The trading service returned an invalid response."); }
    if (!response.ok) {
      const code = bodyValue && typeof bodyValue === "object" && "code" in bodyValue && typeof bodyValue.code === "string"
        ? bodyValue.code.slice(0, 100) : `HTTP_${response.status}`;
      const messages: Record<number, string> = {
        401: "Your wallet sign-in expired. Connect again before preparing another trade.",
        403: "This wallet or website is not admitted to RMT trading yet.",
        409: "The quote changed. Refresh it and review the new amounts.",
        429: "Too many quote requests. Wait a minute before trying again.",
        503: "Secure CannaCat trading is temporarily unavailable. No transaction was submitted."
      };
      throw new CannaCatClientError(code, messages[response.status] ?? "The trade could not be prepared. Refresh your quote or try again later.", response.status);
    }
    return bodyValue;
  }
  return {
    async quoteEth(input: { ethAmountAtomic: string; wallet: string; maximumEthInputAtomic: string; signal?: AbortSignal }): Promise<CannaCatQuote> {
      if (!/^[1-9][0-9]{0,77}$/.test(input.ethAmountAtomic) || BigInt(input.ethAmountAtomic) >= 2n ** 256n
        || !/^[1-9][0-9]{0,77}$/.test(input.maximumEthInputAtomic) || BigInt(input.ethAmountAtomic) > BigInt(input.maximumEthInputAtomic)) {
        throw new CannaCatClientError("INSUFFICIENT_BALANCE", "This ETH input exceeds your spending limit. Keep ETH available for network fees.");
      }
      input.signal?.throwIfAborted();
      const recipient = getAddress(input.wallet);
      const expected = { chainId: 4663, inputAsset: zeroAddress, outputAsset: CANNACAT_EMBED.token, inputAmountAtomic: input.ethAmountAtomic, recipient };
      const response = parseVNextQuoteResponse(await post("quotes", expected, input.signal), expected, now());
      const attempt = response.attempts.find(value => value.provider === "zero-x-swap" && value.status === "indicative"
        && value.publicWalletExecutionEligible && value.strictVerificationAvailable && value.protectedOutputAtomic);
      if (!attempt?.protectedOutputAtomic || !attempt.expiresAtMs || attempt.expiresAtMs <= now()) throw new CannaCatClientError("NO_ADMITTED_ROUTE", "No fresh verified 0x route is available for this ETH input.");
      return { side: "buy", buyInputMode: "eth", tokenAmountAtomic: attempt.protectedOutputAtomic, requestId: response.requestId, ...expected, attempt };
    },
    async quote(input: { side: CannaCatSide; tokenAmountAtomic: string; wallet: string; maximumEthInputAtomic: string; signal?: AbortSignal }): Promise<CannaCatQuote> {
      if (!["buy", "sell"].includes(input.side) || !/^[1-9][0-9]{0,77}$/.test(input.tokenAmountAtomic)
        || BigInt(input.tokenAmountAtomic) >= 2n ** 256n || !/^[1-9][0-9]{0,77}$/.test(input.maximumEthInputAtomic)) {
        throw new CannaCatClientError("INVALID_AMOUNT", "Enter a valid token amount and ETH spending limit.");
      }
      const recipient = getAddress(input.wallet);
      const inputAsset = input.side === "buy" ? zeroAddress : CANNACAT_EMBED.token;
      const outputAsset = input.side === "buy" ? CANNACAT_EMBED.token : zeroAddress;
      const maximum = BigInt(input.maximumEthInputAtomic);
      let amount = input.side === "buy" ? (maximum < 100_000_000_000_000n ? maximum : 100_000_000_000_000n) : BigInt(input.tokenAmountAtomic);
      // A token target is solved with the admitted exact-input rail, not an
      // unverified exact-output mode. Every final minimum must cover the target.
      for (let step = 0; step < (input.side === "buy" ? 5 : 1); step += 1) {
        input.signal?.throwIfAborted();
        const expected = { inputAsset, outputAsset, inputAmountAtomic: amount.toString() };
        const raw = await post("quotes", { chainId: 4663, ...expected, recipient }, input.signal);
        const response = parseVNextQuoteResponse(raw, expected, now());
        const attempt = response.attempts.find((value) => value.provider === "zero-x-swap" && value.status === "indicative"
          && value.publicWalletExecutionEligible && value.strictVerificationAvailable && value.protectedOutputAtomic);
        if (!attempt || !attempt.protectedOutputAtomic || !attempt.expiresAtMs || attempt.expiresAtMs <= now()) {
          throw new CannaCatClientError("NO_ADMITTED_ROUTE", "No fresh verified 0x route is available for this amount.");
        }
        if (input.side === "buy" && BigInt(attempt.protectedOutputAtomic) * 10_000n > BigInt(input.tokenAmountAtomic) * 10_050n) {
          // The seed quote must not turn a small requested target into a large
          // minimum purchase. Refine downward using the same bounded rail.
          const denominator = BigInt(attempt.protectedOutputAtomic) * 10_000n;
          const refined = (amount * BigInt(input.tokenAmountAtomic) * 10_020n + denominator - 1n) / denominator;
          if (refined <= 0n || refined >= amount) throw new CannaCatClientError("TARGET_PRECISION", "This target is too small for a precise quote. Choose another amount.");
          amount = refined;
          continue;
        }
        if (input.side === "sell" || BigInt(attempt.protectedOutputAtomic) >= BigInt(input.tokenAmountAtomic)) {
          return { side: input.side, tokenAmountAtomic: input.tokenAmountAtomic, requestId: response.requestId, ...expected, recipient, attempt };
        }
        amount = nextCannaCatBuyInput(amount, BigInt(attempt.protectedOutputAtomic), BigInt(input.tokenAmountAtomic), maximum);
      }
      throw new CannaCatClientError("TARGET_NOT_REACHED", "The route could not safely cover this token target. Try a smaller amount or refresh later.");
    },
    async prepare(quote: CannaCatQuote, signal?: AbortSignal): Promise<CannaCatPrepared> {
      if (!quote.attempt.expiresAtMs || quote.attempt.expiresAtMs <= now()) throw new CannaCatClientError("STALE_QUOTE", "Refresh the expired quote before preparing a transaction.");
      const expected = { quoteRequestId: quote.requestId, inputAsset: quote.inputAsset, outputAsset: quote.outputAsset,
        inputAmountAtomic: quote.inputAmountAtomic, recipient: quote.recipient };
      const raw = await post("verify", { chainId: 4663, ...expected, provider: "zero-x-swap", protectedOutputFloorAtomic: quote.attempt.protectedOutputAtomic }, signal);
      const evidence = parseVNextPreSignEvidence(raw, { ...expected, provider: "zero-x-swap", protectedOutputFloorAtomic: quote.attempt.protectedOutputAtomic! }, now());
      assertPreparedTarget(quote, evidence);
      if (evidence.status !== "verified" && evidence.status !== "approval_required") {
        throw new CannaCatClientError(evidence.status.toUpperCase(), `Trade verification: ${evidence.status.replaceAll("_", " ")}. No transaction was submitted.`);
      }
      const bundle = await post("authorize", {
        chainId: 4663, ...expected, verificationId: evidence.verificationId, provider: "zero-x-swap", expectedStatus: evidence.status,
        indicativeProtectedOutputFloorAtomic: evidence.indicativeProtectedOutputFloorAtomic, expectedProtectedOutputAtomic: evidence.protectedOutputAtomic,
        settlementMode: VNEXT_PROVIDER_NATIVE_INPUT_FEE, zeroXFirmQuoteCommitment: evidence.zeroXFirmQuoteCommitment
      }, signal);
      const parsed = parseVNextAuthorizationBundle(bundle, evidence, expected, now());
      assertPreparedTarget(quote, parsed.evidence);
      return { quote, evidence: parsed.evidence, plan: parsed.plan };
    },
    async nativeSettlementTrace(txHash: string, wallet: string, signal?: AbortSignal) {
      return post("native-settlement-trace", { txHash, wallet }, signal);
    }
  };
}

