import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress, keccak256 } from "viem";
import {
  verifyZeroXSwapFirmQuote,
  zeroXSwapFirmQuoteVerificationConfiguration
} from "../server/vnext-zero-x-firm-quote-verifier";
import type { VNextProviderQuoteRequest } from "../server/vnext-provider-adapter";

export async function runZeroXFirmQuoteVerifierSmoke() {
  const savedFetch = globalThis.fetch;
  const saved = {
    RMT_RPC_URL: process.env.RMT_RPC_URL,
    RMT_ZEROX_ALLOWANCE_HOLDER: process.env.RMT_ZEROX_ALLOWANCE_HOLDER,
    RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH: process.env.RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH,
    RMT_ZEROX_API_KEY: process.env.RMT_ZEROX_API_KEY,
    RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED: process.env.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED
  };
  const inputAsset = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
  const outputAsset = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
  const recipient = getAddress("0x0000000000000000000000000000000000010000");
  const allowanceHolder = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
  const runtimeCode = "0x60006000" as const;
  const runtimeHash = keccak256(runtimeCode);
  const request: VNextProviderQuoteRequest = {
    chainId: 4_663,
    inputAsset,
    outputAsset,
    inputAmountAtomic: "1000000",
    amountIn: 1_000_000n,
    recipient,
    inputIdentity: { address: inputAsset, symbol: "USDG", decimals: 6 },
    outputIdentity: { address: outputAsset, symbol: "WETH", decimals: 18 }
  };
  const verificationRequest = { ...request, indicativeProtectedOutputFloorAtomic: 514_000_000_000_000n };

  function firmQuote(issue: "none" | "allowance" | "balance" | "simulation" = "none") {
    return {
      allowanceTarget: allowanceHolder,
      blockNumber: "12345678",
      buyAmount: "520000000000000",
      buyToken: outputAsset,
      fees: {
        integratorFee: null,
        integratorFees: [],
        zeroExFee: { amount: "1500", token: inputAsset, type: "volume" },
        gasFee: null
      },
      issues: {
        allowance: issue === "allowance" ? { actual: "0", spender: allowanceHolder } : null,
        balance: issue === "balance" ? { token: inputAsset, actual: "0", expected: request.inputAmountAtomic } : null,
        simulationIncomplete: issue === "simulation",
        invalidSourcesPassed: []
      },
      liquidityAvailable: true,
      minBuyAmount: "514800000000000",
      mode: "exact-in",
      route: { fills: [{ from: inputAsset, to: outputAsset, source: "Uniswap_V3", proportionBps: "10000" }] },
      sellAmount: request.inputAmountAtomic,
      sellToken: inputAsset,
      totalNetworkFee: "9000000000000",
      transaction: { to: allowanceHolder, data: "0x12345678", gas: "180000", gasPrice: "50000000", value: "0" },
      zid: "0x111111111111111111111111"
    };
  }

  try {
    process.env.RMT_ZEROX_API_KEY = "server-only-test-key";
    process.env.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED = "true";
    process.env.RMT_ZEROX_ALLOWANCE_HOLDER = allowanceHolder;
    process.env.RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH = runtimeHash;
    process.env.RMT_RPC_URL = "https://rpc.test.invalid";

    let issue: "none" | "allowance" | "balance" | "simulation" = "none";
    let alter: ((value: ReturnType<typeof firmQuote>) => ReturnType<typeof firmQuote>) | undefined;
    let rpcCallCount = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.origin === "https://api.0x.org") {
        assert.equal(url.pathname, "/swap/allowance-holder/quote");
        assert.equal(url.searchParams.get("chainId"), "4663");
        assert.equal(url.searchParams.get("sellToken"), inputAsset);
        assert.equal(url.searchParams.get("buyToken"), outputAsset);
        assert.equal(url.searchParams.get("sellAmount"), request.inputAmountAtomic);
        assert.equal(url.searchParams.get("taker"), recipient);
        assert.equal(url.searchParams.get("recipient"), recipient);
        assert.equal(url.searchParams.get("slippageBps"), "100");
        assert.equal(new Headers(init?.headers).get("0x-api-key"), "server-only-test-key");
        assert.equal(new Headers(init?.headers).get("0x-version"), "v2");
        const response = firmQuote(issue);
        return Response.json(alter ? alter(response) : response);
      }
      assert.equal(url.origin, "https://rpc.test.invalid");
      const payload = JSON.parse(String(init?.body)) as { method: string };
      if (payload.method === "eth_getCode") return Response.json({ jsonrpc: "2.0", id: 1, result: runtimeCode });
      if (payload.method === "eth_getBalance") return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2386f26fc10000" });
      if (payload.method === "eth_call") {
        rpcCallCount += 1;
        return Response.json({ jsonrpc: "2.0", id: 1, result: "0x" });
      }
      throw new Error(`Unexpected RPC method ${payload.method}`);
    };

    const configuration = zeroXSwapFirmQuoteVerificationConfiguration();
    assert.equal(configuration?.allowanceHolder, allowanceHolder);
    assert.equal(configuration?.runtimeHash, runtimeHash);

    const verified = await verifyZeroXSwapFirmQuote(verificationRequest);
    assert.equal(verified.status, "envelope_verified");
    assert.equal(verified.transactionTarget, allowanceHolder);
    assert.equal(verified.approvalSpender, allowanceHolder);
    assert.equal(verified.protectedOutputAtomic, "514800000000000");
    assert.equal(verified.exactTransactionSimulationPassed, true);
    assert.equal(verified.strictVerificationAvailable, false);
    assert.equal(verified.walletAuthorizationAvailable, false);
    assert.equal(verified.admissionReady, false);
    assert.equal(verified.recipientCalldataDecoded, false);
    assert.equal(verified.outputCalldataDecoded, false);
    assert.equal("calldata" in verified, false);
    assert.equal(rpcCallCount, 1);

    issue = "allowance";
    const approval = await verifyZeroXSwapFirmQuote(verificationRequest);
    assert.equal(approval.status, "approval_required");
    assert.equal(approval.allowanceActualAtomic, "0");
    assert.equal(approval.exactTransactionSimulationPassed, false);
    assert.equal(rpcCallCount, 1);

    issue = "balance";
    const balance = await verifyZeroXSwapFirmQuote(verificationRequest);
    assert.equal(balance.status, "insufficient_balance");
    assert.equal(balance.exactTransactionSimulationPassed, false);

    issue = "simulation";
    const incomplete = await verifyZeroXSwapFirmQuote(verificationRequest);
    assert.equal(incomplete.status, "provider_simulation_incomplete");
    assert.equal(incomplete.providerSimulationIncomplete, true);

    issue = "none";
    alter = (value) => ({ ...value, allowanceTarget: recipient });
    await assert.rejects(() => verifyZeroXSwapFirmQuote(verificationRequest), /unapproved AllowanceHolder/);
    alter = undefined;

    process.env.RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH = `0x${"11".repeat(32)}`;
    await assert.rejects(() => verifyZeroXSwapFirmQuote(verificationRequest), /runtime bytecode is not approved/);
    process.env.RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH = runtimeHash;

    delete process.env.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED;
    assert.equal(zeroXSwapFirmQuoteVerificationConfiguration(), null);

    const verifier = readFileSync(new URL("../server/vnext-zero-x-firm-quote-verifier.ts", import.meta.url), "utf8");
    const engine = readFileSync(new URL("../server/vnext-execution-engine.ts", import.meta.url), "utf8");
    const route = readFileSync(new URL("../../app/api/vnext/verify/route.ts", import.meta.url), "utf8");
    assert.doesNotMatch(engine, /vnext-zero-x-firm-quote-verifier/);
    assert.doesNotMatch(route, /zero-x-swap/);
    assert.doesNotMatch(verifier, /sendTransaction|writeContract|signTypedData|privateKey|\/gasless\/quote/);
    assert.match(verifier, /strictVerificationAvailable: false/);
    assert.match(verifier, /walletAuthorizationAvailable: false/);
    assert.match(verifier, /recipientCalldataDecoded: false/);
  } finally {
    globalThis.fetch = savedFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
