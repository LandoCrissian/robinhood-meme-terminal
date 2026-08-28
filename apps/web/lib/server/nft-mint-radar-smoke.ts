import assert from "node:assert/strict";
import { keccak256, zeroAddress, type Address, type PublicClient } from "viem";
import {
  buildRmtMintRadar,
  createRmtMintRadarCache,
  evaluatePublishedAllowlistOverlap,
  mintLog,
  parseOpenSeaDetailedDrop,
  parseOpenSeaDrops,
  parseReviewedSeaDropDeployments,
  providerReportedCcff00Access,
  readRmtNftMintRadar,
  RMT_MINT_RADAR_FRESH_MS,
  unknownCcff00Access,
  verifyCcff00SeaDropGate,
  verifyMintRadarContract,
  type RmtMintRadarContractEvidence,
} from "./nft-mint-radar";
import {
  RMT_ERC1155_TRANSFER_SINGLE_TOPIC,
  RMT_ERC721_TRANSFER_TOPIC,
} from "@rmt/shared/nft/activity-domain";
import type { VerifiedContractLog } from "./blockscout-contract-logs";

const NOW = new Date("2026-08-28T12:00:00.000Z");
const CONTRACT = "0x1111111111111111111111111111111111111111" as Address;
const CONTRACT_TWO = "0x2222222222222222222222222222222222222222" as Address;
const SEADROP = "0x3333333333333333333333333333333333333333" as Address;
const CCFF00 = "0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146" as Address;
const OWNER = "0x4444444444444444444444444444444444444444" as Address;
const HASH = `0x${"1".repeat(64)}` as const;
const ZERO_TOPIC = `0x${"0".repeat(64)}` as const;

function stage(start: string, end: string, label = "Public") {
  return {
    uuid: `stage-${start}`,
    stage_type: "public_sale",
    label,
    price: "12500000000000000",
    price_currency_address: zeroAddress,
    start_time: start,
    end_time: end,
    max_per_wallet: "2",
  };
}

function drop(overrides: Record<string, unknown> = {}) {
  return {
    collection_slug: "radar-one",
    collection_name: "Radar One",
    chain: "robinhood",
    contract_address: CONTRACT,
    drop_type: "seadrop_v1_erc721",
    is_minting: false,
    image_url: "https://example.invalid/not-rendered.png",
    opensea_url: "https://opensea.io/collection/radar-one",
    active_stage: null,
    next_stage: stage("2026-08-28T13:00:00.000Z", "2026-08-28T14:00:00.000Z"),
    ...overrides,
  };
}

function page(...drops: unknown[]) {
  return { drops, next: null };
}

function detailedDrop(overrides: Record<string, unknown> = {}) {
  const next = stage("2026-08-28T13:00:00.000Z", "2026-08-28T14:00:00.000Z");
  return {
    collection_slug: "radar-one",
    collection_name: "Radar One",
    chain: "robinhood",
    contract_address: CONTRACT,
    drop_type: "seadrop_v1_erc721",
    is_minting: false,
    active_stage: null,
    next_stage: next,
    stages: [next],
    total_supply: "12",
    max_supply: "1000",
    ...overrides,
  };
}

const verified: RmtMintRadarContractEvidence = {
  status: "ONCHAIN_VERIFIED_CONTRACT",
  codeExists: true,
  supportsErc165: true,
  supportsInvalidInterface: false,
  supportsErc721: true,
  supportsErc1155: false,
  supportsErc721Metadata: true,
  standard: "ERC721",
  observedAt: NOW.toISOString(),
};

