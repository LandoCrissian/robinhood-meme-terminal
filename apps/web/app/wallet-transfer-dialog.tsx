"use client";

import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatEther, type Address } from "viem";
import { useAccount, useBalance, usePublicClient, useWaitForTransactionReceipt, useWalletClient } from "wagmi";
import {
  bindNativeTransferSigner,
  createNativeTransferPrompt,
  isNativeTransferUserRejection,
  nativeTransferBlocksAnother,
  nativeTransferStorageKey,
  parseNativeTransferSession,
  prepareNativeTransfer,
  resolveNativeTransferRevertedReceipt,
  resolveNativeTransferSettlement,
  safeTransferMessage,
  transitionNativeTransfer,
  type NativeTransferSession,
  type PreparedNativeTransfer
} from "../lib/wallet-transfer";
import type { RmtActiveSignerAuthority } from "../lib/wallet-gateway";
import { accountFirstBrowserAcceptanceBuild } from "../lib/account-first-browser-acceptance";
import { OverlayPortal } from "./overlay-portal";
import { dialogFocusableElements } from "./dialog-focus";

type TransferStep = "details" | "review" | "submitted";

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function WalletTransferDialog({
  address,
  open,
  target,
  selectedWalletKey,
  selectedWalletKind,
  selectedSignerAuthority,
  onClose
}: {
  address: Address;
  open: boolean;
  target: "testnet" | "mainnet";
  selectedWalletKey: string;
  selectedWalletKind: "embedded" | "external";
  selectedSignerAuthority: RmtActiveSignerAuthority;
  onClose: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<TransferStep>("details");
  const [message, setMessage] = useState("");
  const [reviewed, setReviewed] = useState<PreparedNativeTransfer>();
  const [reviewAuthority, setReviewAuthority] = useState("");
  const [session, setSession] = useState<NativeTransferSession>();
  const [requestPending, setRequestPending] = useState(false);
  const [transactionHash, setTransactionHash] = useState<`0x${string}`>();
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const stepPanel = useRef<HTMLDivElement>(null);
  const previousStep = useRef<TransferStep>("details");
  const returnFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const requestPendingRef = useRef(false);
  const settlementAttempt = useRef("");
  requestPendingRef.current = requestPending;
  const targetChain = target === "mainnet" ? robinhoodChain : robinhoodChainTestnet;
  const explorer = targetChain.blockExplorers.default.url;
  const account = useAccount();
  const { data: walletClient } = useWalletClient({ connector: account.connector });
  const publicClient = usePublicClient({ chainId: targetChain.id });
  const balance = useBalance({
    address,
    chainId: targetChain.id,
    query: { enabled: open, retry: false, refetchInterval: open ? 10_000 : false }
  });
  const exactBalance = balance.status === "success" && typeof balance.data?.value === "bigint"
    ? balance.data.value
    : undefined;
  const receipt = useWaitForTransactionReceipt({
    hash: transactionHash,
    chainId: targetChain.id,
    pollingInterval: accountFirstBrowserAcceptanceBuild ? 250 : undefined
  });
  const storageKey = useMemo(() => nativeTransferStorageKey(address, targetChain.id), [address, targetChain.id]);
  const activeStorageKey = useRef(storageKey);
  activeStorageKey.current = storageKey;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const prepared = useMemo(() => {
    try {
      if (exactBalance === undefined) return undefined;
      return prepareNativeTransfer({ recipient, amount, sender: address, balance: exactBalance });
    } catch {
      return undefined;
    }
  }, [address, amount, exactBalance, recipient]);

  const currentAuthority = useMemo(() => {
    try {
      return walletClient && account.connector ? bindNativeTransferSigner({
        selectedWalletKey,
        selectedWalletKind,
        selectedSignerAuthority,
        connectedAddress: account.address,
        connectedChainId: account.chainId,
        connectorId: account.connector.id,
        connectorType: account.connector.type,
        connectorUid: account.connector.uid,
        walletClientAddress: walletClient.account?.address,
        walletClientChainId: walletClient.chain?.id,
        requiredChainId: targetChain.id
      }) : undefined;
    } catch {
      return undefined;
    }
  }, [account.address, account.chainId, account.connector, selectedSignerAuthority, selectedWalletKey, selectedWalletKind, targetChain.id, walletClient]);

  const saveSession = useCallback((next: NativeTransferSession) => {
    const nextStorageKey = nativeTransferStorageKey(next.sender, next.chainId);
    try {
      window.localStorage.setItem(nextStorageKey, JSON.stringify(next));
      if (nextStorageKey === activeStorageKey.current) setSession(next);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !requestPendingRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = dialogFocusableElements(dialog.current);
      if (focusable.length === 0) {
        event.preventDefault();
        stepPanel.current?.focus({ preventScroll: true });
        return;
      }
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
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      returnFocus.current?.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      previousStep.current = step;
      return;
    }
    if (previousStep.current === step) return;
    previousStep.current = step;
    const frame = window.requestAnimationFrame(() => stepPanel.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    setRecipient("");
    setAmount("");
    setReviewed(undefined);
    setReviewAuthority("");
    setMessage("");
    settlementAttempt.current = "";
    let restored: NativeTransferSession | undefined;
    try {
      restored = parseNativeTransferSession(window.localStorage.getItem(storageKey), address, targetChain.id);
    } catch {
      setMessage("Secure transfer recovery storage is unavailable. RMT will not open the wallet.");
    }
    setSession(restored);
    setTransactionHash(restored?.txHash);
    setStep(nativeTransferBlocksAnother(restored) ? "submitted" : "details");
  }, [address, open, storageKey, targetChain.id]);

  useEffect(() => {
    if (!open || step !== "review" || !reviewAuthority) return;
    if (currentAuthority?.fingerprint === reviewAuthority) return;
    setStep("details");
    setReviewed(undefined);
    setReviewAuthority("");
    setMessage("The selected signing wallet changed. Review the transfer again.");
  }, [currentAuthority?.fingerprint, open, reviewAuthority, step]);

  useEffect(() => {
    if (!session || nativeTransferStorageKey(session.sender, session.chainId) !== storageKey
      || !session.txHash || !["SUBMITTED", "UNKNOWN"].includes(session.state) || !receipt.data) return;
    const attemptKey = `${storageKey}:${session.txHash.toLowerCase()}:${receipt.data.blockHash.toLowerCase()}`;
    if (settlementAttempt.current === attemptKey) return;
    settlementAttempt.current = attemptKey;
    const isCurrentSettlement = () => activeStorageKey.current === storageKey;

    if (receipt.data.status === "reverted") {
      void (async () => {
        let resolution;
        try {
          if (!publicClient) throw new Error("The Robinhood Chain reader is unavailable.");
          resolution = resolveNativeTransferRevertedReceipt(session, {
            contextChainId: await publicClient.getChainId(),
            transactionHash: receipt.data.transactionHash
          });
        } catch {
          resolution = resolveNativeTransferRevertedReceipt(session);
        }

        const persisted = saveSession(resolution.session);
        if (!isCurrentSettlement()) return;
        if (!persisted) setSession(resolution.session);
        if (resolution.outcome === "EXACT_MATCH") {
          setMessage(persisted
            ? ""
            : "The transaction reverted onchain, but RMT could not persist that final state. Keep the transaction hash.");
        } else if (resolution.outcome === "EVIDENCE_UNAVAILABLE") {
          setMessage("The receipt reported a revert, but RMT could not independently verify its Robinhood Chain context. The outcome remains unresolved; keep the transaction hash and do not resubmit.");
        } else {
          setMessage("The receipt reported a revert, but its transaction hash or network did not match the tracked transfer. RMT kept duplicate protection active; keep the transaction hash and do not resubmit.");
        }
      })();
      return;
    }

    void (async () => {
      let resolution;
      try {
        if (!publicClient) throw new Error("The Robinhood Chain reader is unavailable.");
        const [contextChainId, transaction] = await Promise.all([
          publicClient.getChainId(),
          publicClient.getTransaction({ hash: session.txHash! })
        ]);
        resolution = resolveNativeTransferSettlement(session, {
          contextChainId,
          receipt: {
            blockHash: receipt.data.blockHash,
            blockNumber: receipt.data.blockNumber,
            transactionHash: receipt.data.transactionHash
          },
          transaction: {
            blockHash: transaction.blockHash,
            blockNumber: transaction.blockNumber,
            chainId: transaction.chainId,
            from: transaction.from,
            hash: transaction.hash,
            input: transaction.input,
            to: transaction.to,
            value: transaction.value
          }
        });
      } catch {
        resolution = resolveNativeTransferSettlement(session);
      }

      const persisted = saveSession(resolution.session);
      if (!isCurrentSettlement()) return;
      if (!persisted) setSession(resolution.session);
      if (resolution.outcome === "EXACT_MATCH") {
        setMessage(persisted
          ? ""
          : "The receipt arrived, but RMT could not persist the final transfer state. Keep the transaction hash.");
      } else if (resolution.outcome === "EVIDENCE_UNAVAILABLE") {
        setMessage("The receipt succeeded, but RMT could not independently load the mined transaction details. The transfer remains unresolved here; keep the transaction hash and do not resubmit.");
      } else {
        setMessage("The receipt succeeded, but the mined transaction did not match the reviewed network, sender, recipient, amount, or empty calldata. RMT did not mark the transfer confirmed; keep the transaction hash and do not resubmit.");
      }
    })();
  }, [publicClient, receipt.data, saveSession, session, storageKey]);

  if (!open) return null;

  const review = () => {
    setMessage("");
    try {
      if (exactBalance === undefined) throw new Error("The exact Robinhood Chain balance is unavailable. Retry the balance read before sending.");
      const next = prepareNativeTransfer({ recipient, amount, sender: address, balance: exactBalance });
      if (!currentAuthority) throw new Error("Select the exact active wallet on this network and try again.");
      setReviewed(next);
      setReviewAuthority(currentAuthority.fingerprint);
      setStep("review");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review the transfer details.");
    }
  };

  const submit = async () => {
    setMessage("");
    if (requestPending || !reviewed || !walletClient || !currentAuthority || currentAuthority.fingerprint !== reviewAuthority) {
      setStep("details");
      setReviewed(undefined);
      setReviewAuthority("");
      setMessage("The exact signing wallet or reviewed transfer changed. Review it again.");
      return;
    }
    const requestStorageKey = storageKey;
    const isCurrentRequest = () => activeStorageKey.current === requestStorageKey;
    if (!navigator.locks) {
      setMessage("This browser cannot establish duplicate-transfer protection. RMT did not open the wallet.");
      return;
    }
    setRequestPending(true);
    try {
      await navigator.locks.request(`rmt-native-transfer:${storageKey}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock) {
          setMessage("Another tab is already reviewing a transfer from this wallet.");
          return;
        }
        const persisted = parseNativeTransferSession(window.localStorage.getItem(storageKey), address, targetChain.id);
        if (nativeTransferBlocksAnother(persisted)) {
          if (isCurrentRequest()) {
            setSession(persisted);
            setTransactionHash(persisted?.txHash);
            setStep("submitted");
            setMessage("A prior transfer request is unresolved. RMT will not submit another one.");
          }
          return;
        }
        const rebound = bindNativeTransferSigner({
          selectedWalletKey,
          selectedWalletKind,
          selectedSignerAuthority,
          connectedAddress: account.address,
          connectedChainId: account.chainId,
          connectorId: account.connector?.id,
          connectorType: account.connector?.type,
          connectorUid: account.connector?.uid,
          walletClientAddress: walletClient.account?.address,
          walletClientChainId: walletClient.chain?.id,
          requiredChainId: targetChain.id
        });
        if (exactBalance === undefined) throw new Error("The exact Robinhood Chain balance is unavailable. RMT did not open the wallet.");
        const exact = prepareNativeTransfer({ recipient: reviewed.recipient, amount, sender: address, balance: exactBalance });
        if (rebound.fingerprint !== reviewAuthority || exact.recipient !== reviewed.recipient || exact.value !== reviewed.value) {
          throw new Error("The exact signer or transfer changed after review.");
        }
        const prompt = createNativeTransferPrompt({
          requestId: crypto.randomUUID(),
          sender: address,
          recipient: reviewed.recipient,
          value: reviewed.value,
          chainId: targetChain.id,
          walletKey: selectedWalletKey,
          connectorUid: rebound.connectorUid
        });
        if (!saveSession(prompt)) {
          if (isCurrentRequest()) setMessage("RMT could not persist duplicate-transfer protection, so the wallet was not opened.");
          return;
        }
        if (isCurrentRequest()) setStep("submitted");
        try {
          const hash = await walletClient.sendTransaction({
            account: address,
            chain: targetChain,
            to: reviewed.recipient,
            value: reviewed.value
          });
          const submitted = transitionNativeTransfer(prompt, "SUBMITTED", { txHash: hash });
          if (isCurrentRequest()) setTransactionHash(hash);
          if (!saveSession(submitted)) {
            if (isCurrentRequest()) {
              setSession(transitionNativeTransfer(prompt, "UNKNOWN", { txHash: hash }));
              setMessage(`Transaction hash received (${hash.slice(0, 10)}…), but recovery persistence failed. Keep this dialog open while RMT checks the receipt, and do not resubmit.`);
            }
          }
        } catch (error) {
          const next = transitionNativeTransfer(prompt, isNativeTransferUserRejection(error) ? "REJECTED" : "UNKNOWN");
          const persistedNext = saveSession(next);
          if (isCurrentRequest()) {
            if (!persistedNext) setSession(next);
            if (next.state === "REJECTED") setStep("details");
            setMessage(next.state === "REJECTED"
              ? safeTransferMessage(error)
              : "The wallet request result is unknown. Check wallet activity and do not retry this transfer.");
          }
        }
      });
    } catch (error) {
      if (isCurrentRequest()) setMessage(error instanceof Error ? error.message : "The transfer request did not complete. Check wallet activity before retrying.");
    } finally {
      setRequestPending(false);
    }
  };

  const unresolved = nativeTransferBlocksAnother(session);
  const terminal = session?.state === "CONFIRMED" || session?.state === "REVERTED";

  return <OverlayPortal>
    <button className="walletTransferBackdrop" type="button" aria-label="Close transfer" disabled={requestPending} onClick={onClose} />
    <div ref={dialog} className="walletTransferDialog" role="dialog" aria-modal="true" aria-labelledby="wallet-transfer-title" data-rmt-overlay-dialog="transfer">
      <header>
        <div><span>SELF-CUSTODIAL TRANSFER</span><h2 id="wallet-transfer-title">Send ETH on {targetChain.name}</h2></div>
        <button ref={closeButton} type="button" aria-label="Close transfer" disabled={requestPending} onClick={onClose}>×</button>
      </header>

      <div ref={stepPanel} className="walletTransferStep" tabIndex={-1}>
      {step === "details" && <>
        <div className="walletTransferBalance"><span>Available</span><strong>{balance.isLoading
          ? "Reading wallet…"
          : exactBalance === undefined
            ? "Balance unavailable"
            : `${Number(formatEther(exactBalance)).toLocaleString(undefined, { maximumFractionDigits: 7 })} ETH`}</strong></div>
        <label className="walletTransferField"><span>Destination address</span><input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x…" autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
        <label className="walletTransferField"><span>Amount</span><div><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /><b>ETH</b></div></label>
        <p className="walletTransferNotice">Transfers are irreversible. RMT never changes the destination and never submits without your wallet confirmation.</p>
        <button className="walletTransferPrimary" type="button" disabled={!prepared || exactBalance === undefined || !currentAuthority || unresolved} onClick={review}>Review transfer</button>
      </>}

      {step === "review" && reviewed && <>
        <div className="walletTransferReview">
          <div><span>You send</span><strong>{amount} ETH</strong></div>
          <div><span>From</span><strong>{shortAddress(address)}</strong></div>
          <div><span>To</span><strong>{shortAddress(reviewed.recipient)}</strong></div>
          <div><span>Network</span><strong>{targetChain.name}</strong></div>
        </div>
        <p className="walletTransferNotice warning">Check the full address in your wallet. Your wallet shows the final network fee before you approve.</p>
        <div className="walletTransferButtons">
          <button type="button" disabled={requestPending} onClick={() => setStep("details")}>Back</button>
          <button className="walletTransferPrimary" type="button" disabled={requestPending || unresolved} onClick={() => void submit()}>{requestPending ? "Open wallet confirmation…" : "Confirm in wallet"}</button>
        </div>
      </>}

      {step === "submitted" && session ? <div className="walletTransferSuccess">
        <span>{session.state === "CONFIRMED" ? "TRANSFER CONFIRMED" : session.state === "REVERTED" ? "TRANSFER REVERTED" : "TRANSFER REQUEST TRACKED"}</span>
        <strong>{session.state === "CONFIRMED"
          ? `${formatEther(BigInt(session.valueAtomic))} ETH matched the reviewed transfer and was confirmed onchain.`
          : session.state === "REVERTED"
            ? "The onchain transaction reverted. No transfer was completed."
            : session.state === "UNKNOWN" && session.txHash
              ? "Transaction reconciliation is unresolved. Keep the transaction hash and do not resubmit."
              : session.txHash ? "Transaction submitted. Waiting for an onchain receipt…" : "Wallet request unresolved. Check wallet activity and do not retry."}</strong>
        {session.txHash ? <a href={`${explorer}/tx/${session.txHash}`} target="_blank" rel="noreferrer">View transaction on Blockscout ↗</a> : <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">Check wallet activity on Blockscout ↗</a>}
        {terminal ? <button className="walletTransferPrimary" type="button" onClick={onClose}>Done</button> : null}
      </div> : null}
      </div>

      {receipt.isLoading && <p className="walletTransferStatus" role="status">Wallet approved. Waiting for onchain confirmation…</p>}
      {receipt.error && session?.state === "SUBMITTED" ? <p className="walletTransferStatus" role="status">Receipt check is delayed. Keep the transaction hash; RMT will not submit another transfer.</p> : null}
      {message && <p className="walletError" role="alert">{message}</p>}
    </div>
  </OverlayPortal>;
}
