import { isAddress, isHash, isHex, toHex, type Address, type Hex } from "viem";

import type { NewLaunchDeployment } from "./launch-record";

export type LaunchDeployment = NewLaunchDeployment;

export type LaunchConfig = { status: "ready"; deployment: LaunchDeployment }
  | { status: "disabled" | "unavailable"; reason: string };

export type WalletProvider = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
};

export type BoundWallet = {
  address: Address;
  chainId: number;
  provider: WalletProvider;
  request: WalletProvider["request"];
  generation: number;
};

export type LaunchRequest = {
  kind: "launch" | "buy" | "sell" | "token-approval" | "router-approval" | "fees";
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  value: Hex;
  deadline: number;
  blockNumber: Hex;
  blockHash: Hex;
  intentId?: Hex;
  token?: Address;
  amountIn?: string;
  minimumOut?: string;
};

export type PendingRequest = { request: LaunchRequest; hash?: Hex };
const pendingPrefix = "rmt:launchpad:pending:v1";

function pendingKey(chainId: number, address: Address) {
  return [pendingPrefix, chainId, address.toLowerCase()].join(":");
}

export function readPendingRequest(chainId: number, address: Address): PendingRequest | undefined {
  const raw = localStorage.getItem(pendingKey(chainId, address));
  if (!raw) return;
  const saved = JSON.parse(raw) as PendingRequest;
  const request = saved?.request;
  if (!request || request.chainId !== chainId || request.from?.toLowerCase() !== address.toLowerCase()
    || !isAddress(request.to) || !isHex(request.data) || !isHex(request.value)
    || !isHash(request.blockHash) || !isHex(request.blockNumber)
    || (saved.hash && !isHash(saved.hash))) {
    throw new Error("The saved wallet request cannot be read safely.");
  }
  return saved;
}

function storePendingRequest(pending: PendingRequest) {
  const { chainId, from } = pending.request;
  localStorage.setItem(pendingKey(chainId, from), JSON.stringify(pending));
}

function clearPendingRequest(request: LaunchRequest) {
  localStorage.removeItem(pendingKey(request.chainId, request.from));
}

export async function replacePendingRequest(expected: PendingRequest, nextHash?: Hex) {
  const { chainId, from } = expected.request;
  if (!navigator.locks) throw new Error("Secure transaction recovery is unavailable in this browser.");
  return navigator.locks.request(pendingKey(chainId, from), { mode: "exclusive" }, () => {
    const current = readPendingRequest(chainId, from);
    if (!current || current.hash !== expected.hash || JSON.stringify(current.request) !== JSON.stringify(expected.request)) return false;
    if (nextHash) storePendingRequest({ request: current.request, hash: nextHash });
    else clearPendingRequest(current.request);
    return true;
  });
}

export function walletErrorCode(error: unknown): number | undefined {
  let entry = error;
  for (let depth = 0; depth < 6 && typeof entry === "object" && entry !== null; depth += 1) {
    const { code, cause } = entry as { code?: unknown; cause?: unknown };
    if (typeof code === "number") return code;
    entry = cause;
  }
}

export function walletMessage(error: unknown) {
  if (walletErrorCode(error) === 4001) return "Request declined in your wallet.";
  if (error instanceof Error) {
    const message = "shortMessage" in error ? String(error.shortMessage) : error.message;
    if (/insufficient funds|exceeds balance/i.test(message)) return "Insufficient balance for the amount and network gas.";
    return message.slice(0, 360);
  }
  return "The wallet or network could not complete this request.";
}

export async function assertWalletBinding(wallet: BoundWallet, request: LaunchRequest) {
  if (wallet.provider.request !== wallet.request || wallet.address.toLowerCase() !== request.from.toLowerCase() || wallet.chainId !== request.chainId) {
    throw new Error("Reconnect the reviewed wallet on the required network.");
  }
  const [accounts, chainId, block] = await Promise.all([
    wallet.request.call(wallet.provider, { method: "eth_accounts" }),
    wallet.request.call(wallet.provider, { method: "eth_chainId" }),
    wallet.request.call(wallet.provider, { method: "eth_getBlockByNumber", params: [request.blockNumber, false] }),
  ]);
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string"
    || accounts[0].toLowerCase() !== request.from.toLowerCase() || (typeof chainId !== "string" || !/^0x[\da-f]+$/i.test(chainId) || BigInt(chainId) !== BigInt(request.chainId))
    || typeof block !== "object" || !block || !("hash" in block) || block.hash !== request.blockHash) {
    throw new Error("The wallet account or network does not match the reviewed transaction.");
  }
}

export async function submitReviewedRequest(wallet: BoundWallet, request: LaunchRequest, stillSelected: () => boolean) {
  if (!navigator.locks) throw new Error("Open RMT in a secure browser that supports transaction locking.");
  const key = pendingKey(request.chainId, request.from);
  return navigator.locks.request(key, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock || readPendingRequest(request.chainId, request.from)) {
      throw new Error("Recover the existing wallet request before sending another.");
    }
    await assertWalletBinding(wallet, request);
    if (!stillSelected() || wallet.provider.request !== wallet.request || Date.now() >= request.deadline * 1000) {
      throw new Error("Wallet selection or quote expired. Review the transaction again.");
    }
    const pending: PendingRequest = { request };
    storePendingRequest(pending);
    try {
      const hash = await wallet.request.call(wallet.provider, {
        method: "eth_sendTransaction",
        params: [{ from: request.from, to: request.to, data: request.data, value: request.value, chainId: toHex(request.chainId) }],
      });
      if (typeof hash !== "string" || !isHash(hash)) throw new Error("The wallet did not return a transaction hash.");
      storePendingRequest({ request, hash });
      return hash;
    } catch (error) {
      if (walletErrorCode(error) === 4001) clearPendingRequest(request);
      throw error;
    }
  });
}
