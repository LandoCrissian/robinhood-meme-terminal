import assert from "node:assert/strict";

const wei = 10n ** 18n;
const bps = 10_000n;
const ceilDiv = (amount, denominator) => (amount + denominator - 1n) / denominator;
const min = (left, right) => left < right ? left : right;

function simulate({ supply, thresholdBps, feeBps, operatingBps, reserveBps, trades }) {
  const total = supply * wei;
  const maximumSold = total * thresholdBps / bps;
  const virtualEth = 2n * wei;
  // A full-range match at the terminal spot needs
  // remaining = sold * (virtualToken - sold) / virtualToken.
  const pairingPossible = 2n * maximumSold > total;
  const virtualToken = pairingPossible ? maximumSold ** 2n / (2n * maximumSold - total) : total * 18n / 10n;
  const invariant = virtualEth * virtualToken;
  const backing = (sold) => ceilDiv(invariant, virtualToken - sold) - virtualEth;
  const maxBacking = backing(maximumSold);
  const fees = { gross: 0n, operating: 0n, reserve: 0n, treasury: 0n, creator: 0n };
  const treasuryBps = 2_000n;
  let sold = 0n;
  let actualEth = 0n;
  let turnover = 0n;
  let refunded = 0n;
  let settled = 0;
  let blocked = 0;
  for (const [side, amount] of trades) {
    let gross, nextSold, charged;
    if (side === "buy") {
      const usable = amount * (bps - feeBps) / bps;
      nextSold = min(maximumSold, virtualToken - ceilDiv(invariant, virtualEth + actualEth + usable));
      if (nextSold <= sold) { blocked++; continue; }
      const net = backing(nextSold) - actualEth;
      if (net === 0n) { blocked++; continue; }
      gross = ceilDiv(net * bps, bps - feeBps);
      charged = gross - net;
      assert.ok(gross <= amount);
      refunded += amount - gross;
    } else {
      const tokens = sold * amount / bps;
      nextSold = sold - tokens;
      gross = actualEth - backing(nextSold);
      charged = ceilDiv(gross * feeBps, bps);
      if (tokens === 0n || gross <= charged) { blocked++; continue; }
      assert.ok(gross <= actualEth);
    }
    turnover += gross;
    fees.gross += charged;
    const platformBps = operatingBps + reserveBps;
    const platform = fees.gross * platformBps / bps;
    const project = fees.gross - platform;
    fees.operating = platformBps === 0n ? 0n : platform * operatingBps / platformBps;
    fees.reserve = platform - fees.operating;
    fees.treasury = project * treasuryBps / (bps - platformBps);
    fees.creator = project - fees.treasury;
    settled++;
    actualEth = backing(nextSold);
    sold = nextSold;
    assert.ok(actualEth >= 0n && actualEth <= maxBacking);
    assert.equal(fees.operating + fees.reserve + fees.treasury + fees.creator, fees.gross);
  }

  const remaining = total - sold;
  const virtualQuote = virtualEth + actualEth;
  const virtualInventory = virtualToken - sold;
  const neededTokens = actualEth * virtualInventory / virtualQuote;
  const graduation = sold === maximumSold;
  return {
    supply, thresholdBps, feeBps, operatingBps, reserveBps, settled, blocked,
    thresholdBackingWei: maxBacking, actualBackingWei: actualEth, soldAtomic: sold, remainingAtomic: remaining,
    turnoverWei: turnover, refundedWei: refunded, feesWei: fees, graduation, theoreticalTerminalPairingPossible: pairingPossible,
    ...(graduation ? { theoreticalFullRangeMatchingTokenAtomic: neededTokens,
      availableTokenDifferenceAtomic: remaining - neededTokens } : {}),
  };
}

function positionRevenue({ volume, lpFeeBps, positionShareBps, distributionBps }) {
  const totalPoolFees = volume * lpFeeBps / bps;
  const positionEarnings = totalPoolFees * positionShareBps / bps;
  return { volume, totalPoolFees, positionEarnings, modeledRecipientEarnings: positionEarnings * distributionBps / bps };
}

