import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type Transaction,
  type TransactionReceipt,
} from "viem";
import { CCFF00_COLLECTION } from "@rmt/shared/nft/project-registry";
import {
  isRmtWalletUserRejection,
  pendingRmtNftMintExecution,
  prepareRmtNftMintWalletTransaction,
  readRmtNftMintExecutionRecords,
  resolveRmtNftMintExecutionRecord,
  submittedRmtNftMintExecutionRecord,
  writeRmtNftMintExecutionRecord,
} from "../nft-mint-execution";
import { createNftMintExecutionPlanPostHandler } from "./nft-mint-execution-plan-route";
import {
  RMT_SEADROP_PREFLIGHT_ABI,
  computeRmtNftMintPreflightDigest,
  type RmtNftMintPreflightReport,
  type RmtNftVerifiedMintPlan,
} from "./nft-mint-preflight";
import { verifyRmtNftMintReceipt, type RmtNftMintReceiptContext } from "./nft-mint-receipt";

const WALLET = getAddress("0x1000000000000000000000000000000000000001");
const OTHER = getAddress("0x1000000000000000000000000000000000000002");
const COLLECTION = getAddress("0x2000000000000000000000000000000000000001");
const OTHER_COLLECTION = getAddress("0x2000000000000000000000000000000000000002");
const SEADROP = getAddress("0x3000000000000000000000000000000000000001");
const FEE_RECIPIENT = getAddress("0x4000000000000000000000000000000000000001");
const CODE = "0x60016000" as Hex;
const TX_HASH = `0x${"ab".repeat(32)}` as Hex;
const CHECKED_AT = "2026-08-28T12:00:00.000Z";
const STAGE = {
  startTime: "2026-08-28T11:00:00.000Z",
  endTime: "2026-08-28T13:00:00.000Z",
  maxPerWallet: "5",
  maxSupplyForStage: null,
  dropStageIndex: "0",
  feeBps: "0",
  restrictFeeRecipients: false,
} as const;

function publicCalldata(collection = COLLECTION, recipient: Address = zeroAddress, quantity = 1n) {
  return encodeFunctionData({ abi: RMT_SEADROP_PREFLIGHT_ABI, functionName: "mintPublic", args: [collection, FEE_RECIPIENT, recipient, quantity] });
}

function gatedCalldata(allowed = CCFF00_COLLECTION, ids: readonly bigint[] = [7n]) {
  return encodeFunctionData({
    abi: RMT_SEADROP_PREFLIGHT_ABI,
    functionName: "mintAllowedTokenHolder",
    args: [COLLECTION, FEE_RECIPIENT, zeroAddress, { allowedNftToken: allowed, allowedNftTokenIds: [...ids] }],
  });
}

function plan(calldata = publicCalldata(), method: RmtNftVerifiedMintPlan["method"] = "MINT_PUBLIC"): RmtNftVerifiedMintPlan {
  const digest = computeRmtNftMintPreflightDigest({
    schemaVersion: 1, chainId: 4_663, candidateId: "opensea:fixture-drop", collection: COLLECTION.toLowerCase(),
    providerCollectionSlug: "fixture-drop", wallet: WALLET.toLowerCase(), quantity: "1", target: SEADROP.toLowerCase(),
    calldata: calldata.toLowerCase(), value: "100", method, stage: STAGE, simulationBlockNumber: "123", checkedAt: CHECKED_AT,
  });
  return {
    schemaVersion: 1, chainId: 4_663, status: "EXECUTION_PLAN_READY", candidateId: "opensea:fixture-drop",
    providerCollectionSlug: "fixture-drop", collection: COLLECTION, wallet: WALLET, quantity: "1", method,
    target: SEADROP, calldata, calldataHash: keccak256(calldata), value: "100", stage: STAGE,
    ccff00Access: method === "MINT_ALLOWED_TOKEN_HOLDER" ? { collection: CCFF00_COLLECTION, tokenIds: ["7"], status: "REVERIFIED" } : null,
    simulationBlockNumber: "123", gasEstimate: "100000", digest, checkedAt: CHECKED_AT,
    expiresAt: "2026-08-28T12:00:30.000Z", rmtFeeWei: "0", rmtAdmission: "NOT_EVALUATED", projectTokenRelationship: null,
  };
}

