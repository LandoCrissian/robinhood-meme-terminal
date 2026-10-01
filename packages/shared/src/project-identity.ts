import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { RMT_CURATED_NFT_PROJECTS, type RmtCuratedNftProject, type RmtNftProjectTokenAssociation } from "./nft/project-registry.js";
import { INITIAL_PROJECT_EVIDENCE } from "./project-evidence.js";

export const PROJECT_EVIDENCE_CLASSES = ["OWNER_VERIFIED", "ONCHAIN_VERIFIED", "PROJECT_OFFICIAL", "PROVIDER_VERIFIED", "DERIVED"] as const;
export type ProjectEvidence = { class: typeof PROJECT_EVIDENCE_CLASSES[number]; source: string; observedAt: string; blockNumber?: string };
export type ProjectRelationshipType = "PROJECT_HAS_TOKEN" | "PROJECT_HAS_NFT_COLLECTION" | "PROJECT_HAS_OFFICIAL_LINK" | "PROJECT_ORIGIN" | "PROJECT_HAS_MARKET" | "PROJECT_HAS_RWA" | "PROJECT_HAS_STOCK_TOKEN";
export type ProjectRelationship = { projectId: string; type: ProjectRelationshipType; chainId: 4663; contract?: Address; url?: string; evidence: readonly ProjectEvidence[]; verification: "VERIFIED" };

/** Relationships are presentation authority, never asset admission or execution
 * authority. Names/symbols cannot establish an edge. */
export type RmtProjectIdentity = {
  projectId: string;
  displayName: string;
  officialEvidence: readonly { kind: string; url: string }[];
  links: readonly { label: string; url: string; evidence?: readonly ProjectEvidence[] }[];
  artwork: { url: string; evidenceUrl: string } | null;
  discovery?: "VERIFIED" | "WATCHING";
  pendingRelationships?: readonly { type: ProjectRelationshipType; reason: string }[];
  relationships?: readonly ProjectRelationship[];
  assets: readonly {
    chainId: 4663;
    contract: Address;
    kind: "ERC20" | "ERC721" | "ERC1155";
    relationship: RmtNftProjectTokenAssociation | "OWNER_APPROVED_COLLECTION";
    observedAt: string;
    verification: "VERIFIED";
    name?: string;
    symbol?: string;
    decimals?: number;
    evidence?: readonly ProjectEvidence[];
  }[];
};

export function defineRmtProjectIdentity(input: RmtProjectIdentity): RmtProjectIdentity {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(input.projectId) || !input.displayName.trim() || input.assets.length > 64 || input.officialEvidence.length > 32 || input.links.length > 32) throw new Error("Project identity requires bounded official evidence.");
  const https = (value: string) => { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password) throw new Error("Project reference must be public HTTPS."); return url.toString(); };
  const seen = new Set<string>();
  const validEvidence = (e: ProjectEvidence) => PROJECT_EVIDENCE_CLASSES.includes(e.class) && !!e.source && e.source.length <= 1000 && Number.isFinite(Date.parse(e.observedAt)) && (e.blockNumber === undefined || /^\d+$/.test(e.blockNumber));
  if ((input.relationships?.length ?? 0) > 64) throw new Error("Project edges must be bounded.");
  for (const edge of input.relationships ?? []) {
    if (edge.projectId !== input.projectId || edge.chainId !== 4663 || edge.verification !== "VERIFIED" || !["PROJECT_HAS_TOKEN", "PROJECT_HAS_NFT_COLLECTION", "PROJECT_HAS_OFFICIAL_LINK", "PROJECT_ORIGIN", "PROJECT_HAS_MARKET", "PROJECT_HAS_RWA", "PROJECT_HAS_STOCK_TOKEN"].includes(edge.type) || !edge.evidence.length || edge.evidence.length > 16) throw new Error("Invalid project edge.");
    if (edge.contract && (!isAddress(edge.contract, { strict: false }) || edge.contract.toLowerCase() === zeroAddress)) throw new Error("Invalid edge contract.");
    if (edge.url) https(edge.url);
    if (!edge.evidence.every(validEvidence)) throw new Error("Invalid edge provenance.");
    if (["PROJECT_HAS_TOKEN", "PROJECT_HAS_NFT_COLLECTION"].includes(edge.type) && !input.assets.some(asset => asset.contract.toLowerCase() === edge.contract?.toLowerCase() && (asset.kind === "ERC20") === (edge.type === "PROJECT_HAS_TOKEN"))) throw new Error("Asset edge must match a verified project asset.");
  }
  const assets = input.assets.map(asset => {
    if (asset.chainId !== 4663 || !isAddress(asset.contract, { strict: false }) || asset.contract.toLowerCase() === zeroAddress || asset.verification !== "VERIFIED" || !Number.isFinite(Date.parse(asset.observedAt))) throw new Error("Project asset must have exact verified chain, contract and provenance.");
    if (!["ERC20", "ERC721", "ERC1155"].includes(asset.kind) || asset.relationship !== (asset.kind === "ERC20" ? "OWNER_CONFIRMED_PROJECT_TOKEN" : "OWNER_APPROVED_COLLECTION")) throw new Error("Project relationship needs explicit owner authority.");
    if (asset.kind === "ERC20" && !input.officialEvidence.length) throw new Error("A token relationship needs positive project evidence.");
    if (asset.decimals !== undefined && (asset.kind !== "ERC20" || !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 255)) throw new Error("Invalid project asset units.");
    if (asset.evidence) {
      if (asset.evidence.length > 16 || !asset.evidence.some(e => e.class === "OWNER_VERIFIED") || !asset.evidence.some(e => e.class === "ONCHAIN_VERIFIED")) throw new Error("Graph admission requires distinct owner and onchain evidence.");
      if (!asset.evidence.every(validEvidence)) throw new Error("Invalid relationship evidence.");
    }
    const contract = getAddress(asset.contract); const key = contract.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate project contract."); seen.add(key);
    return { ...asset, contract };
  });
  return { ...input, assets, officialEvidence: input.officialEvidence.map(item => ({ ...item, url: https(item.url) })), links: input.links.map(item => { if (item.evidence && (!item.evidence.length || item.evidence.length > 16 || !item.evidence.every(validEvidence))) throw new Error("Invalid link provenance."); return { ...item, url: https(item.url) }; }), artwork: input.artwork ? { url: https(input.artwork.url), evidenceUrl: https(input.artwork.evidenceUrl) } : null };
}

