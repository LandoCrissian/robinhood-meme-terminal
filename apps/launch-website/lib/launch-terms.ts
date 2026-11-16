// The public draft previews the planned supply. Execution remains disabled.
export const plannedLaunchSupply = 1_000_000_000;

// Retained solely for the pinned synthetic 31337 factory and its calldata.
export const fixtureSupplyPresets = [1_000_000, 10_000_000, 100_000_000] as const;

// Fee and liquidity disclosures come from the review fixture and remain provisional.
export const launchTerms = {
  creationFeeEth: "0.0004",
  graduationBackingEth: 2,
  curveAllocationPercent: 60,
  liquidityAllocationPercent: 40,
  curveTradeFeePercent: 1,
  projectFeeSharePercent: 90,
  operatingFeeSharePercent: 5,
  futureReserveFeeSharePercent: 5,
  graduationPoolFeePercent: "0.30",
} as const;
