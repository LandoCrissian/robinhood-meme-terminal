import {
  decodeEventLog,
  getAddress,
  isAddressEqual,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type Transaction,
  type TransactionReceipt,
} from "viem";
import { CCFF00_COLLECTION } from "@rmt/shared/nft/project-registry";
import { createRmtMintRadarPublicClient, parseReviewedSeaDropDeployments, type ReviewedSeaDropDeployment } from "./nft-mint-radar";
import { computeRmtNftMintPreflightDigest, decodeSeaDropMint, type RmtNftVerifiedMintPlan } from "./nft-mint-preflight";

const TRANSFER_EVENT = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: true, name: "tokenId", type: "uint256" },
  ],
}] as const;

export type RmtNftMintReceiptContext = {
  txHash: Hex;
  candidateId: string;
  providerCollectionSlug: string;
  collection: Address;
  wallet: Address;
  quantity: string;
  method: RmtNftVerifiedMintPlan["method"];
  target: Address;
  value: string;
  calldataHash: Hex;
  preflightDigest: Hex;
  stage: RmtNftVerifiedMintPlan["stage"];
  simulationBlockNumber: string;
  planCheckedAt: string;
};

export type RmtNftMintReceiptReport = {
  schemaVersion: 1;
  chainId: 4_663;
  status: "MINT_PENDING" | "MINT_CONFIRMED" | "MINT_FAILED" | "RECEIPT_INVALID" | "EVIDENCE_UNAVAILABLE";
  message: string;
  txHash: Hex;
  candidateId: string;
  collection: Address;
  wallet: Address;
  quantity: string;
  method: RmtNftMintReceiptContext["method"];
  target: Address;
  value: string;
  blockNumber: string | null;
  mintedTokenIds: readonly string[];
  ccff00ConsumedTokenIds: readonly string[];
  receiptVerifiedAt: string;
  rmtFeeWei: "0";
  rmtAdmission: "NOT_EVALUATED";
  projectTokenRelationship: null;
};

type ReceiptClient = Pick<PublicClient, "getChainId" | "getBytecode" | "getTransaction" | "getTransactionReceipt">;

function base(context: RmtNftMintReceiptContext): RmtNftMintReceiptReport {
  return {
    schemaVersion: 1,
    chainId: 4_663,
    status: "EVIDENCE_UNAVAILABLE",
    message: "Mint receipt evidence could not be established.",
    txHash: context.txHash,
    candidateId: context.candidateId,
    collection: context.collection,
    wallet: context.wallet,
    quantity: context.quantity,
    method: context.method,
    target: context.target,
    value: context.value,
    blockNumber: null,
    mintedTokenIds: [],
    ccff00ConsumedTokenIds: [],
    receiptVerifiedAt: new Date().toISOString(),
    rmtFeeWei: "0",
    rmtAdmission: "NOT_EVALUATED",
    projectTokenRelationship: null,
  };
}

function trustedDeployment(target: Address, deployments: readonly ReviewedSeaDropDeployment[]) {
  return deployments.find((deployment) => isAddressEqual(deployment.address, target)) ?? null;
}

function confirmedMintTokenIds(receipt: TransactionReceipt, collection: Address, recipient: Address) {
  const ids: bigint[] = [];
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, collection)) continue;
    try {
      const decoded = decodeEventLog({ abi: TRANSFER_EVENT, data: log.data, topics: log.topics });
      if (decoded.eventName !== "Transfer") continue;
      if (!isAddressEqual(decoded.args.from, zeroAddress) || !isAddressEqual(decoded.args.to, recipient)) continue;
      ids.push(decoded.args.tokenId);
    } catch {
      // Unrelated collection logs are not mint evidence.
    }
  }
  return ids;
}

