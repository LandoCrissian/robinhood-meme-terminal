"use client";

import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useAccount } from "wagmi";
import { getAddress, zeroAddress, type Address } from "viem";
import { accountFirstBrowserAcceptanceBuild } from "../lib/account-first-browser-acceptance";
import { speedWalletEnabled } from "../lib/privy-config";
import type { RmtRequestedFundingAsset } from "../lib/privy-funding";
import { OverlayPortal } from "./overlay-portal";
import { dialogFocusableElements } from "./dialog-focus";
import { useRmtIdentity } from "./rmt-identity";
import { WalletReceiveDialog } from "./wallet-receive-dialog";

const robinhoodConnectEnabled = process.env.NEXT_PUBLIC_ROBINHOOD_CONNECT_ENABLED === "true";
const robinhoodConnectUrl = process.env.NEXT_PUBLIC_ROBINHOOD_CONNECT_URL?.trim();
const PrivyFundingActions = dynamic(
  () => import("./privy-funding-actions").then((module) => module.PrivyFundingActions),
  { ssr: false }
);

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function approvedRobinhoodUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const officialHost = url.hostname === "robinhood.com" || url.hostname.endsWith(".robinhood.com");
    return url.protocol === "https:" && officialHost ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function FundWalletButton({
  variant = "header",
  label = "Add funds",
  target = "mainnet",
  directReceive = false,
  requestedAsset,
  open: controlledOpen,
  onOpenChange
}: {
  variant?: "header" | "inline" | "trade";
  label?: string;
  target?: "testnet" | "mainnet";
  directReceive?: boolean;
  requestedAsset?: RmtRequestedFundingAsset;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback((value: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(value);
    onOpenChange?.(value);
  }, [controlledOpen, onOpenChange]);
  const { address: connectedAddress } = useAccount();
  const identity = useRmtIdentity();
  const exactAccountMode = speedWalletEnabled || accountFirstBrowserAcceptanceBuild;
  const selectedWallet = identity.activeWalletKey
    ? identity.tradingWallets.find((wallet) => wallet.key === identity.activeWalletKey)
    : undefined;
  const address = exactAccountMode
    ? selectedWallet && connectedAddress?.toLowerCase() === selectedWallet.address.toLowerCase()
      ? connectedAddress
      : undefined
    : connectedAddress;
  const targetChain = target === "mainnet" ? robinhoodChain : robinhoodChainTestnet;
  const exactRequestedAsset = requestedAsset ? {
    address: getAddress(requestedAsset.address),
    symbol: requestedAsset.symbol.trim().slice(0, 24) || "Selected asset"
  } satisfies RmtRequestedFundingAsset : undefined;
  const requestedAssetLabel = exactRequestedAsset
    ? exactRequestedAsset.address.toLowerCase() === zeroAddress
      ? `${exactRequestedAsset.symbol} · native`
      : `${exactRequestedAsset.symbol} · ${shortAddress(exactRequestedAsset.address)}`
    : undefined;
  const providerFundingAvailable = target === "mainnet" && speedWalletEnabled;
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocus = useRef(true);
  const approvedUrl = useMemo(() => robinhoodConnectEnabled ? approvedRobinhoodUrl(robinhoodConnectUrl) : undefined, []);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const closeReceive = useCallback(() => {
    setReceiveOpen(false);
    window.setTimeout(() => trigger.current?.focus(), 0);
  }, []);
  const showReceive = useCallback(() => {
    restoreTriggerFocus.current = false;
    setReceiveOpen(true);
    close();
  }, [close]);

  useEffect(() => {
    if (!open) return;
    restoreTriggerFocus.current = true;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = dialogFocusableElements(dialog.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      if (restoreTriggerFocus.current) window.setTimeout(() => trigger.current?.focus(), 0);
    };
  }, [close, open]);

  return <>
    <div className={`fundWalletMenu ${variant}`}>
      <button
        ref={trigger}
        className="fundWalletTrigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={directReceive ? receiveOpen : open}
        aria-controls={directReceive ? undefined : "fund-wallet-dialog"}
        onClick={() => directReceive && address ? setReceiveOpen(true) : setOpen(true)}
      >{label}</button>
      {open && <OverlayPortal>
        <button className="fundWalletBackdrop" type="button" aria-label="Close funding options" onClick={close} />
        <div ref={dialog} className="fundWalletDialog" id="fund-wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="fund-wallet-title" tabIndex={-1} data-rmt-overlay-dialog="funding">
          <div className="fundWalletHeader">
            <div><span>YOUR ACTIVE ACCOUNT</span><h2 id="fund-wallet-title">Deposit on {targetChain.name}</h2></div>
            <button ref={closeButton} type="button" aria-label="Close funding options" onClick={close}>×</button>
          </div>

          {address ? <section className="fundWalletDirect" aria-labelledby="fund-wallet-direct-heading">
            <div className="fundWalletDestination"><span id="fund-wallet-direct-heading">Exact destination</span><strong>{shortAddress(address)} · {targetChain.name} · {targetChain.id}</strong></div>
            {requestedAssetLabel ? <div className="fundWalletDestination"><span>Selected deposit asset</span><strong>{requestedAssetLabel}</strong></div> : null}
            <p>{exactRequestedAsset
              ? exactRequestedAsset.address.toLowerCase() === zeroAddress
                ? `Receive native ${exactRequestedAsset.symbol} on ${targetChain.name} for this ticket.`
                : `Receive only the selected ${exactRequestedAsset.symbol} contract on ${targetChain.name} for this ticket.`
              : target === "mainnet"
              ? "Receive native ETH for gas or a supported Robinhood Chain token such as USDG at this exact account."
              : "Receive only assets supported on Robinhood Chain Testnet at this exact account."}</p>
            <button className="fundWalletPrimary" type="button" onClick={showReceive}>Show address &amp; QR</button>
            <small>Use {targetChain.name} on the sender. A token balance without native ETH cannot pay network gas.</small>
          </section> : exactAccountMode ? <p>Sign in and activate the exact trading account before choosing a deposit destination.</p> : <p>Connect an account before choosing a deposit destination.</p>}

          {address && target === "mainnet" ? <details className="fundWalletOtherMethods">
            <summary>Other funding methods</summary>
            <div className="fundWalletSafety">
              <strong>Provider eligibility varies</strong>
              <span>RMT never receives card, bank, identity-verification, recovery-phrase, or private-key information.</span>
            </div>
            {providerFundingAvailable ? <PrivyFundingActions requestedAsset={exactRequestedAsset} /> : approvedUrl
              ? <a className="fundWalletSecondary" href={approvedUrl} target="_blank" rel="noopener noreferrer">Continue to Robinhood Connect ↗</a>
              : <p className="fundWalletDisclosure">No verified card or cross-chain checkout is active. Direct receive remains available.</p>}
            <a className="fundWalletSecondary" href="https://docs.robinhood.com/chain/bridging/" target="_blank" rel="noreferrer">Official Robinhood Chain bridge options ↗</a>
          </details> : null}
        </div>
      </OverlayPortal>}
    </div>
    {address ? <WalletReceiveDialog address={address as Address} open={receiveOpen} target={target} requestedAsset={exactRequestedAsset} onClose={closeReceive} /> : null}
  </>;
}
