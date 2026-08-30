import { getAddress, isAddress } from "viem";

export type VNextWalletRequestLockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false; reason: "unavailable" | "contended" };

export async function withVNextWalletRequestLock<T>(
  wallet: string,
  operation: () => Promise<T>
): Promise<VNextWalletRequestLockResult<T>> {
  if (!isAddress(wallet, { strict: false }) || typeof navigator === "undefined" || !navigator.locks) {
    return { acquired: false, reason: "unavailable" };
  }
  const lockName = `rmt:vnext-wallet-request:4663:${getAddress(wallet).toLowerCase()}`;
  return navigator.locks.request(lockName, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) return { acquired: false, reason: "contended" } as const;
    return { acquired: true, value: await operation() } as const;
  });
}
