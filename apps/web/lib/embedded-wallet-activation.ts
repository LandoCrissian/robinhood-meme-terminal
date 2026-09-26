export const EMBEDDED_WALLET_ACTIVATION_TIMEOUT_MS = 8_000;

export type EmbeddedWalletActivationSnapshot = {
  accounts: readonly string[];
  chainId?: number;
  connectorId?: string;
  connectorUid?: string;
  currentConnectorUid?: string;
};

export type ActionableEmbeddedWalletCandidate = {
  address: string;
  connectorId: string;
  connectorUid?: string;
  key: string;
};

export type EmbeddedWalletRecordRecovery = "activate" | "reauthenticate" | "reload-session";

/**
 * Privy's connected-wallet collection is not the durable ownership record.
 * An embedded account can remain linked to the authenticated user while its
 * page-local signing record is absent. The installed SDK cannot reconnect
 * that account headlessly, and its configured createOnLogin path is the sole
 * creation owner. RMT therefore activates an existing connected record,
 * refreshes a linked-but-missing record, or restarts authentication so Privy
 * can retry its own creation path.
 */
export function embeddedWalletRecordRecovery(input: {
  connectedEmbeddedWalletCount: number;
  linkedEmbeddedWalletCount: number;
}): EmbeddedWalletRecordRecovery {
  if (input.connectedEmbeddedWalletCount > 0) return "activate";
  return input.linkedEmbeddedWalletCount > 0 ? "reload-session" : "reauthenticate";
}

export function embeddedWalletActivationConfirmed(
  snapshot: EmbeddedWalletActivationSnapshot,
  expected: { address: string; chainId: number; connectorId: string; connectorUid: string }
) {
  return Boolean(
    snapshot.currentConnectorUid
    && snapshot.currentConnectorUid === expected.connectorUid
    && snapshot.connectorUid === snapshot.currentConnectorUid
    && snapshot.connectorId === expected.connectorId
    && snapshot.chainId === expected.chainId
    && snapshot.accounts.some((account) => account.toLowerCase() === expected.address.toLowerCase())
  );
}

export function resolveExactEmbeddedWalletCandidate<T extends ActionableEmbeddedWalletCandidate>(
  candidates: readonly T[],
  walletKey: string
) {
  const matches = candidates.filter((candidate) => candidate.key === walletKey);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Embedded is the consumer default only when it does not override an explicit
 * or currently reconnected external signer. A durable embedded preference may
 * select one exact candidate; ambiguity always remains a visible choice.
 */
export function resolveAutomaticEmbeddedWalletCandidate<T extends ActionableEmbeddedWalletCandidate>(
  candidates: readonly T[],
  options: { preferredWalletKey?: string | null; hasCurrentExternalBinding: boolean }
) {
  if (options.preferredWalletKey) {
    return resolveExactEmbeddedWalletCandidate(candidates, options.preferredWalletKey);
  }
  if (options.hasCurrentExternalBinding) return undefined;
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function resolveConfirmedEmbeddedWalletKey(
  candidates: readonly ActionableEmbeddedWalletCandidate[],
  snapshot: EmbeddedWalletActivationSnapshot,
  chainId: number
) {
  const matches = candidates.filter((candidate) => candidate.connectorUid
    && embeddedWalletActivationConfirmed(snapshot, {
      address: candidate.address,
      chainId,
      connectorId: candidate.connectorId,
      connectorUid: candidate.connectorUid
    }));
  return matches.length === 1 ? matches[0].key : null;
}

/**
 * Wagmi may rehydrate an embedded connector before the authenticated user's
 * durable wallet preference has loaded. Never publish that connector as signer
 * authority during the gap, or while a linked external wallet still requires
 * an explicit reconnect/selection.
 */
export function canPublishEmbeddedWalletAuthority(input: {
  confirmedWalletKey?: string | null;
  confirmedWalletLinkedToCurrentUser: boolean;
  embeddedWalletCandidateCount: number;
  hasLinkedExternalWallet: boolean;
  preferredWalletKey?: string | null;
  walletPreferenceLoaded: boolean;
}) {
  if (!input.walletPreferenceLoaded || !input.confirmedWalletKey || !input.confirmedWalletLinkedToCurrentUser) return false;
  if (input.preferredWalletKey) return input.preferredWalletKey === input.confirmedWalletKey;
  if (input.embeddedWalletCandidateCount !== 1) return false;
  return !input.hasLinkedExternalWallet;
}

export async function waitForEmbeddedWalletActivation(
  readSnapshot: () => EmbeddedWalletActivationSnapshot,
  expected: { address: string; chainId: number; connectorId: string; connectorUid: string },
  options: {
    isCurrent: () => boolean;
    now?: () => number;
    pause?: (milliseconds: number) => Promise<void>;
    pollMs?: number;
    timeoutMs?: number;
  }
) {
  const now = options.now ?? Date.now;
  const pause = options.pause ?? ((milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)));
  const deadline = now() + (options.timeoutMs ?? EMBEDDED_WALLET_ACTIVATION_TIMEOUT_MS);
  while (options.isCurrent() && now() <= deadline) {
    if (embeddedWalletActivationConfirmed(readSnapshot(), expected)) return true;
    await pause(options.pollMs ?? 100);
  }
  return false;
}

/**
 * Privy publishes wallet records and the matching Wagmi connectors on separate
 * React updates. Wait for one exact connector instead of treating an existing
 * wallet with a delayed connector as either provisioned or absent. Duplicate
 * connector identities are ambiguous and fail immediately.
 */
export async function waitForExactWalletConnector<T extends { id: string }>(
  readConnectors: () => readonly T[],
  connectorId: string,
  options: {
    isCurrent: () => boolean;
    now?: () => number;
    pause?: (milliseconds: number) => Promise<void>;
    pollMs?: number;
    timeoutMs?: number;
  }
) {
  const now = options.now ?? Date.now;
  const pause = options.pause ?? ((milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)));
  const deadline = now() + (options.timeoutMs ?? EMBEDDED_WALLET_ACTIVATION_TIMEOUT_MS);
  while (options.isCurrent() && now() <= deadline) {
    const matches = readConnectors().filter((connector) => connector.id === connectorId);
    if (matches.length > 1) return undefined;
    if (matches.length === 1) return matches[0];
    await pause(options.pollMs ?? 100);
  }
  return undefined;
}

/** Wallet ownership and connected-wallet records can hydrate on separate turns. */
export async function waitForEmbeddedWalletRecord(
  readAvailable: () => boolean,
  options: {
    isCurrent: () => boolean;
    now?: () => number;
    pause?: (milliseconds: number) => Promise<void>;
    pollMs?: number;
    timeoutMs?: number;
  }
) {
  const now = options.now ?? Date.now;
  const pause = options.pause ?? ((milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)));
  const deadline = now() + (options.timeoutMs ?? EMBEDDED_WALLET_ACTIVATION_TIMEOUT_MS);
  while (options.isCurrent() && now() <= deadline) {
    if (readAvailable()) return true;
    await pause(options.pollMs ?? 100);
  }
  return false;
}
