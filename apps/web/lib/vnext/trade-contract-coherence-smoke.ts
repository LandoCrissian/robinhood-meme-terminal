import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { getAddress, toFunctionSelector } from "viem";
import { requireZeroXDeployment } from "../server/vnext-zero-x-deployment-authority";
import { TradeExecutionFailure, executionFailureResponse, responseTradeFailure } from "./trade-failure";
import { revalidateAfterApproval } from "./trade-journey";
import { clearTradeQuoteCache, requestTradeQuote, tradeQuoteFailureFromResponse } from "../trade-quote-client";
import { currentTradeEvidence } from "./current-trade-evidence";
import { createVNextExecutionIdentityAuthority } from "../server/vnext-execution-identity-authority";

const fixture = createRequire(import.meta.url)("../../../../.github/scripts/zerox-execution-fixture.cjs");
const target = getAddress(fixture.settler);
const other = getAddress("0x" + "1".repeat(40));
const word = (address: string) => "0x" + address.slice(2).toLowerCase().padStart(64, "0");
const prevSelector = toFunctionSelector("prev(uint128)");

async function main() {
  for (const mode of ["current", "previous", "paused", "unregistered", "incompatible", "malformed"] as const) {
    let previousReads = 0;
    const rpc = async (method: string, params: unknown[]): Promise<unknown> => {
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_blockNumber") return "0x1234";
      assert.equal(params[1], "0x1234", "Registry and runtime use one block");
      if (method === "eth_getCode") return mode === "incompatible" ? "0x6000" : fixture.runtime;
      const previous = (params[0] as { data: string }).data.startsWith(prevSelector);
      if (previous) previousReads++;
      if (mode === "paused" && !previous) throw new Error("Controlled registry revert");
      if (mode === "malformed") return "0x01";
      return word(mode === "unregistered" || (mode === "previous" && !previous) ? other : target);
    };
    if (mode === "current" || mode === "previous") {
      await requireZeroXDeployment(target, rpc);
      await requireZeroXDeployment(target, rpc, "authorization");
    } else {
      await assert.rejects(requireZeroXDeployment(target, rpc), (error: unknown) => error instanceof TradeExecutionFailure && error.retryable === false);
    }
    if (mode === "paused") assert.equal(previousReads, 0, "Previous deployment cannot bypass pause");
  }

  const rejection = new TradeExecutionFailure("CONTRACT_VERSION_UNSUPPORTED");
  const response = executionFailureResponse(rejection, "verification")!;
  const payload = await response.json();
  const client = tradeQuoteFailureFromResponse({ ok: false, status: 422, payload, attempts: 1, latencyMs: 0, stage: "verification" })!;
  assert.equal(client.phase, "FIRM_VERIFY_FAILED");
  assert.equal(client.failure?.code, "CONTRACT_VERSION_UNSUPPORTED");
  assert.equal(client.retryable, false);
  let preparations = 0;
  await assert.rejects(revalidateAfterApproval({ current: () => true, onRetry: () => assert.fail("Permanent rejection retried"),
    attempt: async () => { preparations++; throw client; } }));
  assert.equal(preparations, 1);
  let transient = 0;
  await revalidateAfterApproval({ current: () => true, onRetry: () => {}, wait: async () => {},
    attempt: async () => { if (++transient < 4) throw new TradeExecutionFailure("PROVIDER_UNAVAILABLE"); return true; } });
  assert.equal(transient, 4);
  const originalFetch = globalThis.fetch;
  try {
    for (const [status, expected] of [[422, 1], [503, 3]] as const) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return Response.json({ error: "Fixture" }, { status }); };
      clearTradeQuoteCache();
      await requestTradeQuote("/api/vnext/verify", {}, { maxAttempts: 3, retryDelayMs: 0 });
      assert.equal(calls, expected, "HTTP transport retry is separate from application recovery");
    }
  } finally { globalThis.fetch = originalFetch; clearTradeQuoteCache(); }
  assert.equal(responseTradeFailure({}, 401, "verification").phase, "AUTHENTICATION_FAILED");
  assert.equal(responseTradeFailure({ phase: "IDENTITY_CONFLICT" }, 409, "verification").retryable, false);
  assert.equal(responseTradeFailure({ phase: "IDENTITY_UNAVAILABLE" }, 422, "verification").retryable, true);

  const evidence = { chainId: 4663, provider: "zero-x-swap", recipient: target, inputAsset: target, outputAsset: other,
    inputAmountAtomic: "1", protectedOutputAtomic: "2", verificationId: "verify", sourceQuoteRequestId: "quote", expiresAtMs: 200 };
  const plan = { ...evidence, sourceVerificationId: "verify" };
  const context = { published: "A", current: "A", wallet: target, input: target, output: other, amount: "1", now: 100 };
  const visible = (e: unknown, p: unknown, c = context) => currentTradeEvidence(e as any, p as any, c);
  assert.equal(visible(evidence, plan), evidence);
  assert.equal(visible(evidence, undefined), undefined);
  for (const change of [{ current: "B" }, { wallet: other }, { amount: "3" }, { now: 201 }]) assert.equal(visible(evidence, plan, { ...context, ...change }), undefined);
  assert.equal(visible(evidence, { ...plan, sourceQuoteRequestId: "old" }), undefined);
  assert.equal(visible(evidence, { ...plan, protectedOutputAtomic: "1" }), undefined);

  // Fresh authority instances: diagnose exact-token hydration, not directory visibility.
  const peep = getAddress(["0xf0821f2b", "f570ca4e", "7499a9ed", "9db7c788", "fed9946f"].join(""));
  for (const mode of ["durable", "missing", "transport", "malformed"] as const) {
    let liveCalls = 0;
    const authority = createVNextExecutionIdentityAuthority({
      readInventory: (async (query: { token?: string }) => {
        assert.equal(query.token?.toLowerCase(), peep.toLowerCase());
        if (mode === "transport") throw new Error("Controlled transport failure");
        return { status: "verified_shadow", chainId: 4663, sourceManifestHash: "0x" + "a".repeat(64),
          pools: [{ token0: peep.toLowerCase(), token1: other.toLowerCase() }],
          browseIdentities: { source: mode === "malformed" ? "untrusted" : "verified-token-identity-index", freshness: "last-known",
            identities: mode === "missing" ? [] : [{ address: peep.toLowerCase(), name: "PEEP", symbol: "PEEP", decimals: 18 }] } };
      }) as any,
      readLive: async () => { liveCalls++; throw new Error("Controlled live metadata failure"); }
    });
    const native = await authority.read(getAddress("0x" + "0".repeat(40)));
    assert.equal(native?.provenance, "robinhood-native-asset");
    assert.equal(liveCalls, 0);
    const identity = await authority.read(peep);
    assert.equal(identity?.provenance ?? null, mode === "durable" ? "verified-token-identity-index" : null);
    assert.equal(liveCalls, mode === "durable" ? 0 : 1);
    if (mode === "durable") {
      authority.blockOnPositiveConflict(peep, "decimals_conflict");
      await assert.rejects(authority.read(peep), /conflicts/);
    }
  }
  console.info("Contract/coherence: registry, runtime, transport/application retries, current economics, cold identity PASS; real wallet calls 0");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
