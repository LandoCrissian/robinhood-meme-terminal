export const RMT_ECOSYSTEM_SCHEMA_VERSION = 1 as const;
export const RMT_ECOSYSTEM_CHAIN_ID = 4_663 as const;

export type CapabilityEvidenceState = "reported" | "candidate" | "verified" | "conflicting" | "revoked";
export type CapabilityAdmissionState =
  | "unsupported"
  | "catalogue_only"
  | "observation"
  | "quote_only"
  | "verification_ready"
  | "execution_admitted";

export type CapabilityAuthorityDimension =
  | "project_identity"
  | "asset_identity"
  | "market_venue"
  | "execution_provider"
  | "claim_source"
  | "agent_identity"
  | "compliance_provider"
  | "price_oracle"
  | "distribution_source";

export type CapabilityKind =
  | "project_passport"
  | "asset_registry"
  | "spot_liquidity"
  | "nft_orderbook"
  | "nft_amm"
  | "token_bound_account"
  | "liquidity_position"
  | "escrow_claim"
  | "vesting_claim"
  | "async_vault"
  | "lending"
  | "distribution"
  | "subscription"
  | "api_payment"
  | "agent_endpoint"
  | "agent_mandate"
  | "rwa_compliance"
  | "price_feed"
  | "corporate_action"
  | "referral";

export type CapabilityAction =
  | "discover"
  | "inspect"
  | "quote"
  | "buy"
  | "sell"
  | "swap"
  | "claim"
  | "refund"
  | "deposit"
  | "redeem"
  | "borrow"
  | "repay"
  | "subscribe"
  | "pay"
  | "distribute"
  | "delegate"
  | "execute_agent"
  | "collect_fees";

export type CapabilityAssetClass =
  | "native"
  | "erc20"
  | "erc721"
  | "erc1155"
  | "stock_token"
  | "rwa"
  | "vault_share"
  | "lp_position"
  | "agent"
  | "claim";

export type CapabilityRiskFlag =
  | "regulated_asset"
  | "jurisdiction_gated"
  | "compliance_hook"
  | "custody"
  | "broad_approval"
  | "async_settlement"
  | "offchain_claim_secret"
  | "agent_authority"
  | "upgradeable"
  | "external_oracle"
  | "mutable_metadata"
  | "transfer_restricted";

export type ExternalContractIdentity = {
  chainId: typeof RMT_ECOSYSTEM_CHAIN_ID;
  address: string;
  deploymentTransactionHash: string | null;
  deploymentBlock: string | null;
  runtimeCodeHash: string | null;
  verifiedSourceRef: string | null;
};

export type CapabilityEndpoint =
  | { kind: "contract"; contract: ExternalContractIdentity }
  | { kind: "http_read"; endpointRef: string }
  | { kind: "mcp"; endpointRef: string; identityRef: string | null }
  | { kind: "offchain_evidence"; sourceRef: string };

export type CapabilityFeeBoundary =
  | { kind: "none"; actions: readonly CapabilityAction[] }
  | { kind: "external_provider"; policyRef: string; actions: readonly CapabilityAction[] }
  | {
      kind: "rmt_trade_execution";
      policyId: string;
      feeBps: 25;
      actions: readonly ["buy", "sell"] | readonly ["sell", "buy"];
      productionAdmitted: boolean;
    };

export type ProjectCapabilityRegistration = {
  schemaVersion: typeof RMT_ECOSYSTEM_SCHEMA_VERSION;
  capabilityId: string;
  projectId: string;
  displayName: string;
  authorityDimension: CapabilityAuthorityDimension;
  kind: CapabilityKind;
  providerFamily: string;
  adapterId: string;
  adapterVersion: number;
  evidenceState: CapabilityEvidenceState;
  admissionState: CapabilityAdmissionState;
  actions: readonly CapabilityAction[];
  assetClasses: readonly CapabilityAssetClass[];
  endpoints: readonly CapabilityEndpoint[];
  riskFlags: readonly CapabilityRiskFlag[];
  verificationRequirements: readonly string[];
  feeBoundary: CapabilityFeeBoundary;
  sourceRefs: readonly string[];
  observedAtMs: number;
};

export type ProjectIdentityRecord = {
  schemaVersion: typeof RMT_ECOSYSTEM_SCHEMA_VERSION;
  projectId: string;
  displayName: string;
  controller: string;
  hoodStreetBuildingId: string | null;
  evidenceState: CapabilityEvidenceState;
  claimedContracts: readonly string[];
  verifiedContracts: readonly string[];
  membershipPaid: boolean;
  safetyEndorsed: false;
  sourceRefs: readonly string[];
};

export type CapabilityRelationship = {
  fromId: string;
  toId: string;
  relation:
    | "project_claims_capability"
    | "capability_uses_asset"
    | "capability_routes_venue"
    | "capability_creates_claim"
    | "capability_pays_distribution"
    | "agent_operates_account"
    | "account_contains_asset"
    | "asset_requires_compliance"
    | "asset_uses_price_feed";
  evidenceState: CapabilityEvidenceState;
  sourceRef: string;
};