async function main() {
const providerOnly = parseOpenSeaDrops(page(drop({ contract_address: "unknown" })), "upcoming", NOW);
assert.equal(providerOnly.length, 1);
assert.equal(providerOnly[0]!.collectionAddress, null);
assert.equal(providerOnly[0]!.rmtAdmission, "NOT_EVALUATED");
assert.equal(providerOnly[0]!.projectTokenRelationship, null);
assert.throws(() => parseOpenSeaDrops(page(drop({ chain: "base" })), "upcoming", NOW), /wrong chain/);
assert.throws(() => parseOpenSeaDrops({ results: [] }, "upcoming", NOW), /malformed/);
assert.throws(() => parseOpenSeaDrops(page(drop({ next_stage: { bad: true } })), "upcoming", NOW), /currency|stage/);
const parsedDetail = parseOpenSeaDetailedDrop(detailedDrop(), { providerCollectionSlug: "radar-one", collectionAddress: CONTRACT });
assert.equal(parsedDetail.collectionAddress, CONTRACT);
assert.equal(parsedDetail.stages.length, 1);
assert.equal(parsedDetail.maxSupply, "1000");
assert.throws(() => parseOpenSeaDetailedDrop(detailedDrop({ chain: "base" }), { providerCollectionSlug: "radar-one", collectionAddress: CONTRACT }), /wrong chain/);
assert.throws(() => parseOpenSeaDetailedDrop(detailedDrop({ stages: "not-an-array" }), { providerCollectionSlug: "radar-one", collectionAddress: CONTRACT }), /stages/);

const seaDropCode = "0x60016000" as const;
const reviewed = parseReviewedSeaDropDeployments(`${SEADROP}@${keccak256(seaDropCode)}`);
assert.equal(reviewed.length, 1);
assert.throws(() => parseReviewedSeaDropDeployments(`${SEADROP}@0x01`), /address@runtimeBytecodeHash/);
const seaDropClient = {
  getChainId: async () => 4663,
  getBytecode: async ({ address }: { address: Address }) => address === SEADROP ? seaDropCode : undefined,
  readContract: async ({ functionName }: { functionName: string }) => functionName === "getTokenGatedAllowedTokens" ? [CCFF00] : {
    mintPrice: 12_500_000_000_000_000n,
    maxTotalMintableByWallet: 2n,
    startTime: 1_787_922_000n,
    endTime: 1_787_925_600n,
    dropStageIndex: 7n,
    maxTokenSupplyForStage: 500n,
    feeBps: 0n,
    restrictFeeRecipients: false,
  },
} as unknown as PublicClient;
const verifiedAccess = await verifyCcff00SeaDropGate({
  client: seaDropClient,
  dropCollection: CONTRACT,
  providerStage: parseOpenSeaDrops(page(drop()), "upcoming", NOW)[0]!.stage,
  deployments: reviewed,
  observedAt: NOW.toISOString(),
});
assert.equal(verifiedAccess.status, "VERIFIED_COMMUNITY_GATE");
assert.equal(verifiedAccess.authority, "ONCHAIN_SEADROP_CONFIGURATION");
assert.equal(verifiedAccess.stage?.maxPerWallet, "2");
assert.equal(verifiedAccess.walletEligibility.status, "NOT_CHECKED");
const networkUnknown = await verifyCcff00SeaDropGate({
  client: { ...seaDropClient, getChainId: async () => { throw new Error("offline"); } } as unknown as PublicClient,
  dropCollection: CONTRACT,
  providerStage: null,
  deployments: reviewed,
  observedAt: NOW.toISOString(),
});
assert.equal(networkUnknown.status, "UNKNOWN", "network failure is inconclusive access evidence");

const overlap = evaluatePublishedAllowlistOverlap({
  allowlistAddresses: [OWNER, CONTRACT_TWO], canonicalCcff00Owners: [OWNER], observedAt: NOW.toISOString(), source: "DETERMINISTIC_PUBLIC_ALLOWLIST",
});
assert.equal(overlap.status, "HOLDER_MATCHES_DETECTED");
assert.equal(overlap.holderMatches.matchingHolderCount, 1);
const noOverlap = evaluatePublishedAllowlistOverlap({
  allowlistAddresses: [CONTRACT_TWO], canonicalCcff00Owners: [OWNER], observedAt: NOW.toISOString(), source: "DETERMINISTIC_PUBLIC_ALLOWLIST",
});
assert.equal(noOverlap.status, "UNKNOWN");
assert.equal(noOverlap.holderMatches.matchingHolderCount, 0);
const merkleOnly = evaluatePublishedAllowlistOverlap({
  allowlistAddresses: null, canonicalCcff00Owners: [OWNER], observedAt: NOW.toISOString(), source: "MERKLE_ROOT", merkleRootOnly: true,
});
assert.equal(merkleOnly.status, "UNKNOWN");
assert.match(merkleOnly.evidence[0]!.detail, /cannot establish holder overlap/);
const reported = providerReportedCcff00Access({ exactCollectionAddress: CCFF00, observedAt: NOW.toISOString(), source: "OPENSEA_EXPLICIT_ACCESS_FIELD" });
assert.equal(reported.status, "PROVIDER_REPORTED");
assert.equal(providerReportedCcff00Access({ exactCollectionAddress: null, observedAt: NOW.toISOString(), source: "STAGE_LABEL_ONLY" }).status, "UNKNOWN");
assert.equal(unknownCcff00Access(NOW.toISOString()).walletEligibility.status, "NOT_CHECKED");

const radar = await buildRmtMintRadar({
  featured: page(drop({
    collection_slug: "live-one",
    collection_name: "Live One",
    is_minting: true,
    active_stage: stage("2026-08-28T11:00:00.000Z", "2026-08-28T13:00:00.000Z"),
    next_stage: null,
  })),
  upcoming: page(
    drop({ collection_slug: "later", collection_name: "Later", contract_address: "provider-only", next_stage: stage("2026-08-30T12:00:00.000Z", "2026-08-30T13:00:00.000Z") }),
    drop({ collection_slug: "sooner", collection_name: "Sooner", contract_address: CONTRACT_TWO, next_stage: stage("2026-08-29T12:00:00.000Z", "2026-08-29T13:00:00.000Z", "Allowlist") }),
  ),
  recentlyMinted: page(drop({
    collection_slug: "recent-one",
    collection_name: "Recent One",
    is_minting: false,
    active_stage: stage("2026-08-27T10:00:00.000Z", "2026-08-27T11:00:00.000Z"),
    next_stage: null,
  })),
}, {
  now: () => NOW,
  verifyContract: async (address) => address === CONTRACT ? verified : { ...verified, standard: "ERC1155", supportsErc721: false, supportsErc721Metadata: null, supportsErc1155: true },
  readMintActivity: async (address) => address === CONTRACT ? {
    status: "ONCHAIN_MINT_ACTIVITY",
    transactionHash: HASH,
    blockNumber: "123",
    observedAt: NOW.toISOString(),
    marketMeaning: "NOT_ESTABLISHED",
  } : { status: "NOT_OBSERVED_IN_SAMPLE", transactionHash: null, blockNumber: null, observedAt: null, marketMeaning: "NOT_ESTABLISHED" },
});
assert.equal(radar.chainId, 4663);
assert.equal(radar.providerChain, "robinhood");
assert.equal(radar.status, "READY");
assert.deepEqual(radar.live.map((item) => item.providerCollectionSlug), ["live-one"]);
assert.deepEqual(radar.upcoming.map((item) => item.providerCollectionSlug), ["sooner", "later"], "upcoming is chronological");
assert.deepEqual(radar.recent.map((item) => item.providerCollectionSlug), ["recent-one"]);
assert.equal(radar.live[0]!.mintActivity.marketMeaning, "NOT_ESTABLISHED", "mint activity never implies sale");
assert.deepEqual(radar.live[0]!.evidence, ["PROVIDER_REPORTED", "ONCHAIN_VERIFIED_CONTRACT", "ONCHAIN_MINT_ACTIVITY"]);
assert.equal(radar.upcoming[1]!.contractEvidence.status, "PROVIDER_ONLY");
assert.equal(radar.upcoming[1]!.mintActivity.status, "NOT_CHECKED");
assert.equal(radar.upcoming[1]!.rmtAdmission, "NOT_EVALUATED");
assert.equal(radar.upcoming[1]!.projectTokenRelationship, null);
assert.equal(radar.upcoming[1]!.ccff00Access.status, "UNKNOWN");

const accessBoundRadar = await buildRmtMintRadar({ featured: page(), upcoming: page(drop()), recentlyMinted: page() }, {
  now: () => NOW,
  verifyContract: async () => verified,
  readMintActivity: async () => ({ status: "NOT_OBSERVED_IN_SAMPLE", transactionHash: null, blockNumber: null, observedAt: null, marketMeaning: "NOT_ESTABLISHED" }),
  readDetailedDrop: async () => parsedDetail,
  readCcff00Access: async () => verifiedAccess,
});
assert.equal(accessBoundRadar.upcoming[0]!.ccff00Access.status, "VERIFIED_COMMUNITY_GATE");
assert.equal(accessBoundRadar.upcoming[0]!.rmtAdmission, "NOT_EVALUATED", "access evidence never mutates RMT admission");
assert.equal(accessBoundRadar.upcoming[0]!.projectTokenRelationship, null, "access evidence never creates a project-token relationship");

const empty = await buildRmtMintRadar({ featured: page(), upcoming: page(), recentlyMinted: page() }, {
  now: () => NOW,
  verifyContract: async () => verified,
  readMintActivity: async () => ({ status: "NOT_OBSERVED_IN_SAMPLE", transactionHash: null, blockNumber: null, observedAt: null, marketMeaning: "NOT_ESTABLISHED" }),
});
assert.equal(empty.status, "EMPTY");

function providerFetch(pages: Record<string, unknown>, failure = false): typeof fetch {
  return (async (input) => {
    if (failure) throw new Error("provider unavailable");
    const type = new URL(String(input)).searchParams.get("type")!;
    return new Response(JSON.stringify(pages[type]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const env = { NFT_MINT_RADAR_OPENSEA_API_KEY: "server-only-fixture", NFT_MINT_RADAR_OPENSEA_BASE_URL: "http://127.0.0.1:43111" };
const cache = createRmtMintRadarCache();
const pages = { featured: page(), upcoming: page(drop()), recently_minted: page() };
let clock = NOW;
const initial = await readRmtNftMintRadar({ env, cache, fetchImpl: providerFetch(pages), now: () => clock, verifyContract: async () => verified, readMintActivity: async () => ({ status: "NOT_OBSERVED_IN_SAMPLE", transactionHash: null, blockNumber: null, observedAt: null, marketMeaning: "NOT_ESTABLISHED" }) });
assert.equal(initial.status, "READY");
clock = new Date(NOW.getTime() + RMT_MINT_RADAR_FRESH_MS + 1);
const stale = await readRmtNftMintRadar({ env, cache, fetchImpl: providerFetch(pages, true), now: () => clock, verifyContract: async () => verified });
assert.equal(stale.status, "STALE");
assert.equal(stale.upcoming.length, 1, "stale response preserves last known evidence");
const unavailable = await readRmtNftMintRadar({ env, cache: createRmtMintRadarCache(), fetchImpl: providerFetch(pages, true), now: () => NOW });
assert.equal(unavailable.status, "UNAVAILABLE");
assert.equal(unavailable.asOf, null);
assert.equal(unavailable.upcoming.length, 0, "unavailable is not represented as a successful empty feed");

const baseLog: VerifiedContractLog = {
  blockNumber: 1n,
  blockTimestamp: NOW.toISOString(),
  transactionHash: HASH,
  topics: [RMT_ERC721_TRANSFER_TOPIC, ZERO_TOPIC, ZERO_TOPIC, ZERO_TOPIC],
  data: "0x",
  method: null,
  parameters: new Map(),
};
assert.equal(mintLog(baseLog, "ERC721"), true);
assert.equal(mintLog({ ...baseLog, topics: [RMT_ERC721_TRANSFER_TOPIC, HASH, ZERO_TOPIC, ZERO_TOPIC] }, "ERC721"), false, "ordinary transfer is not a mint");
assert.equal(mintLog({ ...baseLog, topics: [RMT_ERC1155_TRANSFER_SINGLE_TOPIC, HASH, ZERO_TOPIC, HASH] }, "ERC1155"), true);
assert.equal(mintLog({ ...baseLog, topics: [RMT_ERC1155_TRANSFER_SINGLE_TOPIC, HASH, HASH, ZERO_TOPIC] }, "ERC1155"), false, "ERC1155 nonzero sender is not a mint");

const verifiedClient = {
  getChainId: async () => 4663,
  getBytecode: async () => "0x6000",
  readContract: async ({ args }: { args: readonly [`0x${string}`] }) => ({
    "0x01ffc9a7": true,
    "0xffffffff": false,
    "0x80ac58cd": true,
    "0xd9b67a26": false,
    "0x5b5e139f": true,
  } as Record<string, boolean>)[args[0]],
} as unknown as PublicClient;
const directVerification = await verifyMintRadarContract(verifiedClient, CONTRACT, NOW.toISOString());
assert.equal(directVerification.status, "ONCHAIN_VERIFIED_CONTRACT");
assert.equal(directVerification.standard, "ERC721");
assert.equal(directVerification.supportsErc721Metadata, true);
const noCode = await verifyMintRadarContract({ ...verifiedClient, getBytecode: async () => undefined } as unknown as PublicClient, CONTRACT, NOW.toISOString());
assert.equal(noCode.status, "NO_CONTRACT_CODE");
const wrongChain = await verifyMintRadarContract({ ...verifiedClient, getChainId: async () => 1 } as unknown as PublicClient, CONTRACT, NOW.toISOString());
assert.equal(wrongChain.status, "INCONCLUSIVE_MALFORMED_PROVIDER_RESPONSE");
const rpcUnavailable = await verifyMintRadarContract({ ...verifiedClient, getChainId: async () => { throw new Error("offline"); } } as unknown as PublicClient, CONTRACT, NOW.toISOString());
assert.equal(rpcUnavailable.status, "INCONCLUSIVE_PROVIDER_UNAVAILABLE", "network failure is not contract failure");

console.info("NFT Mint Radar parser, authority, freshness, sorting, and onchain-evidence smoke: PASS");
}

void main();
