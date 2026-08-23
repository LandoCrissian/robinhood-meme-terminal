import {
  RMT_ECOSYSTEM_SCHEMA_VERSION,
  assertCapabilityRegistration,
  assertProjectCapabilityGraph,
  rmtTradeFeeAppliesTo,
  type ProjectCapabilityGraph,
  type ProjectCapabilityRegistration
} from "../src/ecosystem-capabilities.ts";
import {
  buildClaimActionEvidence,
  claimKey,
  claimPortfolioSummary,
  type ClaimPositionSnapshot
} from "../src/claim-layer.ts";
import {
  assertMarketBuildingManifest,
  type HoodStreetMarketBuildingManifest
} from "../src/hoodstreet-market-building.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ECOSYSTEM SMOKE FAIL: ${message}`);
}
function expectThrows(run: () => unknown, message: string) {
  let threw = false;
  try { run(); } catch { threw = true; }
  assert(threw, message);
}

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const H1 = `0x${"11".repeat(32)}`;
const H2 = `0x${"22".repeat(32)}`;
const NOW = 2_000_000;

function contract(address: string) {
  return {
    chainId: 4663 as const,
    address,
    deploymentTransactionHash: H1,
    deploymentBlock: "40000000",
    runtimeCodeHash: H2,
    verifiedSourceRef: "fixture:blockscout"
  };
}

const nftMarket: ProjectCapabilityRegistration = {
  schemaVersion: RMT_ECOSYSTEM_SCHEMA_VERSION,
  capabilityId: "stonkbrokers.nft-market",
  projectId: "stonkbrokers",
  displayName: "StonkBrokers NFT liquidity",
  authorityDimension: "market_venue",
  kind: "nft_amm",
  providerFamily: "stonk-anvil",
  adapterId: "rmt.stonk-anvil",
  adapterVersion: 1,
  evidenceState: "verified",
  admissionState: "execution_admitted",
  actions: ["discover", "quote", "buy", "sell"],
  assetClasses: ["erc721", "erc20"],
  endpoints: [{ kind: "contract", contract: contract(A) }],
  riskFlags: ["broad_approval"],
  verificationRequirements: ["runtime exact", "inventory exact", "fee math exact", "fresh simulation"],
  feeBoundary: {
    kind: "rmt_trade_execution",
    policyId: "RMT_NFT_EXECUTION_V1",
    feeBps: 25,
    actions: ["buy", "sell"],
    productionAdmitted: true
  },
  sourceRefs: ["fixture:official-docs", "fixture:blockscout"],
  observedAtMs: NOW
};
assertCapabilityRegistration(nftMarket);
assert(rmtTradeFeeAppliesTo("buy", nftMarket), "admitted RMT buy should carry the explicit trade fee");
assert(!rmtTradeFeeAppliesTo("claim", nftMarket), "claims must not inherit the buy/sell fee");

expectThrows(() => assertCapabilityRegistration({
  ...nftMarket,
  capabilityId: "bad.market",
  evidenceState: "candidate",
  endpoints: [{ kind: "contract", contract: { ...contract(A), runtimeCodeHash: null } }]
}), "candidate/unbound implementation must not become execution-admitted");

const givestClaims: ProjectCapabilityRegistration = {
  schemaVersion: 1,
  capabilityId: "givest.stock-drops",
  projectId: "givest",
  displayName: "Givest stock-token escrow claims",
  authorityDimension: "claim_source",
  kind: "escrow_claim",
  providerFamily: "givest",
  adapterId: "rmt.givest-claims",
  adapterVersion: 1,
  evidenceState: "verified",
  admissionState: "verification_ready",
  actions: ["discover", "inspect", "claim", "refund"],
  assetClasses: ["stock_token", "claim"],
  endpoints: [{ kind: "contract", contract: contract(B) }],
  riskFlags: ["regulated_asset", "jurisdiction_gated", "offchain_claim_secret"],
  verificationRequirements: ["claim-key signature exact", "beneficiary exact", "canonical stock token exact", "claim state fresh"],
  feeBoundary: { kind: "external_provider", policyRef: "givest-protocol", actions: ["claim", "refund"] },
  sourceRefs: ["fixture:givest-repo"],
  observedAtMs: NOW
};
assertCapabilityRegistration(givestClaims);

