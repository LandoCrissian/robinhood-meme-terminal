"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useAccount } from "wagmi";
import { speedWalletEnabled } from "../lib/privy-config";

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
  open: controlledOpen,
  onOpenChange
}: {
  variant?: "header" | "inline";
  label?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback((value: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(value);
    onOpenChange?.(value);
  }, [controlledOpen, onOpenChange]);
  const { address } = useAccount();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const approvedUrl = useMemo(() => robinhoodConnectEnabled ? approvedRobinhoodUrl(robinhoodConnectUrl) : undefined, []);
  const close = useCallback(() => setOpen(false), [setOpen]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
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
      window.setTimeout(() => trigger.current?.focus(), 0);
    };
  }, [close, open]);

  return (
    <div className={`fundWalletMenu ${variant}`}>
      <button ref={trigger} className="fundWalletTrigger" type="button" aria-expanded={open} aria-controls="fund-wallet-dialog" onClick={() => setOpen(true)}>{label}</button>
      {open && <>
        <button className="fundWalletBackdrop" type="button" aria-label="Close funding options" onClick={close} />
        <div ref={dialog} className="fundWalletDialog" id="fund-wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="fund-wallet-title" tabIndex={-1}>
          <div className="fundWalletHeader">
            <div><span>{speedWalletEnabled ? "PRIVY SECURE FUNDING" : approvedUrl ? "ROBINHOOD-HOSTED CHECKOUT" : "FUNDING SETUP"}</span><h2 id="fund-wallet-title">Fund your Robinhood Chain wallet</h2></div>
            <button ref={closeButton} type="button" aria-label="Close funding options" onClick={close}>×</button>
          </div>

          {!speedWalletEnabled && address && <div className="fundWalletDestination"><span>Connected destination</span><strong>{shortAddress(address)}</strong></div>}

          <p>{speedWalletEnabled
            ? "Deposit ETH from crypto or choose any fiat method Privy makes available for your device and region. Privy and its providers handle payment details, quotes, identity checks, conversion, and delivery."
            : approvedUrl
            ? "Continue to Robinhood’s secure checkout. Robinhood will show the payment methods available for your account and location before you confirm."
            : "RMT’s Robinhood Connect application is in progress. The embedded funding path will stay disabled until Robinhood approves RMT and supplies its official partner configuration."}</p>

          <div className="fundWalletSafety">
            <strong>Payment details stay with the provider</strong>
            <span>RMT never receives your Google Pay, card, bank, identity-verification, recovery phrase, or private-key information.</span>
          </div>

          {speedWalletEnabled
            ? <PrivyFundingActions />
            : approvedUrl
              ? <a className="fundWalletPrimary" href={approvedUrl} target="_blank" rel="noopener noreferrer">Continue to Robinhood Connect ↗</a>
              : <button className="fundWalletPrimary" type="button" disabled>Secure funding activation pending</button>}
          <a className="fundWalletSecondary" href="https://docs.robinhood.com/chain/bridging/" target="_blank" rel="noreferrer">Open official Robinhood Chain bridge options ↗</a>
          {!speedWalletEnabled && <small className="fundWalletDisclosure">Available methods depend on the provider, user, device, account, transaction, and region. RMT does not control eligibility.</small>}
        </div>
      </>}
    </div>
  );
}
