import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { getAddress, keccak256, zeroAddress, type Hex } from "viem";
import { parseZeroXPrice } from "../lib/server/vnext-zero-x-adapter";
import { RMT_ZERO_X_FEE_TREASURY, toZeroXToken } from "../lib/vnext/zero-x-settlement";
import type { VNextProviderQuoteRequest } from "../lib/server/vnext-provider-adapter";

// Read-only proof. No signer, wallet client, approval or submission API exists here.
const localEnv = fileURLToPath(new URL("../.env.local", import.meta.url));
if (!process.env.RMT_ZEROX_API_KEY && existsSync(localEnv)) loadEnvFile(localEnv);
const apiKey = process.env.RMT_ZEROX_API_KEY?.trim();
const usdg = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");

async function run() {
  const report: Record<string, unknown> = {
    observedAt: new Date().toISOString(), chainId: 4_663,
    ZEROX_API_KEY_PRESENT: Boolean(apiKey), VALUE_EXPOSED: false,
    signatures: 0, approvals: 0, transactions: 0, productionMutated: false
  };
  if (!apiKey) {
    console.log(JSON.stringify({ ...report, status: "BLOCKED", reason: "SERVER_SIDE_ZEROX_KEY_NOT_AVAILABLE_LOCALLY" }, null, 2));
    process.exitCode = 1;
    return;
  }
  const rpc = await fetch("https://rpc.mainnet.chain.robinhood.com/", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }), signal: AbortSignal.timeout(15_000)
  });
  const chain = await rpc.json() as { result?: string; error?: unknown };
  if (!rpc.ok || chain.error || !chain.result || !/^0x[0-9a-f]+$/i.test(chain.result) || BigInt(chain.result) !== 4_663n) throw new Error("ROBINHOOD_CHAIN_IDENTITY_FAILED");
  report.robinhoodChain = "PASS";
  const results: Record<string, unknown>[] = [];
  for (const [inputAsset, outputAsset, inputAmountAtomic] of [
    [zeroAddress, usdg, "1000000000000000"], [usdg, zeroAddress, "5000000"]
  ] as const) {
    const request: VNextProviderQuoteRequest = {
      chainId: 4_663, inputAsset, outputAsset, inputAmountAtomic, amountIn: BigInt(inputAmountAtomic), recipient: RMT_ZERO_X_FEE_TREASURY,
      inputIdentity: { address: inputAsset, symbol: inputAsset === zeroAddress ? "ETH" : "USDG", decimals: inputAsset === zeroAddress ? 18 : 6 },
      outputIdentity: { address: outputAsset, symbol: outputAsset === zeroAddress ? "ETH" : "USDG", decimals: outputAsset === zeroAddress ? 18 : 6 }
    };
    for (const endpoint of ["price", "quote"] as const) {
      const url = new URL(`/swap/allowance-holder/${endpoint}`, "https://api.0x.org");
      url.search = new URLSearchParams({
        chainId: "4663", sellToken: toZeroXToken(inputAsset), buyToken: toZeroXToken(outputAsset), sellAmount: inputAmountAtomic,
        taker: request.recipient, recipient: request.recipient, slippageBps: "100",
        swapFeeRecipient: RMT_ZERO_X_FEE_TREASURY, swapFeeBps: "25", swapFeeToken: toZeroXToken(inputAsset)
      }).toString();
      const response = await fetch(url, { headers: { "0x-api-key": apiKey!, "0x-version": "v2", Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      const body = await response.json().catch(() => null);
      const result: Record<string, unknown> = { endpoint: url.pathname, sellToken: inputAsset, buyToken: outputAsset, grossSellAmount: inputAmountAtomic, httpStatus: response.status };
      try {
        if (!response.ok) {
          result.providerError = typeof body?.name === "string" && /^[A-Z_]{1,80}$/.test(body.name) ? body.name : "HTTP_ERROR";
          throw new Error("PROVIDER_REQUEST_FAILED");
        }
        const price = parseZeroXPrice(body, request, "swap");
        if (!price) throw new Error("NO_LIQUIDITY_AVAILABLE");
        Object.assign(result, {
          integratorFee: price.integratorFee, treasuryRequestBinding: RMT_ZERO_X_FEE_TREASURY, feeBpsRequestBinding: 25,
          providerFee: price.providerFee, expectedOutput: price.expectedOutputAtomic, protectedOutput: price.protectedOutputAtomic,
          networkFee: price.networkFeeNativeAtomic
        });
        if (endpoint === "quote") {
          const tx = body.transaction;
          if (!tx || !/^0x(?:[a-fA-F0-9]{2}){4,}$/.test(tx.data) || !/^(0|[1-9][0-9]*)$/.test(tx.value) || !/^[1-9][0-9]*$/.test(tx.gas)) throw new Error("INVALID_FIRM_ENVELOPE");
          Object.assign(result, { target: getAddress(tx.to), value: tx.value, calldataHash: keccak256(tx.data as Hex), gas: tx.gas, simulationIncomplete: body.issues?.simulationIncomplete });
        }
        result.status = "PASS";
      } catch {
        result.status = "FAIL";
      }
      results.push(result);
    }
  }
  report.results = results;
  report.status = results.every(result => result.status === "PASS") ? "PASS" : "FAIL";
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
}

void run().catch(() => {
  // Do not emit raw exceptions from authenticated HTTP requests.
  console.log(JSON.stringify({ status: "FAIL", reason: "READ_ONLY_PROOF_UNAVAILABLE", VALUE_EXPOSED: false }));
  process.exitCode = 1;
});
