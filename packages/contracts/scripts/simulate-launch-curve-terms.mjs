import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const unit = 10n ** 18n;
const bps = 10_000n;
const q96 = 2n ** 96n;
const q192 = q96 ** 2n;
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
  if (value === 0n) return 0n;
  let root = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  while (true) {
    const next = (root + value / root) / 2n;
    if (next >= root) return root;
    root = next;
  }
}

function funding(backing) {
  const sqrtPrice = sqrt((virtualToken - soldAtGraduation) * q192 / (3n * backing));
  const intermediate = sqrtPrice * sqrtUpper / q96;
  const nativeLiquidity = backing * intermediate / (sqrtUpper - sqrtPrice);
  const tokenLiquidity = tokenAtGraduation * q96 / (sqrtPrice - sqrtLower);
  const liquidity = nativeLiquidity < tokenLiquidity ? nativeLiquidity : tokenLiquidity;
  const nativeUsed = amount0Delta(sqrtPrice, sqrtUpper, liquidity, true);
  const tokenUsed = amount1Delta(sqrtLower, sqrtPrice, liquidity, true);
  assert.ok(nativeUsed <= backing && tokenUsed <= tokenAtGraduation);
  return { sqrtPrice, liquidity, nativeUsed, tokenUsed, nativeDust: backing - nativeUsed,
    tokenDust: tokenAtGraduation - tokenUsed };
}

function amount0Delta(lower, upper, liquidity, roundUp = false) {
  const numerator = (liquidity << 96n) * (upper - lower);
  return roundUp ? ceilDiv(ceilDiv(numerator, upper), lower) : numerator / upper / lower;
}

function amount1Delta(lower, upper, liquidity, roundUp = false) {
  const numerator = liquidity * (upper - lower);
  return roundUp ? ceilDiv(numerator, q96) : numerator / q96;
}

function quoteOpeningSwap({ sqrtPrice, liquidity }, grossIn, direction) {
  const buy = direction === "buy";
  const netIn = grossIn * (bps - poolFeeBps) / bps;
  const liquidityQ96 = liquidity << 96n;
  const nextSqrtPrice = buy ? ceilDiv(liquidityQ96 * sqrtPrice, liquidityQ96 + netIn * sqrtPrice)
    : sqrtPrice + netIn * q96 / liquidity;
  assert.ok(nextSqrtPrice > sqrtLower && nextSqrtPrice < sqrtUpper);
  const amountOut = buy ? amount1Delta(nextSqrtPrice, sqrtPrice, liquidity) : amount0Delta(sqrtPrice, nextSqrtPrice, liquidity);
  const atSpot = buy ? grossIn * sqrtPrice ** 2n / q192 : grossIn * q192 / sqrtPrice ** 2n;
  const afterFeeAtSpot = buy ? netIn * sqrtPrice ** 2n / q192 : netIn * q192 / sqrtPrice ** 2n;
  return { direction, grossIn, netIn, inputFee: grossIn - netIn, amountOut, atSpot,
    shortfallBps: ceilDiv((atSpot - amountOut) * bps, atSpot),
    averagePriceImpactBpsExcludingFee: ceilDiv((afterFeeAtSpot - amountOut) * bps, afterFeeAtSpot),
    endPriceMoveBps: (sqrtPrice ** 2n - nextSqrtPrice ** 2n) * bps / nextSqrtPrice ** 2n, nextSqrtPrice };
}

