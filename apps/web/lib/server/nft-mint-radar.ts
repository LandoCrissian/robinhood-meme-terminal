import { createPublicClient, getAddress, http, isAddress, isAddressEqual, keccak256, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { CCFF00_COLLECTION } from "@rmt/shared/nft/project-registry";
import {
  RMT_ERC1155_TRANSFER_BATCH_TOPIC,
  RMT_ERC1155_TRANSFER_SINGLE_TOPIC,
  RMT_ERC721_TRANSFER_TOPIC,
} from "@rmt/shared/nft/activity-domain";
import { fetchVerifiedContractLogs, type VerifiedContractLog } from "./blockscout-contract-logs";

export const RMT_MINT_RADAR_CHAIN_ID = 4_663 as const;
export const RMT_MINT_RADAR_PROVIDER_CHAIN = "robinhood" as const;
export const RMT_MINT_RADAR_SCHEMA_VERSION = 1 as const;
export const RMT_MINT_RADAR_FRESH_MS = 90_000;
export const RMT_MINT_RADAR_STALE_MS = 15 * 60_000;

const OPENSEA_SOURCE = "OPENSEA_DROPS_V2" as const;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_PROVIDER_RECORDS = 100;
const MAX_LIVE = 6;
const MAX_UPCOMING = 8;
const MAX_RECENT = 8;
const MAX_DETAILED_DROPS = MAX_LIVE + MAX_UPCOMING;
const MAX_DETAILED_STAGES = 50;
const MAX_REVIEWED_SEADROP_DEPLOYMENTS = 4;
const ERC165_ABI = [{
  type: "function",
  name: "supportsInterface",
  stateMutability: "view",
  inputs: [{ name: "interfaceId", type: "bytes4" }],
  outputs: [{ type: "bool" }],
}] as const;
const SEADROP_ABI = [
  {
    type: "function",
    name: "getTokenGatedAllowedTokens",
    stateMutability: "view",
    inputs: [{ name: "nftContract", type: "address" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "getTokenGatedDrop",
    stateMutability: "view",
    inputs: [{ name: "nftContract", type: "address" }, { name: "allowedNftToken", type: "address" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "mintPrice", type: "uint80" },
        { name: "maxTotalMintableByWallet", type: "uint16" },
        { name: "startTime", type: "uint48" },
        { name: "endTime", type: "uint48" },
        { name: "dropStageIndex", type: "uint8" },
        { name: "maxTokenSupplyForStage", type: "uint32" },
        { name: "feeBps", type: "uint16" },
        { name: "restrictFeeRecipients", type: "bool" },
      ],
    }],
  },
] as const;

export type RmtMintRadarFeedStatus = "READY" | "EMPTY" | "STALE" | "UNAVAILABLE";
export type RmtMintRadarState = "LIVE_NOW" | "UPCOMING" | "RECENTLY_MINTED";
export type RmtMintRadarStandard = "ERC721" | "ERC1155" | "UNKNOWN";
export type RmtMintRadarContractStatus =
  | "ONCHAIN_VERIFIED_CONTRACT"
  | "PROVIDER_ONLY"
  | "NO_CONTRACT_CODE"
  | "CONTRACT_EVIDENCE_CONTRADICTORY"
  | "INCONCLUSIVE_PROVIDER_UNAVAILABLE"
  | "INCONCLUSIVE_MALFORMED_PROVIDER_RESPONSE";
export type RmtMintRadarActivityStatus = "ONCHAIN_MINT_ACTIVITY" | "NOT_OBSERVED_IN_SAMPLE" | "NOT_CHECKED" | "INCONCLUSIVE_PROVIDER_UNAVAILABLE";
export type RmtMintRadarCcff00AccessStatus =
  | "VERIFIED_COMMUNITY_GATE"
  | "HOLDER_MATCHES_DETECTED"
  | "PROVIDER_REPORTED"
  | "CONNECTED_WALLET_ELIGIBLE"
  | "UNKNOWN";
export type RmtMintRadarCcff00AccessAuthority =
  | "ONCHAIN_SEADROP_CONFIGURATION"
  | "CANONICAL_CCFF00_OWNERSHIP_OVERLAP"
  | "OPENSEA_REPORTED_ACCESS"
  | "CONNECTED_WALLET_PROVIDER"
  | "NONE";

export type RmtMintRadarStage = {
  type: string;
  label: string | null;
  startTime: string;
  endTime: string;
  nativePriceWei: string | null;
  priceCurrencyAddress: Address;
  maxPerWallet: string;
};

export type RmtMintRadarContractEvidence = {
  status: RmtMintRadarContractStatus;
  codeExists: boolean | null;
  supportsErc165: boolean | null;
  supportsInvalidInterface: boolean | null;
  supportsErc721: boolean | null;
  supportsErc1155: boolean | null;
  supportsErc721Metadata: boolean | null;
  standard: RmtMintRadarStandard;
  observedAt: string;
};

export type RmtMintRadarActivityEvidence = {
  status: RmtMintRadarActivityStatus;
  transactionHash: `0x${string}` | null;
  blockNumber: string | null;
  observedAt: string | null;
  marketMeaning: "NOT_ESTABLISHED";
};

export type RmtMintRadarCcff00Access = {
  status: RmtMintRadarCcff00AccessStatus;
  authority: RmtMintRadarCcff00AccessAuthority;
  stage: null | {
    startTime: string;
    endTime: string;
    nativePriceWei: string;
    maxPerWallet: string;
    maxSupplyForStage: string;
  };
  holderMatches: {
    status: "DETECTED" | "NONE" | "NOT_CHECKED" | "UNAVAILABLE";
    matchingHolderCount: number | null;
    observedAt: string | null;
  };
  walletEligibility: { status: "NOT_CHECKED" | "UNAVAILABLE" | "ELIGIBLE"; observedAt: string | null };
  evidence: readonly {
    kind: "EXACT_CCFF00_TOKEN_GATE" | "PUBLISHED_ALLOWLIST_OVERLAP" | "PROVIDER_REPORTED_CCFF00_ACCESS" | "CONNECTED_WALLET_ELIGIBILITY" | "INCONCLUSIVE";
    source: string;
    observedAt: string;
    detail: string;
  }[];
};

export type RmtMintRadarDetailedDrop = {
  collectionSlug: string;
  collectionName: string | null;
  chain: typeof RMT_MINT_RADAR_PROVIDER_CHAIN;
  collectionAddress: Address;
  dropType: string;
  isMinting: boolean;
  activeStage: RmtMintRadarStage | null;
  nextStage: RmtMintRadarStage | null;
  stages: readonly RmtMintRadarStage[];
  totalSupply: string | null;
  maxSupply: string | null;
};

export type RmtMintRadarCandidate = {
  candidateId: string;
  chainId: typeof RMT_MINT_RADAR_CHAIN_ID;
  providerChain: typeof RMT_MINT_RADAR_PROVIDER_CHAIN;
  provider: typeof OPENSEA_SOURCE;
  providerCollectionSlug: string;
  collectionName: string;
  collectionAddress: Address | null;
  providerDropType: string;
  state: RmtMintRadarState;
  stage: RmtMintRadarStage | null;
  providerReportedMinting: boolean;
  sourceUrl: string;
  scheduleObservedAt: string;
  contractEvidence: RmtMintRadarContractEvidence;
  mintActivity: RmtMintRadarActivityEvidence;
  ccff00Access: RmtMintRadarCcff00Access;
  evidence: readonly ("PROVIDER_REPORTED" | "ONCHAIN_VERIFIED_CONTRACT" | "ONCHAIN_MINT_ACTIVITY" | "KNOWN_FACTORY_CANDIDATE")[];
  rmtAdmission: "NOT_EVALUATED";
  projectTokenRelationship: null;
};

export type RmtMintRadarResponse = {
  schemaVersion: typeof RMT_MINT_RADAR_SCHEMA_VERSION;
  chainId: typeof RMT_MINT_RADAR_CHAIN_ID;
  providerChain: typeof RMT_MINT_RADAR_PROVIDER_CHAIN;
  status: RmtMintRadarFeedStatus;
  asOf: string | null;
  sources: readonly [{ provider: typeof OPENSEA_SOURCE; authority: "PROVIDER_REPORTED_SCHEDULE"; status: RmtMintRadarFeedStatus }];
  live: readonly RmtMintRadarCandidate[];
  upcoming: readonly RmtMintRadarCandidate[];
  recent: readonly RmtMintRadarCandidate[];
};

type OpenSeaDropFeed = "featured" | "upcoming" | "recently_minted";
type ParsedProviderCandidate = Omit<RmtMintRadarCandidate, "contractEvidence" | "mintActivity" | "ccff00Access" | "evidence">;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ContractVerifier = (address: Address, observedAt: string) => Promise<RmtMintRadarContractEvidence>;
type ActivityReader = (address: Address, standard: RmtMintRadarStandard, now: Date) => Promise<RmtMintRadarActivityEvidence>;
type DetailedDropReader = (candidate: ParsedProviderCandidate) => Promise<RmtMintRadarDetailedDrop | null>;
type Ccff00AccessReader = (input: { candidate: ParsedProviderCandidate; detail: RmtMintRadarDetailedDrop | null; observedAt: string }) => Promise<RmtMintRadarCcff00Access>;

export type RmtMintRadarCache = {
  current: { response: RmtMintRadarResponse; fetchedAtMs: number } | null;
};

export type RmtMintRadarReaderOptions = {
  env?: Partial<NodeJS.ProcessEnv>;
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  cache?: RmtMintRadarCache;
  verifyContract?: ContractVerifier;
  readMintActivity?: ActivityReader;
  readDetailedDrop?: DetailedDropReader;
  readCcff00Access?: Ccff00AccessReader;
};

export function createRmtMintRadarCache(): RmtMintRadarCache {
  return { current: null };
}

const sharedCache = createRmtMintRadarCache();

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string") {
    if (required) throw new Error("OpenSea drop text field is required.");
    return null;
  }
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum);
  if (!normalized && required) throw new Error("OpenSea drop text field is empty.");
  return normalized || null;
}

