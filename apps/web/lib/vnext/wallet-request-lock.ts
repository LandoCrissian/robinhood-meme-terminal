import { getAddress, isAddress } from "viem";

export type VNextWalletRequestLockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false; reason: "unavailable" | "contended" };

export type VNextWalletRequestLease = {
  release: () => void;
  released: Promise<void>;
};

export type VNextWalletRequestLeaseResult =
  | { acquired: true; lease: VNextWalletRequestLease }
  | { acquired: false; reason: "unavailable" | "contended" };

function walletRequestLockName(wallet: string) {
  return `rmt:vnext-wallet-request:4663:${getAddress(wallet).toLowerCase()}`;
}

/**
 * Acquires a per-wallet Web Lock during asynchronous preparation and keeps it
 * through the later explicit wallet-open gesture. This removes all awaited
 * lock work from the signing click while retaining cross-tab serialization.
 */
export async function acquireVNextWalletRequestLease(wallet: string): Promise<VNextWalletRequestLeaseResult> {
  if (!isAddress(wallet, { strict: false }) || typeof navigator === "undefined" || !navigator.locks) {
    return { acquired: false, reason: "unavailable" };
  }
  let release!: () => void;
  let resolveAcquired!: (value: VNextWalletRequestLeaseResult) => void;
  const releaseGate = new Promise<void>((resolve) => { release = resolve; });
  const acquired = new Promise<VNextWalletRequestLeaseResult>((resolve) => { resolveAcquired = resolve; });
  const released = navigator.locks.request(
    walletRequestLockName(wallet),
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) {
        resolveAcquired({ acquired: false, reason: "contended" });
        return;
      }
      resolveAcquired({ acquired: true, lease: { release, released: Promise.resolve() } });
      await releaseGate;
    }
  ).then(() => undefined).catch(() => {
    resolveAcquired({ acquired: false, reason: "unavailable" });
  });
  const result = await acquired;
  if (!result.acquired) return result;
  return { acquired: true, lease: { release, released } };
}

export async function withVNextWalletRequestLock<T>(
  wallet: string,
  operation: () => Promise<T>
): Promise<VNextWalletRequestLockResult<T>> {
  if (!isAddress(wallet, { strict: false }) || typeof navigator === "undefined" || !navigator.locks) {
    return { acquired: false, reason: "unavailable" };
  }
  const lockName = walletRequestLockName(wallet);
  return navigator.locks.request(lockName, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) return { acquired: false, reason: "contended" } as const;
    return { acquired: true, value: await operation() } as const;
  });
}