function curveScenario(backingThreshold) {
  const virtualEth = 2n * backingThreshold;
  const requiredBacking = (sold) => ceilDiv(virtualEth * virtualToken, virtualToken - sold) - virtualEth;
  const empty = { sold: 0n, backing: 0n, grossBuys: 0n, grossSells: 0n, fees: 0n };
  const buy = (state, budget) => {
    const netBudget = budget * (bps - curveFeeBps) / bps;
    const target = state.backing + netBudget < backingThreshold ? state.backing + netBudget : backingThreshold;
    const sold = virtualToken - ceilDiv(virtualEth * virtualToken, virtualEth + target);
    const backing = requiredBacking(sold);
    assert.ok(sold >= state.sold && sold <= soldAtGraduation && backing >= state.backing && backing <= target);
    const netUsed = backing - state.backing;
    const grossUsed = ceilDiv(netUsed * bps, bps - curveFeeBps);
    const fee = grossUsed - netUsed;
    assert.ok(grossUsed <= budget);
    return { sold, backing, grossBuys: state.grossBuys + grossUsed, grossSells: state.grossSells, fees: state.fees + fee,
      lastTrade: { budget, tokens: sold - state.sold, grossUsed, fee, refund: budget - grossUsed } };
  };
  const sell = (state, tokens) => {
    assert.ok(tokens > 0n && tokens <= state.sold);
    const sold = state.sold - tokens;
    const backing = requiredBacking(sold);
    const grossReleased = state.backing - backing;
    const fee = ceilDiv(grossReleased * curveFeeBps, bps);
    const payout = grossReleased - fee;
    assert.ok(payout > 0n);
    return { sold, backing, grossBuys: state.grossBuys, grossSells: state.grossSells + grossReleased, fees: state.fees + fee,
      lastTrade: { tokens, grossReleased, fee, payout } };
  };
  const typicalBudget = unit / 20n;
  let distributed = empty;
  let buyCount = 0;
  while (distributed.sold < soldAtGraduation) {
    distributed = buy(distributed, typicalBudget);
    assert.ok(++buyCount <= 100);
  }
  const threshold = buy(empty, 5n * unit);
  const unwind = sell(threshold, threshold.sold);
  assert.equal(threshold.backing, backingThreshold);
  assert.equal(threshold.sold, soldAtGraduation);
  assert.equal(threshold.grossBuys + threshold.lastTrade.refund, 5n * unit);
  assert.equal(unwind.backing, 0n);
  assert.equal(unwind.sold, 0n);
  assert.equal(threshold.grossBuys - unwind.lastTrade.payout, unwind.fees);
  let repeatedReversal = empty;
  for (let i = 0; i < 50; i++) {
    repeatedReversal = buy(repeatedReversal, typicalBudget);
    repeatedReversal = sell(repeatedReversal, repeatedReversal.sold);
  }
  assert.equal(repeatedReversal.backing, 0n);
  assert.equal(repeatedReversal.sold, 0n);
  const nearlyFull = sell(threshold, 10_000n * unit);
  assert.ok(nearlyFull.backing < backingThreshold && nearlyFull.sold < soldAtGraduation);
  const rebuyAfterExit = buy(nearlyFull, unit);
  assert.equal(rebuyAfterExit.backing, backingThreshold);
  assert.equal(rebuyAfterExit.sold, soldAtGraduation);
  return { zeroActivity: empty, grossDemand: [unit / 2n, unit, 2n * unit, 5n * unit].map((budget) => buy(empty, budget)),
    distributed: { buyCount, typicalBudget, ...distributed }, threshold, fullPreGraduationUnwind: unwind,
    repeatedReversal: { cycles: 50, ...repeatedReversal }, sellBeforeGraduation: nearlyFull, rebuyAfterExit };
}

function fairValueScenario(opening, price) {
  const { sqrtPrice, liquidity } = opening;
  const feeComplement = bps - poolFeeBps;
  const fixedPrice = price.nativeWeiPerWholeToken !== undefined;
  const fairNumerator = fixedPrice ? price.nativeWeiPerWholeToken : q192 * price.fairToOpeningBps;
  const fairDenominator = fixedPrice ? unit : sqrtPrice ** 2n * bps;
  const reference = { ...price, fairNumerator, fairDenominator };
  const relativeNumerator = fairNumerator * sqrtPrice ** 2n;
  const relativeDenominator = fairDenominator * q192;
  // Price is ETH per token. Apply the fee-adjusted marginal no-arbitrage bounds before finding Q96 target.
  const buy = relativeNumerator * feeComplement > relativeDenominator * bps;
  const sell = relativeNumerator * bps < relativeDenominator * feeComplement;
  if (!buy && !sell) return { ...reference, direction: "none", grossNativeProfit: 0n };
  const targetSqrtPrice = sqrt(buy ? q192 * fairDenominator * bps / (fairNumerator * feeComplement)
    : q192 * fairDenominator * feeComplement / (fairNumerator * bps));
  const netIn = buy ? amount0Delta(targetSqrtPrice, sqrtPrice, liquidity, true)
    : amount1Delta(sqrtPrice, targetSqrtPrice, liquidity, true);
  const swap = quoteOpeningSwap(opening, ceilDiv(netIn * bps, feeComplement), buy ? "buy" : "sell");
  const nativeProfit = buy ? swap.amountOut * fairNumerator / fairDenominator - swap.grossIn
    : swap.amountOut - ceilDiv(swap.grossIn * fairNumerator, fairDenominator);
  assert.ok(nativeProfit >= 0n);
  const executionCostCases = [1n, 10n, 30n].map((gwei) => {
    // Hypothetical two-leg total used only for sensitivity. No external venue or execution path is assumed to exist.
    const gasWei = 300_000n * gwei * 10n ** 9n;
    return { gwei, gasWei, netNativeProfitBeforeOtherCosts: nativeProfit - gasWei };
  });
  return { ...reference, targetSqrtPrice, ...swap, grossNativeProfit: nativeProfit, executionCostCases };
}

