import assert from "node:assert/strict";
import { getAddress, keccak256, stringToHex, zeroAddress, type PublicClient } from "viem";
import { marketSources } from "./sources.js";
import { readUpPoolEvidence } from "./up-enrichment.js";

const pool = getAddress("0x0000000000000000000000000000000000000010");
const gauge = getAddress("0x0000000000000000000000000000000000000020");
const fees = getAddress("0x0000000000000000000000000000000000000030");
const bribe = getAddress("0x0000000000000000000000000000000000000040");
const blockHash = keccak256(stringToHex("up-evidence-block"));
const upV2 = marketSources.find((source) => source.id === "up-v2")!;
const upCl = marketSources.find((source) => source.id === "up-cl")!;

function client(values: {
  registered?: boolean;
  gauge?: `0x${string}`;
  fee?: bigint;
}) {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "isPool") return values.registered ?? true;
      if (functionName === "gauges") return values.gauge ?? gauge;
      if (functionName === "getFee" || functionName === "fee") {
        return values.fee ?? 30n;
      }
      if (functionName === "isAlive") return true;
      if (functionName === "weights") return 400n;
      if (functionName === "claimable") return 25n;
      if (functionName === "gaugeToFees") return fees;
      if (functionName === "gaugeToBribe") return bribe;
      throw new Error(`unexpected function ${functionName}`);
    }
  } as unknown as PublicClient;
}

const v2Evidence = await readUpPoolEvidence(
  client({ gauge: zeroAddress, fee: 5n }),
  upV2,
  pool,
  true,
  100n,
  blockHash
);
assert.equal(v2Evidence.liveFee, 5);
assert.equal(v2Evidence.feeDenominator, 10_000);
assert.equal(v2Evidence.gaugeAddress, null);
assert.equal(v2Evidence.gaugeAlive, null);

const clEvidence = await readUpPoolEvidence(
  client({ fee: 10_000n }),
  upCl,
  pool,
  null,
  101n,
  blockHash
);
assert.equal(clEvidence.liveFee, 10_000);
assert.equal(clEvidence.feeDenominator, 1_000_000);
assert.equal(clEvidence.gaugeAddress, gauge.toLowerCase());
assert.equal(clEvidence.gaugeAlive, true);
assert.equal(clEvidence.gaugeWeight, "400");
assert.equal(clEvidence.gaugeClaimable, "25");

await assert.rejects(
  readUpPoolEvidence(client({ registered: false }), upV2, pool, false, 100n, blockHash),
  /no longer recognizes/
);
await assert.rejects(
  readUpPoolEvidence(client({ fee: 301n }), upV2, pool, false, 100n, blockHash),
  /outside the reviewed fee domain/
);
await assert.rejects(
  readUpPoolEvidence(client({}), upV2, pool, null, 100n, blockHash),
  /stable identity/
);
await assert.rejects(
  readUpPoolEvidence(client({}), upCl, pool, false, 100n, blockHash),
  /must not carry/
);

console.info("up market enrichment smoke passed");
