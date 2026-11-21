// Website disclosures mirror the #594 review fixture. They confer no release approval.
export const launchTerms = {
  creationFeeEth: "0.0004",
  graduationBackingEth: 2,
  supplyPresets: [1_000_000, 10_000_000, 100_000_000],
  curveAllocationPercent: 60,
  liquidityAllocationPercent: 40,
  curveTradeFeePercent: 1,
  projectFeeSharePercent: 90,
  operatingFeeSharePercent: 5,
  futureReserveFeeSharePercent: 5,
  graduationPoolFeePercent: "0.30",
} as const;
