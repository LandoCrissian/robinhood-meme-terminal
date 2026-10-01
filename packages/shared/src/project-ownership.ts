import { getAddress, isAddress, type Address } from "viem";
import type { RmtProjectIdentity } from "./project-identity.js";

/** Facts only. No eligibility, valuation, identity merging or benefits. */
export type ProjectAssetOwnership = {
  chainId: 4663; contract: Address; wallet: Address;
  state: "READY" | "UNAVAILABLE"; balance: string | null;
  authority: "RMT_NFT_INDEXER" | "ONCHAIN_BALANCE";
  blockNumber: string | null; blockHash: string | null; observedAt: string | null;
};
export function parseProjectOwnershipFact(value: unknown, contract: Address, wallet: Address): ProjectAssetOwnership | null {
  if (!value || typeof value !== "object") return null;
  const fact = value as ProjectAssetOwnership;
  if (fact.chainId !== 4663 || typeof fact.contract !== "string" || fact.contract.toLowerCase() !== contract.toLowerCase() || typeof fact.wallet !== "string" || fact.wallet.toLowerCase() !== wallet.toLowerCase() || !["RMT_NFT_INDEXER", "ONCHAIN_BALANCE"].includes(fact.authority)) return null;
  if (fact.state === "UNAVAILABLE") return fact.balance === null && fact.blockNumber === null && fact.blockHash === null && fact.observedAt === null ? fact : null;
  if (fact.state !== "READY" || typeof fact.balance !== "string" || !/^\d{1,78}$/.test(fact.balance) || BigInt(fact.balance) > 2n ** 256n - 1n || typeof fact.blockNumber !== "string" || !/^\d{1,78}$/.test(fact.blockNumber) || typeof fact.blockHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(fact.blockHash) || typeof fact.observedAt !== "string" || !Number.isFinite(Date.parse(fact.observedAt))) return null;
  return fact;
}
export function summarizeProjectOwnership(project: RmtProjectIdentity, wallet: Address, facts: readonly ProjectAssetOwnership[]) {
  const assets = project.assets.map(asset => {
    const matches = facts.map(item => parseProjectOwnershipFact(item, asset.contract, wallet)).filter((item): item is ProjectAssetOwnership => item !== null);
    const fact = matches.length === 1 ? matches[0] : null;
    const known = fact?.state === "READY";
    return { asset, fact: known ? fact : null, holds: known ? BigInt(fact.balance!) > 0n : null };
  });
  const side = (kind: "TOKEN" | "NFT") => {
    const group = assets.filter(item => (item.asset.kind === "ERC20") === (kind === "TOKEN"));
    return group.some(item => item.holds === true) ? true : group.some(item => item.holds === null) ? null : false;
  };
  const token = side("TOKEN"), nft = side("NFT");
  const nftRows = assets.filter(item => item.asset.kind !== "ERC20");
  const consistent = new Set(assets.filter(item => item.holds).map(item => `${item.fact!.blockNumber}:${item.fact!.blockHash}`)).size <= 1;
  return { projectId: project.projectId, chainId: 4663 as const, wallet: getAddress(wallet), assets, holdsToken: token, holdsNft: nft,
    holdsBoth: token === false || nft === false ? false : token === null || nft === null || !consistent ? null : true,
    nftCount: nftRows.some(item => !item.fact) || new Set(nftRows.map(item => `${item.fact!.blockNumber}:${item.fact!.blockHash}`)).size > 1 ? null : nftRows.reduce((sum, item) => sum + BigInt(item.fact!.balance!), 0n).toString() };
}
export function projectsRepresentedInWallet(projects: readonly RmtProjectIdentity[], wallet: Address, facts: readonly ProjectAssetOwnership[]) {
  return projects.map(project => summarizeProjectOwnership(project, wallet, facts));
}
export type CompleteHolderSet = { chainId: 4663; contract: Address; blockNumber: string; blockHash: string; completeness: "COMPLETE" | "PARTIAL" | "UNAVAILABLE"; holders: readonly Address[]; authority: "RMT_CANONICAL_OWNERSHIP" };
export function exactHolderOverlap(token: CompleteHolderSet, nft: CompleteHolderSet) {
  if (token.chainId !== 4663 || nft.chainId !== 4663 || token.completeness !== "COMPLETE" || nft.completeness !== "COMPLETE" || !isAddress(token.contract, { strict: false }) || !isAddress(nft.contract, { strict: false }) || !/^\d+$/.test(token.blockNumber) || !/^0x[0-9a-fA-F]{64}$/.test(token.blockHash) || token.blockNumber !== nft.blockNumber || token.blockHash !== nft.blockHash || !token.holders.every(address => isAddress(address, { strict: false })) || !nft.holders.every(address => isAddress(address, { strict: false }))) return { state: "UNAVAILABLE" as const, tokenHolders: null, nftHolders: null, both: null };
  const t = new Set(token.holders.map(a => a.toLowerCase())), n = new Set(nft.holders.map(a => a.toLowerCase()));
  return { state: "READY" as const, tokenHolders: t.size, nftHolders: n.size, both: [...t].filter(a => n.has(a)).length };
}
// Future enrichment contracts do not replace deterministic ownership facts.
export type ProjectHolderEnrichment = { authority: "ENRICHMENT_ONLY"; provider: "BUBBLEMAPS"; chainId: 4663; contract: Address; observedAt: string; mapReference: string; clusters: readonly { addresses: readonly Address[]; concentrationBps: number | null }[] };
export type ProjectLaunchOrigin = { source: "PONS" | "STONKBROKERS" | "INDEPENDENT" | "OTHER_VERIFIED_SOURCE"; evidence: readonly import("./project-identity.js").ProjectEvidence[]; launchTime: string | null; generation: string | null; bondingState: string | null; graduationState: string | null; graduatedMarket: Address | null };
export type ProjectReferenceRelationship = { kind: "RWA" | "STOCK_TOKEN" | "STABLECOIN"; chainId: 4663; onchainAsset: Address; reference: string; issuer: string | null; evidence: readonly import("./project-identity.js").ProjectEvidence[] };
