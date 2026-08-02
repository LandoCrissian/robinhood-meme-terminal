"use client";

import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatEther, type Address } from "viem";
import { useAccount, useBalance, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { prepareNativeTransfer, safeTransferMessage } from "../lib/wallet-transfer";
import { OverlayPortal } from "./overlay-portal";

type TransferStep = "details" | "review" | "submitted";

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function WalletTransferDialog({
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
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<TransferStep>("details");
  const [message, setMessage] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);
  const targetChain = target === "mainnet" ? robinhoodChain : robinhoodChainTestnet;
  const explorer = targetChain.blockExplorers.default.url;
  const account = useAccount();
  const balance = useBalance({
    address,
    chainId: targetChain.id,
    query: { enabled: open, retry: false, refetchInterval: open ? 10_000 : false }
  });
  const transfer = useSendTransaction();
  const receipt = useWaitForTransactionReceipt({ hash: transfer.data, chainId: targetChain.id });

  const prepared = useMemo(() => {
    try {
      return prepareNativeTransfer({ recipient, amount, sender: address, balance: balance.data?.value });
    } catch {
      return undefined;
    }
  }, [address, amount, balance.data?.value, recipient]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !transfer.isPending) onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, open, transfer.isPending]);

  useEffect(() => {
    if (!open) return;
    setRecipient("");
    setAmount("");
    setStep("details");
    setMessage("");
    transfer.reset();
  }, [address, open]);

  useEffect(() => {
    if (receipt.isSuccess) setStep("submitted");
    if (receipt.error) setMessage(safeTransferMessage(receipt.error.message));
  }, [receipt.error, receipt.isSuccess]);

  if (!open) return null;

  const review = () => {
    setMessage("");
    try {
      prepareNativeTransfer({ recipient, amount, sender: address, balance: balance.data?.value });
      if (account.chainId !== targetChain.id) {
        throw new Error("Switch the active wallet to Robinhood Chain and try again.");
      }
      setStep("review");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review the transfer details.");
    }
  };

  const submit = () => {
    setMessage("");
    try {
      const next = prepareNativeTransfer({ recipient, amount, sender: address, balance: balance.data?.value });
      if (account.chainId !== targetChain.id) {
        throw new Error("Switch the active wallet to Robinhood Chain and try again.");
      }
      transfer.sendTransaction({
        account: address,
        chainId: targetChain.id,
        to: next.recipient,
        value: next.value
      });
    } catch (error) {
      setMessage(error instanceof Error ? safeTransferMessage(error.message) : "The transfer did not complete.");
    }
  };

  return <OverlayPortal>
    <button className="walletTransferBackdrop" type="button" aria-label="Close transfer" disabled={transfer.isPending} onClick={onClose} />
    <div className="walletTransferDialog" role="dialog" aria-modal="true" aria-labelledby="wallet-transfer-title">
      <header>
        <div><span>SELF-CUSTODIAL TRANSFER</span><h2 id="wallet-transfer-title">Send ETH on {targetChain.name}</h2></div>
        <button ref={closeButton} type="button" aria-label="Close transfer" disabled={transfer.isPending} onClick={onClose}>×</button>
      </header>

      {step === "details" && <>
        <div className="walletTransferBalance"><span>Available</span><strong>{balance.isLoading ? "Reading wallet…" : `${Number(formatEther(balance.data?.value ?? 0n)).toLocaleString(undefined, { maximumFractionDigits: 7 })} ETH`}</strong></div>
        <label className="walletTransferField"><span>Destination address</span><input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x…" autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
        <label className="walletTransferField"><span>Amount</span><div><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /><b>ETH</b></div></label>
        <p className="walletTransferNotice">Transfers are irreversible. RMT never changes the destination and never submits without your wallet confirmation.</p>
        <button className="walletTransferPrimary" type="button" disabled={!prepared || balance.isLoading} onClick={review}>Review transfer</button>
      </>}

      {step === "review" && prepared && <>
        <div className="walletTransferReview">
          <div><span>You send</span><strong>{amount} ETH</strong></div>
          <div><span>From</span><strong>{shortAddress(address)}</strong></div>
          <div><span>To</span><strong>{shortAddress(prepared.recipient)}</strong></div>
          <div><span>Network</span><strong>{targetChain.name}</strong></div>
        </div>
        <p className="walletTransferNotice warning">Check the full address in your wallet. Your wallet shows the final network fee before you approve.</p>
        <div className="walletTransferButtons">
          <button type="button" disabled={transfer.isPending} onClick={() => setStep("details")}>Back</button>
          <button className="walletTransferPrimary" type="button" disabled={transfer.isPending} onClick={submit}>{transfer.isPending ? "Open wallet confirmation…" : "Confirm in wallet"}</button>
        </div>
      </>}

      {step === "submitted" && transfer.data && <div className="walletTransferSuccess">
        <span>TRANSFER CONFIRMED</span>
        <strong>{amount} ETH was confirmed onchain.</strong>
        <a href={`${explorer}/tx/${transfer.data}`} target="_blank" rel="noreferrer">View transaction on Blockscout ↗</a>
        <button className="walletTransferPrimary" type="button" onClick={onClose}>Done</button>
      </div>}

      {receipt.isLoading && <p className="walletTransferStatus" role="status">Wallet approved. Waiting for onchain confirmation…</p>}
      {(message || transfer.error) && <p className="walletError" role="alert">{message || safeTransferMessage(transfer.error?.message ?? "")}</p>}
    </div>
  </OverlayPortal>;
}
