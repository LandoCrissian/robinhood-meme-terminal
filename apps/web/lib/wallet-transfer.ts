import { getAddress, isAddress, parseEther, zeroAddress, type Address } from "viem";
import { bindRmtActiveSigner, type RmtActiveSignerAuthority } from "./wallet-gateway";

export type PreparedNativeTransfer = {
  recipient: Address;
  value: bigint;
};

export type NativeTransferState = "PROMPT_REQUESTED" | "SUBMITTED" | "CONFIRMED" | "REVERTED" | "REJECTED" | "UNKNOWN";

export type NativeTransferSession = {
  version: 1;
  requestId: string;
  sender: Address;
  recipient: Address;
  valueAtomic: string;
  chainId: number;
  walletKey: string;
  connectorUid: string;
  state: NativeTransferState;
  txHash?: `0x${string}`;
  updatedAt: number;
};

export type NativeTransferSettlementEvidence = {
  contextChainId: number;
  receipt: {
    blockHash: `0x${string}`;
    blockNumber: bigint;
    transactionHash: `0x${string}`;
  };
  transaction: {
    blockHash: `0x${string}` | null;
    blockNumber: bigint | null;
    chainId?: number;
    from: string;
    hash: `0x${string}`;
    input: `0x${string}`;
    to: string | null;
    value: bigint;
  };
};

export type NativeTransferRevertedReceiptEvidence = {
  contextChainId: number;
  transactionHash: `0x${string}`;
};

export type NativeTransferSettlementResolution = {
  outcome: "EXACT_MATCH" | "EVIDENCE_UNAVAILABLE" | "EVIDENCE_MISMATCH";
  session: NativeTransferSession;
};

function isExactNonzeroHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0{64}$/i.test(value);
}