export async function verifyRmtNftMintReceipt(input: {
  context: RmtNftMintReceiptContext;
  env?: Partial<NodeJS.ProcessEnv>;
  client?: ReceiptClient;
  deployments?: readonly ReviewedSeaDropDeployment[];
  now?: () => Date;
}): Promise<RmtNftMintReceiptReport> {
  const { context } = input;
  const result = base(context);
  result.receiptVerifiedAt = (input.now ?? (() => new Date()))().toISOString();
  const deployments = input.deployments ?? (() => {
    try { return parseReviewedSeaDropDeployments((input.env ?? process.env).NFT_MINT_RADAR_REVIEWED_SEADROP_DEPLOYMENTS); } catch { return []; }
  })();
  const deployment = trustedDeployment(context.target, deployments);
  if (!deployment) return { ...result, status: "RECEIPT_INVALID", message: "The transaction target is not an owner-reviewed SeaDrop deployment." };
  const client = input.client ?? createRmtMintRadarPublicClient(input.env ?? process.env);
  let transaction: Transaction;
  let receipt: TransactionReceipt;
  try {
    const [chainId, code, readTransaction, readReceipt] = await Promise.all([
      client.getChainId(),
      client.getBytecode({ address: context.target }),
      client.getTransaction({ hash: context.txHash }),
      client.getTransactionReceipt({ hash: context.txHash }),
    ]);
    if (chainId !== 4_663 || !code || code === "0x" || keccak256(code).toLowerCase() !== deployment.runtimeBytecodeHash.toLowerCase()) {
      return { ...result, status: "RECEIPT_INVALID", message: "SeaDrop target chain or runtime evidence changed." };
    }
    transaction = readTransaction;
    receipt = readReceipt;
  } catch (cause) {
    const text = cause instanceof Error ? cause.message : "";
    if (/not found|could not be found|unknown transaction/i.test(text)) {
      return { ...result, status: "MINT_PENDING", message: "The wallet broadcast is pending canonical receipt evidence." };
    }
    return result;
  }

  if (!transaction.to || !isAddressEqual(transaction.from, context.wallet) || !isAddressEqual(transaction.to, context.target)) {
    return { ...result, status: "RECEIPT_INVALID", message: "Transaction sender or target did not match the verified execution record." };
  }
  if (transaction.value.toString() !== context.value || keccak256(transaction.input).toLowerCase() !== context.calldataHash.toLowerCase()) {
    return { ...result, status: "RECEIPT_INVALID", message: "Onchain transaction bytes did not match the verified execution record." };
  }
  let decoded: ReturnType<typeof decodeSeaDropMint>;
  try { decoded = decodeSeaDropMint(transaction.input); } catch {
    return { ...result, status: "RECEIPT_INVALID", message: "Onchain SeaDrop calldata could not be decoded." };
  }
  if ((decoded.method !== "MINT_PUBLIC" && decoded.method !== "MINT_ALLOWED_TOKEN_HOLDER")
    || decoded.method !== context.method
    || !decoded.collection
    || !isAddressEqual(decoded.collection, context.collection)
    || decoded.quantity?.toString() !== context.quantity
    || !decoded.minterIfNotPayer
    || (!isAddressEqual(decoded.minterIfNotPayer, zeroAddress) && !isAddressEqual(decoded.minterIfNotPayer, context.wallet))) {
    return { ...result, status: "RECEIPT_INVALID", message: "Decoded mint method, collection, recipient, or quantity did not match." };
  }
  if (decoded.method === "MINT_ALLOWED_TOKEN_HOLDER" && (!decoded.allowedNftToken || !isAddressEqual(decoded.allowedNftToken, CCFF00_COLLECTION))) {
    return { ...result, status: "RECEIPT_INVALID", message: "The token-gated transaction did not bind exact CCFF00 access." };
  }
  const recomputedDigest = computeRmtNftMintPreflightDigest({
    schemaVersion: 1,
    chainId: 4_663,
    candidateId: context.candidateId,
    collection: context.collection.toLowerCase(),
    providerCollectionSlug: context.providerCollectionSlug,
    wallet: context.wallet.toLowerCase(),
    quantity: context.quantity,
    target: context.target.toLowerCase(),
    calldata: transaction.input.toLowerCase(),
    value: context.value,
    method: context.method,
    stage: context.stage,
    simulationBlockNumber: context.simulationBlockNumber,
    checkedAt: context.planCheckedAt,
  });
  if (recomputedDigest.toLowerCase() !== context.preflightDigest.toLowerCase()) {
    return { ...result, status: "RECEIPT_INVALID", message: "The preflight integrity fingerprint did not match the onchain transaction." };
  }
  const blockNumber = receipt.blockNumber.toString();
  const ccff00ConsumedTokenIds = decoded.method === "MINT_ALLOWED_TOKEN_HOLDER" ? decoded.allowedNftTokenIds.map(String) : [];
  if (receipt.status !== "success") {
    return { ...result, status: "MINT_FAILED", message: "The mint transaction reverted onchain.", blockNumber, ccff00ConsumedTokenIds };
  }
  const tokenIds = confirmedMintTokenIds(receipt, context.collection, context.wallet);
  if (tokenIds.length !== Number(BigInt(context.quantity))) {
    return { ...result, status: "RECEIPT_INVALID", message: "The receipt did not contain the expected canonical ERC721 mint transfers.", blockNumber, ccff00ConsumedTokenIds };
  }
  return {
    ...result,
    status: "MINT_CONFIRMED",
    message: "Mint confirmed from canonical onchain transaction and ERC721 mint evidence.",
    blockNumber,
    mintedTokenIds: tokenIds.map(String),
    ccff00ConsumedTokenIds,
  };
}
