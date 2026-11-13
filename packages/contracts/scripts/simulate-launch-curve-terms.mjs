import assert from "node:assert/strict";

const unit = 10n ** 18n;
const bps = 10_000n;
const q96 = 2n ** 96n;
const supply = 1_000_000n * unit;
const curveFeeBps = 100n;
const poolFeeBps = 30n;
const soldAtGraduation = supply * 3n / 5n;
const tokenAtGraduation = supply - soldAtGraduation;
const virtualToken = supply * 9n / 5n;
const ticks = { lower: -887220, upper: 887220 };
// Pinned TickMath.getSqrtPriceAtTick results for the actual spacing-60 full-range ticks.
const sqrtLower = 4306310044n;
const sqrtUpper = 1457652066949847389969617340386294118487833376468n;

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

function sqrt(value) {
  let root = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  while (true) {
    const next = (root + value / root) / 2n;
    if (next >= root) return root;
    root = next;
  }
}

function funding(backing) {
  const sqrtPrice = sqrt((virtualToken - soldAtGraduation) * q96 ** 2n / (3n * backing));
  const intermediate = sqrtPrice * sqrtUpper / q96;
  const nativeLiquidity = backing * intermediate / (sqrtUpper - sqrtPrice);
  const tokenLiquidity = tokenAtGraduation * q96 / (sqrtPrice - sqrtLower);
  const liquidity = nativeLiquidity < tokenLiquidity ? nativeLiquidity : tokenLiquidity;
  const nativeUsed = ceilDiv(ceilDiv((liquidity << 96n) * (sqrtUpper - sqrtPrice), sqrtUpper), sqrtPrice);
  const tokenUsed = ceilDiv(liquidity * (sqrtPrice - sqrtLower), q96);
  assert.ok(nativeUsed <= backing && tokenUsed <= tokenAtGraduation);
  return { sqrtPrice, liquidity, nativeUsed, tokenUsed, nativeDust: backing - nativeUsed,
    tokenDust: tokenAtGraduation - tokenUsed };
}

function quoteOpeningBuy({ sqrtPrice, liquidity }, grossIn) {
  const netIn = grossIn * (bps - poolFeeBps) / bps;
  const liquidityQ96 = liquidity << 96n;
  const nextSqrtPrice = ceilDiv(liquidityQ96 * sqrtPrice, liquidityQ96 + netIn * sqrtPrice);
  assert.ok(nextSqrtPrice > sqrtLower);
  const amountOut = liquidity * (sqrtPrice - nextSqrtPrice) / q96;
  const atSpot = grossIn * sqrtPrice ** 2n / q96 ** 2n;
  return { grossIn, amountOut, atSpot, shortfallBps: ceilDiv((atSpot - amountOut) * bps, atSpot) };
}

function modeledLaunch(backing) {
  const virtualEth = 2n * backing;
  const opening = funding(backing);
  const grossToFill = ceilDiv(backing * bps, bps - curveFeeBps);
  const totalCurveFee = grossToFill - backing;
  const typicalBudget = 5n * unit / 100n;
  // A single directional fill is a lower bound. Reversals and gas require additional flow.
  const typicalBuyerCount = ceilDiv(grossToFill, typicalBudget);
  const netAtDemand = (2n * unit) * (bps - curveFeeBps) / bps;
  const soldAtExampleDemand = netAtDemand >= backing ? soldAtGraduation :
    virtualToken - ceilDiv(virtualEth * virtualToken, virtualEth + netAtDemand);
  return { backing, virtualEth, virtualToken, soldAtGraduation, tokenAtGraduation, opening,
    grossToFill, totalCurveFee, typicalBudget, typicalBuyerCount, exampleGrossDemand: 2n * unit,
    soldAtExampleDemand, exampleDemandGraduates: netAtDemand >= backing,
    openingBuys: [unit / 100n, unit / 10n, unit / 2n].map((input) => quoteOpeningBuy(opening, input)) };
}

function allocate(fees) {
  const platform = fees / 10n;
  const operating = platform / 2n;
  const project = fees - platform;
  const treasury = project * 2_000n / 9_000n;
  return { creator: project - treasury, treasury, operating, futureReserve: platform - operating };
}

const configurations = [unit, 2n * unit, 42n * unit / 10n].map(modeledLaunch);
assert.equal(configurations[0].opening.liquidity, 632455532033675866399n);
assert.equal(configurations[0].opening.nativeUsed, 999999999999999966n);
assert.equal(configurations[0].opening.tokenUsed, 399999999999999999999474n);
assert.ok(configurations[0].openingBuys[1].shortfallBps > configurations[1].openingBuys[1].shortfallBps);
assert.ok(configurations[1].openingBuys[1].shortfallBps > configurations[2].openingBuys[1].shortfallBps);

const lpRevenue = [10n, 100n, 1000n].flatMap((volume) =>
  [10_000n, 2_500n, 500n, 0n].map((originalActiveShareBps) => {
    const nativeInputInCanonicalPool = volume * unit;
    const totalNativeFees = nativeInputInCanonicalPool * poolFeeBps / bps;
    const originalPositionNativeFees = totalNativeFees * originalActiveShareBps / bps;
    const recipients = allocate(originalPositionNativeFees);
    assert.equal(Object.values(recipients).reduce((sum, fee) => sum + fee, 0n), originalPositionNativeFees);
    return { nativeInputInCanonicalPool, totalNativeFees, originalActiveShareBps, originalPositionNativeFees, recipients };
  }));

const gasUnits = [699765n, 916115n];
const gasPricesGwei = [1n, 10n, 30n];
const graduationGas = gasUnits.map((units) => ({ units,
  executionCosts: gasPricesGwei.map((gasPriceGwei) => ({ gasPriceGwei, wei: units * gasPriceGwei * 10n ** 9n })) }));

console.log(JSON.stringify({
  assumptions: [
    "Fixed 60% sold with 40% paired. Each comparison scales virtual ETH to twice its actual backing threshold.",
    "V4 quotes use full-range liquidity and exact integer opening math. The shortfall includes the 0.30% LP fee and price impact.",
    "Gross threshold flow assumes uninterrupted buying and excludes network fees. Actual demand, reversals, and fragmentation change timing and cost.",
    "LP revenue assumes a stated average active share and only native-side inputs on this exact PoolKey. Token-side fees accrue in tokens.",
    "Independent routers are equivalent only when they generate fees in this pool. Volume in any other pool contributes zero.",
    "Gas units come from the prior measured 4663 review transactions. Price cases exclude L2 data fees and are not forecasts.",
  ],
  ticks, supply, curveFeeBps, poolFeeBps, configurations, lpRevenue, graduationGas,
}, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
