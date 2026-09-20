import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getAddress, keccak256, zeroAddress, encodeFunctionData, parseAbi, type Hex } from "viem";
import { observePrivateZeroXCase, privateProofConfiguration, privateProofFailure, runPrivateZeroXProof, safePrivateProofEvent } from "./private-zero-x-proof";
import { RMT_ZERO_X_FEE_TREASURY, toZeroXToken } from "../lib/vnext/zero-x-settlement";
import { RMT_ZERO_X_CANONICAL_ALLOWANCE_HOLDER as holder } from "../lib/vnext/zero-x-authority";
import { TradeExecutionFailure } from "../lib/vnext/trade-failure";
import { validateProofJsonl, ProofJsonl } from "./private-zero-x-jsonl";
import { emitObservedCase, CANNACAT_CASE, installPrivateProofReadBudget } from "./private-zero-x-proof";
import type { VNextProviderQuoteRequest } from "../lib/server/vnext-provider-adapter";
import type { ZeroXFirmDiagnostic } from "../lib/server/vnext-zero-x-firm-quote-verifier";
import { verifyZeroXSwapFirmQuote } from "../lib/server/vnext-zero-x-firm-quote-verifier";
import { VNEXT_PROVIDER_NATIVE_INPUT_FEE } from "../lib/vnext/execution-settlement";

const fixture = createRequire(import.meta.url)("../../../.github/scripts/zerox-execution-fixture.cjs");
const savedFetch = globalThis.fetch;
const names = ["RMT_ZEROX_API_KEY", "RMT_VNEXT_ZEROX_OBSERVATION_ENABLED", "RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED", "RMT_ZEROX_ALLOWANCE_HOLDER", "RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH", "RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS", "RMT_RPC_URL", "RMT_MAINNET_RPC_URL", "ROBINHOOD_MAINNET_RPC_URL", "NEXT_PUBLIC_RMT_RPC_URL"] as const;
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
const token = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const other = CANNACAT_CASE.outputAsset;
import { mutateZeroXActions, ppmRuntime } from "../lib/vnext/zero-x-provider-native-fee-smoke";
const holderCode = "0x60006000";
const blockHash = `0x${"ab".repeat(32)}`;
const blockTimestamp = `0x${Math.floor(Date.now() / 1000).toString(16)}`;
let mode = "verified";
let priceCalls = 0;
let quoteCalls = 0;
let simulations = 0;
let headers = 0;
let prevCalls = 0;
const observedMethods = new Set<string>();
const uint = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

function request(inputAsset = token, outputAsset = other): VNextProviderQuoteRequest {
  return { chainId: 4663, inputAsset, outputAsset, amountIn: 1000000n, inputAmountAtomic: "1000000", recipient: getAddress(RMT_ZERO_X_FEE_TREASURY),
    inputIdentity: { address: inputAsset, decimals: inputAsset === zeroAddress ? 18 : 6, symbol: "INPUT" },
    outputIdentity: { address: outputAsset, decimals: 18, symbol: "OUTPUT" } };
}

