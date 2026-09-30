import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { RMT_CURATED_NFT_PROJECTS, type RmtCuratedNftProject, type RmtNftProjectTokenAssociation } from "./nft/project-registry";

/** Relationships are presentation authority, never asset admission or execution
 * authority. Names/symbols cannot establish an edge. */
export type RmtProjectIdentity = {
  projectId: string;
  displayName: string;
  officialEvidence: readonly { kind: string; url: string }[];
  links: readonly { label: string; url: string }[];
  artwork: { url: string; evidenceUrl: string } | null;
  assets: readonly {
    chainId: 4663;
    contract: Address;
    kind: "ERC20" | "ERC721" | "ERC1155";
    relationship: RmtNftProjectTokenAssociation | "OWNER_APPROVED_COLLECTION";
    observedAt: string;
    verification: "VERIFIED";
  }[];
};

export function defineRmtProjectIdentity(input: RmtProjectIdentity): RmtProjectIdentity {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(input.projectId) || !input.displayName.trim() || input.assets.length > 64 || input.officialEvidence.length > 32 || input.links.length > 32) throw new Error("Project identity requires bounded official evidence.");
  const https = (value: string) => { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password) throw new Error("Project reference must be public HTTPS."); return url.toString(); };
  const seen = new Set<string>();
  const assets = input.assets.map(asset => {
    if (asset.chainId !== 4663 || !isAddress(asset.contract, { strict: false }) || asset.contract.toLowerCase() === zeroAddress || asset.verification !== "VERIFIED" || !Number.isFinite(Date.parse(asset.observedAt))) throw new Error("Project asset must have exact verified chain, contract and provenance.");
    if (!["ERC20", "ERC721", "ERC1155"].includes(asset.kind) || asset.relationship !== (asset.kind === "ERC20" ? "OWNER_CONFIRMED_PROJECT_TOKEN" : "OWNER_APPROVED_COLLECTION")) throw new Error("Project relationship needs explicit owner authority.");
    if (asset.kind === "ERC20" && !input.officialEvidence.length) throw new Error("A token relationship needs positive project evidence.");
    const contract = getAddress(asset.contract); const key = contract.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate project contract."); seen.add(key);
    return { ...asset, contract };
  });
  return { ...input, assets, officialEvidence: input.officialEvidence.map(item => ({ ...item, url: https(item.url) })), links: input.links.map(item => ({ ...item, url: https(item.url) })), artwork: input.artwork ? { url: https(input.artwork.url), evidenceUrl: https(input.artwork.evidenceUrl) } : null };
}

export function projectIdentityFromNftProject(project: RmtCuratedNftProject): RmtProjectIdentity {
  // approvedAt dates the existing owner admission/relationship only. It is not
  // collection creation, first discovery or technical verification evidence.
  return defineRmtProjectIdentity({
    projectId: project.projectId, displayName: project.displayName,
    officialEvidence: project.officialProjectEvidence,
    links: project.links.filter(link => link.visibility === "PUBLIC"), artwork: null,
    assets: [
      ...project.collections.filter(collection => collection.verificationStatus === "VERIFIED" && collection.declaredStandard !== null).map(collection => ({ chainId: collection.chainId, contract: collection.contractAddress, kind: collection.declaredStandard!, relationship: "OWNER_APPROVED_COLLECTION" as const, observedAt: project.approvedAt, verification: "VERIFIED" as const })),
      ...(project.projectToken?.verificationStatus === "VERIFIED" ? [{ chainId: project.projectToken.chainId, contract: project.projectToken.contractAddress, kind: "ERC20" as const, relationship: project.projectToken.association, observedAt: project.projectToken.ownerConfirmedAt, verification: "VERIFIED" as const }] : [])
    ]
  });
}

export const RMT_PROJECT_IDENTITIES = RMT_CURATED_NFT_PROJECTS.filter(project => project.status !== "REMOVED").map(projectIdentityFromNftProject);
export function projectsForContract(address: string) {
  if (!isAddress(address, { strict: false })) return [];
  return RMT_PROJECT_IDENTITIES.filter(project => project.assets.some(asset => asset.contract.toLowerCase() === address.toLowerCase()));
}
