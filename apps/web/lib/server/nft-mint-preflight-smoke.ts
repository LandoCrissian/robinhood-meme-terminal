import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { CCFF00_COLLECTION } from "@rmt/shared/nft/project-registry";
import { createNftMintPreflightPostHandler } from "./nft-mint-preflight-route";
import {
  RMT_SEADROP_PREFLIGHT_ABI,
  decodeSeaDropMint,
  parseOpenSeaMintProposal,
  readOpenSeaMintProposal,
  runRmtNftMintPreflight,
  type RmtNftMintPreflightReport,
  type RmtNftMintProposal,
} from "./nft-mint-preflight";
import type { RmtMintRadarCandidate, RmtMintRadarResponse } from "./nft-mint-radar";

const NOW_SECONDS = 1_788_000_000n;
const NOW = new Date(Number(NOW_SECONDS) * 1_000);
const WALLET = getAddress("0x1000000000000000000000000000000000000001");
const OTHER_WALLET = getAddress("0x1000000000000000000000000000000000000002");
const COLLECTION = getAddress("0x2000000000000000000000000000000000000001");
const OTHER_COLLECTION = getAddress("0x2000000000000000000000000000000000000002");
const SEADROP = getAddress("0x3000000000000000000000000000000000000001");
const FEE_RECIPIENT = getAddress("0x4000000000000000000000000000000000000001");
const SEADROP_CODE = "0x60016000" as Hex;
const PRICE = 10_000_000_000_000_000n;
const PUBLIC_STAGE = {
  mintPrice: PRICE,
  startTime: NOW_SECONDS - 600n,
  endTime: NOW_SECONDS + 3_600n,
  maxTotalMintableByWallet: 5n,
  feeBps: 0n,
  restrictFeeRecipients: false,
};
const TOKEN_STAGE = {
  mintPrice: PRICE,
  maxTotalMintableByWallet: 5n,
  startTime: NOW_SECONDS - 600n,
  endTime: NOW_SECONDS + 3_600n,
  dropStageIndex: 0n,
  maxTokenSupplyForStage: 900n,
  feeBps: 0n,
  restrictFeeRecipients: false,
};
const DEPLOYMENTS = [{ address: SEADROP, runtimeBytecodeHash: keccak256(SEADROP_CODE) }] as const;

function iso(seconds: bigint) {
  return new Date(Number(seconds) * 1_000).toISOString();
}

function candidate(overrides: Partial<RmtMintRadarCandidate> = {}): RmtMintRadarCandidate {
  return {
    candidateId: "opensea:fixture-drop",
    chainId: 4_663,
    providerChain: "robinhood",
    provider: "OPENSEA_DROPS_V2",
    providerCollectionSlug: "fixture-drop",
    collectionName: "Fixture Drop",
    collectionAddress: COLLECTION,
    providerDropType: "SEADROP_V1_ERC721",
    state: "LIVE_NOW",
    stage: {
      type: "public",
      label: "Public",
      startTime: iso(PUBLIC_STAGE.startTime),
      endTime: iso(PUBLIC_STAGE.endTime),
      nativePriceWei: PRICE.toString(),
      priceCurrencyAddress: zeroAddress,
      maxPerWallet: PUBLIC_STAGE.maxTotalMintableByWallet.toString(),
    },
    providerReportedMinting: true,
    sourceUrl: "https://opensea.io/collection/fixture-drop",
    scheduleObservedAt: NOW.toISOString(),
    contractEvidence: {
      status: "ONCHAIN_VERIFIED_CONTRACT",
      codeExists: true,
      supportsErc165: true,
      supportsInvalidInterface: false,
      supportsErc721: true,
      supportsErc1155: false,
      supportsErc721Metadata: true,
      standard: "ERC721",
      observedAt: NOW.toISOString(),
    },
    mintActivity: { status: "ONCHAIN_MINT_ACTIVITY", transactionHash: null, blockNumber: "99", observedAt: NOW.toISOString(), marketMeaning: "NOT_ESTABLISHED" },
    ccff00Access: {
      status: "UNKNOWN",
      authority: "NONE",
      stage: null,
      holderMatches: { status: "NOT_CHECKED", matchingHolderCount: null, observedAt: null },
      walletEligibility: { status: "NOT_CHECKED", observedAt: null },
      evidence: [],
    },
    evidence: ["PROVIDER_REPORTED", "ONCHAIN_VERIFIED_CONTRACT"],
    rmtAdmission: "NOT_EVALUATED",
    projectTokenRelationship: null,
    ...overrides,
  };
}