function modeledLaunch(backing) {
  const virtualEth = 2n * backing;
  const opening = funding(backing);
  const grossToFill = ceilDiv(backing * bps, bps - curveFeeBps);
  const totalCurveFee = grossToFill - backing;
  const completeSellFee = ceilDiv(backing * curveFeeBps, bps);
  // Before graduation a single threshold buyer can unwind the entire fill. Fees and gas are the direct cost.
  const preGraduationExit = backing - completeSellFee;
  const roundTripCost = grossToFill - preGraduationExit;
  assert.equal(roundTripCost, totalCurveFee + completeSellFee);
  const typicalBudget = 5n * unit / 100n;
  // A single directional fill is a lower bound. Reversals and gas require additional flow.
  const typicalBuyerCount = ceilDiv(grossToFill, typicalBudget);
  const netAtDemand = (2n * unit) * (bps - curveFeeBps) / bps;
  const soldAtExampleDemand = netAtDemand >= backing ? soldAtGraduation :
    virtualToken - ceilDiv(virtualEth * virtualToken, virtualEth + netAtDemand);
  return { backing, virtualEth, virtualToken, soldAtGraduation, tokenAtGraduation, opening,
    grossToFill, totalCurveFee, preGraduationExit, roundTripCost, typicalBudget, typicalBuyerCount, exampleGrossDemand: 2n * unit,
    soldAtExampleDemand, exampleDemandGraduates: netAtDemand >= backing,
    openingBuys: [unit / 100n, unit / 10n, unit / 2n].map((input) => quoteOpeningSwap(opening, input, "buy")),
    openingSells: [4_000n, 40_000n, 200_000n].map((input) => quoteOpeningSwap(opening, input * unit, "sell")),
    curveDemand: curveScenario(backing),
    openingPrice: { nativePerTokenNumerator: q192, nativePerTokenDenominator: opening.sqrtPrice ** 2n,
      nativeWeiPerWholeToken: q192 * unit / opening.sqrtPrice ** 2n,
      impliedFullyDilutedNativeWei: q192 * supply / opening.sqrtPrice ** 2n },
    fairValueScenarios: [5_000n, 8_000n, 9_900n, 9_980n, 10_000n, 10_020n, 10_100n, 12_000n, 15_000n, 20_000n]
      .map((fairToOpeningBps) => fairValueScenario(opening, { fairToOpeningBps })),
    sharedFairValue: fairValueScenario(opening, { nativeWeiPerWholeToken: 5_000_000_000_000n }) };
}

function allocate(fees, treasuryShareBps = 2_000n) {
  assert.ok(treasuryShareBps >= 0n && treasuryShareBps <= 9_000n);
  const platform = fees / 10n;
  const operating = platform / 2n;
  const project = fees - platform;
  const treasury = project * treasuryShareBps / 9_000n;
  return { creator: project - treasury, treasury, operating, futureReserve: platform - operating };
}

const configurations = [unit, 2n * unit, 42n * unit / 10n].map(modeledLaunch);
assert.equal(configurations[0].opening.liquidity, 632455532033675866399n);
assert.equal(configurations[0].opening.nativeUsed, 999999999999999966n);
assert.equal(configurations[0].opening.tokenUsed, 399999999999999999999474n);
assert.ok(configurations[0].openingBuys[1].shortfallBps > configurations[1].openingBuys[1].shortfallBps);
assert.ok(configurations[1].openingBuys[1].shortfallBps > configurations[2].openingBuys[1].shortfallBps);
assert.deepEqual(configurations.map(({ curveDemand }) => curveDemand.distributed.buyCount), [21, 41, 85]);
assert.deepEqual(configurations.map(({ curveDemand }) => curveDemand.grossDemand[2].sold === soldAtGraduation), [true, false, false]);

