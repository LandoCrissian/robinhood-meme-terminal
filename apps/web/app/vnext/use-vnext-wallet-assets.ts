"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, getAddress, zeroAddress, type Address } from "viem";
import { usePublicClient } from "wagmi";
import type { VNextDirectoryMarket } from "../../lib/vnext/market-directory";
import { ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_USDG_ADDRESS } from "../../lib/vnext/robinhood-assets";
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
import { readVNextExecutionJournal, VNEXT_EXECUTION_EVENT } from "../../lib/vnext/execution-recovery";
import { hasVerifiedVNextSwapSettlement } from "../../lib/vnext/output-settlement";
import {
  reconcileAssetBalanceEvidence,
  reconcileBalanceEvidence,
  walletBalanceReadStatus,
  type VNextAssetBalanceEvidence,
  type VNextBalanceEvidence
} from "../../lib/vnext/wallet-balance-evidence";

export type VNextWalletAssetStatus = "idle" | "loading" | "ready" | "stale" | "error";
export type VNextWalletDiscoveryStatus = "idle" | "loading" | "ready" | "partial" | "stale" | "unavailable";

const EMPTY_WALLET_ASSETS: VNextDetectedWalletAsset[] = [];
const EMPTY_ASSET_BALANCE_EVIDENCE: VNextAssetBalanceEvidence = {};
const UNAVAILABLE_BALANCE_EVIDENCE: VNextBalanceEvidence = { state: "unavailable" };

function browserAcceptanceWalletSnapshot() {
  if (
    process.env.NEXT_PUBLIC_RMT_BROWSER_ACCEPTANCE_PROFILE !== "true"
      && process.env.NEXT_PUBLIC_RMT_ACCOUNT_ACCEPTANCE_PROFILE !== "true"
    || typeof window === "undefined"
    || !["localhost", "127.0.0.1"].includes(window.location.hostname)
    || (window as Window & { __RMT_ACCEPTANCE_READ_WALLET_ASSETS__?: boolean }).__RMT_ACCEPTANCE_READ_WALLET_ASSETS__ === true
  ) return null;
  const accountScenario = process.env.NEXT_PUBLIC_RMT_ACCOUNT_ACCEPTANCE_PROFILE === "true"
    ? window.__RMT_ACCOUNT_ACCEPTANCE_CONFIG__?.walletBalanceScenario ?? "positive"
    : "positive";
  const usdgBalanceAtomic = accountScenario === "zero-input" ? "0" : "100000000";
  const observedAtMs = Date.now();
  const nativeBalance = accountScenario === "erc20-no-gas" ? 0n : 10_000_000_000_000_000_000n;
  return {
    assets: [{
      address: ROBINHOOD_USDG_ADDRESS,
      symbol: "USDG",
      name: "Global Dollar",
      decimals: 6,
      balanceAtomic: usdgBalanceAtomic,
      identityState: "verified" as const,
      source: "canonical" as const,
      reputation: "ok" as const,
      imageUrl: null,
      routeState: "detected" as const
    }],
    assetBalanceEvidence: {
      [ROBINHOOD_USDG_ADDRESS.toLowerCase()]: {
        balanceAtomic: usdgBalanceAtomic,
        observedAtMs,
        state: "confirmed" as const
      }
    },
    nativeBalance,
    nativeBalanceEvidence: {
      balanceAtomic: nativeBalance.toString(),
      observedAtMs,
      state: "confirmed" as const
    },
    observedAtMs
  };
}

function sameCandidateAddresses(left: VNextWalletAssetCandidate[], right: VNextWalletAssetCandidate[]) {
  if (left.length !== right.length) return false;
  const rightAddresses = new Set(right.map((asset) => asset.address.toLowerCase()));
  return left.every((asset) => rightAddresses.has(asset.address.toLowerCase()));
}