function decimal(value: unknown, label: string) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`OpenSea ${label} must be a decimal integer string.`);
  }
  return value;
}

function timestamp(value: unknown, label: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`OpenSea ${label} must be an ISO timestamp.`);
  }
  return new Date(value).toISOString();
}

function providerUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("OpenSea drop URL is required.");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !/(^|\.)opensea\.io$/i.test(parsed.hostname)) {
    throw new Error("OpenSea drop URL must use an OpenSea HTTPS host.");
  }
  return parsed.toString();
}

function contractAddress(value: unknown) {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) return null;
  const normalized = getAddress(value);
  return isAddressEqual(normalized, zeroAddress) ? null : normalized;
}

function stage(value: unknown): RmtMintRadarStage | null {
  if (value === undefined || value === null) return null;
  if (!record(value)) throw new Error("OpenSea drop stage must be an object or null.");
  const currency = contractAddress(value.price_currency_address);
  const zeroCurrency = typeof value.price_currency_address === "string"
    && isAddress(value.price_currency_address, { strict: false })
    && isAddressEqual(getAddress(value.price_currency_address), zeroAddress);
  if (!currency && !zeroCurrency) throw new Error("OpenSea drop stage currency address is malformed.");
  const price = value.price === undefined || value.price === null ? null : decimal(value.price, "drop stage price");
  return {
    type: boundedText(value.stage_type, 80, true)!,
    label: boundedText(value.label, 100),
    startTime: timestamp(value.start_time, "drop stage start time"),
    endTime: timestamp(value.end_time, "drop stage end time"),
    nativePriceWei: zeroCurrency ? price : null,
    priceCurrencyAddress: zeroCurrency ? zeroAddress : currency!,
    maxPerWallet: decimal(value.max_per_wallet, "drop stage wallet limit"),
  };
}