function publicData(input: { collection?: Address; recipient?: Address; quantity?: bigint } = {}) {
  return encodeFunctionData({
    abi: RMT_SEADROP_PREFLIGHT_ABI,
    functionName: "mintPublic",
    args: [input.collection ?? COLLECTION, FEE_RECIPIENT, input.recipient ?? zeroAddress, input.quantity ?? 1n],
  });
}

function tokenData(input: { allowed?: Address; ids?: readonly bigint[]; recipient?: Address; collection?: Address } = {}) {
  return encodeFunctionData({
    abi: RMT_SEADROP_PREFLIGHT_ABI,
    functionName: "mintAllowedTokenHolder",
    args: [input.collection ?? COLLECTION, FEE_RECIPIENT, input.recipient ?? zeroAddress, {
      allowedNftToken: input.allowed ?? CCFF00_COLLECTION,
      allowedNftTokenIds: [...(input.ids ?? [1n])],
    }],
  });
}

function proposal(calldata = publicData(), value = PRICE, target = SEADROP): RmtNftMintProposal {
  return { target, calldata, value };
}

type ClientOverrides = {
  chainId?: number;
  code?: Hex;
  publicStage?: Record<string, unknown>;
  tokenStage?: Record<string, unknown>;
  mintStats?: readonly bigint[];
  owner?: Address;
  redeemed?: boolean;
  feeRecipientAllowed?: boolean;
  simulationReverts?: boolean;
};

function client(overrides: ClientOverrides = {}) {
  return {
    getChainId: async () => overrides.chainId ?? 4_663,
    getBytecode: async () => overrides.code ?? SEADROP_CODE,
    getBlock: async () => ({ number: 123_456n, timestamp: NOW_SECONDS }),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "getPublicDrop") return { ...PUBLIC_STAGE, ...overrides.publicStage };
      if (functionName === "getTokenGatedDrop") return { ...TOKEN_STAGE, ...overrides.tokenStage };
      if (functionName === "getTokenGatedAllowedTokens") return [CCFF00_COLLECTION];
      if (functionName === "getFeeRecipientIsAllowed") return overrides.feeRecipientAllowed ?? true;
      if (functionName === "getAllowedNftTokenIdIsRedeemed") return overrides.redeemed ?? false;
      if (functionName === "ownerOf") return overrides.owner ?? WALLET;
      if (functionName === "getMintStats") return overrides.mintStats ?? [0n, 100n, 1_000n];
      throw new Error(`Unexpected read ${functionName}`);
    },
    call: async () => {
      if (overrides.simulationReverts) throw new Error("fixture revert");
      return { data: "0x" };
    },
    estimateGas: async () => 145_000n,
  } as unknown as PublicClient;
}

async function run(input: {
  candidate?: RmtMintRadarCandidate;
  quantity?: bigint;
  proposal?: RmtNftMintProposal;
  client?: PublicClient;
  deployments?: typeof DEPLOYMENTS | readonly [];
}) {
  const result = await runRmtNftMintPreflight({
    candidate: input.candidate ?? candidate(),
    wallet: WALLET,
    quantity: input.quantity ?? 1n,
    proposal: input.proposal ?? proposal(),
    client: input.client ?? client(),
    deployments: input.deployments ?? DEPLOYMENTS,
    now: () => NOW,
  });
  assert.equal(result.rmtAdmission, "NOT_EVALUATED");
  assert.equal(result.projectTokenRelationship, null);
  assert.equal(result.transactionSubmitted, false);
  assert.equal(result.walletSignatureRequested, false);
  return result;
}

