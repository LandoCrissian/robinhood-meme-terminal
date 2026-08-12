import { createPublicClient, getAddress, http, isAddress, keccak256, type Address } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { ROBINHOOD_USDG_ADDRESS, ROBINHOOD_WETH_ADDRESS } from "../lib/vnext/robinhood-assets";
import {
  UP_CL_EXECUTION_ROUTER,
  UP_CL_EXECUTION_ROUTER_RUNTIME_HASH,
  UP_V2_EXECUTION_ROUTER,
  upClExecutionAbi,
  upV2ExecutionAbi
} from "../lib/vnext/up-authorization-codec";
import { verifyVNextUpRoute } from "../lib/server/vnext-up-execution";
import { quoteUpCl, quoteUpV2, UP_CL_FACTORY, UP_V2_FACTORY, UP_V2_ROUTER_RUNTIME_HASH, type UpObservedQuote } from "../lib/server/vnext-up-quote";

const preflight = process.argv.includes("--preflight");
const inputAsset = getAddress(process.env.RMT_VNEXT_UP_PREFLIGHT_INPUT_ASSET?.trim() || ROBINHOOD_USDG_ADDRESS);
const outputAsset = getAddress(process.env.RMT_VNEXT_UP_PREFLIGHT_OUTPUT_ASSET?.trim() || ROBINHOOD_WETH_ADDRESS);
const amountIn = BigInt(process.env.RMT_VNEXT_UP_PREFLIGHT_AMOUNT_ATOMIC?.trim() || "1000000");
const proofWalletValue = process.env.RMT_VNEXT_UP_PROOF_WALLET?.trim();
const proofWallet = proofWalletValue && isAddress(proofWalletValue, { strict: false }) ? getAddress(proofWalletValue) : null;
const validationWallet = proofWallet ?? getAddress("0x000000000000000000000000000000000000dEaD");
const rpc = process.env.RMT_VNEXT_UP_RPC_URL?.trim() || process.env.RMT_MAINNET_RPC_URL?.trim()
  || process.env.ROBINHOOD_MAINNET_RPC_URL?.trim() || robinhoodChain.rpcUrls.default.http[0];
const client = createPublicClient({ chain: robinhoodChain, transport: http(rpc, { retryCount: 1, timeout: 8_000 }) });

async function inspect(provider: "up-v2" | "up-cl") {
  const router = provider === "up-v2" ? UP_V2_EXECUTION_ROUTER : UP_CL_EXECUTION_ROUTER;
  const expectedHash = provider === "up-v2" ? UP_V2_ROUTER_RUNTIME_HASH : UP_CL_EXECUTION_ROUTER_RUNTIME_HASH;
  const abi = provider === "up-v2" ? upV2ExecutionAbi : upClExecutionAbi;
  const expectedFactory = provider === "up-v2" ? UP_V2_FACTORY : UP_CL_FACTORY;
  const observationFlag = process.env[provider === "up-v2" ? "RMT_VNEXT_UP_V2_OBSERVATION_ENABLED" : "RMT_VNEXT_UP_CL_OBSERVATION_ENABLED"] === "true";
  const authorizationFlag = process.env[provider === "up-v2" ? "RMT_VNEXT_UP_V2_AUTHORIZATION_ENABLED" : "RMT_VNEXT_UP_CL_AUTHORIZATION_ENABLED"] === "true";
  const blockers: string[] = [];
  let runtimeHash: string | null = null;
  let dependencyMatch = false;
  let quote: UpObservedQuote | null = null;
  let evidence: Awaited<ReturnType<typeof verifyVNextUpRoute>> | null = null;
  try {
    const [code, factory, weth] = await Promise.all([
      client.getBytecode({ address: router }),
      client.readContract({ address: router, abi, functionName: provider === "up-v2" ? "defaultFactory" : "factory" } as never),
      client.readContract({ address: router, abi, functionName: provider === "up-v2" ? "weth" : "WETH9" } as never)
    ]) as [undefined | `0x${string}`, Address, Address];
    runtimeHash = code ? keccak256(code) : null;
    dependencyMatch = getAddress(factory) === expectedFactory && getAddress(weth) === ROBINHOOD_WETH_ADDRESS;
    if (runtimeHash !== expectedHash) blockers.push("execution router runtime hash mismatch");
    if (!dependencyMatch) blockers.push("factory or WETH dependency mismatch");
    quote = provider === "up-v2"
      ? await quoteUpV2({ inputAsset, outputAsset, amountIn })
      : await quoteUpCl({ inputAsset, outputAsset, amountIn });
    if (!quote) blockers.push("no current USDG/WETH quote");
    if (quote) evidence = await verifyVNextUpRoute(provider, {
      inputAsset, outputAsset, amountIn, recipient: validationWallet,
      protectedOutputFloorAtomic: quote.protectedAmountOut,
      indicativeProtectedOutputFloorAtomic: quote.protectedAmountOut
    });
  } catch (cause) {
    blockers.push(cause instanceof Error ? cause.message : "unknown readiness failure");
  }
  if (!proofWallet) blockers.push("proof wallet not configured; connected-wallet simulation not run");
  else if (evidence?.status !== "verified") blockers.push(`wallet preflight is ${evidence?.status ?? "unavailable"}`);
  if (!observationFlag) blockers.push("provider observation flag is off");
  if (!authorizationFlag) blockers.push("provider authorization flag is off");
  if (process.env.RMT_VNEXT_AUTHORIZATION_ENABLED !== "true") blockers.push("global server authorization flag is off");
  if (process.env.NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED !== "true") blockers.push("global client authorization flag is off");
  if (process.env.NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED !== "true") blockers.push("wallet submission flag is off");
  return {
    provider, chainId: 4_663, router, expectedRuntimeHash: expectedHash, runtimeHash,
    runtimeHashMatch: runtimeHash === expectedHash, dependencyMatch,
    quoteAvailable: Boolean(quote), route: quote?.routeKind ?? null,
    pools: quote?.legs.map((leg) => leg.pool) ?? [], fees: quote?.legs.map((leg) => leg.fee) ?? [],
    calldataEncodeDecodeAgreement: evidence !== null,
    simulationReadiness: proofWallet ? evidence?.status ?? "unavailable" : "not_run",
    inputBalanceAtomic: proofWallet ? evidence?.balanceAtomic ?? null : null,
    allowanceAtomic: proofWallet ? evidence?.allowanceAtomic ?? null : null,
    nativeGasBalanceWei: proofWallet ? evidence?.nativeBalanceWei ?? null : null,
    executable: Boolean(proofWallet && evidence?.status === "verified"),
    observationFlag, authorizationFlag,
    globalAuthorizationFlag: process.env.RMT_VNEXT_AUTHORIZATION_ENABLED === "true"
      && process.env.NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED === "true",
    walletSubmissionFlag: process.env.NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED === "true",
    releaseReady: blockers.length === 0,
    blockers
  };
}

async function main() {
  if (amountIn <= 0n || inputAsset === outputAsset) throw new Error("Invalid up. readiness pair or amount.");
  if (preflight && !proofWallet) throw new Error("RMT_VNEXT_UP_PROOF_WALLET is required for connected-wallet preflight.");
  const results = await Promise.all([inspect("up-v2"), inspect("up-cl")]);
  console.log(JSON.stringify({ mode: preflight ? "preflight" : "readiness", inputAsset, outputAsset, amountIn: amountIn.toString(), proofWallet, providers: results }, null, 2));
  if (preflight && results.every((result) => !result.executable)) process.exitCode = 2;
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