function parseDrop(input: unknown, feed: OpenSeaDropFeed, now: Date, observedAt: string): ParsedProviderCandidate | null {
  if (!record(input)) throw new Error("OpenSea drop entry must be an object.");
  if (input.chain !== RMT_MINT_RADAR_PROVIDER_CHAIN) throw new Error("OpenSea drop entry is for the wrong chain.");
  if (typeof input.is_minting !== "boolean") throw new Error("OpenSea drop minting state must be boolean.");
  const activeStage = stage(input.active_stage);
  const nextStage = stage(input.next_stage);
  const nowMs = now.getTime();
  const activeByTime = activeStage !== null
    && Date.parse(activeStage.startTime) <= nowMs
    && Date.parse(activeStage.endTime) > nowMs;
  if (input.is_minting !== activeByTime) {
    throw new Error("OpenSea minting flag contradicts the active stage window.");
  }
  const providerCollectionSlug = boundedText(input.collection_slug, 160, true)!;
  let state: RmtMintRadarState;
  let selectedStage: RmtMintRadarStage | null;
  if (input.is_minting) {
    state = "LIVE_NOW";
    selectedStage = activeStage;
  } else if (feed === "upcoming") {
    if (!nextStage || Date.parse(nextStage.startTime) <= nowMs) return null;
    state = "UPCOMING";
    selectedStage = nextStage;
  } else if (feed === "recently_minted") {
    state = "RECENTLY_MINTED";
    selectedStage = activeStage ?? nextStage;
  } else {
    return null;
  }
  return {
    candidateId: `opensea:${providerCollectionSlug}`,
    chainId: RMT_MINT_RADAR_CHAIN_ID,
    providerChain: RMT_MINT_RADAR_PROVIDER_CHAIN,
    provider: OPENSEA_SOURCE,
    providerCollectionSlug,
    collectionName: boundedText(input.collection_name, 160) ?? providerCollectionSlug,
    collectionAddress: contractAddress(input.contract_address),
    providerDropType: boundedText(input.drop_type, 100, true)!,
    state,
    stage: selectedStage,
    providerReportedMinting: input.is_minting,
    sourceUrl: providerUrl(input.opensea_url),
    scheduleObservedAt: observedAt,
    rmtAdmission: "NOT_EVALUATED",
    projectTokenRelationship: null,
  };
}

export function parseOpenSeaDrops(raw: unknown, feed: OpenSeaDropFeed, now: Date): ParsedProviderCandidate[] {
  if (!record(raw) || !Array.isArray(raw.drops) || raw.drops.length > MAX_PROVIDER_RECORDS
    || (raw.next !== undefined && raw.next !== null && typeof raw.next !== "string")) {
    throw new Error("OpenSea drops response is malformed.");
  }
  const observedAt = now.toISOString();
  return raw.drops.flatMap((entry) => {
    const parsed = parseDrop(entry, feed, now, observedAt);
    return parsed ? [parsed] : [];
  });
}

