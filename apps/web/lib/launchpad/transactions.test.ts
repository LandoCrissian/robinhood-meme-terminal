import assert from "node:assert/strict";
import { test } from "node:test";
import type { Hex } from "viem";
import {
  readPendingRequest, replacePendingRequest, submitReviewedRequest,
  type BoundWallet, type LaunchRequest, type WalletProvider,
} from "./transactions";

test("stale receipt and hash recovery cannot replace a newer wallet journal", async () => {
  const account = "0x1111111111111111111111111111111111111111";
  const destination = "0x2222222222222222222222222222222222222222";
  const evidence = `0x${"33".repeat(32)}` as const;
  const oldHash = `0x${"44".repeat(32)}` as const;
  const newHash = `0x${"55".repeat(32)}` as const;
  const storage = new Map<string, string>();
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const restore = (name: string, property: PropertyDescriptor | undefined) => {
    if (property) Object.defineProperty(globalThis, name, property);
    else Reflect.deleteProperty(globalThis, name);
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true, value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  const locks = new Set<string>();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { locks: {
      async request(key: string, _options: unknown, callback: (lock: object | null) => unknown) {
        if (locks.has(key)) return callback(null);
        locks.add(key);
        try { return await callback({}); } finally { locks.delete(key); }
      },
    } },
  });
  let broadcast = 0;
  const provider: WalletProvider = {
    on() {},
    removeListener() {},
    async request({ method }) {
      if (method === "eth_accounts") return [account];
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_getBlockByNumber") return { hash: evidence };
      if (method === "eth_sendTransaction") return ++broadcast === 1 ? oldHash : newHash;
      throw new Error(method);
    },
  };
  const wallet: BoundWallet = { address: account, chainId: 31337, provider, request: provider.request, generation: 1 };
  const request: LaunchRequest = {
    kind: "launch", chainId: 31337, from: account, to: destination, data: "0xaaaa", value: "0x0",
    deadline: Math.floor(Date.now() / 1000) + 120, blockNumber: "0x1", blockHash: evidence,
  };
  try {
    assert.equal(await submitReviewedRequest(wallet, request, () => true), oldHash);
    await assert.rejects(() => submitReviewedRequest(wallet, request, () => true), /Recover the existing/);
    const settled = { request, hash: oldHash };
    assert.equal(await replacePendingRequest(settled), true);
    const next = { ...request, data: "0xbbbb" as Hex };
    assert.equal(await submitReviewedRequest(wallet, next, () => true), newHash);
    assert.equal(await replacePendingRequest(settled), false);
    assert.equal(await replacePendingRequest({ request }, oldHash), false);
    assert.deepEqual(readPendingRequest(31337, account), { request: next, hash: newHash });
    assert.equal(broadcast, 2);
  } finally {
    restore("navigator", originalNavigator);
    restore("localStorage", originalStorage);
  }
});