const draftPath = [["buy", wei / 10n], ["buy", wei / 4n], ["sell", 2_000n], ["buy", 3n * wei]];
const scenarios = [
  { name: "zero activity", supply: 1_000_000n, thresholdBps: 6_000n, feeBps: 100n, operatingBps: 500n, reserveBps: 500n, trades: [] },
  { name: "curve V1", supply: 1_000_000n, thresholdBps: 6_000n, feeBps: 100n, operatingBps: 500n, reserveBps: 500n, trades: draftPath },
  { name: "higher supply and fee", supply: 10_000_000n, thresholdBps: 6_000n, feeBps: 200n, operatingBps: 750n, reserveBps: 750n, trades: draftPath },
  { name: "higher threshold alternative", supply: 100_000_000n, thresholdBps: 7_500n, feeBps: 75n, operatingBps: 500n, reserveBps: 0n, trades: draftPath },
  { name: "lower threshold with demand shortfall", supply: 10_000_000n, thresholdBps: 4_500n, feeBps: 50n, operatingBps: 250n, reserveBps: 250n,
    trades: [["buy", wei / 10n], ["sell", 3_000n], ["buy", wei / 8n]] },
].map(({ name, ...terms }) => ({ name, ...simulate(terms) }));

assert.equal(scenarios[0].actualBackingWei, 0n);
assert.equal(scenarios[1].thresholdBackingWei, wei);
assert.ok(scenarios[1].graduation && scenarios[1].availableTokenDifferenceAtomic === 0n);
assert.ok(!scenarios.at(-1).graduation);

const postGraduation = [10n, 100n, 1_000n].flatMap((volume) => [10_000n, 2_500n, 500n].map((positionShareBps) =>
  positionRevenue({ volume: volume * wei, lpFeeBps: 30n, positionShareBps, distributionBps: 0n })));
assert.ok(postGraduation.every((result) => result.modeledRecipientEarnings === 0n));

const migrationStart = simulate({ supply: 1_000_000n, thresholdBps: 6_000n, feeBps: 100n, operatingBps: 500n,
  reserveBps: 500n, trades: draftPath.slice(0, 3) });
const immutableMigrationBalances = { reserve: migrationStart.actualBackingWei, inventory: migrationStart.remainingAtomic,
  issued: migrationStart.soldAtomic, fees: migrationStart.feesWei };
const executionMigration = ["before_notice_expiry", "approved_matching_engine", "candidate_reverted"].map((outcome) => ({
  outcome, versionBefore: 1, versionAfter: outcome === "approved_matching_engine" ? 2 : 1,
  balancesBefore: immutableMigrationBalances, balancesAfter: immutableMigrationBalances,
}));
const holderReplacement = [0n, 1_000n, 10_000n].map((redeemedBps) => {
  const supply = 1_000_000n * wei;
  const redeemed = supply * redeemedBps / bps;
  assert.equal(redeemed + (supply - redeemed), supply);
  return { redeemedBps, oldSupply: supply, oldLocked: redeemed, replacementSupply: supply,
    replacementReleased: redeemed, replacementEscrowed: supply - redeemed };
});

console.log(JSON.stringify({
  assumptions: [
    "Synthetic deterministic orders and complete fills up to the curve cap. No gas or price forecast.",
    "Alternative parameter sets are sensitivity analysis only. At or below 50% sold, this price-matching construction cannot pair the full remaining inventory.",
    "Curve fee buckets use nested cumulative rounding. Deployment terms require review.",
    "Post-graduation values assume the stated active liquidity share. V1 distributes zero LP fees.",
    "The same pool accounting applies to independent router traffic. Routes that use a different pool do not earn fees for this position.",
  ],
  scenarios,
  postGraduation,
  executionMigration,
  holderReplacement,
}, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
