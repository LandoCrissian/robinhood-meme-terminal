import assert from "node:assert/strict";
import { getAddress, keccak256, zeroAddress, type Hex } from "viem";
import {
  prepareZeroXSwapAuthorization,
  verifyZeroXSwapFirmQuote,
  zeroXSwapFirmQuoteVerificationConfiguration
} from "../server/vnext-zero-x-firm-quote-verifier";
import { VNEXT_PROVIDER_NATIVE_INPUT_FEE } from "./execution-settlement";
import { RMT_ZERO_X_FEE_TREASURY, ZERO_X_NATIVE_TOKEN } from "./zero-x-settlement";
import { assertZeroXSharedWalletAuthorization } from "./zero-x-wallet-authorization-smoke";
import { prepareVNextProviderAuthorization } from "../server/vnext-provider-adapter";
import { vNextZeroXSwapAdapter, vNextZeroXGaslessAdapter } from "../server/vnext-zero-x-adapter";

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
  const settler = getAddress("0x0000000000000000000000000000000000012345");
  const runtimeCode = "0x60006000" as Hex;
  const runtimeHash = keccak256(runtimeCode);
  const baseRequest = {
    chainId: 4_663 as const,
    inputAsset,
    outputAsset,
    inputAmountAtomic: "1000000",
    amountIn: 1_000_000n,
    recipient,
    indicativeProtectedOutputFloorAtomic: 514_000_000_000_000n,
    protectedOutputFloorAtomic: 514_000_000_000_000n,
    settlementMode: VNEXT_PROVIDER_NATIVE_INPUT_FEE,
    deadlineSeconds: BigInt(Math.floor(Date.now() / 1_000)) + 420n,
    nowMs: Date.now()
  };
  let input = inputAsset;
  let output = outputAsset;
  let allowance = false;
  let balanceIssue = false;
  let simulationIncomplete = false;
  let callFailure = false;
  let noTargetCode = false;
  let nativeBalance = 10n ** 20n;
  let nativeValue = "0";
  let transactionTarget = allowanceHolder;
  let quoteCalls = 0;
  let simulatedEnvelope: Record<string, string> | null = null;
  let tokenBalance = 1_000_000n;
  let rpcAllowance: bigint | null = null;
  let quoteMutation: (body: any) => void = () => {};

  const quote = () => ({
    allowanceTarget: input === zeroAddress ? null : allowanceHolder,
    blockNumber: "12345678",
    buyAmount: "520000000000000",
    buyToken: output === zeroAddress ? ZERO_X_NATIVE_TOKEN : output,
    fees: {
      integratorFee: { amount: "2500", token: input === zeroAddress ? ZERO_X_NATIVE_TOKEN : input, type: "volume" },
      integratorFees: [],
      zeroExFee: { amount: "1500", token: input === zeroAddress ? ZERO_X_NATIVE_TOKEN : input, type: "volume" },
      gasFee: null
    },
    issues: {
      allowance: allowance ? { actual: "0", spender: allowanceHolder } : null,
      balance: balanceIssue ? { token: input === zeroAddress ? ZERO_X_NATIVE_TOKEN : input, actual: "0", expected: "1000000" } : null,
      simulationIncomplete,
      invalidSourcesPassed: []
    },
    liquidityAvailable: true,
    minBuyAmount: "514800000000000",
    mode: "exact-in",
    sellAmount: "1000000",
    sellToken: input === zeroAddress ? ZERO_X_NATIVE_TOKEN : input,
    totalNetworkFee: "9000000000000",
    transaction: { to: transactionTarget, data: "0x12345678", gas: "180000", gasPrice: "50000000", value: nativeValue },
    zid: "0x111111111111111111111111"
  });

  try {
    process.env.RMT_ZEROX_API_KEY = "server-only-test-key";
    process.env.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED = "true";
    process.env.RMT_ZEROX_ALLOWANCE_HOLDER = allowanceHolder;
    process.env.RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH = runtimeHash;
    process.env.RMT_RPC_URL = "https://rpc.test.invalid";
    globalThis.fetch = async (raw, init) => {
      const url = new URL(String(raw));
      if (url.origin === "https://api.0x.org") {
        quoteCalls += 1;
        assert.equal(url.pathname, "/swap/allowance-holder/quote");
        assert.equal(url.searchParams.get("chainId"), "4663");
        assert.equal(url.searchParams.get("sellToken"), input === zeroAddress ? ZERO_X_NATIVE_TOKEN : input);
        assert.equal(url.searchParams.get("buyToken"), output === zeroAddress ? ZERO_X_NATIVE_TOKEN : output);
        assert.equal(url.searchParams.get("swapFeeRecipient"), RMT_ZERO_X_FEE_TREASURY);
        assert.equal(url.searchParams.get("swapFeeBps"), "25");
        assert.equal(url.searchParams.get("swapFeeToken"), input === zeroAddress ? ZERO_X_NATIVE_TOKEN : input);
        assert.equal(url.searchParams.has("tradeSurplusRecipient"), false);
        const body = quote();
        quoteMutation(body);
        return Response.json(body);
      }
      const payload = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      if (payload.method === "eth_chainId") return Response.json({ jsonrpc: "2.0", id: 1, result: "0x1237" });
      if (payload.method === "eth_gasPrice") return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2faf080" });
      if (payload.method === "eth_getCode") return Response.json({ jsonrpc: "2.0", id: 1, result: noTargetCode ? "0x" : runtimeCode });
      if (payload.method === "eth_getBalance") return Response.json({ jsonrpc: "2.0", id: 1, result: `0x${nativeBalance.toString(16)}` });
      if (payload.method === "eth_estimateGas") return Response.json({ jsonrpc: "2.0", id: 1, result: "0xc350" });
      if (payload.method === "eth_call") {
        const call = payload.params[0] as Record<string, string>;
        if (call.data.startsWith("0x70a08231")) return Response.json({ jsonrpc: "2.0", id: 1, result: `0x${tokenBalance.toString(16).padStart(64, "0")}` });
        if (call.data.startsWith("0xdd62ed3e")) return Response.json({ jsonrpc: "2.0", id: 1, result: `0x${(rpcAllowance ?? (allowance ? 0n : 1_000_000n)).toString(16).padStart(64, "0")}` });
        simulatedEnvelope = (payload.params[0] ?? null) as Record<string, string> | null;
        return callFailure
          ? Response.json({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "reverted" } })
          : Response.json({ jsonrpc: "2.0", id: 1, result: "0x" });
      }
      throw new Error(`Unexpected RPC method ${payload.method}`);
    };

    assert.equal(zeroXSwapFirmQuoteVerificationConfiguration()?.allowanceHolder, allowanceHolder);
    const verified = await verifyZeroXSwapFirmQuote(baseRequest);
    assert.equal(verified.status, "verified");
    assert.equal(verified.strictVerificationAvailable, true);
    assert.equal(verified.walletAuthorizationAvailable, true);
    assert.equal(verified.admissionReady, true);
    assert.equal(verified.providerNativeFee?.feeAmountAtomic, "2500");
    assert.equal(verified.providerNativeFee?.feeExecutorRequired, false);
    assert.equal(verified.providerFeeAtomic, "1500");
    assert.deepEqual(simulatedEnvelope, { from: recipient, to: allowanceHolder, data: "0x12345678", value: "0x0", gas: "0x2bf20", gasPrice: "0x2faf080" });
    const swap = await prepareVNextProviderAuthorization("zero-x-swap", baseRequest, [vNextZeroXSwapAdapter]);
    assert.equal(swap.transaction.kind, "swap");
    assert.equal(swap.transaction.data, "0x12345678");
    assert.equal(swap.transaction.value, "0");
    assertZeroXSharedWalletAuthorization(swap);
    await assert.rejects(() => prepareVNextProviderAuthorization("zero-x-gasless", baseRequest, [vNextZeroXGaslessAdapter]), /not available/);
    await assert.rejects(() => prepareZeroXSwapAuthorization({ ...baseRequest, protectedOutputFloorAtomic: 999_999_999_999_999n }), /protected output/);

    const malformed: ((body: any) => void)[] = [
      body => { body.chainId = 1; }, body => { body.taker = zeroAddress; }, body => { body.recipient = zeroAddress; },
      body => { body.transaction.to = "invalid"; }, body => { body.transaction.to = zeroAddress; },
      body => { body.transaction.to = settler; }, body => { body.transaction.data = "0x"; },
      body => { body.transaction.data = "0xxyz"; }, body => { body.transaction.data = "0x123"; },
      body => { body.transaction.value = "-1"; }, body => { body.transaction.value = "1"; },
      body => { body.transaction.gas = "0"; }, body => { body.transaction.gasPrice = "-1"; },
      body => { body.sellAmount = "999999"; }, body => { body.sellToken = outputAsset; },
      body => { body.buyToken = inputAsset; }, body => { body.minBuyAmount = "999999999999999999999"; },
      body => { delete body.issues.balance; }, body => { delete body.issues.allowance; },
      body => { body.issues.invalidSourcesPassed = ["unexpected"]; },
      body => { body.issues.allowance = { actual: "0", spender: settler }; },
      body => { body.allowanceTarget = settler; }, body => { body.issues.balance = { token: outputAsset, actual: "0", expected: "1000000" }; },
      body => { body.fees.integratorFee = null; }, body => { body.fees.integratorFee.amount = "0"; },
      body => { body.fees.integratorFee.amount = "2501"; }, body => { body.fees.integratorFee.token = outputAsset; },
      body => { body.fees.integratorFee.type = "surplus"; }, body => { body.fees.integratorFees = [body.fees.integratorFee, body.fees.integratorFee]; },
      body => { body.fees.zeroExFee.amount = "-1"; }, body => { body.fees.zeroExFee.token = "invalid"; },
      body => { body.zid = "!"; }, body => { body.blockNumber = -1; }
    ];
    for (const mutate of malformed) {
      quoteMutation = mutate;
      await assert.rejects(() => prepareZeroXSwapAuthorization(baseRequest));
    }
    quoteMutation = body => { delete body.transaction.gasPrice; body.blockNumber = 12345678; };
    assertZeroXSharedWalletAuthorization(await prepareZeroXSwapAuthorization(baseRequest));
    quoteMutation = () => {};
    tokenBalance = 0n;
    assert.equal((await verifyZeroXSwapFirmQuote(baseRequest)).status, "insufficient_balance", "local balance must fail closed even when provider reports no issue");
    tokenBalance = 1_000_000n;
    rpcAllowance = 0n;
    assert.equal((await verifyZeroXSwapFirmQuote(baseRequest)).status, "approval_required", "local allowance must be checked independently");
    rpcAllowance = null;
    nativeBalance = 1n;
    assert.equal((await verifyZeroXSwapFirmQuote(baseRequest)).status, "insufficient_gas");
    nativeBalance = 10n ** 20n;

    allowance = true;
    const approval = await prepareZeroXSwapAuthorization(baseRequest);
    assert.equal(approval.evidence.status, "approval_required");
    assert.equal(approval.transaction.kind, "erc20_approval");
    assert.equal(approval.transaction.target, inputAsset);
    assert.equal(approval.transaction.value, "0");
    assert.match(approval.transaction.data, /^0x095ea7b3/);
    assertZeroXSharedWalletAuthorization(approval);
    quoteMutation = body => { delete body.allowanceTarget; };
    assertZeroXSharedWalletAuthorization(await prepareZeroXSwapAuthorization(baseRequest));
    quoteMutation = () => {};
    simulationIncomplete = true;
    assertZeroXSharedWalletAuthorization(await prepareZeroXSwapAuthorization(baseRequest));
    simulationIncomplete = false;
    const beforeFresh = quoteCalls;
    allowance = false;
    quoteMutation = body => { body.transaction.data = "0x87654321"; };
    const fresh = await prepareZeroXSwapAuthorization(baseRequest);
    assert.equal(fresh.transaction.kind, "swap");
    assert.equal(fresh.transaction.data, "0x87654321");
    assertZeroXSharedWalletAuthorization(fresh);
    quoteMutation = () => {};
    assert.equal(quoteCalls, beforeFresh + 1, "authorization must always fetch a fresh firm quote");

    allowance = false;
    balanceIssue = true;
    assert.equal((await verifyZeroXSwapFirmQuote(baseRequest)).status, "insufficient_balance");
    balanceIssue = false;
    simulationIncomplete = true;
    assert.equal((await verifyZeroXSwapFirmQuote(baseRequest)).status, "simulation_failed");
    simulationIncomplete = false;
    callFailure = true;
    assert.equal((await verifyZeroXSwapFirmQuote(baseRequest)).status, "simulation_failed");
    callFailure = false;

    input = zeroAddress;
    output = outputAsset;
    transactionTarget = settler;
    nativeValue = "1000000";
    const nativeRequest = { ...baseRequest, inputAsset: zeroAddress };
    const native = await verifyZeroXSwapFirmQuote(nativeRequest);
    assert.equal(native.status, "verified");
    assert.equal(native.approvalRequired, false);
    assert.equal(native.transactionValueAtomic, "1000000");
    assert.equal(native.providerNativeFee?.feeAsset, zeroAddress);
    assert.equal(native.providerNativeFee?.requestFeeToken, ZERO_X_NATIVE_TOKEN);
    const nativePrepared = await prepareZeroXSwapAuthorization(nativeRequest);
    assertZeroXSharedWalletAuthorization(nativePrepared);
    assert.equal((simulatedEnvelope as unknown as Record<string, string>).value, `0x${BigInt(nativePrepared.transaction.value).toString(16)}`);
    quoteMutation = body => { body.issues.allowance = { actual: "0", spender: allowanceHolder }; };
    await assert.rejects(() => prepareZeroXSwapAuthorization(nativeRequest), /native ETH/);
    quoteMutation = () => {};

    nativeBalance = 1n;
    assert.equal((await verifyZeroXSwapFirmQuote(nativeRequest)).status, "insufficient_balance");
    nativeBalance = 1_000_001n;
    assert.equal((await verifyZeroXSwapFirmQuote(nativeRequest)).status, "insufficient_gas");
    nativeBalance = 10n ** 20n;
    noTargetCode = true;
    await assert.rejects(() => verifyZeroXSwapFirmQuote(nativeRequest), /no contract code/);
  } finally {
    globalThis.fetch = savedFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
