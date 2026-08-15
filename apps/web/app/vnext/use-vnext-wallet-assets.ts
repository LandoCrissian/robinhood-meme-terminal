"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import type { VNextDirectoryMarket } from "../../lib/vnext/market-directory";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "../../lib/vnext/robinhood-assets";
import {
  normalizeWalletDiscoveryResponse,
  type VNextWalletDiscoveryAsset
} from "../../lib/vnext/wallet-discovery";
import {
  detectedWalletAssets,
  walletAssetCandidates,
  walletDiscoveryCandidate,
  type VNextWalletAssetCandidate,
  type VNextDetectedWalletAsset
} from "../../lib/vnext/wallet-assets";
import { VNEXT_CLIENT_REFRESH_POLICY } from "../../lib/vnext/client-refresh-policy";
import { useVisibilityRefresh } from "./use-visibility-refresh";

export type VNextWalletAssetStatus = "idle" | "loading" | "ready" | "stale" | "error";
export type VNextWalletDiscoveryStatus = "idle" | "loading" | "ready" | "partial" | "stale" | "unavailable";

const EMPTY_WALLET_ASSETS: VNextDetectedWalletAsset[] = [];

function sameCandidateAddresses(left: VNextWalletAssetCandidate[], right: VNextWalletAssetCandidate[]) {
  if (left.length !== right.length) return false;
  const rightAddresses = new Set(right.map((asset) => asset.address.toLowerCase()));
  return left.every((asset) => rightAddresses.has(asset.address.toLowerCase()));
}

