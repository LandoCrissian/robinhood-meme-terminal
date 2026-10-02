import type { RmtProjectIdentity, ProjectEvidence } from "./project-identity.js";

const observedAt = "2026-10-01T16:30:02.090Z";
const blockNumber = "77518907";
const owner: ProjectEvidence = { class: "OWNER_VERIFIED", source: "RMT_PROJECT_GRAPH_CCFF00_AND_PROJECT_MARKETS_V1", observedAt };
const onchain: ProjectEvidence = { class: "ONCHAIN_VERIFIED", source: "https://rpc.mainnet.chain.robinhood.com/", observedAt, blockNumber };
const provider = (source: string): ProjectEvidence => ({ class: "PROVIDER_VERIFIED", source, observedAt });
const official = (source: string): ProjectEvidence => ({ class: "PROJECT_OFFICIAL", source, observedAt });
const link = (label: string, url: string, source: string, evidenceClass: ProjectEvidence["class"] = "DERIVED") => ({ label, url, evidence: [{ class: evidenceClass, source, observedAt }] });
const collection = (contract: `0x${string}`, name: string, symbol: string, source: string) => ({ chainId: 4663 as const, contract, kind: "ERC721" as const, name, symbol, relationship: "OWNER_APPROVED_COLLECTION" as const, observedAt, verification: "VERIFIED" as const, evidence: [owner, onchain, provider(source)] });
const token = (contract: `0x${string}`, name: string, symbol: string, source: string) => ({ chainId: 4663 as const, contract, kind: "ERC20" as const, name, symbol, decimals: 18, relationship: "OWNER_CONFIRMED_PROJECT_TOKEN" as const, observedAt, verification: "VERIFIED" as const, evidence: [owner, onchain, source.includes("opensea.io") ? provider(source) : official(source)] });
// Read-only verification record: docs/projects/initial-project-evidence.json.
// These units are observed facts, not defaults. No supply/holder/market totals
// are pinned here. Graph data cannot authorize an ordinary-token transaction.
export const INITIAL_PROJECT_EVIDENCE: readonly RmtProjectIdentity[] = [
  { projectId: "cannacats", displayName: "CannaCats", discovery: "VERIFIED", artwork: null,
    officialEvidence: [{ kind: "OWNER_VERIFIED", url: "https://opensea.io/collection/cannacats" }],
    links: [link("OpenSea", "https://opensea.io/collection/cannacats", "https://opensea.io/collection/cannacats", "PROVIDER_VERIFIED"), link("X", "https://x.com/CannaCatMeme", "https://opensea.io/collection/cannacats")],
    assets: [token("0x1139d423C1706BDeaD91f03507F521635591eD92", "CannaCat", "CANNACAT", "https://opensea.io/collection/cannacats"), collection("0x289c8ce652f38029867842048068b39bd0464a3f", "CannaCats", "CCATS", "https://opensea.io/collection/cannacats")] },
  { projectId: "hopium-machines", displayName: "Hopium Machines", discovery: "VERIFIED", artwork: null,
    officialEvidence: [{ kind: "OWNER_VERIFIED", url: "https://opensea.io/collection/hopium-machines" }],
    links: [link("OpenSea", "https://opensea.io/collection/hopium-machines", "https://opensea.io/collection/hopium-machines", "PROVIDER_VERIFIED"), link("Website", "https://hopiummachines.xyz/", "https://opensea.io/collection/hopium-machines")],
    assets: [token("0xB6cE51925C2e397eBF1a443b343d19267B3D4225", "Hopium Machines", "HOPIUM", "https://x.com/HopiumMachines"), collection("0x7da15c761409cb921a81f0e003704cff418b700b", "Hopium Machines", "HOPIUM", "https://opensea.io/collection/hopium-machines")] },
  { projectId: "peeps", displayName: "Founding Feathers", discovery: "VERIFIED", artwork: null,
    officialEvidence: [{ kind: "PROJECT_OFFICIAL", url: "https://peeps.wtf/launchpad/peeps" }, { kind: "OWNER_VERIFIED", url: "https://opensea.io/collection/peep-founding-feathers-506906521" }],
    links: [link("Website", "https://peeps.wtf/", "https://peeps.wtf/launchpad/peeps", "PROJECT_OFFICIAL"), link("X", "https://x.com/PEEPZonRH", "https://opensea.io/collection/peep-founding-feathers-506906521"), link("OpenSea", "https://opensea.io/collection/peep-founding-feathers-506906521", "https://opensea.io/collection/peep-founding-feathers-506906521", "PROVIDER_VERIFIED")],
    assets: [collection("0xc1605fb719f388110b1b0f384b7ffd64ba4ba5df", "PEEP Founding Feathers", "PEEP", "https://opensea.io/collection/peep-founding-feathers-506906521")] },
  { projectId: "ccff00", displayName: "CCFF00", discovery: "VERIFIED", artwork: null,
    officialEvidence: [{ kind: "PROJECT_OFFICIAL", url: "https://hoodstreet.capital/ccff00" }],
    links: [link("Website", "https://hoodstreet.capital/ccff00", "https://hoodstreet.capital/ccff00", "PROJECT_OFFICIAL"), link("X", "https://x.com/CCFF00club", "https://opensea.io/collection/ccff00-161927574"), link("OpenSea", "https://opensea.io/collection/ccff00-161927574", "https://opensea.io/collection/ccff00-161927574", "PROVIDER_VERIFIED")],
    assets: [collection("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146", "CCFF00", "CCFF00", "https://opensea.io/collection/ccff00-161927574")] }
];

// Historical evidence is retained separately from active assets/search/ownership.
// Withdrawal changes project intelligence only; it is not token admission policy.
export const WITHDRAWN_PROJECT_RELATIONSHIPS = [{
  projectId: "peeps", type: "PROJECT_HAS_TOKEN", reason: "OWNER_WITHDREW_TOKEN_RELATIONSHIP",
  asset: token("0xf202de51bb42a0073948b0971707d14c54ef5f44", "Peeps", "PEEPS", "https://peeps.wtf/launchpad/peeps"),
  decisionEvidence: { class: "OWNER_VERIFIED", source: "RMT_PROJECT_MARKETS_FINAL_PRODUCT_QUALITY_V1" }
}] as const;
