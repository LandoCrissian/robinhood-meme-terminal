import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress, zeroAddress, type Address } from "viem";
import {
  prepareVNextProviderAuthorization,
  quoteVNextExecutionProviders,
  verifyVNextExecutionProvider,
  type VNextProviderQuoteRequest
} from "../server/vnext-provider-adapter";
import { createVNextUpAdapters, configuredVNextUpAdapters } from "../server/vnext-up-adapter";
import {
  UP_CL_FACTORY, UP_CL_QUOTER, UP_V2_FACTORY, UP_V2_ROUTER,
  quoteUpCl, quoteUpV2, type UpClRouteLeg, type UpQuoteReader, type UpV2RouteLeg
} from "../server/vnext-up-quote";

const inputAsset = getAddress("0x1111111111111111111111111111111111111111");
const outputAsset = getAddress("0x2222222222222222222222222222222222222222");
const weth = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const recipient = getAddress("0x3333333333333333333333333333333333333333");
const directPool = getAddress("0x4444444444444444444444444444444444444444");
const firstHopPool = getAddress("0x5555555555555555555555555555555555555555");
const secondHopPool = getAddress("0x6666666666666666666666666666666666666666");
const snapshot = {
  blockNumber: 34_716_350n,
  blockHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const
};

const key = (a: Address, b: Address) => `${a.toLowerCase()}:${b.toLowerCase()}`;
const knownPools = new Map([
  [key(inputAsset, outputAsset), directPool],
  [key(inputAsset, weth), firstHopPool],
  [key(weth, outputAsset), secondHopPool]
]);

let v2Verified = 0;
let clVerified = 0;
const reader: UpQuoteReader = {
  async snapshot() { return snapshot; },
  async confirmSnapshot(value) { assert.deepEqual(value, snapshot); },
  async verifyV2() { v2Verified += 1; },
  async verifyCl() { clVerified += 1; },
  async v2Pool(tokenA, tokenB, stable) { return stable ? zeroAddress : knownPools.get(key(tokenA, tokenB)) ?? zeroAddress; },
  async v2PoolRecognized(pool) { return pool !== zeroAddress; },
  async v2Fee(pool) { return pool === directPool ? 30n : 20n; },
  async v2AmountsOut(amountIn, legs) {
    return legs.length === 1 ? [amountIn, 1_000n] : [amountIn, 1_050n, 1_100n];
  },
  async clTickSpacings() { return [1, 60]; },
  async clPool(tokenA, tokenB, tickSpacing) {
    if (tickSpacing !== 60) return zeroAddress;
    return knownPools.get(key(tokenA, tokenB)) ?? zeroAddress;
  },
  async clPoolRecognized(pool) { return pool !== zeroAddress; },
  async clFee(pool) { return pool === directPool ? 500 : 300; },
  async clAmountOut(_amountIn, legs) { return legs.length === 1 ? 1_200n : 1_250n; }
};

const request: VNextProviderQuoteRequest = {
  chainId: 4_663,
  inputAsset,
  outputAsset,
  inputAmountAtomic: "1000000",
  amountIn: 1_000_000n,
  recipient,
  inputIdentity: { address: inputAsset, symbol: "IN", decimals: 6 },
  outputIdentity: { address: outputAsset, symbol: "OUT", decimals: 18 }
};