export function parseOpenSeaDetailedDrop(raw: unknown, expected: Pick<ParsedProviderCandidate, "providerCollectionSlug" | "collectionAddress">) {
  if (!record(raw)) throw new Error("OpenSea detailed drop response is malformed.");
  const collectionSlug = boundedText(raw.collection_slug, 160, true)!;
  if (collectionSlug !== expected.providerCollectionSlug) throw new Error("OpenSea detailed drop slug does not match its feed candidate.");
  if (raw.chain !== RMT_MINT_RADAR_PROVIDER_CHAIN) throw new Error("OpenSea detailed drop is for the wrong chain.");
  if (typeof raw.is_minting !== "boolean") throw new Error("OpenSea detailed drop minting state must be boolean.");
  const address = contractAddress(raw.contract_address);
  if (!address) throw new Error("OpenSea detailed drop contract address is malformed.");
  if (expected.collectionAddress && !isAddressEqual(address, expected.collectionAddress)) {
    throw new Error("OpenSea detailed drop contract does not match its feed candidate.");
  }
  if (!Array.isArray(raw.stages) || raw.stages.length > MAX_DETAILED_STAGES) {
    throw new Error("OpenSea detailed drop stages are malformed or unbounded.");
  }
  const optionalDecimal = (value: unknown, label: string) => value === undefined || value === null ? null : decimal(value, label);
  return {
    collectionSlug,
    collectionName: boundedText(raw.collection_name, 160),
    chain: RMT_MINT_RADAR_PROVIDER_CHAIN,
    collectionAddress: address,
    dropType: boundedText(raw.drop_type, 100, true)!,
    isMinting: raw.is_minting,
    activeStage: stage(raw.active_stage),
    nextStage: stage(raw.next_stage),
    stages: raw.stages.map((item) => {
      const parsed = stage(item);
      if (!parsed) throw new Error("OpenSea detailed drop stage cannot be null.");
      return parsed;
    }),
    totalSupply: optionalDecimal(raw.total_supply, "detailed drop total supply"),
    maxSupply: optionalDecimal(raw.max_supply, "detailed drop maximum supply"),
  } satisfies RmtMintRadarDetailedDrop;
}

export function unknownCcff00Access(
  observedAt: string,
  detail = "No independently established CCFF00 access evidence.",
): RmtMintRadarCcff00Access {
  return {
    status: "UNKNOWN",
    authority: "NONE",
    stage: null,
    holderMatches: { status: "NOT_CHECKED", matchingHolderCount: null, observedAt: null },
    walletEligibility: { status: "NOT_CHECKED", observedAt: null },
    evidence: [{ kind: "INCONCLUSIVE", source: "RMT_MINT_RADAR", observedAt, detail }],
  };
}

export function evaluatePublishedAllowlistOverlap(input: {
  allowlistAddresses: readonly string[] | null;
  canonicalCcff00Owners: readonly string[] | null;
  observedAt: string;
  source: string;
  merkleRootOnly?: boolean;
  privateOrEncrypted?: boolean;
}): RmtMintRadarCcff00Access {
  if (input.merkleRootOnly || input.privateOrEncrypted || !input.allowlistAddresses || !input.canonicalCcff00Owners) {
    return unknownCcff00Access(input.observedAt, input.merkleRootOnly
      ? "A Merkle root does not disclose the wallet set and cannot establish holder overlap."
      : "A bounded public allowlist and canonical current-owner set were not both available.");
  }
  const normalized = (values: readonly string[]) => new Set(values.flatMap((value) => (
    isAddress(value, { strict: false }) ? [getAddress(value).toLowerCase()] : []
  )));
  const allowed = normalized(input.allowlistAddresses);
  const owners = normalized(input.canonicalCcff00Owners);
  const matches = [...allowed].filter((address) => owners.has(address)).length;
  if (matches === 0) {
    return {
      ...unknownCcff00Access(input.observedAt, "A bounded public allowlist was compared with canonical current ownership; no overlap was detected."),
      holderMatches: { status: "NONE", matchingHolderCount: 0, observedAt: input.observedAt },
    };
  }
  return {
    status: "HOLDER_MATCHES_DETECTED",
    authority: "CANONICAL_CCFF00_OWNERSHIP_OVERLAP",
    stage: null,
    holderMatches: { status: "DETECTED", matchingHolderCount: matches, observedAt: input.observedAt },
    walletEligibility: { status: "NOT_CHECKED", observedAt: null },
    evidence: [{
      kind: "PUBLISHED_ALLOWLIST_OVERLAP",
      source: input.source,
      observedAt: input.observedAt,
      detail: `Detected ${matches} unique wallet match${matches === 1 ? "" : "es"}; address sets are not exposed.`,
    }],
  };
}

export function providerReportedCcff00Access(input: {
  exactCollectionAddress: string | null;
  observedAt: string;
  source: string;
}): RmtMintRadarCcff00Access {
  if (!input.exactCollectionAddress || !isAddress(input.exactCollectionAddress, { strict: false })
    || !isAddressEqual(getAddress(input.exactCollectionAddress), CCFF00_COLLECTION)) {
    return unknownCcff00Access(input.observedAt, "Provider access evidence did not bind the exact CCFF00 collection.");
  }
  return {
    status: "PROVIDER_REPORTED",
    authority: "OPENSEA_REPORTED_ACCESS",
    stage: null,
    holderMatches: { status: "NOT_CHECKED", matchingHolderCount: null, observedAt: null },
    walletEligibility: { status: "NOT_CHECKED", observedAt: null },
    evidence: [{
      kind: "PROVIDER_REPORTED_CCFF00_ACCESS",
      source: input.source,
      observedAt: input.observedAt,
      detail: `Provider-reported access explicitly bound ${CCFF00_COLLECTION}; not independently proven.`,
    }],
  };
}

function unavailableContract(observedAt: string, status: RmtMintRadarContractStatus = "PROVIDER_ONLY"): RmtMintRadarContractEvidence {
  return {
    status,
    codeExists: null,
    supportsErc165: null,
    supportsInvalidInterface: null,
    supportsErc721: null,
    supportsErc1155: null,
    supportsErc721Metadata: null,
    standard: "UNKNOWN",
    observedAt,
  };
}

