import { createHash } from "node:crypto";
import {
  decodeFunctionData,
  getAddress,
  isAddress,
  isAddressEqual,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { CCFF00_COLLECTION } from "@rmt/shared/nft/project-registry";
import {
  RMT_MINT_RADAR_CHAIN_ID,
  createRmtMintRadarPublicClient,
  parseReviewedSeaDropDeployments,
  rmtMintRadarProviderConfiguration,
  type RmtMintRadarCandidate,
  type ReviewedSeaDropDeployment,
} from "./nft-mint-radar";

export const RMT_NFT_MINT_PREFLIGHT_SCHEMA_VERSION = 1 as const;
export const RMT_NFT_MINT_PREFLIGHT_MAX_AGE_MS = 30_000;
const MAX_RESPONSE_BYTES = 128_000;
const MAX_QUANTITY = 10;

const PUBLIC_DROP_COMPONENTS = [
  { name: "mintPrice", type: "uint80" },
  { name: "startTime", type: "uint48" },
  { name: "endTime", type: "uint48" },
  { name: "maxTotalMintableByWallet", type: "uint16" },
  { name: "feeBps", type: "uint16" },
  { name: "restrictFeeRecipients", type: "bool" },
] as const;
const TOKEN_GATED_DROP_COMPONENTS = [
  { name: "mintPrice", type: "uint80" },
  { name: "maxTotalMintableByWallet", type: "uint16" },
  { name: "startTime", type: "uint48" },
  { name: "endTime", type: "uint48" },
  { name: "dropStageIndex", type: "uint8" },
  { name: "maxTokenSupplyForStage", type: "uint32" },
  { name: "feeBps", type: "uint16" },
  { name: "restrictFeeRecipients", type: "bool" },
] as const;
const MINT_PARAMS_COMPONENTS = [
  { name: "mintPrice", type: "uint256" },
  { name: "maxTotalMintableByWallet", type: "uint256" },
  { name: "startTime", type: "uint256" },
  { name: "endTime", type: "uint256" },
  { name: "dropStageIndex", type: "uint256" },
  { name: "maxTokenSupplyForStage", type: "uint256" },
  { name: "feeBps", type: "uint256" },
  { name: "restrictFeeRecipients", type: "bool" },
] as const;

export const RMT_SEADROP_PREFLIGHT_ABI = [
  {
    type: "function", name: "mintPublic", stateMutability: "payable",
    inputs: [
      { name: "nftContract", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "minterIfNotPayer", type: "address" },
      { name: "quantity", type: "uint256" },
    ], outputs: [],
  },
  {
    type: "function", name: "mintAllowList", stateMutability: "payable",
    inputs: [
      { name: "nftContract", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "minterIfNotPayer", type: "address" },
      { name: "quantity", type: "uint256" },
      { name: "mintParams", type: "tuple", components: MINT_PARAMS_COMPONENTS },
      { name: "proof", type: "bytes32[]" },
    ], outputs: [],
  },
  {
    type: "function", name: "mintSigned", stateMutability: "payable",
    inputs: [
      { name: "nftContract", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "minterIfNotPayer", type: "address" },
      { name: "quantity", type: "uint256" },
      { name: "mintParams", type: "tuple", components: MINT_PARAMS_COMPONENTS },
      { name: "salt", type: "uint256" },
      { name: "signature", type: "bytes" },
    ], outputs: [],
  },
  {
    type: "function", name: "mintAllowedTokenHolder", stateMutability: "payable",
    inputs: [
      { name: "nftContract", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "minterIfNotPayer", type: "address" },
      { name: "mintParams", type: "tuple", components: [
        { name: "allowedNftToken", type: "address" },
        { name: "allowedNftTokenIds", type: "uint256[]" },
      ] },
    ], outputs: [],
  },
  {
    type: "function", name: "getPublicDrop", stateMutability: "view",
    inputs: [{ name: "nftContract", type: "address" }],
    outputs: [{ name: "", type: "tuple", components: PUBLIC_DROP_COMPONENTS }],
  },
  {
    type: "function", name: "getTokenGatedDrop", stateMutability: "view",
    inputs: [{ name: "nftContract", type: "address" }, { name: "allowedNftToken", type: "address" }],
    outputs: [{ name: "", type: "tuple", components: TOKEN_GATED_DROP_COMPONENTS }],
  },
  {
    type: "function", name: "getTokenGatedAllowedTokens", stateMutability: "view",
    inputs: [{ name: "nftContract", type: "address" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function", name: "getFeeRecipientIsAllowed", stateMutability: "view",
    inputs: [{ name: "nftContract", type: "address" }, { name: "feeRecipient", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function", name: "getAllowedNftTokenIdIsRedeemed", stateMutability: "view",
    inputs: [
      { name: "nftContract", type: "address" },
      { name: "allowedNftToken", type: "address" },
      { name: "allowedNftTokenId", type: "uint256" },
    ], outputs: [{ name: "", type: "bool" }],
  },
] as const;

const MINT_STATS_ABI = [{
  type: "function", name: "getMintStats", stateMutability: "view",
  inputs: [{ name: "minter", type: "address" }],
  outputs: [
    { name: "minterNumMinted", type: "uint256" },
    { name: "currentTotalSupply", type: "uint256" },
    { name: "maxSupply", type: "uint256" },
  ],
}] as const;
const ERC721_OWNER_ABI = [{
  type: "function", name: "ownerOf", stateMutability: "view",
  inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }],
}] as const;

export type RmtNftMintPreflightMethod =
  | "MINT_PUBLIC"
  | "MINT_ALLOW_LIST"
  | "MINT_SIGNED"
  | "MINT_ALLOWED_TOKEN_HOLDER"
  | "UNKNOWN";

export type RmtNftMintPreflightStatus =
  | "PREFLIGHT_READY"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_PRECONDITION_FAILED"
  | "DROP_NOT_LIVE"
  | "WALLET_NOT_CONNECTED"
  | "NOT_PREFLIGHT_ELIGIBLE"
  | "UNSUPPORTED_PREFLIGHT_METHOD"
  | "TARGET_NOT_TRUSTED"
  | "COLLECTION_MISMATCH"
  | "RECIPIENT_MISMATCH"
  | "QUANTITY_INVALID"
  | "PRICE_MISMATCH"
  | "STAGE_MISMATCH"
  | "CCFF00_ACCESS_NOT_VERIFIED"
  | "CCFF00_TOKEN_NOT_ELIGIBLE"
  | "CCFF00_TOKEN_ALREADY_REDEEMED"
  | "SUPPLY_EXHAUSTED"
  | "WALLET_LIMIT_EXCEEDED"
  | "SIMULATION_REVERTED"
  | "EVIDENCE_UNAVAILABLE";

export type RmtNftMintProposal = {
  target: Address;
  calldata: Hex;
  value: bigint;
};

export type RmtNftMintPreflightReport = {
  schemaVersion: typeof RMT_NFT_MINT_PREFLIGHT_SCHEMA_VERSION;
  chainId: typeof RMT_MINT_RADAR_CHAIN_ID;
  status: RmtNftMintPreflightStatus;
  message: string;
  candidateId: string;
  provider: "OPENSEA_DROPS_V2";
  providerCollectionSlug: string;
  collection: Address | null;
  wallet: Address;
  recipient: Address | null;
  quantity: string;
  method: RmtNftMintPreflightMethod | null;
  target: Address | null;
  calldataHash: Hex | null;
  mintPriceWei: string | null;
  totalValueWei: string | null;
  stage: null | {
    startTime: string;
    endTime: string;
    maxPerWallet: string;
    maxSupplyForStage: string | null;
    dropStageIndex: string | null;
    feeBps: string;
    restrictFeeRecipients: boolean;
  };
  supply: null | {
    minterNumMinted: string;
    currentTotalSupply: string;
    maxSupply: string;
    remainingWalletAllowance: string;
    remainingCollectionSupply: string;
    remainingStageSupply: string | null;
  };
  ccff00Access: null | {
    collection: typeof CCFF00_COLLECTION;
    tokenIds: readonly string[];
    status: "REVERIFIED";
  };
  simulation: {
    status: "NOT_RUN" | "SUCCEEDED" | "REVERTED";
    blockNumber: string | null;
    gasEstimate: string | null;
    reason: string | null;
  };
  digest: Hex | null;
  checkedAt: string;
  expiresAt: string;
  rmtAdmission: "NOT_EVALUATED";
  projectTokenRelationship: null;
  transactionSubmitted: false;
  walletSignatureRequested: false;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type DecodedMint = {
  method: RmtNftMintPreflightMethod;
  collection: Address | null;
  feeRecipient: Address | null;
  minterIfNotPayer: Address | null;
  quantity: bigint | null;
  allowedNftToken: Address | null;
  allowedNftTokenIds: readonly bigint[];
};
type StageEvidence = {
  mintPrice: bigint;
  maxPerWallet: bigint;
  startTime: bigint;
  endTime: bigint;
  maxSupplyForStage: bigint | null;
  dropStageIndex: bigint | null;
  feeBps: bigint;
  restrictFeeRecipients: boolean;
};

export type RmtNftMintPreflightOptions = {
  candidate: RmtMintRadarCandidate;
  wallet: Address;
  quantity: bigint;
  env?: Partial<NodeJS.ProcessEnv>;
  fetchImpl?: FetchLike;
  client?: PublicClient;
  deployments?: readonly ReviewedSeaDropDeployment[];
  now?: () => Date;
  proposal?: RmtNftMintProposal;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bigintField(value: unknown, label: string) {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new TypeError(`${label} was malformed.`);
}

function addressField(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) throw new TypeError(`${label} was malformed.`);
  return getAddress(value);
}

function reportBase(input: Pick<RmtNftMintPreflightOptions, "candidate" | "wallet" | "quantity">, checkedAt: string): RmtNftMintPreflightReport {
  return {
    schemaVersion: RMT_NFT_MINT_PREFLIGHT_SCHEMA_VERSION,
    chainId: RMT_MINT_RADAR_CHAIN_ID,
    status: "EVIDENCE_UNAVAILABLE",
    message: "Mint readiness evidence could not be established.",
    candidateId: input.candidate.candidateId,
    provider: "OPENSEA_DROPS_V2",
    providerCollectionSlug: input.candidate.providerCollectionSlug,
    collection: input.candidate.collectionAddress,
    wallet: input.wallet,
    recipient: null,
    quantity: input.quantity.toString(),
    method: null,
    target: null,
    calldataHash: null,
    mintPriceWei: null,
    totalValueWei: null,
    stage: null,
    supply: null,
    ccff00Access: null,
    simulation: { status: "NOT_RUN", blockNumber: null, gasEstimate: null, reason: null },
    digest: null,
    checkedAt,
    expiresAt: new Date(Date.parse(checkedAt) + RMT_NFT_MINT_PREFLIGHT_MAX_AGE_MS).toISOString(),
    rmtAdmission: "NOT_EVALUATED",
    projectTokenRelationship: null,
    transactionSubmitted: false,
    walletSignatureRequested: false,
  };
}

function fail(
  base: RmtNftMintPreflightReport,
  status: Exclude<RmtNftMintPreflightStatus, "PREFLIGHT_READY">,
  message: string,
  patch: Partial<RmtNftMintPreflightReport> = {},
): RmtNftMintPreflightReport {
  return { ...base, ...patch, status, message };
}

export function parseOpenSeaMintProposal(raw: unknown): RmtNftMintProposal {
  if (!record(raw)) throw new TypeError("OpenSea mint proposal must be an object.");
  const keys = Object.keys(raw).sort();
  if (keys.join(",") !== "calldata,target,value") throw new TypeError("OpenSea mint proposal fields changed.");
  const target = addressField(raw.target, "OpenSea mint target");
  if (isAddressEqual(target, zeroAddress)) throw new TypeError("OpenSea mint target was zero.");
  if (typeof raw.calldata !== "string" || !/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(raw.calldata)) {
    throw new TypeError("OpenSea mint calldata was malformed.");
  }
  if (typeof raw.value !== "string" || !/^(0|[1-9]\d*)$/.test(raw.value)) {
    throw new TypeError("OpenSea mint value was malformed.");
  }
  return { target, calldata: raw.calldata as Hex, value: BigInt(raw.value) };
}

class ProviderProposalError extends Error {
  readonly status: RmtNftMintPreflightStatus;
  constructor(status: RmtNftMintPreflightStatus, message: string) {
    super(message);
    this.status = status;
  }
}

export async function readOpenSeaMintProposal(input: {
  slug: string;
  wallet: Address;
  quantity: bigint;
  env?: Partial<NodeJS.ProcessEnv>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<RmtNftMintProposal> {
  if (input.quantity < 1n || input.quantity > BigInt(MAX_QUANTITY)) {
    throw new ProviderProposalError("QUANTITY_INVALID", `Quantity must be between 1 and ${MAX_QUANTITY}.`);
  }
  const config = rmtMintRadarProviderConfiguration(input.env ?? process.env);
  if (!config) throw new ProviderProposalError("PROVIDER_UNAVAILABLE", "OpenSea mint proposal service is not configured.");
  const url = new URL(`/api/v2/drops/${encodeURIComponent(input.slug)}/mint`, config.origin);
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "x-api-key": config.apiKey },
      body: JSON.stringify({ minter: input.wallet, quantity: Number(input.quantity) }),
      cache: "no-store",
      signal: AbortSignal.timeout(Math.min(8_000, Math.max(1_000, input.timeoutMs ?? 4_000))),
    });
  } catch {
    throw new ProviderProposalError("PROVIDER_UNAVAILABLE", "OpenSea mint proposal service was unavailable.");
  }
  if (response.status === 409) throw new ProviderProposalError("DROP_NOT_LIVE", "OpenSea reports that this drop is not currently minting.");
  if (response.status === 422) throw new ProviderProposalError("PROVIDER_PRECONDITION_FAILED", "OpenSea could not establish the requested wallet mint preconditions.");
  if (!response.ok) throw new ProviderProposalError("PROVIDER_UNAVAILABLE", "OpenSea could not provide a mint transaction proposal.");
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAX_RESPONSE_BYTES) throw new ProviderProposalError("PROVIDER_UNAVAILABLE", "OpenSea mint proposal exceeded its size limit.");
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) throw new ProviderProposalError("PROVIDER_UNAVAILABLE", "OpenSea mint proposal exceeded its size limit.");
  try {
    return parseOpenSeaMintProposal(JSON.parse(body) as unknown);
  } catch {
    throw new ProviderProposalError("PROVIDER_UNAVAILABLE", "OpenSea mint proposal shape could not be verified.");
  }
}