const claim: ClaimPositionSnapshot = {
  schemaVersion: 1,
  sourceCapabilityId: givestClaims.capabilityId,
  sourceContract: B,
  locator: { kind: "bytes32", value: H1 },
  kind: "escrow_drop",
  beneficiary: C,
  controller: C,
  asset: { kind: "erc20", chainId: 4663, address: A, amountAtomic: "1000000000000000000", decimals: 18 },
  state: "claimable",
  amountState: "exact",
  transferability: "nontransferable",
  complianceState: "allowed",
  requestedAtMs: NOW - 10_000,
  claimableAtMs: NOW - 1_000,
  expiresAtMs: NOW + 100_000,
  observedRollupBlock: "40000001",
  observedAtMs: NOW,
  evidenceState: "verified",
  sourceRef: "fixture:claim-event"
};
assert(claimKey(claim).includes(B.toLowerCase()), "claim key must bind the exact source contract");
const claimPlan = buildClaimActionEvidence({
  claim,
  capability: givestClaims,
  action: "claim",
  adapterId: "rmt.givest-claims",
  adapterVersion: 1,
  target: B,
  calldataHash: H2,
  recipient: C,
  deadlineMs: NOW + 10_000,
  nowMs: NOW,
  verificationState: "verified"
});
assert(claimPlan.rmtExecutionFeePolicy === null, "claim execution must not silently inherit the RMT trade fee");
assert(claimPlan.broadArbitraryCallAllowed === false, "claim adapter must not authorize an arbitrary call");
const summary = claimPortfolioSummary([claim]);
assert(summary.total === 1 && summary.byState.claimable === 1, "claim portfolio should expose claimable state");

const graph: ProjectCapabilityGraph = {
  schemaVersion: 1,
  projects: [
    {
      schemaVersion: 1,
      projectId: "stonkbrokers",
      displayName: "StonkBrokers",
      controller: C,
      hoodStreetBuildingId: "hoodstreet.stonkbrokers",
      evidenceState: "verified",
      claimedContracts: [A],
      verifiedContracts: [A],
      membershipPaid: true,
      safetyEndorsed: false,
      sourceRefs: ["fixture:controller-signature", "fixture:deployment"]
    },
    {
      schemaVersion: 1,
      projectId: "givest",
      displayName: "Givest",
      controller: B,
      hoodStreetBuildingId: "hoodstreet.givest",
      evidenceState: "verified",
      claimedContracts: [B],
      verifiedContracts: [B],
      membershipPaid: true,
      safetyEndorsed: false,
      sourceRefs: ["fixture:controller-signature", "fixture:deployment"]
    }
  ],
  capabilities: [nftMarket, givestClaims],
  relationships: [
    { fromId: "stonkbrokers", toId: nftMarket.capabilityId, relation: "project_claims_capability", evidenceState: "verified", sourceRef: "fixture:project-claim" },
    { fromId: "givest", toId: givestClaims.capabilityId, relation: "project_claims_capability", evidenceState: "verified", sourceRef: "fixture:project-claim" }
  ]
};
assertProjectCapabilityGraph(graph);

const building: HoodStreetMarketBuildingManifest = {
  schemaVersion: 1,
  buildingId: "hoodstreet.stonkbrokers",
  projectId: "stonkbrokers",
  controller: C,
  transferPolicy: "controller_migration_only",
  financialRights: "none",
  safetyEndorsement: false,
  paidPlacementMayAffectMarketRanking: false,
  identityTokenRef: "erc721:hoodstreet-project-passport",
  projectAccount: {
    kind: "erc6551",
    address: B,
    implementationRef: "fixture:verified-tba-implementation",
    custodyScope: "non_regulated_assets_only",
    regulatedAssetCustodyAllowed: false
  },
  floors: [{ floorId: "markets", label: "Markets", capabilityIds: [nftMarket.capabilityId], authority: "external_capabilities_only" }],
  anchors: [{ kind: "source_manifest", reference: "fixture:project-capability-manifest", evidenceState: "verified", expiresAtMs: null }],
  dynamicTraits: {
    verifiedAssetCount: 2,
    observedMarketCount: 3,
    verifiedRmtExecutionCount: 1,
    claimablePositionCount: 0,
    registeredAgentCount: 1,
    capabilityHealth: "healthy",
    observedAtMs: NOW,
    evidenceRoot: H1
  },
  manifestHash: H2
};
assertMarketBuildingManifest(building);
expectThrows(() => assertMarketBuildingManifest({ ...building, financialRights: "revenue_share" as "none" }), "building identity must not imply a revenue security");
expectThrows(() => assertMarketBuildingManifest({
  ...building,
  projectAccount: { ...building.projectAccount, regulatedAssetCustodyAllowed: true as false }
}), "building account must not bypass regulated-asset controls");

console.log("RMT_ECOSYSTEM_FLYWHEEL_SMOKE: PASS");