function noActivity(status: RmtMintRadarActivityStatus = "NOT_CHECKED"): RmtMintRadarActivityEvidence {
  return { status, transactionHash: null, blockNumber: null, observedAt: null, marketMeaning: "NOT_ESTABLISHED" };
}

function defaultClient(env: Partial<NodeJS.ProcessEnv>) {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(env.NFT_MINT_RADAR_RPC_URL?.trim()
      || env.RMT_MAINNET_RPC_URL?.trim()
      || env.ROBINHOOD_MAINNET_RPC_URL?.trim()
      || robinhoodChain.rpcUrls.default.http[0], { retryCount: 0, timeout: 5_000 }),
  });
}

export type ReviewedSeaDropDeployment = { address: Address; runtimeBytecodeHash: Hex };

export function parseReviewedSeaDropDeployments(value: string | undefined): readonly ReviewedSeaDropDeployment[] {
  if (!value?.trim()) return [];
  const entries = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (entries.length > MAX_REVIEWED_SEADROP_DEPLOYMENTS) throw new Error("Too many reviewed SeaDrop deployments configured.");
  return entries.map((entry) => {
    const [rawAddress, rawHash, extra] = entry.split("@");
    if (extra !== undefined || !rawAddress || !isAddress(rawAddress, { strict: false }) || !rawHash || !/^0x[0-9a-f]{64}$/i.test(rawHash)) {
      throw new Error("Reviewed SeaDrop deployment must use address@runtimeBytecodeHash.");
    }
    return { address: getAddress(rawAddress), runtimeBytecodeHash: rawHash.toLowerCase() as Hex };
  });
}

function bigintField(value: unknown, field: string) {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new TypeError(`SeaDrop ${field} response was malformed.`);
}

export async function verifyCcff00SeaDropGate(input: {
  client: PublicClient;
  dropCollection: Address;
  providerStage: RmtMintRadarStage | null;
  deployments: readonly ReviewedSeaDropDeployment[];
  observedAt: string;
}): Promise<RmtMintRadarCcff00Access> {
  if (input.deployments.length === 0) {
    return unknownCcff00Access(input.observedAt, "No Robinhood Chain SeaDrop deployment with a reviewed runtime hash is configured.");
  }
  let chainId: number;
  try {
    chainId = await input.client.getChainId();
  } catch {
    return unknownCcff00Access(input.observedAt, "Robinhood Chain RPC was unavailable while reading token-gate configuration.");
  }
  if (chainId !== RMT_MINT_RADAR_CHAIN_ID) {
    return unknownCcff00Access(input.observedAt, "RPC chain identity did not match Robinhood Chain.");
  }
  for (const deployment of input.deployments) {
    try {
      const code = await input.client.getBytecode({ address: deployment.address });
      if (!code || code === "0x" || keccak256(code).toLowerCase() !== deployment.runtimeBytecodeHash.toLowerCase()) continue;
      const allowed = await input.client.readContract({
        address: deployment.address,
        abi: SEADROP_ABI,
        functionName: "getTokenGatedAllowedTokens",
        args: [input.dropCollection],
      });
      if (!Array.isArray(allowed) || !allowed.every((address) => typeof address === "string" && isAddress(address, { strict: false }))) {
        throw new TypeError("SeaDrop token-gated allowed-token response was malformed.");
      }
      if (!allowed.some((address) => isAddressEqual(getAddress(address), CCFF00_COLLECTION))) continue;
      const raw = await input.client.readContract({
        address: deployment.address,
        abi: SEADROP_ABI,
        functionName: "getTokenGatedDrop",
        args: [input.dropCollection, CCFF00_COLLECTION],
      });
      if (!record(raw)) throw new TypeError("SeaDrop token-gated stage response was malformed.");
      const mintPrice = bigintField(raw.mintPrice, "mint price");
      const maxPerWallet = bigintField(raw.maxTotalMintableByWallet, "wallet limit");
      const startTime = bigintField(raw.startTime, "start time");
      const endTime = bigintField(raw.endTime, "end time");
      const dropStageIndex = bigintField(raw.dropStageIndex, "stage index");
      const maxSupply = bigintField(raw.maxTokenSupplyForStage, "stage supply");
      bigintField(raw.feeBps, "fee basis points");
      if (typeof raw.restrictFeeRecipients !== "boolean") throw new TypeError("SeaDrop fee-recipient restriction response was malformed.");
      if (startTime === 0n || endTime <= startTime || maxPerWallet === 0n || maxSupply === 0n) continue;
      if (input.providerStage) {
        const providerStart = BigInt(Math.trunc(Date.parse(input.providerStage.startTime) / 1_000));
        const providerEnd = BigInt(Math.trunc(Date.parse(input.providerStage.endTime) / 1_000));
        if (providerStart !== startTime || providerEnd !== endTime
          || input.providerStage.nativePriceWei !== mintPrice.toString()
          || input.providerStage.maxPerWallet !== maxPerWallet.toString()) continue;
      }
      return {
        status: "VERIFIED_COMMUNITY_GATE",
        authority: "ONCHAIN_SEADROP_CONFIGURATION",
        stage: {
          startTime: new Date(Number(startTime) * 1_000).toISOString(),
          endTime: new Date(Number(endTime) * 1_000).toISOString(),
          nativePriceWei: mintPrice.toString(),
          maxPerWallet: maxPerWallet.toString(),
          maxSupplyForStage: maxSupply.toString(),
        },
        holderMatches: { status: "NOT_CHECKED", matchingHolderCount: null, observedAt: null },
        walletEligibility: { status: "NOT_CHECKED", observedAt: null },
        evidence: [{
          kind: "EXACT_CCFF00_TOKEN_GATE",
          source: `SeaDrop ${deployment.address}`,
          observedAt: input.observedAt,
          detail: `Runtime hash pinned; drop ${input.dropCollection}; allowed NFT ${CCFF00_COLLECTION}; onchain stage ${dropStageIndex}.`,
        }],
      };
    } catch (error) {
      if (error instanceof TypeError) {
        return unknownCcff00Access(input.observedAt, error.message);
      }
      return unknownCcff00Access(input.observedAt, "Robinhood Chain RPC was unavailable while reading token-gate configuration.");
    }
  }
  return unknownCcff00Access(input.observedAt, "No reviewed SeaDrop deployment established an exact CCFF00 token gate for this drop.");
}

