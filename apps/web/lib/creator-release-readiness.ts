import { isAddress } from "viem";
import {
  hashCreatorAssetDraft,
  type CreatorAssetDraft
} from "./creator-assets";
import {
  validateMarketplaceEconomicsPolicy,
  type MarketplaceEconomicsPolicyDraft
} from "./creator-economics";

export type ReleaseReadinessStatus = "ready" | "attention" | "blocked";

export type ReleaseReadinessCheck = {
  id: string;
  label: string;
  detail: string;
  status: ReleaseReadinessStatus;
};

export type CreatorReleaseReadiness = {
  status: ReleaseReadinessStatus;
  readyCount: number;
  totalCount: number;
  checks: ReleaseReadinessCheck[];
};

function check(
  id: string,
  label: string,
  detail: string,
  status: ReleaseReadinessStatus
): ReleaseReadinessCheck {
  return { id, label, detail, status };
}

export function evaluateCreatorReleaseReadiness(
  draft: CreatorAssetDraft,
  options: {
    savedRevisionHash?: string;
    economicsPolicy?: MarketplaceEconomicsPolicyDraft | null;
  } = {}
): CreatorReleaseReadiness {
  const checks: ReleaseReadinessCheck[] = [];

  checks.push(draft.primaryMediaUri.startsWith("ipfs://")
    ? check("media", "Media permanence", "Primary media uses an IPFS content address.", "ready")
    : draft.primaryMediaUri.startsWith("https://")
      ? check("media", "Media permanence", "HTTPS media can change or disappear; pin immutable media before release.", "attention")
      : check("media", "Media permanence", "Add valid HTTPS or IPFS primary media.", "blocked"));

  if (draft.creationMethod === "human") {
    checks.push(check("provenance", "Creation provenance", "Recorded as human-created.", "ready"));
  } else if (draft.aiTools.length > 0 && draft.aiDisclosure.trim().length >= 20) {
    checks.push(check("provenance", "Creation provenance", "AI tools and the creator's contribution are disclosed.", "ready"));
  } else {
    checks.push(check("provenance", "Creation provenance", "AI-assisted work needs named tools and a clear contribution disclosure.", "blocked"));
  }

  const rightsReady = draft.rightsConfirmed
    && draft.rightsStatement.trim().length >= 20
    && (!draft.containsThirdPartyMaterial || draft.thirdPartyRightsConfirmed)
    && (draft.assetType !== "music_release"
      || (draft.masterRightsConfirmed && draft.compositionRightsConfirmed));
  checks.push(rightsReady
    ? check("rights", "Rights declarations", "Required creator declarations are complete.", "ready")
    : check("rights", "Rights declarations", "Complete every applicable rights and permission declaration.", "blocked"));

  checks.push(draft.license !== "custom" || draft.licenseUri.startsWith("https://")
    ? check("license", "License terms", `Intended license: ${draft.license.replaceAll("_", " ")}.`, "ready")
    : check("license", "License terms", "A custom license needs a valid HTTPS terms URL.", "blocked"));

  const editionReady = draft.editionMode === "one_of_one"
    ? draft.editionSupply === 1
    : draft.editionMode === "open"
      ? draft.editionSupply === 0
      : Number.isInteger(draft.editionSupply) && draft.editionSupply >= 1 && draft.editionSupply <= 1_000_000;
  checks.push(editionReady
    ? check("edition", "Edition design", `${draft.editionMode.replaceAll("_", " ")} supply is internally consistent.`, "ready")
    : check("edition", "Edition design", "Edition mode and supply do not match.", "blocked"));

  checks.push(draft.secondaryRoyaltyBps > 0
    ? check(
      "royalty",
      "Royalty preference",
      `${(draft.secondaryRoyaltyBps / 100).toFixed(2)}% is a preference only; ERC-2981 cannot force external marketplaces to pay it.`,
      "attention"
    )
    : check("royalty", "Royalty preference", "No secondary-sale royalty preference is configured.", "ready"));

  const collaboratorWalletsReady = draft.collaborators.every((collaborator) => (
    collaborator.name.trim().length >= 2
    && isAddress(collaborator.walletAddress, { strict: false })
  ));
  checks.push(draft.collaborators.length === 0
    ? check("consent", "Collaborator consent", "No collaborators are proposed.", "ready")
    : collaboratorWalletsReady
      ? check("consent", "Collaborator consent", "Wallets are present, but every collaborator must still sign this exact revision.", "blocked")
      : check("consent", "Collaborator consent", "Each collaborator needs a wallet before a signed invitation can be prepared.", "blocked"));

  const splitTotal = draft.revenueSplits.reduce((total, split) => total + split.shareBps, 0);
  const splitWallets = draft.revenueSplits.map((split) => split.walletAddress.toLowerCase());
  const splitsReady = draft.revenueSplits.length === 0 || (
    splitTotal === 10_000
    && splitWallets.every((wallet) => isAddress(wallet, { strict: false }))
    && new Set(splitWallets).size === splitWallets.length
  );
  checks.push(splitsReady
    ? check(
      "splits",
      "Revenue split",
      draft.revenueSplits.length === 0 ? "No revenue split is proposed." : "Proposed recipients total exactly 100%.",
      "ready"
    )
    : check("splits", "Revenue split", "Recipients need unique valid wallets and shares totaling exactly 100%.", "blocked"));

  const currentRevisionHash = hashCreatorAssetDraft(draft);
  checks.push(options.savedRevisionHash === currentRevisionHash
    ? check("revision", "Revision integrity", "The saved revision matches the current form.", "ready")
    : options.savedRevisionHash
      ? check("revision", "Revision integrity", "Unsaved changes invalidate earlier consent or review.", "attention")
      : check("revision", "Revision integrity", "Save this draft to establish its first revision fingerprint.", "attention"));

  const economicsError = options.economicsPolicy
    ? validateMarketplaceEconomicsPolicy(options.economicsPolicy)
    : "No marketplace economics policy is attached.";
  checks.push(economicsError
    ? check("economics", "Fee disclosure", "Marketplace execution stays locked until one versioned fee policy is attached.", "blocked")
    : check("economics", "Fee disclosure", "A complete versioned fee policy is attached.", "ready"));

  const status: ReleaseReadinessStatus = checks.some((candidate) => candidate.status === "blocked")
    ? "blocked"
    : checks.some((candidate) => candidate.status === "attention")
      ? "attention"
      : "ready";
  return {
    status,
    readyCount: checks.filter((candidate) => candidate.status === "ready").length,
    totalCount: checks.length,
    checks
  };
}
