// Keep the existing API while sharing the bounded settlement proof with claims.
export { assertNativeTransferProof as assertFixtureNativeProof,
  assertInnerCallProof as assertFixtureInnerCallProof,
  treasuryClaimInput as fixtureTreasuryClaimInput } from "../../../packages/launchpad-common/native-proof.mjs";
