"use client";

import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { OverlayPortal } from "./overlay-portal";

export function WalletReceiveDialog({
  address,
  open,
  target,
  onClose
}: {
  address: Address;
  open: boolean;
  target: "testnet" | "mainnet";
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const targetChain = target === "mainnet" ? robinhoodChain : robinhoodChainTestnet;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    setCopied(false);
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [address, onClose, open]);

  if (!open) return null;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return <OverlayPortal>
    <button className="walletTransferBackdrop" type="button" aria-label="Close receive wallet" onClick={onClose} />
    <div className="walletReceiveDialog" role="dialog" aria-modal="true" aria-labelledby="wallet-receive-title">
      <header>
        <div><span>ACTIVE WALLET</span><h2 id="wallet-receive-title">Receive on {targetChain.name}</h2></div>
        <button ref={closeButton} type="button" aria-label="Close receive wallet" onClick={onClose}>×</button>
      </header>
      <div className="walletReceiveNetwork">
        <span>NETWORK</span>
        <strong><i aria-hidden="true" />{targetChain.name}</strong>
        <small>Chain ID {targetChain.id}</small>
      </div>
      <div className="walletReceiveAddress">
        <span>DEPOSIT ADDRESS</span>
        <code>{address}</code>
      </div>
      <p>Send only assets supported on {targetChain.name}. The address is exact; the sending wallet must use this network.</p>
      <div className="walletReceiveActions">
        <button className="walletTransferPrimary" type="button" onClick={() => void copyAddress()}>{copied ? "Address copied" : "Copy full address"}</button>
        <a href={`${targetChain.blockExplorers.default.url}/address/${address}`} target="_blank" rel="noreferrer">View on Blockscout ↗</a>
      </div>
    </div>
  </OverlayPortal>;
}
