import assert from "node:assert/strict";
import "./server/lemon-project-feed-smoke";
import "./server/sushi-launch-feed-smoke";
import {
  externalProjectProvenanceDescription,
  externalProjectProvenanceLabel,
  selectPreferredLifecycleMarket
} from "./external-market";
import { isNonzeroEvmAddress, selectExternalPairBaseToken } from "./external-market-identity";
import {
  marketDistributionPassport,
  UNISWAP_LAUNCHES_ANNOUNCEMENT_URL,
  UNISWAP_LAUNCHPAD_DEPLOYMENTS_URL
} from "./launch-distribution";

const syntheticAddress = (character: string) => ("0x" + character.repeat(40)) as `0x${string}`;
const zero = { address: "0x0000000000000000000000000000000000000000", name: "Ether" };
const wrappedNative = { address: syntheticAddress("a"), name: "Wrapped Ether" };
const external = { address: syntheticAddress("b"), name: "External token" };
const excluded = new Set([wrappedNative.address.toLowerCase()]);

assert.equal(isNonzeroEvmAddress(zero.address), false, "The native zero-address sentinel is not an ERC-20 trade target");
assert.equal(isNonzeroEvmAddress(external.address), true);
assert.equal(isNonzeroEvmAddress("0x1234"), false);
assert.equal(isNonzeroEvmAddress("NATIVE"), false);

assert.equal(
  selectExternalPairBaseToken(external, wrappedNative, excluded),
  external,
  "An eligible external base quoted against a canonical market asset may be ranked"
);
assert.equal(
  selectExternalPairBaseToken(zero, external, excluded),
  undefined,
  "A zero-address base must not transfer its price and valuation metrics to the quote token"
);
assert.equal(
  selectExternalPairBaseToken(wrappedNative, external, excluded),
  undefined,
  "A canonical base must not transfer its price and valuation metrics to an external quote token"
);
assert.equal(
  selectExternalPairBaseToken({ address: "not-an-address", name: "Malformed" }, wrappedNative, excluded),
  undefined,
  "Malformed base-token metadata must fail closed"
);
assert.equal(
  selectExternalPairBaseToken(external, { address: syntheticAddress("c"), name: "Unknown quote" }, excluded),
  undefined,
  "An unrecognized quote asset must fail closed"
);

const curveMarket = {
  venue: {
    kind: "external-launchpad",
    sourceId: "circus",
    market: syntheticAddress("b"),
    execution: "read-only"
  } as const,
  liquidityUsd: 50_000,
  momentumScore: 99,
  pairAddress: syntheticAddress("c")
};
const dexMarket = {
  venue: {
    kind: "dex",
    dexId: "uniswap",
    pairAddress: syntheticAddress("d"),
    url: "https://dexscreener.com/robinhood/" + syntheticAddress("d"),
    execution: "read-only"
  } as const,
  liquidityUsd: 5_000,
  momentumScore: 40,
  pairAddress: syntheticAddress("d")
};
assert.equal(
  selectPreferredLifecycleMarket(curveMarket, dexMarket),
  dexMarket,
  "A DEX market must replace a stale curve record after graduation"
);
assert.equal(
  selectPreferredLifecycleMarket(dexMarket, curveMarket),
  dexMarket,
  "A delayed curve snapshot must never replace a discovered DEX market"
);

const lemonProject = {
  sourceId: "lemon",
  sourceName: "Lemon",
  provenance: "public-api-and-dex-pool-cross-checked",
  creator: syntheticAddress("d"),
  launchPool: syntheticAddress("e"),
  name: "Lemon project",
  symbol: "LEMON",
  description: "",
  imageUri: null,
  socials: { x: null, telegram: null, discord: null, website: null, farcaster: null }
} as const;
assert.equal(
  externalProjectProvenanceLabel(lemonProject),
  "Lemon · API + DEX pool matched",
  "Lemon identity must not be described as factory-derived"
);
assert.match(
  externalProjectProvenanceDescription(lemonProject),
  /documented public API.*token and launch pool match the live DEX pair/,
  "Lemon provenance disclosure must state the actual cross-check boundary"
);

const ponsUniswapMarket = {
  ...dexMarket,
  address: external.address,
  name: "Pons market",
  symbol: "PONS",
  dexId: "uniswap-v3",
  project: {
    ...lemonProject,
    sourceId: "pons",
    sourceName: "Pons",
    provenance: "factory-and-token-cross-checked"
  },
  origin: { kind: "external", state: "unknown", coverage: "unavailable" },
  url: "https://dexscreener.com/robinhood/" + dexMarket.pairAddress
} as unknown as Parameters<typeof marketDistributionPassport>[0];
const ponsPassport = marketDistributionPassport(ponsUniswapMarket);
assert.equal(ponsPassport.venue, "uniswap");
assert.equal(ponsPassport.state, "recognized-source-market");
assert.equal(ponsPassport.isAttributedLaunch, true);
assert.match(ponsPassport.summary, /Individual beta-feed inclusion is not independently confirmed/);
assert.equal(ponsPassport.steps[0]?.tone, "verified");
assert.equal(ponsPassport.steps[1]?.tone, "verified");
assert.equal(ponsPassport.steps[2]?.tone, "candidate");
assert.equal(ponsPassport.steps[2]?.evidenceUrl, UNISWAP_LAUNCHES_ANNOUNCEMENT_URL);
assert.match(UNISWAP_LAUNCHPAD_DEPLOYMENTS_URL, /developers\.uniswap\.org/);

const unattributedPassport = marketDistributionPassport({
  ...ponsUniswapMarket,
  project: undefined
});
assert.equal(unattributedPassport.state, "market-live");
assert.equal(unattributedPassport.isAttributedLaunch, false);
assert.match(unattributedPassport.steps[0]?.detail ?? "", /does not prove which platform created the token/);
assert.match(unattributedPassport.steps[2]?.detail ?? "", /does not by itself prove inclusion/);

const sushiPassport = marketDistributionPassport({
  ...ponsUniswapMarket,
  dexId: "sushiswap-v3",
  venue: {
    kind: "dex",
    dexId: "sushiswap-v3",
    pairAddress: ponsUniswapMarket.pairAddress,
    url: ponsUniswapMarket.url,
    execution: "read-only"
  }
});
assert.equal(sushiPassport.venue, "sushi");
assert.equal(sushiPassport.state, "announced-watch");
assert.match(sushiPassport.steps[2]?.detail ?? "", /documented launch record and pool agree/);

const verifiedSushiLaunchPassport = marketDistributionPassport({
  ...ponsUniswapMarket,
  dexId: "sushiswap-v3",
  project: {
    ...lemonProject,
    sourceId: "sushi",
    sourceName: "Sushi Launch"
  },
  venue: {
    kind: "dex",
    dexId: "sushiswap-v3",
    pairAddress: ponsUniswapMarket.pairAddress,
    url: ponsUniswapMarket.url,
    execution: "read-only"
  }
});
assert.equal(verifiedSushiLaunchPassport.state, "recognized-source-market");
assert.equal(verifiedSushiLaunchPassport.shortLabel, "Sushi Launch verified");
assert.equal(verifiedSushiLaunchPassport.steps[2]?.tone, "verified");
assert.match(verifiedSushiLaunchPassport.steps[2]?.detail ?? "", /does not imply a partnership/);

console.info("External market address integrity validation passed");