export async function verifyMintRadarContract(
  client: PublicClient,
  address: Address,
  observedAt: string,
): Promise<RmtMintRadarContractEvidence> {
  let chainId: number;
  let code: `0x${string}` | undefined;
  try {
    [chainId, code] = await Promise.all([client.getChainId(), client.getBytecode({ address })]);
  } catch {
    return unavailableContract(observedAt, "INCONCLUSIVE_PROVIDER_UNAVAILABLE");
  }
  if (chainId !== RMT_MINT_RADAR_CHAIN_ID) return unavailableContract(observedAt, "INCONCLUSIVE_MALFORMED_PROVIDER_RESPONSE");
  if (!code || code === "0x") return { ...unavailableContract(observedAt, "NO_CONTRACT_CODE"), codeExists: false };
  const read = async (interfaceId: `0x${string}`) => {
    const value = await client.readContract({ address, abi: ERC165_ABI, functionName: "supportsInterface", args: [interfaceId] });
    if (typeof value !== "boolean") throw new TypeError("supportsInterface response was not boolean.");
    return value;
  };
  let erc165: boolean;
  let invalid: boolean;
  let erc721: boolean;
  let erc1155: boolean;
  let metadata: boolean | null = null;
  try {
    [erc165, invalid, erc721, erc1155] = await Promise.all([
      read("0x01ffc9a7"), read("0xffffffff"), read("0x80ac58cd"), read("0xd9b67a26"),
    ]);
    if (erc721) metadata = await read("0x5b5e139f");
  } catch (error) {
    return {
      ...unavailableContract(observedAt,
        error instanceof TypeError ? "INCONCLUSIVE_MALFORMED_PROVIDER_RESPONSE" : "INCONCLUSIVE_PROVIDER_UNAVAILABLE"),
      codeExists: true,
    };
  }
  const standard: RmtMintRadarStandard = erc721 !== erc1155 ? erc721 ? "ERC721" : "ERC1155" : "UNKNOWN";
  const verified = erc165 && !invalid && standard !== "UNKNOWN";
  return {
    status: verified ? "ONCHAIN_VERIFIED_CONTRACT" : "CONTRACT_EVIDENCE_CONTRADICTORY",
    codeExists: true,
    supportsErc165: erc165,
    supportsInvalidInterface: invalid,
    supportsErc721: erc721,
    supportsErc1155: erc1155,
    supportsErc721Metadata: metadata,
    standard,
    observedAt,
  };
}

function zeroTopic(topic: `0x${string}` | null | undefined) {
  return typeof topic === "string" && /^0x0{24}0{40}$/i.test(topic);
}

export function mintLog(log: VerifiedContractLog, standard: RmtMintRadarStandard) {
  const topic0 = log.topics[0]?.toLowerCase();
  return standard === "ERC721"
    ? topic0 === RMT_ERC721_TRANSFER_TOPIC && zeroTopic(log.topics[1])
    : standard === "ERC1155"
      ? (topic0 === RMT_ERC1155_TRANSFER_SINGLE_TOPIC || topic0 === RMT_ERC1155_TRANSFER_BATCH_TOPIC) && zeroTopic(log.topics[2])
      : false;
}

export async function readSampledMintActivity(address: Address, standard: RmtMintRadarStandard, now: Date) {
  if (standard === "UNKNOWN") return noActivity();
  try {
    const logs = await fetchVerifiedContractLogs(address, { pages: 1 });
    const cutoff = now.getTime() - 72 * 60 * 60_000;
    const found = logs.find((log) => Date.parse(log.blockTimestamp) >= cutoff && mintLog(log, standard));
    return found ? {
      status: "ONCHAIN_MINT_ACTIVITY" as const,
      transactionHash: found.transactionHash,
      blockNumber: found.blockNumber.toString(),
      observedAt: new Date(found.blockTimestamp).toISOString(),
      marketMeaning: "NOT_ESTABLISHED" as const,
    } : noActivity("NOT_OBSERVED_IN_SAMPLE");
  } catch {
    return noActivity("INCONCLUSIVE_PROVIDER_UNAVAILABLE");
  }
}