export function decodeSeaDropMint(calldata: Hex): DecodedMint {
  let decoded: ReturnType<typeof decodeFunctionData<typeof RMT_SEADROP_PREFLIGHT_ABI>>;
  try {
    decoded = decodeFunctionData({ abi: RMT_SEADROP_PREFLIGHT_ABI, data: calldata });
  } catch {
    return { method: "UNKNOWN", collection: null, feeRecipient: null, minterIfNotPayer: null, quantity: null, allowedNftToken: null, allowedNftTokenIds: [] };
  }
  const args = (decoded.args ?? []) as readonly unknown[];
  const collection = addressField(args[0], "SeaDrop mint collection");
  const feeRecipient = addressField(args[1], "SeaDrop fee recipient");
  const minterIfNotPayer = addressField(args[2], "SeaDrop mint recipient");
  if (decoded.functionName === "mintPublic") {
    return { method: "MINT_PUBLIC", collection, feeRecipient, minterIfNotPayer, quantity: bigintField(args[3], "SeaDrop quantity"), allowedNftToken: null, allowedNftTokenIds: [] };
  }
  if (decoded.functionName === "mintAllowList") {
    return { method: "MINT_ALLOW_LIST", collection, feeRecipient, minterIfNotPayer, quantity: bigintField(args[3], "SeaDrop quantity"), allowedNftToken: null, allowedNftTokenIds: [] };
  }
  if (decoded.functionName === "mintSigned") {
    return { method: "MINT_SIGNED", collection, feeRecipient, minterIfNotPayer, quantity: bigintField(args[3], "SeaDrop quantity"), allowedNftToken: null, allowedNftTokenIds: [] };
  }
  const mintParams = args[3];
  if (!record(mintParams) || !Array.isArray(mintParams.allowedNftTokenIds)) throw new TypeError("SeaDrop token-gated mint parameters were malformed.");
  const ids = mintParams.allowedNftTokenIds.map((value) => bigintField(value, "SeaDrop allowed NFT token ID"));
  return {
    method: "MINT_ALLOWED_TOKEN_HOLDER",
    collection,
    feeRecipient,
    minterIfNotPayer,
    quantity: BigInt(ids.length),
    allowedNftToken: addressField(mintParams.allowedNftToken, "SeaDrop allowed NFT token"),
    allowedNftTokenIds: ids,
  };
}