async function run() {
  try {
    let transportCalls = 0;
    globalThis.fetch = async () => { transportCalls++; return Response.json({}); };
    const budget = installPrivateProofReadBudget();
    const query = new URLSearchParams({ chainId: "4663", sellToken: CANNACAT_CASE.inputAsset,
      buyToken: CANNACAT_CASE.outputAsset, sellAmount: CANNACAT_CASE.amount,
      taker: RMT_ZERO_X_FEE_TREASURY, recipient: RMT_ZERO_X_FEE_TREASURY });
    const endpoint = (kind: string) => `https://api.0x.org/swap/allowance-holder/${kind}?${query}`;
    const rpc = (method: string) => fetch("https://rpc.invalid", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }) });
    try {
      await assert.rejects(fetch(endpoint("quote").replace("sellAmount=1000000", "sellAmount=2")), /REQUEST_BLOCKED/);
      await fetch(endpoint("price")); await fetch(endpoint("quote"));
      await assert.rejects(fetch(endpoint("price")), /REQUEST_BLOCKED/);
      await assert.rejects(fetch(endpoint("quote")), /REQUEST_BLOCKED/);
      for (const method of ["eth_sendRawTransaction", "eth_sendTransaction", "personal_sign", "wallet_requestPermissions"]) await assert.rejects(rpc(method), /RPC_BLOCKED/);
      for (let i = 0; i < 64; i++) await rpc("eth_call");
      await assert.rejects(rpc("eth_call"), /RPC_BLOCKED/);
      for (let i = 0; i < 16; i++) await fetch("https://read.invalid");
      await assert.rejects(fetch("https://read.invalid"), /READ_BLOCKED/);
      await assert.rejects(fetch("https://read.invalid", { method: "DELETE" }), /READ_BLOCKED/);
      assert.equal(transportCalls, 82, "blocked calls never reach transport");
    } finally { budget.restore(); }
    globalThis.fetch = async () => { throw new Error("synthetic transport failure"); };
    const failedBudget = installPrivateProofReadBudget();
    try {
      await assert.rejects(fetch(endpoint("quote")), /synthetic transport/);
      await assert.rejects(fetch(endpoint("quote")), /REQUEST_BLOCKED/);
      assert.equal(failedBudget.counts.firm, 1, "a failed request consumes the one-shot budget");
    } finally { failedBudget.restore(); }
    for (const name of names) delete process.env[name];
    let forbiddenCalls = 0;
    globalThis.fetch = async () => { forbiddenCalls++; throw new Error("must not call"); };
    assert.equal((await runPrivateZeroXProof()).status, "BLOCKED");
    assert.equal(forbiddenCalls, 0, "missing configuration must fail before network");
    process.env.RMT_ZEROX_API_KEY = "fixture-only-not-a-production-credential";
    process.env.RMT_VNEXT_ZEROX_OBSERVATION_ENABLED = "true";
    process.env.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED = "true";
    process.env.RMT_ZEROX_ALLOWANCE_HOLDER = holder;
    process.env.RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH = keccak256(holderCode);
    process.env.RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS = "zero-x-swap";
    process.env.RMT_RPC_URL = "https://rpc.invalid/fixture";
    assert.equal(privateProofConfiguration().status, "READY");
    for (const [name, bad] of [["RMT_RPC_URL", "http://rpc.invalid"], ["RMT_RPC_URL", "https://user:secret@rpc.invalid"],
      ["RMT_ZEROX_API_KEY", "bad\nheader"], ["RMT_ZEROX_ALLOWANCE_HOLDER", other],
      ["RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS", "zero-x-swap,sushi"], ["RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH", "0x1234"]] as const) {
      const original = process.env[name]; process.env[name] = bad;
      assert.equal((await runPrivateZeroXProof()).status, "BLOCKED");
      process.env[name] = original;
    }
    assert.equal(forbiddenCalls, 0);
    assert.equal(privateProofFailure(new Error("https://secret.invalid/key?cookie=secret")), "FIRM_QUOTE_REJECTED");
    assert.equal(privateProofFailure(new TradeExecutionFailure("RATE_LIMITED")), "RATE_LIMITED");
    const malicious = { kind: "quote", allowanceTarget: token, transactionTarget: holder, transactionValue: "cookie=secret",
      calldataHash: "0x1234", decodedSettler: fixture.settler, protectedExecutableMinimum: "9".repeat(1000),
      providerFeeAsset: null, providerFeeAmount: "https://secret.invalid", providerSimulationIncomplete: true,
      transactionData: "DO_NOT_OUTPUT", cookie: "DO_NOT_OUTPUT", error: "DO_NOT_OUTPUT" } as unknown as ZeroXFirmDiagnostic;
    const sanitized = JSON.stringify(safePrivateProofEvent(malicious));
    for (const marker of ["secret", "DO_NOT_OUTPUT", "cookie", "https", "999999999"]) assert.equal(sanitized.includes(marker), false);

    globalThis.fetch = async (raw, init) => {
      const url = new URL(String(raw));
      if (url.origin === "https://api.0x.org") {
        assert.equal(init?.method ?? "GET", "GET");
        assert.equal(new Headers(init?.headers).get("0x-version"), "v2");
        assert.equal(url.searchParams.get("chainId"), "4663");
        assert.equal(url.searchParams.get("slippagePpm"), "9900");
        assert.equal(url.searchParams.has("slippageBps"), false);
        assert.equal(url.searchParams.get("swapFeeBps"), "25");
        assert.equal(url.searchParams.get("swapFeeRecipient"), RMT_ZERO_X_FEE_TREASURY);
        assert.equal(url.searchParams.get("swapFeeToken"), url.searchParams.get("sellToken"));
        assert.equal(url.searchParams.get("taker"), url.searchParams.get("recipient"));
        const firm = url.pathname === "/swap/allowance-holder/quote";
        assert.ok(firm || url.pathname === "/swap/allowance-holder/price");
        if (firm) quoteCalls++; else priceCalls++;
        if (mode === "no_price" && !firm) return Response.json({ liquidityAvailable: false });
        if (firm && mode === "rate_limit") return Response.json({ message: "DO_NOT_OUTPUT" }, { status: 429 });
        if (firm && mode === "provider_error") return Response.json({ message: "DO_NOT_OUTPUT" }, { status: 503 });
        if (firm && mode === "no_route") return Response.json({ name: "NO_LIQUIDITY_AVAILABLE" }, { status: 400 });
        const native = url.searchParams.get("sellToken") === toZeroXToken(zeroAddress);
        const sellToken = url.searchParams.get("sellToken")!;
        const body = { actionBasisForTest: 1000000n, liquidityAvailable: true, sellToken, buyToken: url.searchParams.get("buyToken")!, sellAmount: "1000000",
          buyAmount: "1000000", minBuyAmount: "990100", totalNetworkFee: "100000", allowanceTarget: native ? null : holder,
          fees: { integratorFee: { token: sellToken, amount: "2500", type: "volume" }, zeroExFee: null, gasFee: null },
          issues: { allowance: mode === "allowance" ? { actual: "0", spender: holder } : null,
            balance: mode === "balance" ? { token: sellToken, actual: "0", expected: "1000000" } : null,
            simulationIncomplete: mode === "provider_simulation", invalidSourcesPassed: [] },
          transaction: { to: native ? fixture.settler : holder, value: native ? "1000000" : "0", gas: "100000", gasPrice: "1", data: "" },
          untrustedText: "DO_NOT_OUTPUT" };
        body.transaction.data = fixture.encodeQuote(body, RMT_ZERO_X_FEE_TREASURY);
        if (firm && mode === "unsupported") body.transaction.data = mutateZeroXActions(body.transaction.data as Hex, a => { a[2] = "0xdeadbeef"; });
        if (firm && mode === "early_envelope") body.transaction.data = mutateZeroXActions(body.transaction.data as Hex, a => {
          a.splice(2, 0, encodeFunctionData({ abi: parseAbi(["function CHECK_SLIPPAGE(bool exact)"]), functionName: "CHECK_SLIPPAGE", args: [false] }));
        });
        const { actionBasisForTest: _basis, ...response } = body;
        return Response.json(response);
      }
      const payload = JSON.parse(String(init?.body));
      observedMethods.add(payload.method);
      let result: unknown;
      if (payload.method === "eth_chainId") result = mode === "wrong_chain" ? "0x1" : "0x1237";
      else if (payload.method === "eth_blockNumber") result = "0x100";
      else if (payload.method === "eth_getBlockByNumber") {
        if (payload.params[0] !== "latest") headers++;
        result = { number: "0x100", hash: mode === "reorg" && headers % 2 === 0 ? `0x${"cd".repeat(32)}` : blockHash,
          timestamp: blockTimestamp, transactions: [] };
      } else if (payload.method === "eth_getCode") result = payload.params[0].toLowerCase() === holder.toLowerCase()
        ? holderCode : mode === "runtime" ? "0x60016001" : ppmRuntime;
      else if (payload.method === "eth_getBalance") result = "0x10000000000000000";
      else if (payload.method === "eth_gasPrice") result = "0x1";
      else if (payload.method === "eth_estimateGas") result = "0x5208"; // simulation of approval, never submission
      else if (payload.method === "eth_call") {
        const call = payload.params[0];
        if (call.data.startsWith("0x6352211e")) result = mode === "paused" ? uint(0n) : uint(BigInt(fixture.settler));
        else if (call.to.toLowerCase() === "0x00000000000004533fe15556b1e086bb1a72ceae") { prevCalls++; result = uint(BigInt(fixture.settler)); }
        else if (call.from) { simulations++; if (mode === "exact_simulation") throw new Error("DO_NOT_OUTPUT"); result = "0x"; }
        else result = uint(mode === "allowance" && call.data.startsWith("0xdd62ed3e") ? 0n : 100000000000000000000n);
      } else assert.fail(`Non-read RPC method: ${payload.method}`);
      return Response.json({ jsonrpc: "2.0", id: payload.id, result });
    };
    const directRequest = { ...request(), indicativeProtectedOutputFloorAtomic: 990000n,
      settlementMode: VNEXT_PROVIDER_NATIVE_INPUT_FEE, deadlineSeconds: BigInt(Math.floor(Date.now() / 1000) + 240), nowMs: Date.now() };
    const plain = await verifyZeroXSwapFirmQuote(directRequest);
    let inspections = 0;
    const inspected = await verifyZeroXSwapFirmQuote(directRequest, undefined, envelope => {
      inspections++; assert.equal(Object.isFrozen(envelope), true);
      assert.equal(Reflect.set(envelope, "target", other), false);
      assert.equal(envelope.target, getAddress(holder));
    });
    assert.equal(inspections, 1); assert.equal(inspected.status, plain.status);
    const beforeThrow = simulations;
    await assert.rejects(() => verifyZeroXSwapFirmQuote(directRequest, undefined, () => { throw new Error("DO_NOT_OUTPUT"); }));
    assert.equal(simulations, beforeThrow, "inspection failure cannot bypass checks or return accepted evidence");
    const directQuoteCalls = quoteCalls;
    for (const pair of [[token, other], [token, zeroAddress], [zeroAddress, token]] as const) {
      const result = await observePrivateZeroXCase(request(...pair), true);
      assert.equal(result.failureClass, "VERIFIED");
      assert.equal(result.RMTExactSimulationState, "PASS");
      assert.equal(result.firmStatus, "FIRM_QUOTE_RETURNED");
      assert.equal(result.feeEvidence, "QUOTED_FEE_NOT_ENCODED_VALIDATION_OR_SETTLEMENT");
      assert.ok(result.firmQuote && "allowanceTarget" in result.firmQuote);
      assert.equal(result.firmQuote.allowanceTarget, pair[0] === zeroAddress ? null : getAddress(holder));
      assert.equal(JSON.stringify(result).includes("DO_NOT_OUTPUT"), false);
      assert.ok(result.deployment && "blockHash" in result.deployment && result.deployment.blockHash === blockHash);
      assert.ok((result.actions?.actionCount ?? 0) >= 3);
      const lines: string[] = []; const writer = new ProofJsonl(line => lines.push(line));
      writer.emit("PROOF_START"); writer.emit("SOURCE_FINGERPRINT", { path: "fixture", sha256: "a".repeat(64) });
      writer.beginCase("USDG_TO_CANNACAT"); emitObservedCase(writer, result); writer.finish("COMPLETE");
      assert.ok(validateProofJsonl(lines.join("")));
      const emitted = lines.map(line => JSON.parse(line));
      assert.equal(emitted.filter(r => r.type === "QUOTE").length, 1);
      assert.equal(emitted.filter(r => r.type === "ACTION").length, result.actions!.actionCount);
      assert.equal(emitted.at(-1).truncated, false);
      assert.equal(lines.join("").toLowerCase().includes(RMT_ZERO_X_FEE_TREASURY.toLowerCase()), false);
    }
    for (const [nextMode, expected] of [["allowance", "INSUFFICIENT_ALLOWANCE"], ["balance", "INSUFFICIENT_BALANCE"],
      ["provider_simulation", "SIMULATION_FAILED"], ["exact_simulation", "SIMULATION_FAILED"], ["runtime", "RUNTIME_REJECTED"],
      ["unsupported", "EXECUTION_ENVELOPE_REJECTED"], ["early_envelope", "EXECUTION_ENVELOPE_REJECTED"], ["rate_limit", "RATE_LIMITED"], ["provider_error", "PROVIDER_UNAVAILABLE"],
      ["no_route", "NO_ROUTE"], ["wrong_chain", "FIRM_QUOTE_REJECTED"], ["paused", "SETTLER_REGISTRY_UNAVAILABLE"], ["reorg", "RPC_UNAVAILABLE"]]) {
      mode = nextMode; headers = 0; const before = simulations;
      const callsBefore = quoteCalls;
      const result = await observePrivateZeroXCase(request(), true);
      assert.equal(result.failureClass, expected, mode);
      if (mode === "runtime") assert.ok(result.deployment && "runtimeAdmitted" in result.deployment && result.deployment.runtimeAdmitted === false);
      if (mode === "runtime") assert.ok((result.actions?.actionCount ?? 0) >= 3, "capture survives runtime rejection without admission");
      if (mode === "unsupported" || mode === "early_envelope") {
        assert.ok((result.actions?.actionCount ?? 0) >= 3);
        assert.equal(result.envelopeDiagnostic?.envelopeReason, mode === "unsupported" ? "UNSUPPORTED_ACTION" : "EARLY_SLIPPAGE");
        assert.equal(result.envelopeDiagnostic?.actionIndex, 2);
        assert.equal(result.envelopeDiagnostic?.envelopeFunction, mode === "unsupported" ? "verifyZeroXEncodedFee" : "decodeZeroXExecutableMinimum");
      }
      assert.ok(quoteCalls - callsBefore <= 1, "no firm retry");
      if (mode !== "exact_simulation") assert.equal(simulations, before, `no simulation past ${mode} boundary`);
      if (mode === "provider_simulation") assert.equal(result.RMTExactSimulationState, "NOT_RUN");
      assert.equal(JSON.stringify(result).includes("DO_NOT_OUTPUT"), false);
    }
    mode = "no_price"; const before = quoteCalls;
    assert.equal((await observePrivateZeroXCase(request())).firmStatus, "NOT_TESTED");
    assert.equal(quoteCalls, before, "no invented floor or firm retry");
    assert.equal(prevCalls, 0, "pause must never fall back to previous");
    assert.ok(priceCalls > quoteCalls - directQuoteCalls, "each observed firm has an indicative read; direct hook tests counted separately");
    assert.equal([...observedMethods].some(m => /send|sign|approve/i.test(m)), false);
    const cli = fileURLToPath(new URL("./private-zero-x-proof.ts", import.meta.url));
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval",
      `setInterval(() => {}, 1000); process.argv = [process.execPath, ${JSON.stringify(cli)}, '--execute-read-only']; await import(${JSON.stringify(new URL("./private-zero-x-proof.ts", import.meta.url).href)});`],
      { encoding: "utf8", timeout: 20_000, env: { NODE_ENV: "test", PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
    assert.equal(child.error, undefined, "CLI must terminate despite a pre-existing live handle");
    assert.equal(child.status, 1);
    assert.ok(validateProofJsonl(child.stdout));
    const records = child.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(records[0].status, "BLOCKED");
    assert.equal(records.at(-1).type, "PROOF_END");
    assert.equal(records.at(-1).status, "BLOCKED");
    console.log("Private 0x proof: actual adapter/verifier MOCKED_INTEGRATION and sanitization/configuration negatives passed; no live proof.");
  } finally {
    globalThis.fetch = savedFetch;
    for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
  }
}
void run();
