import assert from "node:assert/strict";
import { getAddress } from "viem";
import { fetchTokenRiskEvidence } from "./token-risk-evidence";

const token = getAddress("0xcC333d246c75C14B087561F39F8c6FEf958CE54f");
const pair = getAddress("0x247bC73e70EBDecf6221B1A6E0564580938C5FFE");
const creator = getAddress("0x99e6c2Ebc0E3D86210Cf257CEB98E146CA045E01");
const whale = getAddress("0xA4990d06e247d3741d0711DdC8C4f4C9369E1d20");
const zero = "0x0000000000000000000000000000000000000000";

function mockFetch(options: {
  tokenAddress?: string;
  contractStatus?: number;
  contract?: Record<string, unknown>;
  holders?: unknown[];
} = {}) {
  return async (input: string | URL) => {
    const url = input.toString();
    if (url.includes("/smart-contracts/")) {
      if (options.contractStatus === 404) return new Response("missing", { status: 404 });
      return Response.json(options.contract ?? {
        is_verified: true,
        proxy_type: null,
        implementations: [],
        is_changed_bytecode: false
      });
    }
    if (url.endsWith("/holders")) {
      return Response.json({
        items: options.holders ?? [
          { address: { hash: whale }, value: "80" },
          { address: { hash: pair }, value: "700" },
          { address: { hash: zero }, value: "100" },
          { address: { hash: creator }, value: "120" }
        ]
      });
    }
    return Response.json({
      address_hash: options.tokenAddress ?? token,
      holders_count: "92",
      total_supply: "1000"
    });
  };
}

async function main() {
  const evidence = await fetchTokenRiskEvidence(
    { token, pair, creator },
    {
      fetch: mockFetch(),
      readCreatorBalance: async () => 120n,
      now: () => Date.parse("2026-07-27T12:00:00.000Z")
    }
  );
  assert.equal(evidence.marketVerified, true);
  assert.equal(evidence.coverage, "complete");
  assert.equal(evidence.contract.sourcePublished, true);
  assert.equal(evidence.contract.isProxy, false);
  assert.equal(evidence.contract.bytecodeChanged, false);
  assert.equal(evidence.holders.count, 92);
  assert.equal(evidence.holders.poolShareBps, 7_000);
  assert.equal(evidence.holders.largestNonPoolHolder?.address, creator);
  assert.equal(evidence.holders.largestNonPoolHolder?.shareBps, 1_200);
  assert.equal(evidence.holders.creatorShareBps, 1_200);
  assert.match(evidence.warnings.join(" "), /non-pool address controls at least 10%/);
  assert.match(evidence.warnings.join(" "), /reported creator controls at least 10%/);
  assert.equal(evidence.checkedAt, "2026-07-27T12:00:00.000Z");

  const opaque = await fetchTokenRiskEvidence(
    { token, pair },
    {
      fetch: mockFetch({ contractStatus: 404 }),
      now: () => 0
    }
  );
  assert.equal(opaque.contract.sourcePublished, false);
  assert.equal(opaque.contract.isProxy, null);
  assert.match(opaque.warnings.join(" "), /source is not published/);

  const proxy = await fetchTokenRiskEvidence(
    { token, pair },
    {
      fetch: mockFetch({
        contract: {
          is_verified: true,
          proxy_type: "eip1967",
          implementations: [{}],
          is_changed_bytecode: true
        }
      })
    }
  );
  assert.equal(proxy.contract.isProxy, true);
  assert.equal(proxy.contract.bytecodeChanged, true);
  assert.match(proxy.warnings.join(" "), /differs from the published source/);
  assert.match(proxy.warnings.join(" "), /token is a proxy/);

  await assert.rejects(
    fetchTokenRiskEvidence(
      { token, pair },
      { fetch: mockFetch({ tokenAddress: whale }) }
    ),
    /different token/
  );
  await assert.rejects(
    fetchTokenRiskEvidence(
      { token, pair },
      { fetch: async () => new Response("down", { status: 503 }) }
    ),
    /unavailable/
  );

  console.log("Token risk evidence excludes pools, fails closed, and labels transparency without implying safety.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
