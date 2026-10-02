import type { RmtProjectIdentity } from "@rmt/shared/project-identity";

// Permanent, exact-contract presentation assets. Full original source, evidence
// class and content digest: docs/projects/project-artwork-evidence.json.
// Retaining validated artwork avoids making identity depend on marketplace uptime.
const collectionArtwork: Readonly<Record<string, string>> = {
  "0x289c8ce652f38029867842048068b39bd0464a3f": "/project-art/cannacats.avif",
  "0x7da15c761409cb921a81f0e003704cff418b700b": "/project-art/hopium-machines.avif",
  "0xc1605fb719f388110b1b0f384b7ffd64ba4ba5df": "/project-art/peeps.avif",
  "0x505a22ffed8d37ebe580ffd98d2cdb0021189146": "/project-art/ccff00.svg"
};
const tokenArtwork: Readonly<Record<string, string>> = {
  "0xb6ce51925c2e397ebf1a443b343d19267b3d4225": "/project-art/hopium-token.png"
};

export function projectComposition(project: RmtProjectIdentity) {
  const tokens = project.assets.filter(asset => asset.chainId === 4663 && asset.kind === "ERC20");
  const collections = project.assets.filter(asset => asset.chainId === 4663 && asset.kind !== "ERC20");
  const label = tokens.length && collections.length ? "Token ↔ NFT project" : collections.length ? "NFT-led project" : "Token project";
  return { tokens, collections, label: project.projectId === "ccff00" ? "NFT-led RMT ecosystem project" : label };
}

export function projectArtworkCandidates(project: RmtProjectIdentity, contract?: string) {
  const { tokens, collections } = projectComposition(project);
  const exact = contract ? project.assets.find(asset => asset.chainId === 4663 && asset.contract.toLowerCase() === contract.toLowerCase()) : null;
  if (contract && !exact) return [];
  const collection = collections.map(asset => collectionArtwork[asset.contract.toLowerCase()]).filter(Boolean);
  const token = tokens.map(asset => tokenArtwork[asset.contract.toLowerCase()]).filter(Boolean);
  // Project identity may use collection artwork; that does not assert separate
  // token artwork. A token without its own image falls back to project identity.
  // Existing project-authoritative remote art uses the already bounded server
  // artwork boundary, never an arbitrary browser image URL or a new provider.
  const canonicalProject = project.artwork && project.assets[0]?.chainId === 4663 ? `/api/vnext/token-artwork?address=${project.assets[0].contract}` : null;
  const projectArt = [canonicalProject, ...collection, ...token].filter((value): value is string => Boolean(value));
  const assetArt = exact ? (exact.kind === "ERC20" ? [tokenArtwork[exact.contract.toLowerCase()] ?? projectArt[0], `/api/vnext/token-artwork?address=${exact.contract}`] : [collectionArtwork[exact.contract.toLowerCase()]]) : [];
  return [...new Set([...assetArt, ...projectArt].filter((value): value is string => Boolean(value)))];
}
