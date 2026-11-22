export const launchTokenSupply = 1_000_000_000;
export const launchTokenDecimals = 18;
export const launchTokenSupplyWei = BigInt(launchTokenSupply) * 10n ** BigInt(launchTokenDecimals);
export const launchRegistrationKind = "curve-launch-1b-v2";

// The published chain-4663 factory uses the fixed-supply production build profile.
export const launchTerms = {
  creationFeeEth: "0.0004",
  graduationBackingEth: 2,
  virtualEth: 4,
  curveAllocationPercent: 60,
  liquidityAllocationPercent: 40,
  curveTradeFeePercent: 1,
  projectFeeSharePercent: 90,
  operatingFeeSharePercent: 5,
  futureReserveFeeSharePercent: 5,
  graduationPoolFeePercent: "0.30",
} as const;

const netPercent = BigInt(100 - launchTerms.curveTradeFeePercent);
export const minimumGraduationGrossWei =
  (BigInt(launchTerms.graduationBackingEth) * 10n ** 18n * 100n + netPercent - 1n) / netPercent;