function parsePublicDrop(raw: unknown): StageEvidence {
  if (!record(raw)) throw new TypeError("SeaDrop public stage was malformed.");
  const restrict = raw.restrictFeeRecipients;
  if (typeof restrict !== "boolean") throw new TypeError("SeaDrop public fee restriction was malformed.");
  return {
    mintPrice: bigintField(raw.mintPrice, "SeaDrop public mint price"),
    maxPerWallet: bigintField(raw.maxTotalMintableByWallet, "SeaDrop public wallet limit"),
    startTime: bigintField(raw.startTime, "SeaDrop public start time"),
    endTime: bigintField(raw.endTime, "SeaDrop public end time"),
    maxSupplyForStage: null,
    dropStageIndex: 0n,
    feeBps: bigintField(raw.feeBps, "SeaDrop public fee"),
    restrictFeeRecipients: restrict,
  };
}

function parseTokenGatedDrop(raw: unknown): StageEvidence {
  if (!record(raw)) throw new TypeError("SeaDrop token-gated stage was malformed.");
  const restrict = raw.restrictFeeRecipients;
  if (typeof restrict !== "boolean") throw new TypeError("SeaDrop token-gated fee restriction was malformed.");
  return {
    mintPrice: bigintField(raw.mintPrice, "SeaDrop token-gated mint price"),
    maxPerWallet: bigintField(raw.maxTotalMintableByWallet, "SeaDrop token-gated wallet limit"),
    startTime: bigintField(raw.startTime, "SeaDrop token-gated start time"),
    endTime: bigintField(raw.endTime, "SeaDrop token-gated end time"),
    maxSupplyForStage: bigintField(raw.maxTokenSupplyForStage, "SeaDrop token-gated stage supply"),
    dropStageIndex: bigintField(raw.dropStageIndex, "SeaDrop token-gated stage index"),
    feeBps: bigintField(raw.feeBps, "SeaDrop token-gated fee"),
    restrictFeeRecipients: restrict,
  };
}