async function main() {
const wireProposal = (overrides: Record<string, unknown> = {}) => ({
  to: SEADROP,
  data: publicData(),
  value: `0x${PRICE.toString(16)}`,
  chain: "robinhood",
  ...overrides,
});
const parsed = parseOpenSeaMintProposal(wireProposal());
assert.equal(parsed.target, SEADROP);
assert.equal(parsed.calldata, publicData());
assert.equal(parsed.value, PRICE);
assert.throws(() => parseOpenSeaMintProposal(wireProposal({ chain: "base" })), /chain/);
const { chain: _missingChain, ...missingChain } = wireProposal();
assert.throws(() => parseOpenSeaMintProposal(missingChain), /fields changed/);
assert.throws(() => parseOpenSeaMintProposal({ target: SEADROP, calldata: publicData(), value: `0x${PRICE.toString(16)}`, chain: "robinhood" }), /fields changed/);
assert.throws(() => parseOpenSeaMintProposal(wireProposal({ value: PRICE.toString() })), /value/);
assert.throws(() => parseOpenSeaMintProposal(wireProposal({ value: "0xxyz" })), /value/);
assert.throws(() => parseOpenSeaMintProposal(wireProposal({ value: "-0x1" })), /value/);
assert.equal(parseOpenSeaMintProposal(wireProposal({ value: "0x0" })).value, 0n);
assert.equal(parseOpenSeaMintProposal(wireProposal({ value: "0x2386f26fc10000" })).value, 10_000_000_000_000_000n);
assert.throws(() => parseOpenSeaMintProposal(wireProposal({ to: "0x123" })), /target/);
assert.throws(() => parseOpenSeaMintProposal(wireProposal({ data: "0x123" })), /calldata/);

let capturedProviderRequest: { url: string; headers: Headers; body: string } | null = null;
const providerRead = await readOpenSeaMintProposal({
  slug: "fixture-drop",
  wallet: WALLET,
  quantity: 1n,
  env: { NFT_MINT_RADAR_OPENSEA_API_KEY: "server-only-fixture", NFT_MINT_RADAR_OPENSEA_BASE_URL: "http://127.0.0.1:43111" },
  fetchImpl: async (url, init) => {
    capturedProviderRequest = { url: String(url), headers: new Headers(init?.headers), body: String(init?.body) };
    return new Response(JSON.stringify(wireProposal()), { status: 200 });
  },
});
assert.equal(providerRead.target, SEADROP);
assert.equal(providerRead.calldata, publicData());
assert.equal(providerRead.value, PRICE);
assert.ok(capturedProviderRequest);
const captured = capturedProviderRequest as { url: string; headers: Headers; body: string };
assert.equal(captured.url, "http://127.0.0.1:43111/api/v2/drops/fixture-drop/mint");
assert.equal(captured.headers.get("x-api-key"), "server-only-fixture");
assert.deepEqual(JSON.parse(captured.body), { minter: WALLET, quantity: 1 });

const readyPublic = await run({});
assert.equal(readyPublic.status, "PREFLIGHT_READY");
assert.equal(readyPublic.method, "MINT_PUBLIC");
assert.equal(readyPublic.recipient, WALLET);
assert.equal(readyPublic.simulation.status, "SUCCEEDED");
assert.equal(readyPublic.simulation.blockNumber, "123456");
assert.equal(readyPublic.digest?.length, 66);

assert.equal((await run({ deployments: [] })).status, "TARGET_NOT_TRUSTED");
assert.equal((await run({ client: client({ code: "0x60026000" }) })).status, "TARGET_NOT_TRUSTED");
assert.equal((await run({ proposal: proposal(publicData({ collection: OTHER_COLLECTION })) })).status, "COLLECTION_MISMATCH");
assert.equal((await run({ proposal: proposal(publicData({ recipient: OTHER_WALLET })) })).status, "RECIPIENT_MISMATCH");
assert.equal((await run({ proposal: proposal(publicData({ quantity: 2n }), PRICE * 2n), quantity: 1n })).status, "QUANTITY_INVALID");
assert.equal((await run({ proposal: proposal(publicData(), PRICE + 1n) })).status, "PRICE_MISMATCH");
assert.equal((await run({ client: client({ publicStage: { endTime: NOW_SECONDS - 1n } }) })).status, "DROP_NOT_LIVE");
assert.equal((await run({ client: client({ publicStage: { startTime: NOW_SECONDS + 1n, endTime: NOW_SECONDS + 2_000n } }) })).status, "DROP_NOT_LIVE");
assert.equal((await run({ client: client({ mintStats: [5n, 100n, 1_000n] }) })).status, "WALLET_LIMIT_EXCEEDED");
assert.equal((await run({ client: client({ mintStats: [0n, 1_000n, 1_000n] }) })).status, "SUPPLY_EXHAUSTED");
assert.equal((await run({ client: client({ simulationReverts: true }) })).status, "SIMULATION_REVERTED");

await assert.rejects(() => readOpenSeaMintProposal({
  slug: "fixture-drop", wallet: WALLET, quantity: 1n,
  env: { NFT_MINT_RADAR_OPENSEA_API_KEY: "key", NFT_MINT_RADAR_OPENSEA_BASE_URL: "http://127.0.0.1:43111" },
  fetchImpl: async () => { throw new Error("offline"); },
}), /unavailable/);

assert.equal((await run({ proposal: proposal("0x12345678") })).status, "UNSUPPORTED_PREFLIGHT_METHOD");
const mintParams = {
  mintPrice: PRICE, maxTotalMintableByWallet: 5n, startTime: PUBLIC_STAGE.startTime, endTime: PUBLIC_STAGE.endTime,
  dropStageIndex: 1n, maxTokenSupplyForStage: 900n, feeBps: 0n, restrictFeeRecipients: false,
};
const allowlistData = encodeFunctionData({
  abi: RMT_SEADROP_PREFLIGHT_ABI, functionName: "mintAllowList",
  args: [COLLECTION, FEE_RECIPIENT, zeroAddress, 1n, mintParams, []],
});
assert.equal(decodeSeaDropMint(allowlistData).method, "MINT_ALLOW_LIST");
assert.equal((await run({ proposal: proposal(allowlistData) })).status, "UNSUPPORTED_PREFLIGHT_METHOD");
const signedData = encodeFunctionData({
  abi: RMT_SEADROP_PREFLIGHT_ABI, functionName: "mintSigned",
  args: [COLLECTION, FEE_RECIPIENT, zeroAddress, 1n, mintParams, 9n, "0x1234"],
});
assert.equal(decodeSeaDropMint(signedData).method, "MINT_SIGNED");
assert.equal((await run({ proposal: proposal(signedData) })).status, "UNSUPPORTED_PREFLIGHT_METHOD");

function gatedCandidate(overrides: Partial<RmtMintRadarCandidate> = {}) {
  return candidate({
    stage: {
      type: "token_gated",
      label: "CCFF00 Holders",
      startTime: iso(TOKEN_STAGE.startTime),
      endTime: iso(TOKEN_STAGE.endTime),
      nativePriceWei: PRICE.toString(),
      priceCurrencyAddress: zeroAddress,
      maxPerWallet: TOKEN_STAGE.maxTotalMintableByWallet.toString(),
    },
    ccff00Access: {
      status: "VERIFIED_COMMUNITY_GATE",
      authority: "ONCHAIN_SEADROP_CONFIGURATION",
      stage: {
        startTime: iso(TOKEN_STAGE.startTime),
        endTime: iso(TOKEN_STAGE.endTime),
        nativePriceWei: PRICE.toString(),
        maxPerWallet: TOKEN_STAGE.maxTotalMintableByWallet.toString(),
        maxSupplyForStage: TOKEN_STAGE.maxTokenSupplyForStage.toString(),
      },
      holderMatches: { status: "NOT_CHECKED", matchingHolderCount: null, observedAt: null },
      walletEligibility: { status: "NOT_CHECKED", observedAt: null },
      evidence: [{ kind: "EXACT_CCFF00_TOKEN_GATE", source: `SeaDrop ${SEADROP}`, observedAt: NOW.toISOString(), detail: "fixture" }],
    },
    ...overrides,
  });
}

assert.equal((await run({ candidate: candidate(), proposal: proposal(tokenData()) })).status, "CCFF00_ACCESS_NOT_VERIFIED");
assert.equal((await run({ candidate: gatedCandidate(), proposal: proposal(tokenData({ allowed: OTHER_COLLECTION })) })).status, "CCFF00_ACCESS_NOT_VERIFIED");
assert.equal((await run({ candidate: gatedCandidate(), proposal: proposal(tokenData()), client: client({ owner: OTHER_WALLET }) })).status, "CCFF00_TOKEN_NOT_ELIGIBLE");
assert.equal((await run({ candidate: gatedCandidate(), proposal: proposal(tokenData()), client: client({ redeemed: true }) })).status, "CCFF00_TOKEN_ALREADY_REDEEMED");
assert.equal((await run({ candidate: gatedCandidate(), proposal: proposal(tokenData()), client: client({ tokenStage: { mintPrice: PRICE + 1n } }) })).status, "STAGE_MISMATCH");
const readyGated = await run({ candidate: gatedCandidate(), proposal: proposal(tokenData()) });
assert.equal(readyGated.status, "PREFLIGHT_READY");
assert.equal(readyGated.method, "MINT_ALLOWED_TOKEN_HOLDER");
assert.deepEqual(readyGated.ccff00Access?.tokenIds, ["1"]);

const radar: RmtMintRadarResponse = {
  schemaVersion: 1, chainId: 4_663, providerChain: "robinhood", status: "READY", asOf: NOW.toISOString(),
  sources: [{ provider: "OPENSEA_DROPS_V2", authority: "PROVIDER_REPORTED_SCHEDULE", status: "READY" }],
  live: [candidate()], upcoming: [], recent: [],
};
let boundWallet: Address | null = null;
const handler = createNftMintPreflightPostHandler({
  bindWallet: async (_request, wallet) => { boundWallet = wallet; },
  readRadar: async () => radar,
  runPreflight: async () => readyPublic,
});
const routeResponse = await handler(new Request("http://localhost/api/nft/mint-preflight", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ candidateId: "opensea:fixture-drop", wallet: WALLET, quantity: 1 }),
}));
assert.equal(routeResponse.status, 200);
assert.equal(boundWallet, WALLET);
const arbitraryPayload = await handler(new Request("http://localhost/api/nft/mint-preflight", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ candidateId: "opensea:fixture-drop", wallet: WALLET, quantity: 1, target: SEADROP, calldata: publicData(), value: PRICE.toString() }),
}));
assert.equal(arbitraryPayload.status, 400, "browser cannot provide target, calldata, or value");

const sources = await Promise.all([
  readFile(new URL("./nft-mint-preflight.ts", import.meta.url), "utf8"),
  readFile(new URL("../../app/api/nft/mint-preflight/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../../app/nft/_components/nft-mint-readiness.tsx", import.meta.url), "utf8"),
]);
const executableSurface = sources.join("\n");
assert.doesNotMatch(executableSurface, /\b(?:sendTransaction|writeContract|useWriteContract|wallet_sendTransaction|eth_sendRawTransaction)\b/);
assert.doesNotMatch(executableSurface, /NEXT_PUBLIC_.*(?:OPENSEA|SEADROP|RPC)/);

console.info("NFT Mint Execution Preflight provider parsing, SeaDrop decoding, exact binding, stage/supply/access verification, simulation, digest, and no-send boundary smoke: PASS");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
