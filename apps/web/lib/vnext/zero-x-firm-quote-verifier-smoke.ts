import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Address } from "viem";
import { decodeFunctionData, erc20Abi, getAddress, keccak256, zeroAddress } from "viem";
import { createZeroXFirmQuoteCommitment } from "../server/vnext-zero-x-firm-quote-commitment";
import {
  prepareZeroXSwapAuthorization,
  verifyZeroXSwapFirmQuote,
  zeroXSwapFirmQuoteVerificationConfiguration
} from "../server/vnext-zero-x-firm-quote-verifier";
import { VNEXT_PROVIDER_NATIVE_INPUT_FEE } from "./execution-settlement";
import { TradeExecutionFailure } from "./trade-failure";
import { assertZeroXCommitmentAdversarialMatrix } from "./zero-x-firm-quote-commitment-smoke";
import {
  RMT_ZERO_X_FEE_TREASURY,
  toZeroXToken,
  ZERO_X_NATIVE_TOKEN,
  zeroXFeeAsset
} from "./zero-x-settlement";

export async function runZeroXFirmQuoteVerifierSmoke() {
  const savedFetch = globalThis.fetch;
  const saved = {
    RMT_VNEXT_VERIFICATION_COMMITMENT_SECRET: process.env.RMT_VNEXT_VERIFICATION_COMMITMENT_SECRET,
    RMT_RPC_URL: process.env.RMT_RPC_URL,
    RMT_ZEROX_ALLOWANCE_HOLDER: process.env.RMT_ZEROX_ALLOWANCE_HOLDER,
    RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH: process.env.RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH,
    RMT_ZEROX_API_KEY: process.env.RMT_ZEROX_API_KEY,
    RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED: process.env.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED
  };
  const outputAsset = getAddress("0x14C51bB55592372eAC7141A1D0527D1dD7Fbd42F");
  const erc20Input = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
  const recipient = getAddress("0x0000000000000000000000000000000000010000");
  const allowanceHolder = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
  const providerTarget = getAddress("0x0000000000000000000000000000000000012345");
  const now = () => Date.now();
  let inputAsset: Address = zeroAddress;
  let allowanceRequired = false;
  let balanceIssue = false;
  let simulationIncomplete = true;
  let noRoute = false;
  let noLiquidityBody = false;
  let providerStatus = 200;
  let quoteCalls = 0;
  let approvalGasCalls = 0;
  let mutation: (body: Record<string, any>) => void = () => {};

  const request = () => ({
    chainId: 4_663 as const,
    inputAsset,
    outputAsset,
    inputAmountAtomic: "500000000000000",
    amountIn: 500_000_000_000_000n,
    recipient,
    indicativeProtectedOutputFloorAtomic: 99_000n,
    protectedOutputFloorAtomic: 99_000n,
    settlementMode: VNEXT_PROVIDER_NATIVE_INPUT_FEE,
    nowMs: now()
  });
  const quote = () => ({
    allowanceTarget: inputAsset === zeroAddress ? null : allowanceHolder,
    blockNumber: "12345678",
    buyAmount: "100000",
    buyToken: outputAsset,
    fees: {
      integratorFee: {
        amount: "1250000000000",
        token: toZeroXToken(zeroXFeeAsset(inputAsset, outputAsset)),
        type: "volume"
      },
      zeroExFee: null,
      gasFee: null
    },
    issues: {
      allowance: allowanceRequired ? { actual: "0", spender: allowanceHolder } : null,
      balance: balanceIssue ? { token: toZeroXToken(inputAsset), actual: "0", expected: "500000000000000" } : null,
      simulationIncomplete,
      invalidSourcesPassed: [],
      futureProviderIssue: { internalRoute: "opaque-and-non-authoritative" }
    },
    liquidityAvailable: true,
    minBuyAmount: "99000",
    mode: "exact-in",
    sellAmount: "500000000000000",
    sellToken: toZeroXToken(inputAsset),
    totalNetworkFee: "9000000000000",
    transaction: {
      to: providerTarget,
      data: "0xdeadbeef00",
      gas: "180000",
      gasPrice: "50000000",
      value: inputAsset === zeroAddress ? "500000000000000" : "0",
      chainId: 4_663,
      from: recipient
    },
    route: { fills: [{ source: "A_FUTURE_0X_INTERNAL_ROUTE", proportionBps: "10000" }] },
    zid: "0x111111111111111111111111"
  });

  const context = () => ({
    identityId: "test-identity",
    sessionToken: "test-session",
    wallet: recipient,
    quoteRequestId: randomUUID(),
    verificationId: randomUUID()
  });

  try {
    process.env.RMT_VNEXT_VERIFICATION_COMMITMENT_SECRET = "deterministic-zero-x-commitment-test-secret-only";
    process.env.RMT_ZEROX_API_KEY = "server-only-test-key";
    process.env.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED = "true";
    process.env.RMT_ZEROX_ALLOWANCE_HOLDER = allowanceHolder;
    delete process.env.RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH;
    process.env.RMT_RPC_URL = "https://rpc.test.invalid";

    globalThis.fetch = async (raw, init) => {
      const url = new URL(String(raw));
      if (url.origin === "https://api.0x.org") {
        quoteCalls += 1;
        assert.equal(url.pathname, "/swap/allowance-holder/quote");
        assert.equal(url.searchParams.get("chainId"), "4663");
        assert.equal(url.searchParams.get("sellToken"), toZeroXToken(inputAsset));
        assert.equal(url.searchParams.get("buyToken"), outputAsset);
        assert.equal(url.searchParams.get("sellAmount"), "500000000000000");
        assert.equal(url.searchParams.get("taker"), recipient);
        assert.equal(url.searchParams.get("recipient"), recipient);
        assert.equal(url.searchParams.get("slippagePpm"), "9900");
        assert.equal(url.searchParams.has("slippageBps"), false);
        assert.equal(url.searchParams.get("swapFeeRecipient"), RMT_ZERO_X_FEE_TREASURY);
        assert.equal(url.searchParams.get("swapFeeBps"), "25");
        assert.equal(url.searchParams.get("swapFeeToken"), toZeroXToken(zeroXFeeAsset(inputAsset, outputAsset)));
        assert.equal(init?.headers && new Headers(init.headers).get("0x-version"), "v2");
        if (noRoute) return Response.json({ name: "NO_LIQUIDITY_AVAILABLE" }, { status: 400 });
        if (noLiquidityBody) return Response.json({ liquidityAvailable: false });
        if (providerStatus !== 200) return Response.json({ reason: "controlled provider failure" }, { status: providerStatus });
        const body = quote();
        mutation(body);
        return Response.json(body);
      }
      assert.equal(url.origin, "https://rpc.test.invalid");
      const payload = JSON.parse(String(init?.body)) as { method: string };
      assert.equal(payload.method, "eth_estimateGas", "only exact approval gas may use RPC on the provider-native path");
      approvalGasCalls += 1;
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0xc350" });
    };

    assert.deepEqual(zeroXSwapFirmQuoteVerificationConfiguration(), { allowanceHolder });

    const native = await verifyZeroXSwapFirmQuote(request());
    assert.equal(native.status, "verified");
    assert.equal(native.approvalRequired, false);
    assert.equal(native.providerReportedMinBuyAmount, "99000");
    assert.equal(native.protectedOutputAtomic, "99000");
    assert.equal(native.router, providerTarget);
    assert.equal(native.transactionData, "0xdeadbeef00");
    assert.equal(native.swapTransactionValueAtomic, "500000000000000");
    assert.equal(native.providerSimulationIncomplete, true);
    assert.equal(native.exactSimulationState, "not_run");
    assert.equal(native.routerRuntimeHash, null);
    assert.equal(native.nativeBalanceWei, null);
    assert.equal(approvalGasCalls, 0, "native ETH must not acquire an approval or approval RPC dependency");

    const nativeContext = context();
    const nativeCommitment = createZeroXFirmQuoteCommitment(native, nativeContext, now());
    const nativeAuthorizationRequest = {
      ...request(),
      protectedOutputFloorAtomic: 99_000n,
      deadlineSeconds: BigInt(native.deadline),
      zeroXExpectedStatus: "verified",
      zeroXFirmQuoteContext: nativeContext,
      zeroXFirmQuoteCommitment: nativeCommitment
    } as const;
    const nativePrepared = await prepareZeroXSwapAuthorization(nativeAuthorizationRequest);
    assert.equal(nativePrepared.transaction.kind, "swap");
    assert.equal(nativePrepared.transaction.target, providerTarget);
    assert.equal(nativePrepared.transaction.data, "0xdeadbeef00");
    assert.equal(nativePrepared.transaction.value, "500000000000000");
    assert.equal(quoteCalls, 1, "authorization must reuse the committed provider response");
    await assertZeroXCommitmentAdversarialMatrix(nativeAuthorizationRequest);

    await assert.rejects(() => prepareZeroXSwapAuthorization({
      ...request(),
      inputAmountAtomic: "500000000000001",
      amountIn: 500_000_000_000_001n,
      protectedOutputFloorAtomic: 99_000n,
      deadlineSeconds: BigInt(native.deadline),
      zeroXExpectedStatus: "verified",
      zeroXFirmQuoteContext: nativeContext,
      zeroXFirmQuoteCommitment: nativeCommitment
    }), /invalid or expired/);

    simulationIncomplete = false;
    inputAsset = erc20Input;
    allowanceRequired = true;
    const approval = await verifyZeroXSwapFirmQuote(request());
    assert.equal(approval.status, "approval_required");
    assert.equal(approval.providerNativeFee?.firmQuote?.allowanceTarget, allowanceHolder);
    assert.equal(approvalGasCalls, 1);
    const approvalContext = context();
    const approvalPrepared = await prepareZeroXSwapAuthorization({
      ...request(),
      protectedOutputFloorAtomic: 99_000n,
      deadlineSeconds: BigInt(approval.deadline),
      zeroXExpectedStatus: "approval_required",
      zeroXFirmQuoteContext: approvalContext,
      zeroXFirmQuoteCommitment: createZeroXFirmQuoteCommitment(approval, approvalContext, now())
    });
    assert.equal(approvalPrepared.transaction.kind, "erc20_approval");
    assert.equal(approvalPrepared.transaction.target, erc20Input);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: approvalPrepared.transaction.data });
    assert.equal(decoded.functionName, "approve");
    assert.equal(getAddress(decoded.args[0]), allowanceHolder);
    assert.equal(decoded.args[1], 500_000_000_000_000n);

    allowanceRequired = false;
    const postApproval = await verifyZeroXSwapFirmQuote(request());
    assert.equal(postApproval.status, "verified");
    assert.equal(postApproval.providerNativeFee?.firmQuote?.allowanceTarget, null);
    assert.equal(approvalGasCalls, 1, "fresh post-approval quote must not repeat an approval estimate");

    balanceIssue = true;
    assert.equal((await verifyZeroXSwapFirmQuote(request())).status, "insufficient_balance");
    balanceIssue = false;

    for (const mutate of [
      (body: Record<string, any>) => { body.sellAmount = "499999999999999"; },
      (body: Record<string, any>) => { body.recipient = getAddress("0x0000000000000000000000000000000000010001"); },
      (body: Record<string, any>) => { body.minBuyAmount = "98999"; },
      (body: Record<string, any>) => { body.fees.integratorFee.token = ZERO_X_NATIVE_TOKEN; },
      (body: Record<string, any>) => { body.transaction.value = "1"; },
      (body: Record<string, any>) => { body.transaction.to = zeroAddress; }
    ]) {
      mutation = mutate;
      await assert.rejects(
        () => verifyZeroXSwapFirmQuote({ ...request(), indicativeProtectedOutputFloorAtomic: 1n }),
        (error: unknown) => error instanceof TradeExecutionFailure && error.code === "PROVIDER_POLICY_REJECTED"
      );
    }
    mutation = () => {};

    noRoute = true;
    await assert.rejects(
      () => verifyZeroXSwapFirmQuote(request()),
      (error: unknown) => error instanceof TradeExecutionFailure && error.code === "NO_ROUTE"
    );
    noRoute = false;
    noLiquidityBody = true;
    await assert.rejects(
      () => verifyZeroXSwapFirmQuote(request()),
      (error: unknown) => error instanceof TradeExecutionFailure && error.code === "NO_ROUTE"
    );
    noLiquidityBody = false;
    for (const [status, code] of [[429, "RATE_LIMITED"], [503, "PROVIDER_UNAVAILABLE"], [403, "PROVIDER_POLICY_REJECTED"]] as const) {
      providerStatus = status;
      await assert.rejects(
        () => verifyZeroXSwapFirmQuote(request()),
        (error: unknown) => error instanceof TradeExecutionFailure && error.code === code
      );
    }
    providerStatus = 200;

    process.env.RMT_ZEROX_ALLOWANCE_HOLDER = providerTarget;
    assert.equal(zeroXSwapFirmQuoteVerificationConfiguration(), null);
    const beforeInvalidConfig = quoteCalls;
    await assert.rejects(() => verifyZeroXSwapFirmQuote(request()));
    assert.equal(quoteCalls, beforeInvalidConfig, "invalid approval authority must stop before the provider request");
  } finally {
    globalThis.fetch = savedFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runZeroXFirmQuoteVerifierSmoke().then(() => {
    console.log("RMT provider-native 0x firm quote, exact approval, commitment and immutable handoff smoke checks passed.");
  });
}