function sameAddress(left: string, right: string) {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

function updateNativeTransferState(
  session: NativeTransferSession,
  state: NativeTransferState,
  options: { txHash?: `0x${string}`; now?: number } = {}
) {
  if (session.txHash !== undefined && !isExactNonzeroHash(session.txHash)) {
    throw new Error("A tracked transfer hash must be exact and nonzero.");
  }
  if (options.txHash !== undefined && !isExactNonzeroHash(options.txHash)) {
    throw new Error("A tracked transfer hash must be exact and nonzero.");
  }
  const txHash = options.txHash ?? session.txHash;
  if (["SUBMITTED", "CONFIRMED", "REVERTED"].includes(state) && txHash === undefined) {
    throw new Error(`A ${state.toLowerCase()} transfer requires an exact transaction hash.`);
  }
  return { ...session, state, txHash, updatedAt: options.now ?? Date.now() };
}

export function bindNativeTransferSigner(input: {
  selectedWalletKey?: string | null;
  selectedWalletKind?: "embedded" | "external" | null;
  selectedSignerAuthority?: RmtActiveSignerAuthority | null;
  connectedAddress?: string;
  connectedChainId?: number;
  connectorId?: string;
  connectorType?: string;
  connectorUid?: string;
  walletClientAddress?: string;
  walletClientChainId?: number;
  requiredChainId: number;
}) {
  const binding = bindRmtActiveSigner(input);
  if (input.connectedChainId !== input.requiredChainId || input.walletClientChainId !== input.requiredChainId) {
    throw new Error("Switch the active wallet to the selected Robinhood network and try again.");
  }
  if (!input.walletClientAddress || getAddress(input.walletClientAddress) !== binding.address) {
    throw new Error("The exact selected wallet client changed before transfer review.");
  }
  return {
    address: binding.address,
    connectorId: binding.authority.connectorId,
    connectorType: binding.authority.connectorType,
    connectorUid: binding.authority.connectorUid,
    fingerprint: JSON.stringify([
      binding.authority.walletKey,
      binding.authority.connectorUid,
      binding.authority.connectorId,
      binding.authority.connectorType,
      binding.address.toLowerCase(),
      input.requiredChainId
    ])
  };
}

export function nativeTransferStorageKey(sender: string, chainId: number) {
  if (!isAddress(sender, { strict: false }) || !Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Transfer recovery requires an exact sender and chain.");
  }
  return `rmt:native-transfer:v1:${chainId}:${getAddress(sender).toLowerCase()}`;
}

export function createNativeTransferPrompt(input: {
  requestId: string;
  sender: string;
  recipient: string;
  value: bigint;
  chainId: number;
  walletKey: string;
  connectorUid: string;
  now?: number;
}): NativeTransferSession {
  if (!input.requestId || input.value <= 0n || !input.walletKey || !input.connectorUid) {
    throw new Error("Transfer recovery requires a complete reviewed request.");
  }
  return {
    version: 1,
    requestId: input.requestId,
    sender: getAddress(input.sender),
    recipient: getAddress(input.recipient),
    valueAtomic: input.value.toString(),
    chainId: input.chainId,
    walletKey: input.walletKey,
    connectorUid: input.connectorUid,
    state: "PROMPT_REQUESTED",
    updatedAt: input.now ?? Date.now()
  };
}

export function transitionNativeTransfer(
  session: NativeTransferSession,
  state: NativeTransferState,
  options: { txHash?: `0x${string}`; now?: number } = {}
): NativeTransferSession {
  if (state === "CONFIRMED") {
    throw new Error("A confirmed transfer requires independently matched mined transaction evidence.");
  }
  if (state === "REVERTED") {
    throw new Error("A reverted transfer requires an independently matched receipt hash and chain context.");
  }
  return updateNativeTransferState(session, state, options);
}

export function resolveNativeTransferRevertedReceipt(
  session: NativeTransferSession,
  evidence?: NativeTransferRevertedReceiptEvidence,
  now?: number
): NativeTransferSettlementResolution {
  const unresolved = (outcome: "EVIDENCE_UNAVAILABLE" | "EVIDENCE_MISMATCH"): NativeTransferSettlementResolution => ({
    outcome,
    session: updateNativeTransferState(session, "UNKNOWN", { now })
  });
  if (!evidence) return unresolved("EVIDENCE_UNAVAILABLE");

  const expectedHash = session.txHash;
  if (!isExactNonzeroHash(expectedHash)
    || !isExactNonzeroHash(evidence.transactionHash)
    || evidence.transactionHash.toLowerCase() !== expectedHash.toLowerCase()
    || evidence.contextChainId !== session.chainId) {
    return unresolved("EVIDENCE_MISMATCH");
  }

  return {
    outcome: "EXACT_MATCH",
    session: updateNativeTransferState(session, "REVERTED", { now })
  };
}

export function resolveNativeTransferSettlement(
  session: NativeTransferSession,
  evidence?: NativeTransferSettlementEvidence,
  now?: number
): NativeTransferSettlementResolution {
  const unresolved = (outcome: "EVIDENCE_UNAVAILABLE" | "EVIDENCE_MISMATCH"): NativeTransferSettlementResolution => ({
    outcome,
    session: updateNativeTransferState(session, "UNKNOWN", { now })
  });
  if (!evidence) return unresolved("EVIDENCE_UNAVAILABLE");

  const expectedHash = session.txHash;
  if (!isExactNonzeroHash(expectedHash)
    || !isExactNonzeroHash(evidence.receipt.transactionHash)
    || !isExactNonzeroHash(evidence.receipt.blockHash)
    || !isExactNonzeroHash(evidence.transaction.hash)
    || !isExactNonzeroHash(evidence.transaction.blockHash)
    || evidence.receipt.transactionHash.toLowerCase() !== expectedHash.toLowerCase()
    || evidence.transaction.hash.toLowerCase() !== expectedHash.toLowerCase()
    || evidence.transaction.blockHash.toLowerCase() !== evidence.receipt.blockHash.toLowerCase()
    || evidence.transaction.blockNumber !== evidence.receipt.blockNumber
    || evidence.contextChainId !== session.chainId
    || evidence.transaction.chainId !== session.chainId
    || !sameAddress(evidence.transaction.from, session.sender)
    || !evidence.transaction.to
    || !sameAddress(evidence.transaction.to, session.recipient)
    || evidence.transaction.value.toString() !== session.valueAtomic
    || evidence.transaction.input.toLowerCase() !== "0x") {
    return unresolved("EVIDENCE_MISMATCH");
  }

  return {
    outcome: "EXACT_MATCH",
    session: updateNativeTransferState(session, "CONFIRMED", { now })
  };
}

export function nativeTransferBlocksAnother(session?: NativeTransferSession) {
  return Boolean(session && ["PROMPT_REQUESTED", "SUBMITTED", "UNKNOWN"].includes(session.state));
}

export function parseNativeTransferSession(value: string | null, sender: string, chainId: number) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<NativeTransferSession>;
    if (parsed.version !== 1 || !parsed.requestId || !parsed.sender || getAddress(parsed.sender) !== getAddress(sender)
      || !parsed.recipient || !isAddress(parsed.recipient, { strict: false }) || parsed.chainId !== chainId
      || !parsed.walletKey || !parsed.connectorUid || !parsed.state
      || !["PROMPT_REQUESTED", "SUBMITTED", "CONFIRMED", "REVERTED", "REJECTED", "UNKNOWN"].includes(parsed.state)
      || typeof parsed.valueAtomic !== "string" || !/^\d+$/.test(parsed.valueAtomic)
      || typeof parsed.updatedAt !== "number"
      || (parsed.txHash !== undefined && !isExactNonzeroHash(parsed.txHash))
      || (["SUBMITTED", "CONFIRMED", "REVERTED"].includes(parsed.state) && parsed.txHash === undefined)) return undefined;
    return parsed as NativeTransferSession;
  } catch {
    return undefined;
  }
}

