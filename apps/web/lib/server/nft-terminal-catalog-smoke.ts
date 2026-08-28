import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { RmtNftProjectInventoryRead } from "@rmt/shared/nft/project-inventory";
import {
  RMT_CURATED_NFT_PROJECTS,
  type RmtCuratedNftProject,
} from "@rmt/shared/nft/project-registry";
import type { RmtNftProjectMarketReadModel } from "@rmt/shared/nft/project-market";
import {
  NFT_TERMINAL_CATALOG_PREVIEW_LIMIT,
  activePublicRmtNftCollections,
  activePublicRmtNftProjects,
  readRmtNftTerminalCatalog,
  recentlyAddedPublicRmtNftProjects,
} from "./nft-terminal-catalog";

const admitted = RMT_CURATED_NFT_PROJECTS[0]!;
const fixture = (projectId: string, status: RmtCuratedNftProject["status"], approvedAt: string): RmtCuratedNftProject => ({
  ...admitted,
  projectId,
  displayName: projectId.toUpperCase(),
  status,
  approvedAt,
  collections: admitted.collections.map((collection, index) => ({
    ...collection,
    contractAddress: `0x${String(index + Number.parseInt(projectId.slice(-1), 36) + 1).padStart(40, "0")}` as `0x${string}`,
  })),
});
const projects = [
  fixture("active-a", "ACTIVE", "2026-08-25T00:00:00.000Z"),
  fixture("active-b", "ACTIVE", "2026-08-27T00:00:00.000Z"),
  fixture("paused-1", "PAUSED", "2026-08-28T00:00:00.000Z"),
  fixture("removed-1", "REMOVED", "2026-08-29T00:00:00.000Z"),
  fixture("watching-1", "WATCHING", "2026-08-30T00:00:00.000Z"),
];