export function useVNextWalletAssets(markets: VNextDirectoryMarket[], imported: VNextWalletAssetCandidate[] = []) {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: ROBINHOOD_MAINNET_CHAIN_ID });
  const [assets, setAssets] = useState<VNextDetectedWalletAsset[]>([]);
  const [nativeBalance, setNativeBalance] = useState<bigint>();
  const [status, setStatus] = useState<VNextWalletAssetStatus>("idle");
  const [discoveryStatus, setDiscoveryStatus] = useState<VNextWalletDiscoveryStatus>("idle");
  const [observedAtMs, setObservedAtMs] = useState<number>();
  const balanceRequestId = useRef(0);
  const discoveryRequestId = useRef(0);
  const snapshotWallet = useRef<string | null>(null);
  const discoveryWallet = useRef<string | null>(null);
  const discoveredAssets = useRef<VNextWalletDiscoveryAsset[]>([]);
  const lastDiscoveryAt = useRef<number | null>(null);
  const onRobinhood = chainId === ROBINHOOD_MAINNET_CHAIN_ID;
  const enabled = Boolean(address && isConnected && onRobinhood && publicClient);

  const refresh = useCallback(async (forceDiscovery = true) => {
    const currentBalanceRequest = ++balanceRequestId.current;
    if (!address || !publicClient || !isConnected || !onRobinhood) {
      discoveryRequestId.current += 1;
      setAssets([]);
      setNativeBalance(undefined);
      setObservedAtMs(undefined);
      setStatus("idle");
      setDiscoveryStatus("idle");
      snapshotWallet.current = null;
      discoveryWallet.current = null;
      discoveredAssets.current = [];
      lastDiscoveryAt.current = null;
      return;
    }

    const walletKey = address.toLowerCase();
    if (snapshotWallet.current !== walletKey) {
      setAssets([]);
      setNativeBalance(undefined);
    }
    if (discoveryWallet.current !== walletKey) {
      discoveryWallet.current = walletKey;
      discoveredAssets.current = [];
      lastDiscoveryAt.current = null;
      setDiscoveryStatus("loading");
    } else if (forceDiscovery) {
      setDiscoveryStatus((current) => current === "idle" || current === "unavailable" ? "loading" : current);
    }
    setStatus((current) => current === "ready" || current === "stale" ? current : "loading");

    const readCandidates = async (candidates: VNextWalletAssetCandidate[]) => {
      const balances = await publicClient.multicall({
        contracts: candidates.map((candidate) => ({
          address: candidate.address,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [address] as const
        })),
        allowFailure: true,
        batchSize: 0,
        deployless: true
      });
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
      return detectedWalletAssets(positive.map(({ candidate, balance }) => ({
        candidate,
        balance,
        ...metadataByAddress.get(candidate.address.toLowerCase())
      })));
    };

    const cachedDiscovery = discoveredAssets.current.map(walletDiscoveryCandidate);
    const initialCandidates = walletAssetCandidates(markets, 48, [...imported, ...cachedDiscovery]);
    const discoveryDue = forceDiscovery
      || lastDiscoveryAt.current === null
      || Date.now() - lastDiscoveryAt.current >= VNEXT_CLIENT_REFRESH_POLICY.walletDiscoveryMs;
    const currentDiscoveryRequest = discoveryDue ? ++discoveryRequestId.current : null;
    if (discoveryDue) lastDiscoveryAt.current = Date.now();
    const discoveryRequest = discoveryDue
      ? fetch(`/api/vnext/wallet-assets?${new URLSearchParams({ wallet: address })}`, { cache: "no-store" })
        .then(async (response) => ({
          ok: response.ok,
          payload: normalizeWalletDiscoveryResponse(await response.json(), address)
        }))
        .catch(() => ({ ok: false, payload: null }))
      : null;

    try {
      const [native, detected] = await Promise.all([
        publicClient.getBalance({ address }),
        readCandidates(initialCandidates)
      ]);
      if (currentBalanceRequest === balanceRequestId.current && discoveryWallet.current === walletKey) {
        snapshotWallet.current = walletKey;
        setAssets(detected);
        setNativeBalance(native);
        setObservedAtMs(Date.now());
        setStatus("ready");
      }
    } catch {
      if (currentBalanceRequest === balanceRequestId.current && discoveryWallet.current === walletKey) {
        const currentWallet = snapshotWallet.current === walletKey;
        if (!currentWallet) {
          setAssets([]);
          setNativeBalance(undefined);
        }
        setStatus(currentWallet ? "stale" : "error");
      }
    }

    if (!discoveryRequest || currentDiscoveryRequest === null) return;
    const discovery = await discoveryRequest;
    if (currentDiscoveryRequest !== discoveryRequestId.current || discoveryWallet.current !== walletKey) return;
    if (!discovery.ok || !discovery.payload) {
      setDiscoveryStatus(discoveredAssets.current.length > 0 ? "stale" : "unavailable");
      return;
    }
    discoveredAssets.current = discovery.payload.assets;
    setDiscoveryStatus(discovery.payload.complete ? "ready" : "partial");
    const finalCandidates = walletAssetCandidates(markets, 48, [
      ...imported,
      ...discovery.payload.assets.map(walletDiscoveryCandidate)
    ]);
    if (sameCandidateAddresses(initialCandidates, finalCandidates)) return;
    const finalBalanceRequest = ++balanceRequestId.current;
    try {
      const completeDetected = await readCandidates(finalCandidates);
      if (finalBalanceRequest !== balanceRequestId.current || discoveryWallet.current !== walletKey) return;
      snapshotWallet.current = walletKey;
      setAssets(completeDetected);
      setObservedAtMs(Date.now());
      setStatus("ready");
    } catch {
      if (finalBalanceRequest === balanceRequestId.current && snapshotWallet.current === walletKey) setStatus("stale");
    }
  }, [address, imported, isConnected, markets, onRobinhood, publicClient]);

  useEffect(() => {
    if (!enabled) {
      balanceRequestId.current += 1;
      discoveryRequestId.current += 1;
      setAssets([]);
      setNativeBalance(undefined);
      setObservedAtMs(undefined);
      setStatus("idle");
      setDiscoveryStatus("idle");
      snapshotWallet.current = null;
      discoveryWallet.current = null;
      discoveredAssets.current = [];
      lastDiscoveryAt.current = null;
      return;
    }
  }, [enabled]);

  useVisibilityRefresh(() => refresh(false), VNEXT_CLIENT_REFRESH_POLICY.walletBalanceMs, {
    enabled,
    refreshKey: address?.toLowerCase() ?? "disconnected"
  });

  const snapshotIsCurrent = Boolean(address && snapshotWallet.current === address.toLowerCase());
  return {
    assets: snapshotIsCurrent ? assets : EMPTY_WALLET_ASSETS,
    nativeBalance: snapshotIsCurrent ? nativeBalance : undefined,
    status,
    discoveryStatus,
    observedAtMs: snapshotIsCurrent ? observedAtMs : undefined,
    enabled,
    onRobinhood,
    refresh
  };
}
