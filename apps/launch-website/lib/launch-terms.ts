export const launchTokenSupply = 1_000_000_000;
export const launchTokenDecimals = 18;
export const launchTokenSupplyWei = BigInt(launchTokenSupply) * 10n ** BigInt(launchTokenDecimals);
export const launchRegistrationKind = "curve-launch-1b-v2";

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