const lpRevenue = [10n, 100n, 1000n].flatMap((volume) =>
  [10_000n, 2_500n, 500n, 0n].map((originalActiveShareBps) => {
    const nativeInputInCanonicalPool = volume * unit;
    const totalNativeFees = nativeInputInCanonicalPool * poolFeeBps / bps;
    const originalPositionNativeFees = totalNativeFees * originalActiveShareBps / bps;
    const recipients = allocate(originalPositionNativeFees);
    assert.equal(Object.values(recipients).reduce((sum, fee) => sum + fee, 0n), originalPositionNativeFees);
    return { nativeInputInCanonicalPool, totalNativeFees, originalActiveShareBps, originalPositionNativeFees, recipients };
  }));

// Measured on the pinned 4663 Task 019 fork with the 1 ETH review configuration.
const gasUnits = [1523044n, 1739882n];
const gasPricesGwei = [1n, 10n, 30n];
const graduationGas = gasUnits.map((units) => ({ units,
  executionCosts: gasPricesGwei.map((gasPriceGwei) => ({ gasPriceGwei, wei: units * gasPriceGwei * 10n ** 9n })) }));
const feeCollectionGasUnits = 560153n;
const nativeCollectionBreakEven = gasPricesGwei.flatMap((gasPriceGwei) =>
  [10_000n, 2_500n, 500n].map((activeShareBps) => {
    const gasCost = feeCollectionGasUnits * gasPriceGwei * 10n ** 9n;
    const nativeVolume = ceilDiv(gasCost * bps ** 2n, poolFeeBps * activeShareBps);
    return { gasPriceGwei, activeShareBps, gasCost, nativeVolume };
  }));

const { values } = parseArgs({ options: { "fork-evidence": { type: "string", multiple: true }, "gas-evidence": { type: "string" } } });
const verifiedForks = (values["fork-evidence"] ?? []).map((file) => {
  const evidence = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  assert.equal(evidence.manifest.chainId, 4663, "Only use the verified Robinhood profile as a fork comparison.");
  const selected = configurations.find(({ backing }) => backing === BigInt(evidence.terms.backingWei));
  assert.ok(selected, "Unexpected fork threshold.");
  const { graduation, atomicGraduation, v4Trades, lpFees, outsideLiquidity } = evidence;
  assert.equal(BigInt(evidence.creation.supply), supply, "Fork launch supply differs from the reference model.");
  assert.equal(BigInt(evidence.terms.virtualEthWei), selected.virtualEth);
  assert.equal(BigInt(evidence.terms.expectedThresholdTradeGross), selected.grossToFill);
  const { opening, openingBuys } = selected;
  for (const [name, expected] of Object.entries({
    sqrtPriceX96: opening.sqrtPrice, liquidity: opening.liquidity, nativeUsed: opening.nativeUsed,
    tokenUsed: opening.tokenUsed, nativeDust: opening.nativeDust, tokenDust: opening.tokenDust,
  })) assert.equal(BigInt(graduation[name]), expected, name + " must match the pinned fork receipt.");
  const firstBuy = openingBuys[1];
  assert.equal(BigInt(v4Trades.buy.amountIn), firstBuy.grossIn, "The first v4 swap must use the exact 0.10 ETH test input.");
  assert.equal(BigInt(v4Trades.buy.output), firstBuy.amountOut, "The exact opening quote must match official router settlement.");
  const sellInput = firstBuy.amountOut / 2n;
  const firstSell = quoteOpeningSwap({ ...opening, sqrtPrice: firstBuy.nextSqrtPrice }, sellInput, "sell");
  assert.equal(BigInt(v4Trades.sell.amountIn), sellInput, "The first v4 sell must spend half the acquired tokens.");
  assert.equal(BigInt(v4Trades.sell.output), firstSell.amountOut, "The post-buy sell quote must match official router settlement.");
  return { backingWei: selected.backing, source: file, compilerInputSha256: evidence.manifest.inputSha256, graduation,
    atomicGraduation, firstV4Buy: v4Trades.buy, firstV4Sell: v4Trades.sell, lpFees, outsideLiquidity };
});
assert.equal(new Set(verifiedForks.map(({ backingWei }) => backingWei)).size, verifiedForks.length, "Repeat one input per threshold.");