export function prepareNativeTransfer(input: {
  recipient: string;
  amount: string;
  sender: string;
  balance?: bigint;
}): PreparedNativeTransfer {
  const recipientInput = input.recipient.trim();
  if (!isAddress(recipientInput, { strict: false })) {
    throw new Error("Enter a valid EVM wallet address.");
  }

  const recipient = getAddress(recipientInput);
  if (recipient.toLowerCase() === zeroAddress) {
    throw new Error("The zero address cannot receive this transfer.");
  }
  if (recipient.toLowerCase() === input.sender.toLowerCase()) {
    throw new Error("Choose a destination other than the active wallet.");
  }

  const amount = input.amount.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(amount)) {
    throw new Error("Enter an ETH amount with no more than 18 decimal places.");
  }

  const value = parseEther(amount);
  if (value <= 0n) throw new Error("Enter an ETH amount greater than zero.");
  if (input.balance !== undefined && value >= input.balance) {
    throw new Error("Leave some ETH in the wallet for the network fee.");
  }

  return { recipient, value };
}

export function isNativeTransferUserRejection(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const record = current as { code?: unknown; cause?: unknown };
    if (record.code === 4001 || record.code === "4001") return true;
    current = record.cause;
  }
  return false;
}

export function safeTransferMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (isNativeTransferUserRejection(error)) return "Wallet review was rejected before a transaction hash was returned.";
  if (/rejected|denied|cancelled|canceled/i.test(message)) {
    return "The wallet request ended without a final result. Check wallet activity before trying again.";
  }
  if (/insufficient funds|exceeds the balance|network fee|gas/i.test(message)) {
    return "The wallet needs more ETH to cover this transfer and the network fee.";
  }
  if (/chain|network/i.test(message)) {
    return "Switch the active wallet to Robinhood Chain and try again.";
  }
  return "The transfer did not complete. Review the destination and try again.";
}