function parseMintStats(raw: unknown) {
  const values = Array.isArray(raw)
    ? raw
    : record(raw)
      ? [raw.minterNumMinted, raw.currentTotalSupply, raw.maxSupply]
      : null;
  if (!values || values.length !== 3) throw new TypeError("SeaDrop collection mint stats were malformed.");
  return {
    minterNumMinted: bigintField(values[0], "SeaDrop minter count"),
    currentTotalSupply: bigintField(values[1], "SeaDrop current supply"),
    maxSupply: bigintField(values[2], "SeaDrop maximum supply"),
  };
}

function stageMatchesProvider(candidate: RmtMintRadarCandidate, stage: StageEvidence) {
  if (!candidate.stage || candidate.stage.nativePriceWei === null) return false;
  return BigInt(Math.trunc(Date.parse(candidate.stage.startTime) / 1_000)) === stage.startTime
    && BigInt(Math.trunc(Date.parse(candidate.stage.endTime) / 1_000)) === stage.endTime
    && BigInt(candidate.stage.nativePriceWei) === stage.mintPrice
    && BigInt(candidate.stage.maxPerWallet) === stage.maxPerWallet;
}

function stageReport(stage: StageEvidence): NonNullable<RmtNftMintPreflightReport["stage"]> {
  return {
    startTime: new Date(Number(stage.startTime) * 1_000).toISOString(),
    endTime: new Date(Number(stage.endTime) * 1_000).toISOString(),
    maxPerWallet: stage.maxPerWallet.toString(),
    maxSupplyForStage: stage.maxSupplyForStage?.toString() ?? null,
    dropStageIndex: stage.dropStageIndex?.toString() ?? null,
    feeBps: stage.feeBps.toString(),
    restrictFeeRecipients: stage.restrictFeeRecipients,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Preflight digest value was not finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  throw new TypeError("Preflight digest value was not JSON-safe.");
}

function deterministicDigest(value: Record<string, unknown>) {
  const json = canonicalJson(value);
  return `0x${createHash("sha256").update(json).digest("hex")}` as Hex;
}

function trustedDeployment(target: Address, deployments: readonly ReviewedSeaDropDeployment[]) {
  return deployments.find((deployment) => isAddressEqual(deployment.address, target)) ?? null;
}

export async function runRmtNftMintPreflight(options: RmtNftMintPreflightOptions): Promise<RmtNftMintPreflightReport> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const base = reportBase(options, checkedAt);
  const { candidate, wallet, quantity } = options;
  if (candidate.state !== "LIVE_NOW" || !candidate.providerReportedMinting) return fail(base, "DROP_NOT_LIVE", "Mint Radar does not currently establish a live mint stage.");
  if (!candidate.collectionAddress || candidate.contractEvidence.status !== "ONCHAIN_VERIFIED_CONTRACT") {
    return fail(base, "NOT_PREFLIGHT_ELIGIBLE", "This Radar candidate does not have independently verified contract evidence.");
  }
  if (quantity < 1n || quantity > BigInt(MAX_QUANTITY)) return fail(base, "QUANTITY_INVALID", `Quantity must be between 1 and ${MAX_QUANTITY}.`);

  let proposal: RmtNftMintProposal;
  try {
    proposal = options.proposal ?? await readOpenSeaMintProposal({
      slug: candidate.providerCollectionSlug,
      wallet,
      quantity,
      env: options.env,
      fetchImpl: options.fetchImpl,
    });
  } catch (cause) {
    if (cause instanceof ProviderProposalError) return fail(base, cause.status as Exclude<RmtNftMintPreflightStatus, "PREFLIGHT_READY">, cause.message);
    return fail(base, "PROVIDER_UNAVAILABLE", "OpenSea could not provide a verifiable mint proposal.");
  }
  const proposalPatch = { target: proposal.target, calldataHash: keccak256(proposal.calldata), totalValueWei: proposal.value.toString() };
  const deployments = options.deployments ?? (() => {
    try { return parseReviewedSeaDropDeployments((options.env ?? process.env).NFT_MINT_RADAR_REVIEWED_SEADROP_DEPLOYMENTS); } catch { return []; }
  })();
  const deployment = trustedDeployment(proposal.target, deployments);
  if (!deployment) return fail(base, "TARGET_NOT_TRUSTED", "The proposed target is not an owner-reviewed Robinhood Chain SeaDrop deployment.", proposalPatch);
  const client = options.client ?? createRmtMintRadarPublicClient(options.env ?? process.env);
  let blockNumber: bigint;
  let blockTime: bigint;
  try {
    const [chainId, code, block] = await Promise.all([
      client.getChainId(), client.getBytecode({ address: proposal.target }), client.getBlock({ blockTag: "latest" }),
    ]);
    if (chainId !== RMT_MINT_RADAR_CHAIN_ID || !code || code === "0x" || keccak256(code).toLowerCase() !== deployment.runtimeBytecodeHash.toLowerCase()) {
      return fail(base, "TARGET_NOT_TRUSTED", "The proposed SeaDrop target failed chain or runtime-bytecode verification.", proposalPatch);
    }
    blockNumber = block.number;
    blockTime = block.timestamp;
  } catch {
    return fail(base, "EVIDENCE_UNAVAILABLE", "Robinhood Chain target evidence could not be established.", proposalPatch);
  }

  let decoded: DecodedMint;
  try {
    decoded = decodeSeaDropMint(proposal.calldata);
  } catch {
    return fail(base, "UNSUPPORTED_PREFLIGHT_METHOD", "The proposed SeaDrop calldata could not be decoded safely.", proposalPatch);
  }
  const decodedPatch = { ...proposalPatch, method: decoded.method, collection: decoded.collection, recipient: decoded.minterIfNotPayer };
  if (decoded.method === "UNKNOWN" || decoded.method === "MINT_ALLOW_LIST" || decoded.method === "MINT_SIGNED") {
    return fail(base, "UNSUPPORTED_PREFLIGHT_METHOD", "This recognized mint path is not supported by V1 preflight.", decodedPatch);
  }
  if (!decoded.collection || !isAddressEqual(decoded.collection, candidate.collectionAddress)) {
    return fail(base, "COLLECTION_MISMATCH", "The proposed calldata does not mint the exact Radar collection.", decodedPatch);
  }
  if (!decoded.minterIfNotPayer || (!isAddressEqual(decoded.minterIfNotPayer, zeroAddress) && !isAddressEqual(decoded.minterIfNotPayer, wallet))) {
    return fail(base, "RECIPIENT_MISMATCH", "The proposed calldata redirects the mint away from the connected wallet.", decodedPatch);
  }
  if (decoded.quantity !== quantity) return fail(base, "QUANTITY_INVALID", "The proposed calldata quantity does not match the requested quantity.", decodedPatch);

  let stage: StageEvidence;
  try {
    if (decoded.method === "MINT_PUBLIC") {
      stage = parsePublicDrop(await client.readContract({
        address: proposal.target, abi: RMT_SEADROP_PREFLIGHT_ABI, functionName: "getPublicDrop", args: [candidate.collectionAddress], blockNumber,
      }));
    } else {
      if (candidate.ccff00Access.status !== "VERIFIED_COMMUNITY_GATE" || candidate.ccff00Access.authority !== "ONCHAIN_SEADROP_CONFIGURATION") {
        return fail(base, "CCFF00_ACCESS_NOT_VERIFIED", "This token-gated proposal lacks independently verified CCFF00 access evidence.", decodedPatch);
      }
      if (!decoded.allowedNftToken || !isAddressEqual(decoded.allowedNftToken, CCFF00_COLLECTION)) {
        return fail(base, "CCFF00_ACCESS_NOT_VERIFIED", "The proposed token gate is not bound to the exact CCFF00 collection.", decodedPatch);
      }
      const [allowedTokens, tokenStage] = await Promise.all([
        client.readContract({
          address: proposal.target, abi: RMT_SEADROP_PREFLIGHT_ABI, functionName: "getTokenGatedAllowedTokens",
          args: [candidate.collectionAddress], blockNumber,
        }),
        client.readContract({
          address: proposal.target, abi: RMT_SEADROP_PREFLIGHT_ABI, functionName: "getTokenGatedDrop",
          args: [candidate.collectionAddress, CCFF00_COLLECTION], blockNumber,
        }),
      ]);
      if (!Array.isArray(allowedTokens) || !allowedTokens.every((value) => typeof value === "string" && isAddress(value, { strict: false }))) {
        throw new TypeError("SeaDrop allowed-token evidence was malformed.");
      }
      if (!allowedTokens.some((value) => isAddressEqual(getAddress(value), CCFF00_COLLECTION))) {
        return fail(base, "CCFF00_ACCESS_NOT_VERIFIED", "SeaDrop no longer enumerates CCFF00 as an allowed token for this drop.", decodedPatch);
      }
      stage = parseTokenGatedDrop(tokenStage);
      const prior = candidate.ccff00Access.stage;
      if (!prior || prior.nativePriceWei !== stage.mintPrice.toString() || prior.maxPerWallet !== stage.maxPerWallet.toString()
        || prior.maxSupplyForStage !== stage.maxSupplyForStage?.toString()
        || prior.startTime !== new Date(Number(stage.startTime) * 1_000).toISOString()
        || prior.endTime !== new Date(Number(stage.endTime) * 1_000).toISOString()) {
        return fail(base, "STAGE_MISMATCH", "The current CCFF00 token-gate stage no longer matches Radar access evidence.", { ...decodedPatch, stage: stageReport(stage) });
      }
    }
  } catch {
    return fail(base, "EVIDENCE_UNAVAILABLE", "The current SeaDrop stage could not be independently read.", decodedPatch);
  }
  const fullPatch = { ...decodedPatch, mintPriceWei: stage.mintPrice.toString(), stage: stageReport(stage) };
  if (stage.startTime === 0n || stage.endTime <= stage.startTime || blockTime < stage.startTime || blockTime >= stage.endTime) {
    return fail(base, "DROP_NOT_LIVE", "The independently read SeaDrop stage is not live at the simulation block.", fullPatch);
  }
  if (stage.maxPerWallet === 0n || stage.feeBps > 10_000n || (stage.maxSupplyForStage !== null && stage.maxSupplyForStage === 0n)) {
    return fail(base, "STAGE_MISMATCH", "The independently read SeaDrop stage is empty or malformed.", fullPatch);
  }
  if (!stageMatchesProvider(candidate, stage)) return fail(base, "STAGE_MISMATCH", "Provider schedule evidence does not match the current SeaDrop stage.", fullPatch);
  if (proposal.value !== stage.mintPrice * quantity) return fail(base, "PRICE_MISMATCH", "The proposed transaction value does not equal mint price multiplied by quantity.", fullPatch);
  if (stage.restrictFeeRecipients) {
    try {
      const allowed = await client.readContract({
        address: proposal.target, abi: RMT_SEADROP_PREFLIGHT_ABI, functionName: "getFeeRecipientIsAllowed",
        args: [candidate.collectionAddress, decoded.feeRecipient!], blockNumber,
      });
      if (allowed !== true) return fail(base, "STAGE_MISMATCH", "The proposed fee recipient is not currently allowed by SeaDrop.", fullPatch);
    } catch {
      return fail(base, "EVIDENCE_UNAVAILABLE", "SeaDrop fee-recipient evidence could not be established.", fullPatch);
    }
  }

  let ccff00Access: RmtNftMintPreflightReport["ccff00Access"] = null;
  if (decoded.method === "MINT_ALLOWED_TOKEN_HOLDER") {
    const ids = decoded.allowedNftTokenIds;
    if (ids.length === 0 || new Set(ids.map(String)).size !== ids.length) return fail(base, "QUANTITY_INVALID", "CCFF00 token IDs must be nonempty and unique.", fullPatch);
    try {
      for (const tokenId of ids) {
        const [owner, redeemed] = await Promise.all([
          client.readContract({ address: CCFF00_COLLECTION, abi: ERC721_OWNER_ABI, functionName: "ownerOf", args: [tokenId], blockNumber }),
          client.readContract({ address: proposal.target, abi: RMT_SEADROP_PREFLIGHT_ABI, functionName: "getAllowedNftTokenIdIsRedeemed", args: [candidate.collectionAddress, CCFF00_COLLECTION, tokenId], blockNumber }),
        ]);
        if (typeof owner !== "string" || !isAddress(owner, { strict: false }) || !isAddressEqual(getAddress(owner), wallet)) {
          return fail(base, "CCFF00_TOKEN_NOT_ELIGIBLE", `Connected wallet does not currently own CCFF00 token #${tokenId}.`, fullPatch);
        }
        if (redeemed === true) return fail(base, "CCFF00_TOKEN_ALREADY_REDEEMED", `CCFF00 token #${tokenId} was already redeemed for this drop.`, fullPatch);
        if (redeemed !== false) throw new TypeError("SeaDrop redemption evidence was malformed.");
      }
      ccff00Access = { collection: CCFF00_COLLECTION, tokenIds: ids.map(String), status: "REVERIFIED" };
    } catch (cause) {
      if (cause instanceof TypeError) return fail(base, "EVIDENCE_UNAVAILABLE", "CCFF00 ownership or redemption evidence was malformed.", fullPatch);
      return fail(base, "EVIDENCE_UNAVAILABLE", "CCFF00 ownership or redemption evidence was unavailable.", fullPatch);
    }
  }

  let stats: ReturnType<typeof parseMintStats>;
  try {
    stats = parseMintStats(await client.readContract({
      address: candidate.collectionAddress, abi: MINT_STATS_ABI, functionName: "getMintStats", args: [wallet], blockNumber,
    }));
  } catch {
    return fail(base, "EVIDENCE_UNAVAILABLE", "The collection did not return verifiable SeaDrop mint stats.", { ...fullPatch, ccff00Access });
  }
  if (stats.minterNumMinted + quantity > stage.maxPerWallet) {
    return fail(base, "WALLET_LIMIT_EXCEEDED", "Quantity exceeds the current SeaDrop wallet limit.", { ...fullPatch, ccff00Access });
  }
  if (stats.currentTotalSupply + quantity > stats.maxSupply
    || (stage.maxSupplyForStage !== null && stats.currentTotalSupply + quantity > stage.maxSupplyForStage)) {
    return fail(base, "SUPPLY_EXHAUSTED", "Quantity exceeds current collection or stage supply.", { ...fullPatch, ccff00Access });
  }
  const remaining = (limit: bigint, used: bigint) => limit > used ? limit - used : 0n;
  const supply: NonNullable<RmtNftMintPreflightReport["supply"]> = {
    minterNumMinted: stats.minterNumMinted.toString(),
    currentTotalSupply: stats.currentTotalSupply.toString(),
    maxSupply: stats.maxSupply.toString(),
    remainingWalletAllowance: remaining(stage.maxPerWallet, stats.minterNumMinted).toString(),
    remainingCollectionSupply: remaining(stats.maxSupply, stats.currentTotalSupply).toString(),
    remainingStageSupply: stage.maxSupplyForStage === null ? null : remaining(stage.maxSupplyForStage, stats.currentTotalSupply).toString(),
  };

  try {
    await client.call({ account: wallet, to: proposal.target, data: proposal.calldata, value: proposal.value, blockNumber });
  } catch {
    return fail(base, "SIMULATION_REVERTED", "The exact proposed transaction reverted during read-only simulation.", {
      ...fullPatch, ccff00Access, supply,
      simulation: { status: "REVERTED", blockNumber: blockNumber.toString(), gasEstimate: null, reason: "Simulation reverted; raw provider/RPC details are not exposed." },
    });
  }
  let gasEstimate: string | null = null;
  try {
    gasEstimate = (await client.estimateGas({ account: wallet, to: proposal.target, data: proposal.calldata, value: proposal.value })).toString();
  } catch {
    gasEstimate = null;
  }
  const digest = deterministicDigest({
    schemaVersion: RMT_NFT_MINT_PREFLIGHT_SCHEMA_VERSION,
    chainId: RMT_MINT_RADAR_CHAIN_ID,
    candidateId: candidate.candidateId,
    collection: candidate.collectionAddress.toLowerCase(),
    providerCollectionSlug: candidate.providerCollectionSlug,
    wallet: wallet.toLowerCase(),
    quantity: quantity.toString(),
    target: proposal.target.toLowerCase(),
    calldata: proposal.calldata.toLowerCase(),
    value: proposal.value.toString(),
    method: decoded.method,
    stage: stageReport(stage),
    simulationBlockNumber: blockNumber.toString(),
    checkedAt,
  });
  return {
    ...base,
    ...fullPatch,
    status: "PREFLIGHT_READY",
    message: "RMT independently verified and simulated this exact provider proposal. No transaction has been submitted.",
    recipient: wallet,
    ccff00Access,
    supply,
    simulation: { status: "SUCCEEDED", blockNumber: blockNumber.toString(), gasEstimate, reason: null },
    digest,
  };
}