const treasuryShareBps = 2_000n;
const levels = [
  { name: "low", nativeInput: unit, tokenInput: 100_000n * unit },
  { name: "medium", nativeInput: 10n * unit, tokenInput: 1_000_000n * unit },
  { name: "high", nativeInput: 100n * unit, tokenInput: 10_000_000n * unit },
];
const activeShareCases = [10_000n, 5_000n, 2_500n, 500n, 0n];
const lpIncome = levels.flatMap(({ name, nativeInput, tokenInput }) => activeShareCases.map((activeShareBps) => {
  const asset = (grossInput) => {
    const poolFees = grossInput * poolFeeBps / bps;
    const originalFees = poolFees * activeShareBps / bps;
    const recipients = allocate(originalFees, treasuryShareBps);
    assert.equal(Object.values(recipients).reduce((sum, value) => sum + value, 0n), originalFees);
    return { grossInput, poolFees, originalFees, otherLiquidityFees: poolFees - originalFees, recipients };
  };
  return { name, activeShareBps, native: asset(nativeInput), token: asset(tokenInput) };
}));

const measuredFeeGas = verifiedForks.length ? verifiedForks.map(({ backingWei, lpFees }) => ({
  backingWei, collectGas: BigInt(lpFees.collected.gasUsed), claimGas: BigInt(lpFees.claim.gasUsed),
  nativeOnlyClaimGas: BigInt(lpFees.feeCosts.native.gasUsed), tokenOnlyClaimGas: BigInt(lpFees.feeCosts.token.gasUsed),
})) : [{ backingWei: unit, collectGas: feeCollectionGasUnits }];
const collectionCosts = measuredFeeGas.flatMap(({ backingWei, collectGas, claimGas, nativeOnlyClaimGas, tokenOnlyClaimGas }) =>
  gasPricesGwei.flatMap((gwei) => [0n, unit / 100_000n, unit / 10_000n].map((posterWei) => {
    const gasPriceWei = gwei * 10n ** 9n;
    const collectCost = collectGas * gasPriceWei + posterWei;
    const claimCost = (units) => units === undefined ? null : units * gasPriceWei + posterWei;
    const oneClaimCost = claimCost(claimGas);
    return { backingWei, gasPriceWei, posterWeiPerOperation: posterWei, collectCost, oneClaimCost,
      nativeOnlyClaimCost: claimCost(nativeOnlyClaimGas), tokenOnlyClaimCost: claimCost(tokenOnlyClaimGas),
      totalWithFourClaims: oneClaimCost === null ? null : collectCost + 4n * oneClaimCost };
  })));
const measuredCosts = [];
if (values["gas-evidence"]) {
  const evidence = JSON.parse(readFileSync(values["gas-evidence"], "utf8").replace(/^\uFEFF/, ""));
  assert.equal(evidence.chainId, 4663);
  assert.equal(evidence.endpoint, "https://rpc.mainnet.chain.robinhood.com/");
  assert.match(evidence.observationBlock.hash, /^0x[0-9a-f]{64}$/i);
  for (const observation of evidence.observations) {
    const backingWei = BigInt(observation.backingWei);
    const fork = verifiedForks.find((entry) => entry.backingWei === backingWei);
    assert.ok(fork && observation.compilerInputSha256 === fork.compilerInputSha256, "Live rate evidence must match a supplied exact fork.");
    const operationCost = (name) => {
      const operation = observation.operations.find((entry) => entry.name === name);
      const receipt = fork.lpFees.feeCosts[name];
      assert.equal(operation.transactionHash, receipt.transactionHash);
      assert.equal(operation.calldata, receipt.calldata);
      assert.equal(operation.gasUsed, receipt.gasUsed);
      const baseFee = BigInt(evidence.control.l2BaseFee);
      const posterWei = BigInt(operation.poster.gasUnits) * baseFee;
      assert.equal(BigInt(operation.poster.posterWei), posterWei);
      const combined = BigInt(operation.gasUsed) * baseFee + posterWei;
      assert.equal(BigInt(operation.combinedEstimateAtL2BaseFeeWei), combined);
      return combined;
    };
    const collectCost = operationCost("collection");
    const oneClaimCost = operationCost("combined");
    measuredCosts.push({ backingWei, gasPriceWei: BigInt(evidence.control.l2BaseFee), observationBlock: evidence.observationBlock,
      collectCost, oneClaimCost, nativeOnlyClaimCost: operationCost("native"), tokenOnlyClaimCost: operationCost("token"),
      totalWithFourClaims: collectCost + 4n * oneClaimCost });
  }
}
const breakEvenByShare = [...collectionCosts, ...measuredCosts].flatMap((cost) => activeShareCases.map((activeShareBps) => {
  const volumeForOriginalFees = (credit) => activeShareBps === 0n ? null
    : ceilDiv(ceilDiv(credit * bps, activeShareBps) * bps, poolFeeBps);
  // The floor-rounded 5% operating bucket first reaches x exactly at 20*x in cumulative fee credit.
  return { ...cost, activeShareBps, originalNativeOnlyVolume: volumeForOriginalFees(cost.collectCost),
    operatingNativeOnlyVolume: volumeForOriginalFees(20n * cost.collectCost),
    operatingWithOwnClaimNativeOnlyVolume: cost.nativeOnlyClaimCost === null ? null
      : volumeForOriginalFees(20n * (cost.collectCost + cost.nativeOnlyClaimCost)),
    combinedSystemNativeOnlyVolume: cost.totalWithFourClaims === null ? null : volumeForOriginalFees(cost.totalWithFourClaims) };
}));