const fixturePlan = plan();
const readyReport = { status: "PREFLIGHT_READY" } as RmtNftMintPreflightReport;
const radar = { status: "READY", live: [{ candidateId: "opensea:fixture-drop" }] } as never;

async function main() {
let radarReads = 0;
const disabled = createNftMintExecutionPlanPostHandler({
  env: { RMT_NFT_MINT_EXECUTION_ENABLED: "false" },
  readRadar: async () => { radarReads += 1; return radar; },
});
const disabledResponse = await disabled(new Request("http://localhost/api/nft/mint-execution-plan", { method: "POST", body: "{}" }));
assert.equal(disabledResponse.status, 403, "SERVER_EXECUTION_FLAG_FALSE_REJECTS");
assert.equal(radarReads, 0, "DISABLED_STOPS_BEFORE_PROVIDER");

let planRuns = 0;
const enabled = createNftMintExecutionPlanPostHandler({
  env: { RMT_NFT_MINT_EXECUTION_ENABLED: "true" },
  bindWallet: async (_request, wallet) => { assert.equal(wallet, WALLET); },
  readRadar: async () => radar,
  runPreflightWithPlan: async () => { planRuns += 1; return { report: readyReport, plan: fixturePlan }; },
});
function request(body: object) {
  return new Request("http://localhost/api/nft/mint-execution-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
const planResponse = await enabled(request({ candidateId: "opensea:fixture-drop", wallet: WALLET, quantity: 1 }));
assert.equal(planResponse.status, 200, "FRESH_EXECUTION_PLAN_READY");
assert.deepEqual(await planResponse.json(), fixturePlan, "EXACT_VERIFIED_PLAN_RETURNED");
assert.equal(planRuns, 1, "ONE_PREFLIGHT_ENGINE_RUN");
for (const forbidden of ["target", "calldata", "value", "chainId", "digest", "providerCollectionSlug", "collection"]) {
  const response = await enabled(request({ candidateId: "opensea:fixture-drop", wallet: WALLET, quantity: 1, [forbidden]: "browser-controlled" }));
  assert.equal(response.status, 400, `CLIENT_${forbidden.toUpperCase()}_REJECTED`);
}
const staleReadiness = await enabled(request({ candidateId: "opensea:fixture-drop", wallet: WALLET, quantity: 1, readiness: readyReport }));
assert.equal(staleReadiness.status, 400, "STALE_READINESS_CANNOT_EXECUTE");

const prepared = prepareRmtNftMintWalletTransaction({ plan: fixturePlan, connectedAddress: WALLET, connectedChainId: 4_663, selectedCandidateId: fixturePlan.candidateId, selectedQuantity: 1, nowMs: Date.parse(CHECKED_AT) + 5_000 });
assert.deepEqual(prepared, { account: WALLET, chainId: 4_663, to: SEADROP, data: fixturePlan.calldata, value: 100n }, "EXACT_TARGET_DATA_VALUE_TO_WALLET");
assert.throws(() => prepareRmtNftMintWalletTransaction({ plan: fixturePlan, connectedAddress: OTHER, connectedChainId: 4_663, selectedCandidateId: fixturePlan.candidateId, selectedQuantity: 1, nowMs: Date.parse(CHECKED_AT) }), /PLAN_CONTEXT_CHANGED/, "ACCOUNT_RACE_GUARD");
assert.throws(() => prepareRmtNftMintWalletTransaction({ plan: fixturePlan, connectedAddress: WALLET, connectedChainId: 1, selectedCandidateId: fixturePlan.candidateId, selectedQuantity: 1, nowMs: Date.parse(CHECKED_AT) }), /PLAN_CONTEXT_CHANGED/, "CHAIN_RACE_GUARD");
assert.throws(() => prepareRmtNftMintWalletTransaction({ plan: fixturePlan, connectedAddress: WALLET, connectedChainId: 4_663, selectedCandidateId: fixturePlan.candidateId, selectedQuantity: 2, nowMs: Date.parse(CHECKED_AT) }), /PLAN_CONTEXT_CHANGED/, "QUANTITY_RACE_GUARD");
assert.throws(() => prepareRmtNftMintWalletTransaction({ plan: fixturePlan, connectedAddress: WALLET, connectedChainId: 4_663, selectedCandidateId: fixturePlan.candidateId, selectedQuantity: 1, nowMs: Date.parse(fixturePlan.expiresAt) }), /EXECUTION_PLAN_EXPIRED/, "EXPIRED_PLAN_REJECTED");
assert.equal(isRmtWalletUserRejection({ code: 4001 }), true, "USER_REJECTION_HANDLED");

const memory = new Map<string, string>();
const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
const pending = submittedRmtNftMintExecutionRecord(fixturePlan, TX_HASH, CHECKED_AT);
writeRmtNftMintExecutionRecord(storage, pending);
assert.equal(readRmtNftMintExecutionRecords(storage).length, 1, "PENDING_RECORD_SURVIVES_RELOAD");
assert.equal(pendingRmtNftMintExecution(storage, WALLET, fixturePlan.candidateId)?.txHash, TX_HASH, "PENDING_RECORD_RECOVERED");

const transferEvent = [{ type: "event", name: "Transfer", inputs: [
  { indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: true, name: "tokenId", type: "uint256" },
] }] as const;
function transferLog(to = WALLET, tokenId = 9n, collection = COLLECTION) {
  return { address: collection, data: "0x", topics: encodeEventTopics({ abi: transferEvent, eventName: "Transfer", args: { from: zeroAddress, to, tokenId } }) };
}
function receiptContext(inputPlan = fixturePlan): RmtNftMintReceiptContext {
  return {
    txHash: TX_HASH, candidateId: inputPlan.candidateId, providerCollectionSlug: inputPlan.providerCollectionSlug,
    collection: inputPlan.collection, wallet: inputPlan.wallet, quantity: inputPlan.quantity, method: inputPlan.method,
    target: inputPlan.target, value: inputPlan.value, calldataHash: inputPlan.calldataHash, preflightDigest: inputPlan.digest,
    stage: inputPlan.stage, simulationBlockNumber: inputPlan.simulationBlockNumber, planCheckedAt: inputPlan.checkedAt,
  };
}
function receiptClient(input: { calldata?: Hex; sender?: Address; code?: Hex; status?: "success" | "reverted"; logs?: readonly unknown[] } = {}) {
  const transaction = { from: input.sender ?? WALLET, to: SEADROP, input: input.calldata ?? fixturePlan.calldata, value: 100n } as Transaction;
  const receipt = { status: input.status ?? "success", blockNumber: 456n, logs: input.logs ?? [transferLog()] } as TransactionReceipt;
  return {
    getChainId: async () => 4_663,
    getBytecode: async () => input.code ?? CODE,
    getTransaction: async () => transaction,
    getTransactionReceipt: async () => receipt,
  } as never;
}
const deployments = [{ address: SEADROP, runtimeBytecodeHash: keccak256(CODE) }] as const;
const confirmed = await verifyRmtNftMintReceipt({ context: receiptContext(), client: receiptClient(), deployments });
assert.equal(confirmed.status, "MINT_CONFIRMED", "SUCCESSFUL_RECEIPT");
assert.deepEqual(confirmed.mintedTokenIds, ["9"], "CANONICAL_TOKEN_IDS_EXTRACTED");
assert.equal(confirmed.rmtAdmission, "NOT_EVALUATED", "RECEIPT_DOES_NOT_ADMIT_PROJECT");
assert.equal(confirmed.projectTokenRelationship, null, "RECEIPT_DOES_NOT_CREATE_RELATIONSHIP");
assert.equal(resolveRmtNftMintExecutionRecord(pending, confirmed).state, "CONFIRMED", "SUCCESSFUL_RECOVERED_RECEIPT");
const failed = await verifyRmtNftMintReceipt({ context: receiptContext(), client: receiptClient({ status: "reverted" }), deployments });
assert.equal(failed.status, "MINT_FAILED", "REVERTED_RECEIPT");
assert.equal(resolveRmtNftMintExecutionRecord(pending, failed).state, "FAILED", "FAILED_RECOVERED_RECEIPT");
assert.equal((await verifyRmtNftMintReceipt({ context: receiptContext(), client: receiptClient({ sender: OTHER }), deployments })).status, "RECEIPT_INVALID", "WRONG_SENDER_REJECTED");
assert.equal((await verifyRmtNftMintReceipt({ context: receiptContext(), client: receiptClient({ code: "0x60026000" }), deployments })).status, "RECEIPT_INVALID", "TARGET_RUNTIME_DRIFT_REJECTED");
assert.equal((await verifyRmtNftMintReceipt({ context: receiptContext(), client: receiptClient({ calldata: publicCalldata(OTHER_COLLECTION) }), deployments })).status, "RECEIPT_INVALID", "WRONG_COLLECTION_REJECTED");
assert.equal((await verifyRmtNftMintReceipt({ context: receiptContext(), client: receiptClient({ logs: [] }), deployments })).status, "RECEIPT_INVALID", "MISSING_MINT_EVENT_REJECTED");
assert.equal((await verifyRmtNftMintReceipt({ context: receiptContext(), client: receiptClient({ logs: [transferLog(OTHER)] }), deployments })).status, "RECEIPT_INVALID", "WRONG_RECIPIENT_EVENT_REJECTED");
assert.equal((await verifyRmtNftMintReceipt({ context: receiptContext(), client: receiptClient({ logs: [transferLog(), transferLog(WALLET, 10n)] }), deployments })).status, "RECEIPT_INVALID", "WRONG_MINT_QUANTITY_REJECTED");

const gatedPlan = plan(gatedCalldata(), "MINT_ALLOWED_TOKEN_HOLDER");
const gated = await verifyRmtNftMintReceipt({ context: receiptContext(gatedPlan), client: receiptClient({ calldata: gatedPlan.calldata }), deployments });
assert.equal(gated.status, "MINT_CONFIRMED", "CCFF00_GATED_RECEIPT");
assert.deepEqual(gated.ccff00ConsumedTokenIds, ["7"], "CCFF00_CONSUMED_IDS_PRESERVED");
const wrongGatePlan = plan(gatedCalldata(OTHER_COLLECTION), "MINT_ALLOWED_TOKEN_HOLDER");
assert.equal((await verifyRmtNftMintReceipt({ context: receiptContext(wrongGatePlan), client: receiptClient({ calldata: wrongGatePlan.calldata }), deployments })).status, "RECEIPT_INVALID", "WRONG_ALLOWED_TOKEN_REJECTED");

const clientSource = await readFile(new URL("../../app/nft/_components/nft-mint-readiness.tsx", import.meta.url), "utf8");
const recoverySource = await readFile(new URL("../../app/nft/_components/nft-mint-execution-recovery.tsx", import.meta.url), "utf8");
const nftPageSource = await readFile(new URL("../../app/nft/page.tsx", import.meta.url), "utf8");
const planRouteSource = await readFile(new URL("../../app/api/nft/mint-execution-plan/route.ts", import.meta.url), "utf8");
const receiptSource = await readFile(new URL("nft-mint-receipt.ts", import.meta.url), "utf8");
const envExample = await readFile(new URL("../../.env.example", import.meta.url), "utf8");
assert.match(clientSource, /NEXT_PUBLIC_RMT_NFT_MINT_EXECUTION_ENABLED === "true"/, "CLIENT_FLAG_REQUIRED");
assert.match(clientSource, /executionInFlight\.current \|\| executionRecord\?\.state === "PENDING"/, "DOUBLE_SUBMISSION_GUARD");
assert.match(clientSource, /sendTransactionAsync\(transaction\)/, "WALLET_CONFIRMATION_PATH");
assert.match(recoverySource, /readRmtNftMintExecutionRecords[\s\S]*?item\.wallet\.toLowerCase\(\)/, "PAGE_LEVEL_EXECUTION_RECOVERY");
assert.match(nftPageSource, /<NftMintExecutionRecovery \/>/, "RECOVERY_SURVIVES_DROP_LEAVING_LIVE_FEED");
assert.doesNotMatch(planRouteSource + receiptSource, /sendTransaction|writeContract|wallet_sendTransaction|eth_sendRawTransaction|signTransaction/, "NO_SERVER_SIGN_OR_BROADCAST");
assert.match(clientSource, /fetch\("\/api\/nft\/mint-execution-plan"[\s\S]*?body: JSON\.stringify\(\{ candidateId, wallet: address, quantity \}\)/, "PLAN_ENDPOINT_RECEIVES_ONLY_BOUNDED_INTENT");
assert.match(envExample, /^RMT_NFT_MINT_EXECUTION_ENABLED=false$/m, "SERVER_FLAG_DEFAULT_FALSE");
assert.match(envExample, /^NEXT_PUBLIC_RMT_NFT_MINT_EXECUTION_ENABLED=false$/m, "CLIENT_FLAG_DEFAULT_FALSE");

console.log("NFT mint execution smoke: PASS");
}

void main();
