import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { POST } from "../../app/api/vnext/authorize/route";
import { VNEXT_DIRECT_NO_RMT_FEE } from "./execution-settlement";

export async function publicAuthorizationNegativeSmoke() {
  const savedScope = process.env.RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS;
  const savedEnabled = process.env.RMT_VNEXT_AUTHORIZATION_ENABLED;
  const savedFetch = globalThis.fetch;
  let externalRequests = 0;
  const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
  try {
    process.env.RMT_VNEXT_AUTHORIZATION_ENABLED = "true";
    globalThis.fetch = async () => { externalRequests++; throw new Error("No external access permitted in negative authorization fixture"); };
    for (const provider of ["sushi", "uniswap-v2", "uniswap-v3", "uniswap-v4", "uniswapx", "zero-x-gasless", "up-v2", "up-cl"]) {
      for (const scope of [provider, "zero-x-swap", "uniswap-v2,uniswap-v3", `${provider},zero-x-swap`]) {
        process.env.RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS = scope;
        const poolId = `0x${"1".repeat(64)}`;
        const body = {
          chainId: 4663, quoteRequestId: "11111111-1111-4111-8111-111111111111",
          verificationId: "22222222-2222-4222-8222-222222222222", provider,
          inputAsset: address(0), outputAsset: address(1), inputAmountAtomic: "1000000", recipient: address(2),
          expectedStatus: "verified", indicativeProtectedOutputFloorAtomic: "1", expectedProtectedOutputAtomic: "1",
          settlementMode: VNEXT_DIRECT_NO_RMT_FEE,
          ...(provider === "uniswap-v4" ? {
            canonicalMarket: { sourceId: "uniswap-v4", poolId },
            v4QuoteEvidence: { poolId, currency0: address(0), currency1: address(1), fee: 3000, tickSpacing: 60,
              hooks: address(0), recipient: address(2), observedBlock: "1", observedBlockHash: poolId,
              observedAtMs: 1, quotedAtMs: 1, expiresAtMs: 2 }
          } : {})
        };
        const response = await POST(new Request("http://localhost/api/vnext/authorize", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        }));
        const payload = await response.json();
        if (provider === "uniswapx" || provider === "zero-x-gasless") {
          assert.equal(response.status, 400, `${provider}: excluded by request schema`);
        } else if (scope.includes("zero-x-swap") && scope !== "zero-x-swap") {
          assert.equal(response.status, 503, `${provider}: mixed scope fails closed`);
          assert.equal(payload.code, "PROVIDER_SCOPE_INVALID");
        } else {
          assert.equal(response.status, 403, `${provider}: public authorization rejected`);
          assert.equal(payload.code, "PROVIDER_QUOTE_ONLY");
        }
        if (response.status !== 400) {
          assert.equal(payload.stage, "authorization");
          assert.equal(payload.phase, "ZEROX_POLICY_REJECTED");
          assert.equal(payload.retryable, false);
        }
        assert.equal(payload.plan, undefined);
      }
    }
    assert.equal(externalRequests, 0, "No identity, authentication discovery, provider or wallet network calls");
    const banner = readFileSync(new URL("../../app/vnext/vnext-execution-recovery-banner.tsx", import.meta.url), "utf8");
    assert.match(banner, /Approval transaction confirmed/);
    assert.match(banner, /must verify the current allowance/);
    assert.doesNotMatch(banner, /Exact approval confirmed|The exact allowance is confirmed/);
    console.log("32 actual authorize-route negative controls passed; approval receipt wording does not assert allowance.");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedScope === undefined) delete process.env.RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS;
    else process.env.RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS = savedScope;
    if (savedEnabled === undefined) delete process.env.RMT_VNEXT_AUTHORIZATION_ENABLED;
    else process.env.RMT_VNEXT_AUTHORIZATION_ENABLED = savedEnabled;
  }
}
