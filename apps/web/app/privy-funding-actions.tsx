"use client";

import { useAddFunds, usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { erc20Abi, getAddress, zeroAddress } from "viem";
import { useAccount, useBalance, useReadContract } from "wagmi";
import {
  createFundingSession,
  fundingSessionNeedsReconciliation,
  fundingSessionStorageKey,
  parseFundingSession,
  RMT_FUNDING_CHAIN_ID,
  reconcileFundingSession,
  recordFundingCheckoutOpened,
  recordFundingFailure,
  recordFundingResult,
  type RmtFundingSession
} from "../lib/funding-session";
import {
  parsePrivyFundingConfig,
  privyFundingMatchesRequestedAsset,
  type RmtRequestedFundingAsset
} from "../lib/privy-funding";
import { useRmtIdentity } from "./rmt-identity";

const funding = parsePrivyFundingConfig({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  enabled: process.env.NEXT_PUBLIC_PRIVY_FUNDING_ENABLED,
  providerVerified: process.env.NEXT_PUBLIC_PRIVY_FUNDING_PROVIDER_VERIFIED,
  chainId: process.env.NEXT_PUBLIC_PRIVY_FUNDING_CHAIN_ID,
  asset: process.env.NEXT_PUBLIC_PRIVY_FUNDING_ASSET,
  defaultAmount: process.env.NEXT_PUBLIC_PRIVY_FUNDING_DEFAULT_AMOUNT,
  environment: process.env.NEXT_PUBLIC_PRIVY_FUNDING_ENVIRONMENT
});

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function statusCopy(session: RmtFundingSession | undefined) {
  if (!session) return undefined;
  if (session.balanceIncreaseObservedAt && session.status !== "DELIVERED") {
    return "Balance increased · provider attempt still unresolved";
  }
  if (session.status === "SUBMITTED_PENDING") return "Submitted · waiting for the destination balance";
  if (session.status === "DELIVERED") return "Observed · exact destination asset balance increased after this flow started";
  if (session.status === "CANCELLED") return "Cancelled · destination balance still needs a check";
  if (session.status === "FAILED") return "Not submitted · provider route unavailable";
  if (session.status === "UNKNOWN") return "Unknown · reconcile before another deposit";
  return "Not submitted";
}

function statusLabel(session: RmtFundingSession) {
  if (session.status === "DELIVERED") return "DELIVERED";
  return session.balanceIncreaseObservedAt ? "BALANCE INCREASE OBSERVED · UNRESOLVED" : session.status;
}

export function PrivyFundingActions({ requestedAsset }: { requestedAsset?: RmtRequestedFundingAsset }) {
  const { ready, authenticated } = usePrivy();
  const identity = useRmtIdentity();
  const { address: activeAddress } = useAccount();
  const { addFunds } = useAddFunds();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [session, setSession] = useState<RmtFundingSession>();
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string>();
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [fundingAttemptKey, setFundingAttemptKey] = useState<string>();
  const fundingAttemptInFlight = useRef<string | undefined>(undefined);
  const selectedWallet = identity.activeWalletKey
    ? identity.tradingWallets.find((wallet) => wallet.key === identity.activeWalletKey)
    : undefined;
  const destination = authenticated
    && identity.activeWalletKind !== null
    && selectedWallet
    && activeAddress?.toLowerCase() === selectedWallet.address.toLowerCase()
    ? getAddress(activeAddress)
    : undefined;
  const fundingAsset = getAddress(funding.asset);
  const providerAssetMatches = privyFundingMatchesRequestedAsset(funding, requestedAsset);
  const storageKey = destination && providerAssetMatches ? fundingSessionStorageKey({
    destination,
    chainId: RMT_FUNDING_CHAIN_ID,
    asset: fundingAsset
  }) : undefined;
  const activeStorageKey = useRef<string | undefined>(undefined);
  activeStorageKey.current = storageKey;
  const nativeAsset = fundingAsset.toLowerCase() === zeroAddress;
  const nativeBalance = useBalance({
    address: destination,
    chainId: RMT_FUNDING_CHAIN_ID,
    query: { enabled: Boolean(destination && providerAssetMatches && nativeAsset), retry: false }
  });
  const tokenBalance = useReadContract({
    address: fundingAsset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: destination ? [destination] : undefined,
    chainId: RMT_FUNDING_CHAIN_ID,
    query: { enabled: Boolean(destination && providerAssetMatches && !nativeAsset), retry: false }
  });
  const currentBalance = nativeAsset ? nativeBalance.data?.value : tokenBalance.data;
  const refreshBalance = useCallback(async () => {
    if (nativeAsset) return (await nativeBalance.refetch()).data?.value;
    return (await tokenBalance.refetch()).data;
  }, [nativeAsset, nativeBalance, tokenBalance]);

  const readPersistedSession = useCallback(() => {
    if (!destination || !storageKey) return { available: false, session: undefined } as const;
    try {
      return {
        available: true,
        session: parseFundingSession(window.localStorage.getItem(storageKey), {
          destination,
          chainId: RMT_FUNDING_CHAIN_ID,
          asset: fundingAsset
        })
      } as const;
    } catch {
      return { available: false, session: undefined } as const;
    }
  }, [destination, fundingAsset, storageKey]);

  useEffect(() => {
    setMessage("");
    setBusy(false);
    setHydratedStorageKey(undefined);
    if (!destination || !storageKey) {
      setSession(undefined);
      setStorageAvailable(true);
      return;
    }
    const synchronize = () => {
      if (activeStorageKey.current !== storageKey) return;
      const persisted = readPersistedSession();
      setStorageAvailable(persisted.available);
      setSession(persisted.session);
      setHydratedStorageKey(storageKey);
      if (!persisted.available) {
        setMessage("Secure browser storage is unavailable. Provider checkout stays disabled; direct receive remains available.");
      }
    };
    synchronize();
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === storageKey) synchronize();
    };
    window.addEventListener("storage", storageChanged);
    return () => window.removeEventListener("storage", storageChanged);
  }, [destination, readPersistedSession, storageKey]);

  const saveSession = useCallback((next: RmtFundingSession) => {
    const nextStorageKey = fundingSessionStorageKey(next);
    try {
      window.localStorage.setItem(nextStorageKey, JSON.stringify(next));
      if (activeStorageKey.current === nextStorageKey) setSession(next);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!destination || !storageKey || !session || fundingSessionStorageKey(session) !== storageKey) return;
    const reconciled = reconcileFundingSession(session, currentBalance);
    if (reconciled === session) return;
    const requestStorageKey = storageKey;
    if (saveSession(reconciled)) {
      if (activeStorageKey.current === requestStorageKey) setMessage(reconciled.status === "DELIVERED"
          ? "The provider reported a terminal result and RMT observed the exact destination asset balance increase."
          : "RMT observed an exact destination asset balance increase, but it does not prove which transfer caused it. The provider attempt remains unresolved.");
    } else if (activeStorageKey.current === requestStorageKey) {
      setMessage("RMT observed a balance increase but could not persist the update. Provider checkout remains blocked in this tab.");
    }
  }, [currentBalance, destination, saveSession, session, storageKey]);

  useEffect(() => {
    if (!destination || !fundingSessionNeedsReconciliation(session)) return;
    const timer = window.setInterval(() => void refreshBalance(), 8_000);
    return () => window.clearInterval(timer);
  }, [destination, refreshBalance, session]);

  const clearResolvedSession = () => {
    if (!storageKey) return;
    try {
      window.localStorage.removeItem(storageKey);
      setSession(undefined);
      setMessage("");
    } catch {
      setMessage("RMT could not clear the persisted funding record. Provider checkout remains blocked; direct receive remains available.");
    }
  };

  const reconcileBeforeAnotherDeposit = async () => {
    if (!session || !storageKey || !fundingSessionNeedsReconciliation(session)) return;
    const requestStorageKey = storageKey;
    const publish = (next: string) => {
      if (activeStorageKey.current === requestStorageKey) setMessage(next);
    };
    setBusy(true);
    publish("Checking the exact destination asset balance…");
    try {
      const exactBalance = await refreshBalance();
      if (typeof exactBalance !== "bigint") throw new Error("Exact balance unavailable.");
      const reconciled = reconcileFundingSession(session, exactBalance);
      if (reconciled.status === "DELIVERED") {
        if (saveSession(reconciled)) {
          publish("The provider reported a terminal result and RMT observed the exact destination asset balance increase.");
        } else {
          publish("RMT observed a balance increase but could not persist the update. Keep this funding attempt unresolved.");
        }
      } else if (reconciled !== session) {
        if (saveSession(reconciled)) {
          publish("RMT observed an exact destination asset balance increase, but it cannot attribute that increase to the unresolved provider attempt. Another checkout remains blocked.");
        } else {
          publish("RMT observed a balance increase but could not persist the update. Keep this funding attempt unresolved.");
        }
      } else {
        publish("No exact destination asset balance increase was observed in this fresh check. The provider attempt remains unresolved; RMT will not open a second checkout from this record.");
      }
    } catch {
      publish("RMT could not read the exact destination asset balance. Keep this attempt unresolved and retry the check.");
    } finally {
      if (activeStorageKey.current === requestStorageKey) setBusy(false);
    }
  };

  const beginFunding = async () => {
    if (
      !destination
      || !storageKey
      || hydratedStorageKey !== storageKey
      || !storageAvailable
      || fundingSessionNeedsReconciliation(session)
      || fundingAttemptInFlight.current
    ) return;
    const requestStorageKey = storageKey;
    const publish = (next: string) => {
      if (activeStorageKey.current === requestStorageKey) setMessage(next);
    };
    fundingAttemptInFlight.current = requestStorageKey;
    setFundingAttemptKey(requestStorageKey);
    setBusy(true);
    publish("Checking the exact destination asset balance before provider checkout…");
    try {
      if (!navigator.locks) {
        publish("This browser cannot establish the cross-tab funding lock. Provider checkout stays disabled; direct receive remains available.");
        return;
      }
      await navigator.locks.request(`rmt-funding-checkout:${storageKey}`, {
        mode: "exclusive",
        ifAvailable: true
      }, async (lock) => {
        if (!lock) {
          publish("Another tab is already opening or reconciling this exact funding destination. Return to that tab or check the destination balance.");
          return;
        }

        // Re-read synchronously inside the cross-tab lock. The passive hydration
        // state is presentation only and can never authorize a second checkout.
        const persisted = readPersistedSession();
        if (!persisted.available) {
          if (activeStorageKey.current === requestStorageKey) setStorageAvailable(false);
          publish("Secure browser storage is unavailable. Provider checkout was not opened; direct receive remains available.");
          return;
        }
        if (fundingSessionNeedsReconciliation(persisted.session)) {
          if (activeStorageKey.current === requestStorageKey) setSession(persisted.session);
          publish("A previous provider attempt for this exact destination is unresolved. Reconcile it before another deposit.");
          return;
        }

        let baseline: bigint;
        try {
          let exactBalance: bigint | undefined;
          if (nativeAsset) exactBalance = (await nativeBalance.refetch()).data?.value;
          else exactBalance = (await tokenBalance.refetch()).data;
          if (typeof exactBalance !== "bigint") throw new Error("Exact destination balance unavailable.");
          baseline = exactBalance;
        } catch {
          publish("RMT could not read the exact destination asset balance, so provider checkout was not opened. Retry the balance check.");
          return;
        }

        const opened = recordFundingCheckoutOpened(
          createFundingSession({ destination, asset: fundingAsset, initialBalanceAtomic: baseline })
        );
        // Persist an unresolved state before opening provider UI. If persistence
        // fails, fail closed and never call the provider.
        if (!saveSession(opened)) {
          if (activeStorageKey.current === requestStorageKey) setStorageAvailable(false);
          publish("RMT could not persist duplicate-payment protection, so provider checkout was not opened. Direct receive remains available.");
          return;
        }
        publish("");
        try {
          const result = await addFunds({
            destination: { address: destination, chain: funding.chain, asset: fundingAsset },
            fiat: {
              source: { defaultAsset: "usd" },
              environment: funding.environment,
              defaultAmount: funding.defaultAmount
            },
            crypto: { refundAddress: destination, slippageBps: 100 }
          });
          const submitted = recordFundingResult(opened, result);
          if (!saveSession(submitted)) {
            publish("Privy returned from funding, but RMT retained the earlier UNKNOWN record because the update could not be persisted. Reconcile before retrying.");
            return;
          }
          publish("Privy accepted the funding flow. RMT will report only whether the exact destination asset balance later increases.");
          void refreshBalance();
        } catch (error) {
          const failure = recordFundingFailure(opened, error);
          if (!saveSession(failure.session)) {
            publish("The provider window closed without a durable final state. RMT retained the earlier UNKNOWN record; reconcile before retrying.");
            return;
          }
          publish(failure.message);
        }
      });
    } finally {
      if (fundingAttemptInFlight.current === requestStorageKey) {
        fundingAttemptInFlight.current = undefined;
        setFundingAttemptKey(undefined);
      }
      if (activeStorageKey.current === requestStorageKey) setBusy(false);
    }
  };

  if (!ready) {
    return <button className="fundWalletPrimary" type="button" disabled>Checking funding options…</button>;
  }

  if (!authenticated) {
    return <div className="fundWalletProviderState">
      <button className="fundWalletPrimary" type="button" onClick={identity.login}>Sign in to create or restore your RMT wallet</button>
      <small className="fundWalletDisclosure">{identity.supportsOAuth
        ? "Use email, Google, a passkey, or an existing wallet. Returning users keep the same account."
        : "Email, passkey, or this wallet are available here. Open RMT in Safari or Chrome to use Google sign-in."}</small>
    </div>;
  }

  if (!destination) {
    const failed = identity.embeddedWalletProvisioning === "failed";
    return <div className="privyFundingUnavailable" role="status">
      <strong>{failed ? "Wallet setup paused" : "Preparing your RMT wallet"}</strong>
      <span>{failed ? identity.embeddedWalletProvisioningError : "The exact trading account must be active before RMT opens a funding route."}</span>
      {failed ? <div className="fundWalletResolutionActions">
        <button className="fundWalletSecondary" type="button" onClick={identity.retryEmbeddedWalletProvisioning}>
          {identity.embeddedWalletRecovery === "reload-session"
            ? "Reload wallet connection"
            : identity.embeddedWalletRecovery === "reauthenticate" ? "Sign in again" : "Retry wallet setup"}
        </button>
        {identity.embeddedWalletRecovery === "reload-session" ? <button className="fundWalletSecondary" type="button" onClick={identity.restartEmbeddedWalletSession}>
          Sign out and sign in again
        </button> : null}
      </div> : null}
    </div>;
  }

  if (!funding.enabled) {
    return <div className="privyFundingUnavailable">
      <strong>Provider checkout is not active</strong>
      <span>Direct receive above is ready. RMT will not claim card, Apple Pay, bank, or cross-chain support until an exact Robinhood Chain route is enabled.</span>
    </div>;
  }

  if (!providerAssetMatches) {
    return <div className="privyFundingUnavailable">
      <strong>No provider checkout for this selected asset</strong>
      <span>Direct receive is ready for {requestedAsset?.symbol ?? "the selected asset"} on Robinhood Chain. RMT will not silently substitute the provider&apos;s configured asset.</span>
    </div>;
  }

  const unresolved = fundingSessionNeedsReconciliation(session);
  const fundingStorageReady = hydratedStorageKey === storageKey && storageAvailable;
  const anotherAccountFunding = Boolean(fundingAttemptKey && fundingAttemptKey !== storageKey);
  return <div className="fundWalletProviderState">
    <div className="fundWalletDestination">
      <span>Provider destination</span>
      <strong>{shortAddress(destination)} · {requestedAsset?.symbol ?? funding.assetLabel} · Robinhood Chain</strong>
    </div>
    {session ? <div className={`fundWalletStatus is${session.status.toLowerCase().replaceAll("_", "-")}`} role="status">
      <span>{statusLabel(session)}</span><strong>{statusCopy(session)}</strong>
    </div> : null}
    <button className="fundWalletPrimary" type="button" disabled={busy || unresolved || !fundingStorageReady || anotherAccountFunding} onClick={() => void beginFunding()}>
      {busy ? "Opening secure funding…" : anotherAccountFunding ? "Finish the open funding window" : unresolved ? "Reconcile pending funding first" : !fundingStorageReady ? "Checking prior funding…" : "See available provider methods"}
    </button>
    <small className="fundWalletDisclosure">
      Privy shows only methods and quotes available for this device, region, exact asset, and Robinhood Chain destination. Review source network, destination, fees, minimums, and refund terms before commitment.
      {funding.environment === "sandbox" ? " This configuration uses the provider sandbox; it is not live funding." : ""}
    </small>
    {unresolved ? <div className="fundWalletResolutionActions">
      <button type="button" disabled={busy} onClick={() => void reconcileBeforeAnotherDeposit()}>{busy ? "Checking balance…" : "Check destination balance"}</button>
      <small>An unresolved provider attempt stays blocked until provider-attributable finality and destination delivery are both established. A balance increase alone may be an unrelated direct receive and is not safe retry authority.</small>
    </div> : session?.status === "DELIVERED" || session?.status === "FAILED"
      ? <button className="fundWalletTextAction" type="button" onClick={clearResolvedSession}>Start another deposit</button>
      : null}
    {message ? <p className="fundWalletMessage" role="status">{message}</p> : null}
  </div>;
}