export type ProjectCapabilityGraph = {
  schemaVersion: typeof RMT_ECOSYSTEM_SCHEMA_VERSION;
  projects: readonly ProjectIdentityRecord[];
  capabilities: readonly ProjectCapabilityRegistration[];
  relationships: readonly CapabilityRelationship[];
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const WRITE_ACTIONS = new Set<CapabilityAction>([
  "buy", "sell", "swap", "claim", "refund", "deposit", "redeem", "borrow", "repay",
  "subscribe", "pay", "distribute", "delegate", "execute_agent", "collect_fees"
]);
const ADMISSION_ORDER: Record<CapabilityAdmissionState, number> = {
  unsupported: 0,
  catalogue_only: 1,
  observation: 2,
  quote_only: 3,
  verification_ready: 4,
  execution_admitted: 5
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid RMT ecosystem capability: ${message}.`);
}

export function canonicalId(value: string, label = "identity") {
  invariant(ID.test(value), `${label} is not canonical`);
  return value;
}

export function normalizeEvmAddress(value: string, label = "address") {
  invariant(ADDRESS.test(value), `${label} is invalid`);
  return value.toLowerCase();
}

export function normalizeBytes32(value: string, label = "bytes32") {
  invariant(HASH32.test(value), `${label} is invalid`);
  return value.toLowerCase();
}

export function canonicalUint(value: string, label = "uint256") {
  invariant(UINT.test(value), `${label} is not a canonical unsigned integer`);
  return value;
}

export function admissionAtLeast(value: CapabilityAdmissionState, minimum: CapabilityAdmissionState) {
  return ADMISSION_ORDER[value] >= ADMISSION_ORDER[minimum];
}

export function assertContractIdentity(identity: ExternalContractIdentity) {
  invariant(identity.chainId === RMT_ECOSYSTEM_CHAIN_ID, "contract is on the wrong chain");
  normalizeEvmAddress(identity.address, "contract address");
  if (identity.deploymentTransactionHash !== null) normalizeBytes32(identity.deploymentTransactionHash, "deployment transaction hash");
  if (identity.deploymentBlock !== null) canonicalUint(identity.deploymentBlock, "deployment block");
  if (identity.runtimeCodeHash !== null) normalizeBytes32(identity.runtimeCodeHash, "runtime code hash");
  invariant(identity.verifiedSourceRef === null || identity.verifiedSourceRef.trim().length > 0, "verified source reference is empty");
  return true;
}

function assertFeeBoundary(boundary: CapabilityFeeBoundary) {
  invariant(boundary.actions.length > 0, "fee boundary has no actions");
  invariant(new Set(boundary.actions).size === boundary.actions.length, "fee boundary duplicates actions");
  if (boundary.kind === "rmt_trade_execution") {
    invariant(boundary.policyId.trim().length > 0, "RMT fee policy identity is missing");
    invariant(boundary.feeBps === 25, "RMT trade fee changed from exactly 25 basis points");
    invariant(
      boundary.actions.length === 2 && boundary.actions.includes("buy") && boundary.actions.includes("sell"),
      "RMT trade fee may bind only buy and sell"
    );
  }
  return true;
}

export function assertCapabilityRegistration(registration: ProjectCapabilityRegistration) {
  invariant(registration.schemaVersion === RMT_ECOSYSTEM_SCHEMA_VERSION, "schema version is unsupported");
  canonicalId(registration.capabilityId, "capability ID");
  canonicalId(registration.projectId, "project ID");
  invariant(registration.displayName.trim().length > 0, "display name is missing");
  canonicalId(registration.providerFamily, "provider family");
  canonicalId(registration.adapterId, "adapter ID");
  invariant(Number.isInteger(registration.adapterVersion) && registration.adapterVersion > 0, "adapter version is invalid");
  invariant(registration.actions.length > 0 && new Set(registration.actions).size === registration.actions.length, "actions are missing or duplicated");
  invariant(registration.assetClasses.length > 0 && new Set(registration.assetClasses).size === registration.assetClasses.length, "asset classes are missing or duplicated");
  invariant(registration.endpoints.length > 0, "capability has no evidence endpoint");
  invariant(registration.sourceRefs.length > 0 && registration.sourceRefs.every((source) => source.trim().length > 0), "source references are missing");
  invariant(Number.isSafeInteger(registration.observedAtMs) && registration.observedAtMs > 0, "observation timestamp is invalid");
  invariant(new Set(registration.riskFlags).size === registration.riskFlags.length, "risk flags are duplicated");
  assertFeeBoundary(registration.feeBoundary);

  for (const endpoint of registration.endpoints) {
    if (endpoint.kind === "contract") assertContractIdentity(endpoint.contract);
    else if (endpoint.kind === "offchain_evidence") invariant(endpoint.sourceRef.trim().length > 0, "evidence source reference is empty");
    else invariant(endpoint.endpointRef.trim().length > 0, "endpoint reference is empty");
  }

  const hasWriteAction = registration.actions.some((action) => WRITE_ACTIONS.has(action));
  if (registration.admissionState === "execution_admitted") {
    invariant(registration.evidenceState === "verified", "execution admission requires verified evidence");
    invariant(hasWriteAction, "execution admission has no write action");
    invariant(registration.verificationRequirements.length > 0, "execution admission has no strict verification contract");
    const contractEndpoints = registration.endpoints.filter((endpoint): endpoint is Extract<CapabilityEndpoint, { kind: "contract" }> => endpoint.kind === "contract");
    invariant(contractEndpoints.length > 0, "execution admission has no contract identity");
    invariant(
      contractEndpoints.every((endpoint) => endpoint.contract.runtimeCodeHash !== null && endpoint.contract.deploymentTransactionHash !== null),
      "execution admission lacks deployment/runtime binding"
    );
  }

  if (registration.evidenceState === "revoked" || registration.evidenceState === "conflicting") {
    invariant(!admissionAtLeast(registration.admissionState, "verification_ready"), "revoked/conflicting capability cannot remain verification-ready");
  }

  if (registration.feeBoundary.kind === "rmt_trade_execution") {
    invariant(registration.actions.includes("buy") && registration.actions.includes("sell"), "RMT fee policy is attached to a non-trading capability");
  }

  return true;
}

export function assertProjectIdentity(project: ProjectIdentityRecord) {
  invariant(project.schemaVersion === RMT_ECOSYSTEM_SCHEMA_VERSION, "project schema version is unsupported");
  canonicalId(project.projectId, "project ID");
  invariant(project.displayName.trim().length > 0, "project display name is missing");
  normalizeEvmAddress(project.controller, "project controller");
  if (project.hoodStreetBuildingId !== null) canonicalId(project.hoodStreetBuildingId, "HoodStreet building ID");
  for (const address of project.claimedContracts) normalizeEvmAddress(address, "claimed contract");
  for (const address of project.verifiedContracts) normalizeEvmAddress(address, "verified contract");
  invariant(new Set(project.claimedContracts.map((address) => address.toLowerCase())).size === project.claimedContracts.length, "claimed contracts are duplicated");
  invariant(new Set(project.verifiedContracts.map((address) => address.toLowerCase())).size === project.verifiedContracts.length, "verified contracts are duplicated");
  invariant(project.safetyEndorsed === false, "project identity may not imply a safety endorsement");
  invariant(project.sourceRefs.length > 0, "project identity has no source evidence");
  if (project.evidenceState !== "verified") {
    invariant(project.verifiedContracts.length === 0, "unverified project identity cannot publish verified contracts");
  }
  if (project.membershipPaid) invariant(project.evidenceState !== "revoked", "revoked project cannot use payment to restore evidence");
  return true;
}

export function assertProjectCapabilityGraph(graph: ProjectCapabilityGraph) {
  invariant(graph.schemaVersion === RMT_ECOSYSTEM_SCHEMA_VERSION, "graph schema version is unsupported");
  for (const project of graph.projects) assertProjectIdentity(project);
  for (const capability of graph.capabilities) assertCapabilityRegistration(capability);

  const projectIds = new Set(graph.projects.map((project) => project.projectId));
  const capabilityIds = new Set(graph.capabilities.map((capability) => capability.capabilityId));
  invariant(projectIds.size === graph.projects.length, "project IDs are duplicated");
  invariant(capabilityIds.size === graph.capabilities.length, "capability IDs are duplicated");
  for (const capability of graph.capabilities) {
    invariant(projectIds.has(capability.projectId), `capability ${capability.capabilityId} references an unknown project`);
  }

  const knownIds = new Set([...projectIds, ...capabilityIds]);
  for (const relationship of graph.relationships) {
    invariant(knownIds.has(relationship.fromId) && knownIds.has(relationship.toId), "relationship references an unknown identity");
    invariant(relationship.fromId !== relationship.toId, "relationship cannot self-reference");
    invariant(relationship.sourceRef.trim().length > 0, "relationship source reference is missing");
  }
  return true;
}

export function capabilityKey(registration: Pick<ProjectCapabilityRegistration, "projectId" | "capabilityId" | "adapterVersion">) {
  return `${canonicalId(registration.projectId)}/${canonicalId(registration.capabilityId)}@${registration.adapterVersion}`;
}

export function rmtTradeFeeAppliesTo(action: CapabilityAction, registration: ProjectCapabilityRegistration) {
  assertCapabilityRegistration(registration);
  return registration.feeBoundary.kind === "rmt_trade_execution"
    && registration.feeBoundary.productionAdmitted
    && registration.feeBoundary.actions.includes(action as "buy" | "sell");
}