async function main() {
assert.deepEqual(activePublicRmtNftProjects(projects).map((project) => project.projectId), ["active-a", "active-b"]);
assert.deepEqual(recentlyAddedPublicRmtNftProjects(projects).map((project) => project.projectId), ["active-b", "active-a"]);
assert.deepEqual(activePublicRmtNftCollections(projects).map((collection) => collection.projectId), ["active-a", "active-b"]);
assert.deepEqual(activePublicRmtNftProjects().map((project) => project.projectId), ["ccff00"]);
assert.equal(admitted.projectToken, null);

const inventory: RmtNftProjectInventoryRead = {
  schemaVersion: 1,
  projectId: "ccff00",
  chainId: 4663,
  collectionAddress: admitted.collections[0]!.contractAddress,
  collectionStandard: "ERC721",
  availability: "AVAILABLE",
  availabilityReason: null,
  asOf: "2026-08-27T00:00:00.000Z",
  items: [],
  nextCursor: null,
};
const market = {
  schemaVersion: 1,
  project: {
    projectId: "ccff00",
    displayName: "CCFF00",
    status: "ACTIVE",
    rmtCurated: true,
    chainId: 4663,
    collections: [{ contractAddress: admitted.collections[0]!.contractAddress, standard: "ERC721" }],
    links: [],
  },
  onchain: {
    schemaVersion: 1,
    projectId: "ccff00",
    chainId: 4663,
    collectionAddress: admitted.collections[0]!.contractAddress,
    collectionStandard: "ERC721",
    sourceStatus: "SYNCED",
    availability: "AVAILABLE",
    completeness: "COMPLETE",
    holderCount: "17",
    circulatingTokenCount: "24",
    recentActivity: [],
    asOf: "2026-08-27T00:00:00.000Z",
  },
  marketplace: { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" },
  projectToken: null,
} as const satisfies RmtNftProjectMarketReadModel;

let inventoryLimit: number | undefined;
const catalog = await readRmtNftTerminalCatalog("active", {
  readMarket: async () => market,
  readInventory: async (_projectId, request) => {
    inventoryLimit = request?.limit;
    return inventory;
  },
});
assert.equal(catalog.projects.length, 1);
assert.equal(catalog.projects[0]!.projectId, "ccff00");
assert.equal(catalog.projects[0]!.projectToken, null);
assert.equal(catalog.projects[0]!.market && "project" in catalog.projects[0]!.market && catalog.projects[0]!.market.onchain.availability, "AVAILABLE");
assert.equal(inventoryLimit, NFT_TERMINAL_CATALOG_PREVIEW_LIMIT);
assert.equal(NFT_TERMINAL_CATALOG_PREVIEW_LIMIT, 4);

const unavailableCatalog = await readRmtNftTerminalCatalog("active", {
  readMarket: async () => ({
    ...market,
    onchain: { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" },
    marketplace: { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" },
  }),
  readInventory: async () => ({ availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" }),
});
assert.equal(unavailableCatalog.projects[0]!.projectId, "ccff00", "registry admission survives live-service degradation");

const catalogPage = readFileSync(new URL("../../app/nft/page.tsx", import.meta.url), "utf8");
const projectPage = readFileSync(new URL("../../app/nft/[projectId]/page.tsx", import.meta.url), "utf8");
const terminal = readFileSync(new URL("../../app/vnext/terminal-presentations.tsx", import.meta.url), "utf8");
const chrome = readFileSync(new URL("../../app/public-chrome.tsx", import.meta.url), "utf8");
const catalogReader = readFileSync(new URL("./nft-terminal-catalog.ts", import.meta.url), "utf8");
const radarReader = readFileSync(new URL("./nft-mint-radar.ts", import.meta.url), "utf8");
const publicSources = [catalogPage, terminal, chrome, catalogReader].join("\n");

assert.match(catalogPage, /RMT NFT Terminal/);
assert.match(catalogPage, /Active[\s\S]*Recently Added[\s\S]*Collections/);
assert.match(catalogPage, /Lowest OpenSea listing/);
assert.match(catalogPage, /Mint Radar/);
assert.match(catalogPage, /DISCOVERY · NOT ADMISSION/);
assert.match(catalogPage, /data-radar-admission=\{candidate\.rmtAdmission\}/);
assert.match(catalogPage, /Active Collections/);
assert.match(catalogPage, /Suspense fallback=\{<MintRadarFallback/);
assert.match(catalogPage, /Schedule evidence could not be established\. Active RMT collections remain available\./);
assert.doesNotMatch(catalogPage, /No upcoming mints/i);
assert.doesNotMatch(radarReader, /project-intake|RMT_NFT_PROJECT_INTAKE|RMT_CURATED_NFT_PROJECTS/);
assert.match(radarReader, /projectTokenRelationship: null/);
assert.match(radarReader, /rmtAdmission: "NOT_EVALUATED"/);
assert.match(projectPage, /limit: 24/);
assert.match(projectPage, /href="\/nft"/);
assert.equal((terminal.match(/data-terminal-nav="nft" href="\/nft"/g) ?? []).length, 2);
assert.doesNotMatch(terminal, /TerminalContext[\s\S]{0,100}["']nft["']/);
assert.match(chrome, /<PublicLink href="\/nft">NFTs<\/PublicLink>/);
assert.match(chrome, /NFT Terminal<small>RMT-curated NFT projects and Project Markets/);
assert.match(chrome, /<PublicLink href="\/sources">Sources/);
assert.equal((chrome.match(/<PublicLink href="\/nft">/g) ?? []).length, 3);
assert.doesNotMatch(catalogReader, /project-intake|RMT_NFT_PROJECT_INTAKE/);
for (const name of ["Hopium Machines", "Robin Rabbits", "CannaCats", "Pixel Hood Minis", "World Weed Seeds", "Peeps", "Gogh Punks", "Clay StonKz"]) {
  assert.doesNotMatch(publicSources, new RegExp(name, "i"));
}
assert.doesNotMatch(publicSources, /HoodStreet|discoveryProvenance/i);
assert.doesNotMatch(catalogPage, />\s*(BUY|LIST|OFFER|FULFILL|SIGN|SUBMIT|ACCEPT|SWEEP)\s*</i);
console.info("NFT Terminal catalog admission, degradation, preview, and navigation smoke: PASS");
}

void main();
