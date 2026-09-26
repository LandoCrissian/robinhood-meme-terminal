"use client";

import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { zeroAddress, type Address } from "viem";
import type { RmtRequestedFundingAsset } from "../lib/privy-funding";
import { OverlayPortal } from "./overlay-portal";
import { dialogFocusableElements } from "./dialog-focus";

export function WalletReceiveDialog({
  address,
  open,
  target,
  requestedAsset,
  onClose
}: {
  address: Address;
  open: boolean;
  target: "testnet" | "mainnet";
  requestedAsset?: RmtRequestedFundingAsset;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [destination, setDestination] = useState(address);
  const wasOpen = useRef(false);
  const requestedAssetFingerprint = requestedAsset
    ? `${requestedAsset.address.toLowerCase()}:${requestedAsset.symbol.trim()}`
    : "general";
  const assetAtOpen = useRef(requestedAssetFingerprint);
  const targetChain = target === "mainnet" ? robinhoodChain : robinhoodChainTestnet;

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      setDestination(address);
      assetAtOpen.current = requestedAssetFingerprint;
    } else if (open && (destination.toLowerCase() !== address.toLowerCase()
      || assetAtOpen.current !== requestedAssetFingerprint)) onCloseRef.current();
    wasOpen.current = open;
  }, [address, destination, open, requestedAssetFingerprint]);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = dialogFocusableElements(dialog.current);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    setCopied(false);
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      returnFocus.current?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(destination);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return <OverlayPortal>
    <button className="walletTransferBackdrop" type="button" aria-label="Close receive wallet" onClick={onClose} />
    <div ref={dialog} className="walletReceiveDialog" role="dialog" aria-modal="true" aria-labelledby="wallet-receive-title" data-rmt-overlay-dialog="receive">
      <header>
        <div><span>DEPOSIT TO ACTIVE WALLET</span><h2 id="wallet-receive-title">Receive on {targetChain.name}</h2></div>
        <button ref={closeButton} type="button" aria-label="Close receive wallet" onClick={onClose}>×</button>
      </header>
      <div className="walletReceiveNetwork">
        <span>NETWORK</span>
        <strong><i aria-hidden="true" />{targetChain.name}</strong>
        <small>Chain ID {targetChain.id}</small>
      </div>
      <div className="walletReceiveDestination">
        <div className="walletReceiveQr" role="img" aria-label={`QR code for ${destination}`}>
          <QRCodeSVG value={destination} size={156} level="M" marginSize={1} title={`Deposit to ${destination} on ${targetChain.name}`} />
        </div>
        <div className="walletReceiveAddress">
          <span>DEPOSIT ADDRESS</span>
          <code>{destination}</code>
          {requestedAsset ? <small>Selected asset: {requestedAsset.symbol}{requestedAsset.address.toLowerCase() === zeroAddress
            ? " · native ETH"
            : ` · contract ${requestedAsset.address}`}. Sending another asset will not fund this trade ticket.</small>
          : <small>Accepted: native ETH for gas and Robinhood Chain ERC-20s such as USDG. Verify the token contract before sending.</small>}
        </div>
      </div>
      <p>Use {targetChain.name} (chain {targetChain.id}) on the sending wallet. Assets sent on Ethereum mainnet are not spendable on Robinhood Chain merely because the address is the same. Keep some native ETH for network gas.</p>
      <div className="walletReceiveActions">
        <button className="walletTransferPrimary" type="button" onClick={() => void copyAddress()}>{copied ? "Address copied" : "Copy full address"}</button>
        <a href={`${targetChain.blockExplorers.default.url}/address/${destination}`} target="_blank" rel="noreferrer">View on Blockscout ↗</a>
      </div>
    </div>
  </OverlayPortal>;
}