export function projectIdentityFromNftProject(project: RmtCuratedNftProject): RmtProjectIdentity {
  // approvedAt dates the existing owner admission/relationship only. It is not
  // collection creation, first discovery or technical verification evidence.
  return defineRmtProjectIdentity({
    projectId: project.projectId, displayName: project.displayName,
    discovery: project.status === "ACTIVE" ? "VERIFIED" : "WATCHING",
    officialEvidence: project.officialProjectEvidence,
    links: project.links.filter(link => link.visibility === "PUBLIC"), artwork: null,
    assets: [
      ...project.collections.filter(collection => collection.verificationStatus === "VERIFIED" && collection.declaredStandard !== null).map(collection => ({ chainId: collection.chainId, contract: collection.contractAddress, kind: collection.declaredStandard!, relationship: "OWNER_APPROVED_COLLECTION" as const, observedAt: project.approvedAt, verification: "VERIFIED" as const })),
      ...(project.projectToken?.verificationStatus === "VERIFIED" ? [{ chainId: project.projectToken.chainId, contract: project.projectToken.contractAddress, kind: "ERC20" as const, relationship: project.projectToken.association, observedAt: project.projectToken.ownerConfirmedAt, verification: "VERIFIED" as const }] : [])
    ]
  });
}

// This reviewed graph is independent of NFT indexer admission. Adding a project
// never creates an activity source, deployment, execution gate or entitlement.
export const RMT_PROJECT_IDENTITIES: readonly RmtProjectIdentity[] = [
  ...RMT_CURATED_NFT_PROJECTS.filter(project => project.status !== "REMOVED" && !INITIAL_PROJECT_EVIDENCE.some(item => item.projectId === project.projectId)).map(projectIdentityFromNftProject),
  ...INITIAL_PROJECT_EVIDENCE.map(defineRmtProjectIdentity)
];
export const RMT_DISCOVERABLE_PROJECTS = RMT_PROJECT_IDENTITIES.filter(project => project.discovery === "VERIFIED");
export function projectById(projectId: string) { return RMT_DISCOVERABLE_PROJECTS.find(project => project.projectId === projectId) ?? null; }
export function projectRelationships(project: RmtProjectIdentity): readonly ProjectRelationship[] {
  return [
    ...project.assets.map(asset => ({ projectId: project.projectId, type: asset.kind === "ERC20" ? "PROJECT_HAS_TOKEN" as const : "PROJECT_HAS_NFT_COLLECTION" as const, chainId: asset.chainId, contract: asset.contract, evidence: asset.evidence ?? [{ class: "OWNER_VERIFIED" as const, source: "RMT_CURATED_NFT_PROJECTS", observedAt: asset.observedAt }], verification: asset.verification })),
    ...project.links.map(link => ({ projectId: project.projectId, type: "PROJECT_HAS_OFFICIAL_LINK" as const, chainId: 4663 as const, url: link.url, evidence: link.evidence ?? (project.assets[0] ? [{ class: "OWNER_VERIFIED" as const, source: "RMT_CURATED_NFT_PROJECTS", observedAt: project.assets[0].observedAt }] : []), verification: "VERIFIED" as const }))
    ,...(project.relationships ?? [])
  ];
}
export function searchProjects(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return RMT_DISCOVERABLE_PROJECTS;
  if (normalized.length > 160) return [];
  return RMT_DISCOVERABLE_PROJECTS.filter(project => isAddress(normalized, { strict: false })
    ? project.assets.some(asset => asset.contract.toLowerCase() === normalized)
    : [project.displayName, project.projectId, ...project.assets.flatMap(asset => [asset.name ?? "", asset.symbol ?? ""])].some(value => value.toLowerCase().includes(normalized)));
}
export function projectsForContract(address: string) {
  if (!isAddress(address, { strict: false })) return [];
  return RMT_PROJECT_IDENTITIES.filter(project => project.assets.some(asset => asset.contract.toLowerCase() === address.toLowerCase()));
}