function dedupe(candidates: readonly ParsedProviderCandidate[]) {
  const priority: Record<RmtMintRadarState, number> = { LIVE_NOW: 3, UPCOMING: 2, RECENTLY_MINTED: 1 };
  const bySlug = new Map<string, ParsedProviderCandidate>();
  for (const candidate of candidates) {
    const previous = bySlug.get(candidate.providerCollectionSlug);
    if (!previous || priority[candidate.state] > priority[previous.state]) bySlug.set(candidate.providerCollectionSlug, candidate);
  }
  return [...bySlug.values()];
}

async function boundedMap<T, U>(items: readonly T[], concurrency: number, map: (item: T) => Promise<U>) {
  const results = new Array<U>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await map(items[index]!);
    }
  }));
  return results;
}

export async function buildRmtMintRadar(
  pages: { featured: unknown; upcoming: unknown; recentlyMinted: unknown },
  options: Pick<RmtMintRadarReaderOptions, "now" | "verifyContract" | "readMintActivity" | "readDetailedDrop" | "readCcff00Access" | "env"> = {},
): Promise<RmtMintRadarResponse> {
  const now = (options.now ?? (() => new Date()))();
  const observedAt = now.toISOString();
  const client = options.verifyContract ? null : defaultClient(options.env ?? process.env);
  const verifyContract = options.verifyContract ?? ((address: Address, at: string) => verifyMintRadarContract(client!, address, at));
  const readActivity = options.readMintActivity ?? readSampledMintActivity;
  const parsedAll = dedupe([
    ...parseOpenSeaDrops(pages.featured, "featured", now),
    ...parseOpenSeaDrops(pages.upcoming, "upcoming", now),
    ...parseOpenSeaDrops(pages.recentlyMinted, "recently_minted", now),
  ]);
  const time = (candidate: ParsedProviderCandidate | RmtMintRadarCandidate) => candidate.stage ? Date.parse(candidate.stage.startTime) : 0;
  const parsed = [
    ...parsedAll.filter((item) => item.state === "LIVE_NOW").sort((a, b) => time(a) - time(b)).slice(0, MAX_LIVE),
    ...parsedAll.filter((item) => item.state === "UPCOMING").sort((a, b) => time(a) - time(b)).slice(0, MAX_UPCOMING),
    ...parsedAll.filter((item) => item.state === "RECENTLY_MINTED").sort((a, b) => time(b) - time(a)).slice(0, MAX_RECENT),
  ];
  let deployments: readonly ReviewedSeaDropDeployment[] = [];
  let accessClient: PublicClient | null = null;
  if (!options.readCcff00Access) {
    try {
      deployments = parseReviewedSeaDropDeployments((options.env ?? process.env).NFT_MINT_RADAR_REVIEWED_SEADROP_DEPLOYMENTS);
      if (deployments.length > 0) accessClient = client ?? defaultClient(options.env ?? process.env);
    } catch {
      deployments = [];
    }
  }
  const readAccess = options.readCcff00Access ?? (async ({ candidate, detail, observedAt: at }) => (
    candidate.collectionAddress && detail && accessClient
      ? verifyCcff00SeaDropGate({ client: accessClient, dropCollection: candidate.collectionAddress, providerStage: detail.activeStage ?? detail.nextStage ?? candidate.stage, deployments, observedAt: at })
      : unknownCcff00Access(at, detail
        ? "No reviewed Robinhood Chain SeaDrop deployment is configured for independent access verification."
        : "Detailed access evidence was not established for this candidate.")
  ));
  const enriched = await boundedMap(parsed, 3, async (candidate): Promise<RmtMintRadarCandidate> => {
    let detail: RmtMintRadarDetailedDrop | null = null;
    if (options.readDetailedDrop && candidate.state !== "RECENTLY_MINTED") {
      try {
        detail = await options.readDetailedDrop(candidate);
      } catch {
        detail = null;
      }
    }
    const contractEvidence = candidate.collectionAddress
      ? await verifyContract(candidate.collectionAddress, observedAt)
      : unavailableContract(observedAt);
    const mintActivity = candidate.collectionAddress && contractEvidence.status === "ONCHAIN_VERIFIED_CONTRACT"
      ? await readActivity(candidate.collectionAddress, contractEvidence.standard, now)
      : noActivity();
    const evidence: RmtMintRadarCandidate["evidence"] = [
      "PROVIDER_REPORTED",
      ...(contractEvidence.status === "ONCHAIN_VERIFIED_CONTRACT" ? ["ONCHAIN_VERIFIED_CONTRACT" as const] : []),
      ...(mintActivity.status === "ONCHAIN_MINT_ACTIVITY" ? ["ONCHAIN_MINT_ACTIVITY" as const] : []),
    ];
    const ccff00Access = await readAccess({ candidate, detail, observedAt });
    return { ...candidate, contractEvidence, mintActivity, ccff00Access, evidence };
  });
  const live = enriched.filter((item) => item.state === "LIVE_NOW")
    .sort((a, b) => Number(Boolean(b.mintActivity.status === "ONCHAIN_MINT_ACTIVITY")) - Number(Boolean(a.mintActivity.status === "ONCHAIN_MINT_ACTIVITY")) || time(a) - time(b))
    .slice(0, MAX_LIVE);
  const upcoming = enriched.filter((item) => item.state === "UPCOMING").sort((a, b) => time(a) - time(b)).slice(0, MAX_UPCOMING);
  const recent = enriched.filter((item) => item.state === "RECENTLY_MINTED").sort((a, b) => time(b) - time(a)).slice(0, MAX_RECENT);
  const status: RmtMintRadarFeedStatus = live.length + upcoming.length + recent.length === 0 ? "EMPTY" : "READY";
  return {
    schemaVersion: RMT_MINT_RADAR_SCHEMA_VERSION,
    chainId: RMT_MINT_RADAR_CHAIN_ID,
    providerChain: RMT_MINT_RADAR_PROVIDER_CHAIN,
    status,
    asOf: observedAt,
    sources: [{ provider: OPENSEA_SOURCE, authority: "PROVIDER_REPORTED_SCHEDULE", status }],
    live,
    upcoming,
    recent,
  };
}

