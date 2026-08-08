"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import type { VNextDirectoryMarket } from "../../lib/vnext/market-directory";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "../../lib/vnext/robinhood-assets";
import {
  detectedWalletAssets,
  walletAssetCandidates,
  type VNextWalletAssetCandidate,
  type VNextDetectedWalletAsset
} from "../../lib/vnext/wallet-assets";

export type VNextWalletAssetStatus = "idle" | "loading" | "ready" | "stale" | "error";

const EMPTY_WALLET_ASSETS: VNextDetectedWalletAsset[] = [];

export function useVNextWalletAssets(markets: VNextDirectoryMarket[], imported: VNextWalletAssetCandidate[] = []) {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: ROBINHOOD_MAINNET_CHAIN_ID });
  const [assets, setAssets] = useState<VNextDetectedWalletAsset[]>([]);
  const [nativeBalance, setNativeBalance] = useState<bigint>();
  const [status, setStatus] = useState<VNextWalletAssetStatus>("idle");
  const [observedAtMs, setObservedAtMs] = useState<number>();
  const requestId = useRef(0);
  const snapshotWallet = useRef<string | null>(null);
  const candidates = useMemo(() => walletAssetCandidates(markets, 48, imported), [imported, markets]);
  const onRobinhood = chainId === ROBINHOOD_MAINNET_CHAIN_ID;
  const enabled = Boolean(address && isConnected && onRobinhood && publicClient);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!address || !publicClient || !isConnected || !onRobinhood) {
      setAssets([]);
      setNativeBalance(undefined);
      setObservedAtMs(undefined);
      setStatus("idle");
      snapshotWallet.current = null;
      return;
    }

    if (snapshotWallet.current !== address.toLowerCase()) {
      setAssets([]);
      setNativeBalance(undefined);
    }
    setStatus((current) => current === "ready" || current === "stale" ? current : "loading");

    try {
      const [native, balances] = await Promise.all([
        publicClient.getBalance({ address }),
        publicClient.multicall({
          contracts: candidates.map((candidate) => ({
            address: candidate.address,
            abi: erc20Abi,
            functionName: "balanceOf" as const,
            args: [address] as const
          })),
          allowFailure: true,
          batchSize: 0,
          deployless: true
        })
      ]);
      const positive = candidates.flatMap((candidate, index) => {
        const result = balances[index];
        return result?.status === "success" && typeof result.result === "bigint" && result.result > 0n
          ? [{ candidate, balance: result.result }]
          : [];
      });
      const unresolved = positive.filter(({ candidate }) => candidate.decimals === null);
      const metadata = unresolved.length > 0 ? await publicClient.multicall({
        contracts: unresolved.flatMap(({ candidate }) => [
          { address: candidate.address, abi: erc20Abi, functionName: "decimals" as const },
          { address: candidate.address, abi: erc20Abi, functionName: "symbol" as const },
          { address: candidate.address, abi: erc20Abi, functionName: "name" as const }
        ]),
        allowFailure: true,
        batchSize: 0,
        deployless: true
      }) : [];
      const metadataByAddress = new Map<string, { decimals: number | null; symbol: string | null; name: string | null }>();
      unresolved.forEach(({ candidate }, index) => {
        const offset = index * 3;
        const decimals = metadata[offset];
        const symbol = metadata[offset + 1];
        const name = metadata[offset + 2];
        metadataByAddress.set(candidate.address.toLowerCase(), {
          decimals: decimals?.status === "success" && typeof decimals.result === "number" ? decimals.result : null,
          symbol: symbol?.status === "success" && typeof symbol.result === "string" ? symbol.result : null,
          name: name?.status === "success" && typeof name.result === "string" ? name.result : null
        });
      });
      const detected = detectedWalletAssets(positive.map(({ candidate, balance }) => ({
        candidate,
        balance,
        ...metadataByAddress.get(candidate.address.toLowerCase())
      })));
      if (currentRequest !== requestId.current) return;
      snapshotWallet.current = address.toLowerCase();
      setAssets(detected);
      setNativeBalance(native);
      setObservedAtMs(Date.now());
      setStatus("ready");
    } catch {
      if (currentRequest !== requestId.current) return;
      const currentWallet = snapshotWallet.current === address.toLowerCase();
      if (!currentWallet) {
        setAssets([]);
        setNativeBalance(undefined);
      }
      setStatus(currentWallet ? "stale" : "error");
    }
  }, [address, candidates, isConnected, onRobinhood, publicClient]);

  useEffect(() => {
    if (!enabled) {
      requestId.current += 1;
      setAssets([]);
      setNativeBalance(undefined);
      setObservedAtMs(undefined);
      setStatus("idle");
      snapshotWallet.current = null;
      return;
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(interval);
  }, [enabled, refresh]);

  const snapshotIsCurrent = Boolean(address && snapshotWallet.current === address.toLowerCase());
  return {
    assets: snapshotIsCurrent ? assets : EMPTY_WALLET_ASSETS,
    nativeBalance: snapshotIsCurrent ? nativeBalance : undefined,
    status,
    observedAtMs: snapshotIsCurrent ? observedAtMs : undefined,
    enabled,
    onRobinhood,
    refresh
  };
}
