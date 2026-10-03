import type { RmtProjectIdentity } from "@rmt/shared/project-identity";

// Permanent, exact-contract presentation assets. Full original source, evidence
// class and content digest: docs/projects/project-artwork-evidence.json.
// Retaining validated artwork avoids making identity depend on marketplace uptime.
const collectionArtwork: Readonly<Record<string, string>> = {
  "0x289c8ce652f38029867842048068b39bd0464a3f": "/project-art/cannacats.avif",
  "0x7da15c761409cb921a81f0e003704cff418b700b": "/project-art/hopium-machines.avif",
  "0xc1605fb719f388110b1b0f384b7ffd64ba4ba5df": "/project-art/peeps.avif",
  "0x505a22ffed8d37ebe580ffd98d2cdb0021189146": "/project-art/ccff00.svg",
  "0x7d90c589aaaf37f2fd0e4231a5f4aa089cc91555": "/project-art/receipts.avif",
  "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6": "/project-art/gogh-punks.avif",
  "0x8215824669c453136cabe59a079c32aca2f87cd5": "/project-art/pixel-hood-minis.avif",
  "0x745c261680aebabe4a0e0ab9e0a2e8a7aa756871": "/project-art/pixel-hood-clan.avif",
  "0x496f1e53ef6c1af48341b9d0a03249108cf26543": "/project-art/sknots-go-down.avif",
  "0x0084e3f586dfd424b959e80537208cef4cbcee21": "/project-art/robinhood-bear.avif",
  "0xe638f58c87258ece6c0eddc46f70327663635c69": "/project-art/suited-ape-society.avif",
  "0xde0acefc89d4cf5f4ce45a4fb8a51aa355091b44": "/project-art/claystonkz.avif",
  "0xdb7cf5bb66efbf995545e5335cb107ed32866d29": "/project-art/spawnhood.avif",
  "0xd0350532006a2e858487411606376fa04c76468c": "/project-art/stray-cars.avif",
  "0xc180f7bb3a73edad6d30cf22813f2eba0ff3042d": "/project-art/the-undeadz.avif",
  "0xb87522e093858d992b7555077ff3541597deb34e": "/project-art/robin-rabbits.avif"
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