function providerConfiguration(env: Partial<NodeJS.ProcessEnv>) {
  const apiKey = env.NFT_MINT_RADAR_OPENSEA_API_KEY?.trim();
  if (!apiKey) return null;
  const base = env.NFT_MINT_RADAR_OPENSEA_BASE_URL?.trim() || "https://api.opensea.io";
  try {
    const url = new URL(base);
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== "https:" && !loopback)) return null;
    return { apiKey, origin: url.origin };
  } catch {
    return null;
  }
}

async function readProviderPage(fetchImpl: FetchLike, config: { apiKey: string; origin: string }, feed: OpenSeaDropFeed, timeoutMs: number) {
  const url = new URL("/api/v2/drops", config.origin);
  url.searchParams.set("type", feed);
  url.searchParams.set("limit", "100");
  url.searchParams.set("chains", RMT_MINT_RADAR_PROVIDER_CHAIN);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "x-api-key": config.apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`OpenSea drops read failed with HTTP ${response.status}.`);
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAX_RESPONSE_BYTES) throw new Error("OpenSea drops response exceeded its size limit.");
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) throw new Error("OpenSea drops response exceeded its size limit.");
  return JSON.parse(body) as unknown;
}

async function readProviderDetail(
  fetchImpl: FetchLike,
  config: { apiKey: string; origin: string },
  candidate: ParsedProviderCandidate,
  timeoutMs: number,
) {
  const url = new URL(`/api/v2/drops/${encodeURIComponent(candidate.providerCollectionSlug)}`, config.origin);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "x-api-key": config.apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`OpenSea detailed drop read failed with HTTP ${response.status}.`);
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAX_RESPONSE_BYTES) throw new Error("OpenSea detailed drop response exceeded its size limit.");
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) throw new Error("OpenSea detailed drop response exceeded its size limit.");
  return parseOpenSeaDetailedDrop(JSON.parse(body) as unknown, candidate);
}

function unavailableResponse(status: "STALE" | "UNAVAILABLE", prior: RmtMintRadarResponse | null = null): RmtMintRadarResponse {
  return prior ? {
    ...prior,
    status,
    sources: [{ provider: OPENSEA_SOURCE, authority: "PROVIDER_REPORTED_SCHEDULE", status }],
  } : {
    schemaVersion: RMT_MINT_RADAR_SCHEMA_VERSION,
    chainId: RMT_MINT_RADAR_CHAIN_ID,
    providerChain: RMT_MINT_RADAR_PROVIDER_CHAIN,
    status,
    asOf: null,
    sources: [{ provider: OPENSEA_SOURCE, authority: "PROVIDER_REPORTED_SCHEDULE", status }],
    live: [], upcoming: [], recent: [],
  };
}

export async function readRmtNftMintRadar(options: RmtMintRadarReaderOptions = {}): Promise<RmtMintRadarResponse> {
  const now = options.now ?? (() => new Date());
  const nowMs = now().getTime();
  const cache = options.cache ?? sharedCache;
  if (cache.current && nowMs - cache.current.fetchedAtMs <= RMT_MINT_RADAR_FRESH_MS) return cache.current.response;
  const config = providerConfiguration(options.env ?? process.env);
  if (!config) return unavailableResponse("UNAVAILABLE");
  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = Math.min(8_000, Math.max(1_000, options.timeoutMs ?? 4_000));
    const [featured, upcoming, recentlyMinted] = await Promise.all([
      readProviderPage(fetchImpl, config, "featured", timeoutMs),
      readProviderPage(fetchImpl, config, "upcoming", timeoutMs),
      readProviderPage(fetchImpl, config, "recently_minted", timeoutMs),
    ]);
    let detailReads = 0;
    const response = await buildRmtMintRadar({ featured, upcoming, recentlyMinted }, {
      ...options,
      readDetailedDrop: options.readDetailedDrop ?? (async (candidate) => {
        if (detailReads >= MAX_DETAILED_DROPS) throw new Error("Detailed drop read bound exceeded.");
        detailReads += 1;
        return readProviderDetail(fetchImpl, config, candidate, timeoutMs);
      }),
    });
    cache.current = { response, fetchedAtMs: nowMs };
    return response;
  } catch {
    const prior = cache.current;
    return prior && nowMs - prior.fetchedAtMs <= RMT_MINT_RADAR_STALE_MS
      ? unavailableResponse("STALE", prior.response)
      : unavailableResponse("UNAVAILABLE");
  }
}