async function run() {
  const v2 = await quoteUpV2(request, reader);
  assert(v2);
  assert.equal(v2Verified, 1);
  assert.equal(v2.routeKind, "weth_hop");
  assert.equal(v2.amountOut, 1_100n);
  assert.equal(v2.protectedAmountOut, 1_089n);
  assert.deepEqual(v2.legs.map((leg) => (leg as UpV2RouteLeg).fee), [20, 20]);

  const cl = await quoteUpCl(request, reader);
  assert(cl);
  assert.equal(clVerified, 1);
  assert.equal(cl.routeKind, "weth_hop");
  assert.equal(cl.amountOut, 1_250n);
  assert.equal(cl.protectedAmountOut, 1_237n);
  assert.deepEqual(cl.legs.map((leg) => (leg as UpClRouteLeg).tickSpacing), [60, 60]);

  const adapters = createVNextUpAdapters({
    async quoteV2() { return v2; },
    async quoteCl() { return cl; }
  });
  const attempts = await quoteVNextExecutionProviders(request, [adapters.v2, adapters.cl]);
  assert.deepEqual(attempts.map((attempt) => attempt.provider), ["up-v2", "up-cl"]);
  assert(attempts.every((attempt) => attempt.status === "indicative"));
  assert(attempts.every((attempt) => attempt.providerFamily === "up"));
  assert(attempts.every((attempt) => attempt.strictVerificationAvailable === true));
  assert(attempts.every((attempt) => attempt.authorizationReady === false));
  assert.deepEqual(attempts[0].liquidityFeeEvidence.map((evidence) => evidence.denominator), [10_000, 10_000]);
  assert.deepEqual(attempts[0].liquidityFeeEvidence.map((evidence) => evidence.stable), [false, false]);
  assert.deepEqual(attempts[1].liquidityFeeEvidence.map((evidence) => evidence.denominator), [1_000_000, 1_000_000]);
  assert.deepEqual(attempts[1].liquidityFeeEvidence.map((evidence) => evidence.tickSpacing), [60, 60]);
  assert(attempts.every((attempt) => attempt.liquidityFeeEvidence.every((evidence) => evidence.observedBlock === snapshot.blockNumber.toString())));
  assert.equal(adapters.v2.capabilities.strictVerification, true);
  assert.equal(adapters.v2.capabilities.walletAuthorization, true);
  assert.equal(adapters.cl.capabilities.strictVerification, true);
  assert.equal(adapters.cl.capabilities.walletAuthorization, true);

  const poisoned = createVNextUpAdapters({
    async quoteV2() {
      return { ...v2, legs: [{ ...(v2.legs[0] as UpV2RouteLeg), fee: 10_001 }] };
    },
    async quoteCl() { return cl; }
  });
  assert.equal((await quoteVNextExecutionProviders(request, [poisoned.v2]))[0].status, "invalid_response");
  await assert.rejects(() => quoteUpV2(request, {
    ...reader,
    async confirmSnapshot() { throw new Error("up. quote block was reorganized."); }
  }), /reorganized/);

  const previousV2 = process.env.RMT_VNEXT_UP_V2_OBSERVATION_ENABLED;
  const previousCl = process.env.RMT_VNEXT_UP_CL_OBSERVATION_ENABLED;
  delete process.env.RMT_VNEXT_UP_V2_OBSERVATION_ENABLED;
  delete process.env.RMT_VNEXT_UP_CL_OBSERVATION_ENABLED;
  assert.deepEqual(configuredVNextUpAdapters(), []);
  process.env.RMT_VNEXT_UP_V2_OBSERVATION_ENABLED = "true";
  assert.deepEqual(configuredVNextUpAdapters().map((adapter) => adapter.provider), ["up-v2"]);
  process.env.RMT_VNEXT_UP_CL_OBSERVATION_ENABLED = "true";
  assert.deepEqual(configuredVNextUpAdapters().map((adapter) => adapter.provider), ["up-v2", "up-cl"]);
  if (previousV2 === undefined) delete process.env.RMT_VNEXT_UP_V2_OBSERVATION_ENABLED;
  else process.env.RMT_VNEXT_UP_V2_OBSERVATION_ENABLED = previousV2;
  if (previousCl === undefined) delete process.env.RMT_VNEXT_UP_CL_OBSERVATION_ENABLED;
  else process.env.RMT_VNEXT_UP_CL_OBSERVATION_ENABLED = previousCl;

  assert.equal(UP_V2_FACTORY, getAddress("0xFA5429AEBa338BEa2BFcc1b9a889862Ee395bc28"));
  assert.equal(UP_V2_ROUTER, getAddress("0xf5198743240fAC98db71868F34c70139b1eb0474"));
  assert.equal(UP_CL_FACTORY, getAddress("0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3"));
  assert.equal(UP_CL_QUOTER, getAddress("0x03983AB2C057a2eac211ff01738a1e49ff325B49"));
  const adapterSource = readFileSync(new URL("../server/vnext-up-adapter.ts", import.meta.url), "utf8");
  const quoteSource = readFileSync(new URL("../server/vnext-up-quote.ts", import.meta.url), "utf8");
  assert.match(quoteSource, /tickSpacing/);
  assert.match(adapterSource, /RMT_VNEXT_UP_V2_AUTHORIZATION_ENABLED/);
  assert.match(adapterSource, /RMT_VNEXT_UP_CL_AUTHORIZATION_ENABLED/);
  assert.match(adapterSource, /prepareAuthorization/);
  assert.doesNotMatch(adapterSource, /sendTransaction|writeContract|signTypedData/);
  assert.doesNotMatch(quoteSource, /sendTransaction|writeContract|signTypedData|privateKey/);
  console.log("RMT VNext up v2 and Slipstream observation adapter smoke checks passed.");
}

run().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