const stressCadenceCost = collectionCosts.find(({ backingWei, gasPriceWei, posterWeiPerOperation }) =>
  backingWei === unit && gasPriceWei === 10n ** 10n && posterWeiPerOperation === 0n)
  ?? collectionCosts.find(({ gasPriceWei, posterWeiPerOperation }) => gasPriceWei === 10n ** 10n && posterWeiPerOperation === 0n);
const cadence = [stressCadenceCost, ...measuredCosts].flatMap((costCase) =>
  lpIncome.filter(({ activeShareBps }) => activeShareBps === 2_500n).map(({ name, activeShareBps, native, token }) => {
    const margin = 2n;
    const intervals = [1n, 7n, 30n, 90n].map((days) => {
      const observedNative = native.originalFees * days / 30n;
      const operatingNative = allocate(observedNative, treasuryShareBps).operating;
      return { days, originalNative: observedNative, originalToken: token.originalFees * days / 30n,
        operatingNative, originalCollectMargin: observedNative >= margin * costCase.collectCost,
        combinedSystemMargin: costCase.totalWithFourClaims === null ? null : observedNative >= margin * costCase.totalWithFourClaims,
        operatingCollectMargin: costCase.nativeOnlyClaimCost === null ? null
          : operatingNative >= margin * (costCase.collectCost + costCase.nativeOnlyClaimCost) };
    });
    return { name, activeShareBps, margin, costCase, intervals };
  }));

console.log(JSON.stringify({
  assumptions: [
    "Fixed 60% sold with 40% paired. Each comparison scales virtual ETH to twice its actual backing threshold.",
    "V4 quotes use full-range liquidity and exact integer opening math. The shortfall includes the 0.30% LP fee and price impact.",
    "Gross threshold flow assumes uninterrupted buying and excludes network fees. Actual demand, reversals, and fragmentation change timing and cost.",
    "LP revenue assumes a stated average active share and only native-side inputs on this exact PoolKey. Token-side fees accrue in tokens.",
    "Independent routers are equivalent only when they generate fees in this pool. Volume in any other pool contributes zero.",
    "Historical gas units come from Task 019 4663 review transactions and exclude L2 data fees. When supplied, current fork receipts supply separate execution units for fee operations.",
    "Arbitrage assumes infinite external liquidity at a hypothetical fixed fair price, one v4 range and no outside LP. No such external venue or executable opportunity is inferred.",
    "Fee cadence models a constant 30-day volume, no protocol fee, a fixed active share, and explicit hypothetical data-cost sensitivities. Native-only break-even assigns no credit to tokens of unknown realizable value.",
  ],
  ticks, supply, curveFeeBps, poolFeeBps, configurations, lpRevenue, graduationGas, nativeCollectionBreakEven,
  thresholds: configurations.map(({ backing, opening, curveDemand, openingPrice, openingBuys, openingSells, fairValueScenarios, sharedFairValue }) =>
    ({ backingWei: backing, opening, curveDemand, openingPrice, openingBuys, openingSells, fairValueScenarios, sharedFairValue })),
  forkComparisons: verifiedForks,
  lpFeePolicy: { treasuryShareBps, noTreasuryExample: allocate(10_000n, 0n), maximumTreasuryExample: allocate(10_000n, 9_000n),
    lpIncome, measuredFeeGas, collectionCosts, measuredCosts, breakEvenByShare, cadence },
}, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