export function useVNextWalletAssets(
  markets: VNextDirectoryMarket[],
  imported: VNextWalletAssetCandidate[] = [],
  selectedWalletAddress?: Address
) {
  const publicClient = usePublicClient({ chainId: ROBINHOOD_MAINNET_CHAIN_ID });
  const [assets, setAssets] = useState<VNextDetectedWalletAsset[]>([]);
  const [assetBalanceEvidence, setAssetBalanceEvidence] = useState<VNextAssetBalanceEvidence>({});
  const [nativeBalance, setNativeBalance] = useState<bigint>();
  const [nativeBalanceEvidence, setNativeBalanceEvidence] = useState<VNextBalanceEvidence>(UNAVAILABLE_BALANCE_EVIDENCE);
  const [status, setStatus] = useState<VNextWalletAssetStatus>("idle");
  const [discoveryStatus, setDiscoveryStatus] = useState<VNextWalletDiscoveryStatus>("idle");
  const [observedAtMs, setObservedAtMs] = useState<number>();
  const balanceRequestId = useRef(0);
  const discoveryRequestId = useRef(0);
  const snapshotWallet = useRef<string | null>(null);
  const statusWallet = useRef<string | null>(null);
  const discoveryWallet = useRef<string | null>(null);
  const discoveredAssets = useRef<VNextWalletDiscoveryAsset[]>([]);
  const lastDiscoveryAt = useRef<number | null>(null);
  const assetsRef = useRef<VNextDetectedWalletAsset[]>([]);
  const assetBalanceEvidenceRef = useRef<VNextAssetBalanceEvidence>({});
  const nativeBalanceRef = useRef<bigint | undefined>(undefined);
  const nativeBalanceEvidenceRef = useRef<VNextBalanceEvidence>(UNAVAILABLE_BALANCE_EVIDENCE);
  const address = selectedWalletAddress;
  const explicitCandidateKey = useMemo(
    () => imported.map((candidate) => candidate.address.toLowerCase()).sort().join(","),
    [imported]
  );
  // Acceptance data is a deterministic wallet read, so keep the object identity
  // stable just like a real completed RPC snapshot. Recreating the array on each
  // render would cause SpendBalance to continuously republish the same state.
  const acceptanceSnapshot = useMemo(
    () => address ? browserAcceptanceWalletSnapshot() : null,
    [address]
  );
  const enabled = Boolean(address && publicClient && !acceptanceSnapshot);

  const refresh = useCallback(async (forceDiscovery = true) => {
    const currentBalanceRequest = ++balanceRequestId.current;
    if (!address || !publicClient) {
      discoveryRequestId.current += 1;
      setAssets([]);
      setAssetBalanceEvidence({});
      setNativeBalance(undefined);
      setNativeBalanceEvidence(UNAVAILABLE_BALANCE_EVIDENCE);
      setObservedAtMs(undefined);
      setStatus("idle");
      setDiscoveryStatus("idle");
      snapshotWallet.current = null;
      statusWallet.current = null;
      discoveryWallet.current = null;
      discoveredAssets.current = [];
      lastDiscoveryAt.current = null;
      assetsRef.current = [];
      assetBalanceEvidenceRef.current = {};
      nativeBalanceRef.current = undefined;
      nativeBalanceEvidenceRef.current = UNAVAILABLE_BALANCE_EVIDENCE;
      return;
    }

    const walletKey = address.toLowerCase();
    statusWallet.current = walletKey;
    if (snapshotWallet.current !== walletKey) {
      setAssets([]);
      setAssetBalanceEvidence({});
      setNativeBalance(undefined);
      setNativeBalanceEvidence(UNAVAILABLE_BALANCE_EVIDENCE);
      assetsRef.current = [];
      assetBalanceEvidenceRef.current = {};
      nativeBalanceRef.current = undefined;
      nativeBalanceEvidenceRef.current = UNAVAILABLE_BALANCE_EVIDENCE;
    }
    if (discoveryWallet.current !== walletKey) {
      discoveryWallet.current = walletKey;
      discoveredAssets.current = [];
      lastDiscoveryAt.current = null;
      setDiscoveryStatus("loading");
    } else if (forceDiscovery) {
      setDiscoveryStatus((current) => current === "idle" || current === "unavailable" ? "loading" : current);
    }
    setStatus((current) => snapshotWallet.current === walletKey && (current === "ready" || current === "stale")
      ? current
      : "loading");

    const readCandidates = async (candidates: VNextWalletAssetCandidate[]) => {
      const observedAt = Date.now();
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
      }).catch(() => candidates.map(() => ({ status: "failure" as const, result: undefined })));
      const evidence = reconcileAssetBalanceEvidence(
        candidates,
        balances,
        assetBalanceEvidenceRef.current,
        observedAt
      );
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
      }).catch(() => []) : [];
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
      const detectedAddresses = new Set(detected.map((asset) => asset.address.toLowerCase()));
      const stale = assetsRef.current.filter((asset) => (
        !detectedAddresses.has(asset.address.toLowerCase())
        && evidence[asset.address.toLowerCase()]?.state === "stale"
      ));
      return { assets: [...detected, ...stale], evidence, observedAt };
    };

    const recentSettledCandidates: VNextWalletAssetCandidate[] = [...new Set(readVNextExecutionJournal()
      .filter((record) => record.wallet.toLowerCase() === walletKey && hasVerifiedVNextSwapSettlement(record))
      .slice(0, 16).flatMap((record) => [record.inputAsset.toLowerCase(), record.outputAsset.toLowerCase()]))]
      .filter((asset) => asset !== zeroAddress).map((asset) => ({
        address: getAddress(asset), symbol: `${asset.slice(0, 6)}...${asset.slice(-4)}`, name: "Recently traded asset",
        decimals: null, identityState: "reported", source: "settled_transaction", reputation: "unknown", imageUrl: null
      }));
    const cachedDiscovery = [...recentSettledCandidates, ...discoveredAssets.current.map(walletDiscoveryCandidate)];
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

    const [nativeRead, candidateRead] = await Promise.allSettled([
      publicClient.getBalance({ address }),
      readCandidates(initialCandidates)
    ]);
    if (currentBalanceRequest === balanceRequestId.current && discoveryWallet.current === walletKey) {
      const observedAt = Date.now();
      const nextNativeEvidence = reconcileBalanceEvidence(
        nativeRead.status === "fulfilled"
          ? { result: nativeRead.value, status: "success" }
          : { status: "failure" },
        nativeBalanceEvidenceRef.current,
        observedAt
      );
      const tokenRead = candidateRead.status === "fulfilled"
        ? candidateRead.value
        : {
            assets: assetsRef.current,
            evidence: reconcileAssetBalanceEvidence(
              initialCandidates,
              initialCandidates.map(() => ({ status: "failure" as const })),
              assetBalanceEvidenceRef.current,
              observedAt
            ),
            observedAt
          };
      if (nativeRead.status === "fulfilled") nativeBalanceRef.current = nativeRead.value;
      else if (nextNativeEvidence.state === "unavailable") nativeBalanceRef.current = undefined;
      nativeBalanceEvidenceRef.current = nextNativeEvidence;
      assetsRef.current = tokenRead.assets;
      assetBalanceEvidenceRef.current = tokenRead.evidence;
      snapshotWallet.current = walletKey;
      setAssets(tokenRead.assets);
      setAssetBalanceEvidence(tokenRead.evidence);
      setNativeBalance(nativeBalanceRef.current);
      setNativeBalanceEvidence(nextNativeEvidence);
      setObservedAtMs(Math.max(
        nextNativeEvidence.observedAtMs ?? 0,
        ...Object.values(tokenRead.evidence).map((item) => item.observedAtMs ?? 0)
      ) || undefined);
      setStatus(walletBalanceReadStatus(nextNativeEvidence, tokenRead.evidence));
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
      ...recentSettledCandidates,
      ...discovery.payload.assets.map(walletDiscoveryCandidate)
    ]);
    if (sameCandidateAddresses(initialCandidates, finalCandidates)) return;
    const finalBalanceRequest = ++balanceRequestId.current;
    const completeRead = await readCandidates(finalCandidates);
    if (finalBalanceRequest !== balanceRequestId.current || discoveryWallet.current !== walletKey) return;
    snapshotWallet.current = walletKey;
    assetsRef.current = completeRead.assets;
    assetBalanceEvidenceRef.current = completeRead.evidence;
    setAssets(completeRead.assets);
    setAssetBalanceEvidence(completeRead.evidence);
    setObservedAtMs(Math.max(
      nativeBalanceEvidenceRef.current.observedAtMs ?? 0,
      ...Object.values(completeRead.evidence).map((item) => item.observedAtMs ?? 0)
    ) || undefined);
    setStatus(walletBalanceReadStatus(nativeBalanceEvidenceRef.current, completeRead.evidence));
  }, [address, imported, markets, publicClient]);

  useEffect(() => {
    if (!enabled) {
      balanceRequestId.current += 1;
      discoveryRequestId.current += 1;
      setAssets([]);
      setAssetBalanceEvidence({});
      setNativeBalance(undefined);
      setNativeBalanceEvidence(UNAVAILABLE_BALANCE_EVIDENCE);
      setObservedAtMs(undefined);
      setStatus("idle");
      setDiscoveryStatus("idle");
      snapshotWallet.current = null;
      statusWallet.current = null;
      discoveryWallet.current = null;
      discoveredAssets.current = [];
      lastDiscoveryAt.current = null;
      assetsRef.current = [];
      assetBalanceEvidenceRef.current = {};
      nativeBalanceRef.current = undefined;
      nativeBalanceEvidenceRef.current = UNAVAILABLE_BALANCE_EVIDENCE;
      return;
    }
  }, [enabled]);

  useVisibilityRefresh(() => refresh(false), VNEXT_CLIENT_REFRESH_POLICY.walletBalanceMs, {
    enabled,
    refreshKey: `${address?.toLowerCase() ?? "disconnected"}:${explicitCandidateKey}`
  });

  useEffect(() => {
    if (!enabled || !address) return;
    const seen = new Set(readVNextExecutionJournal().filter(hasVerifiedVNextSwapSettlement).map((record) => record.txHash));
    const settled = () => {
      const fresh = readVNextExecutionJournal().filter((record) => record.wallet.toLowerCase() === address.toLowerCase()
        && hasVerifiedVNextSwapSettlement(record) && !seen.has(record.txHash));
      if (!fresh.length) return;
      fresh.forEach((record) => seen.add(record.txHash));
      void refresh(true);
    };
    window.addEventListener(VNEXT_EXECUTION_EVENT, settled);
    return () => window.removeEventListener(VNEXT_EXECUTION_EVENT, settled);
  }, [address, enabled, refresh]);

  const snapshotIsCurrent = Boolean(address && snapshotWallet.current === address.toLowerCase());
  const statusIsCurrent = Boolean(address && statusWallet.current === address.toLowerCase());
  const discoveryStatusIsCurrent = Boolean(address && discoveryWallet.current === address.toLowerCase());
  return {
    assets: acceptanceSnapshot?.assets ?? (snapshotIsCurrent ? assets : EMPTY_WALLET_ASSETS),
    assetBalanceEvidence: acceptanceSnapshot?.assetBalanceEvidence
      ?? (snapshotIsCurrent ? assetBalanceEvidence : EMPTY_ASSET_BALANCE_EVIDENCE),
    nativeBalance: acceptanceSnapshot?.nativeBalance ?? (snapshotIsCurrent ? nativeBalance : undefined),
    nativeBalanceEvidence: acceptanceSnapshot?.nativeBalanceEvidence
      ?? (snapshotIsCurrent ? nativeBalanceEvidence : UNAVAILABLE_BALANCE_EVIDENCE),
    status: acceptanceSnapshot ? "ready" as const : statusIsCurrent ? status : enabled ? "loading" as const : "idle" as const,
    discoveryStatus: acceptanceSnapshot ? "ready" as const : discoveryStatusIsCurrent ? discoveryStatus : enabled ? "loading" as const : "idle" as const,
    observedAtMs: acceptanceSnapshot?.observedAtMs ?? (snapshotIsCurrent ? observedAtMs : undefined),
    enabled: Boolean(acceptanceSnapshot) || enabled,
    onRobinhood: Boolean(address),
    refresh
  };
}
