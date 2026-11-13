"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { isHash, parseAbiItem, parseEventLogs, type Address, type Hex, type PublicClient } from "viem";
import { boundReceipt, displayAmount, verifySwap } from "../../../lib/launchpad/direct-v4";
import { fetchCurveState, isCurveAction, projectCurveReceipt, verifyCurveAction } from "../../../lib/launchpad/curve-receipt";
import type { NewLaunchRecord } from "../../../lib/launchpad/launch-record";
import { NativeSettlementPending } from "../../../lib/launchpad/native-settlement";
import {
  readPendingRequest, replacePendingRequest, submitReviewedRequest, walletMessage,
  type LaunchRequest, type PendingRequest,
} from "../../../lib/launchpad/transactions";
import { useLaunchClient, useLaunchWallet } from "./launch-wallet";

type Directory = { status: "ready" | "delayed" | "disabled"; launches: NewLaunchRecord[] };

export function useLaunches(filter: { creator?: Address; token?: Address } = {}) {
  const { creator, token } = filter;
  const [state, setState] = useState<Directory | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pendingRefreshes = useRef(0);
  const { config } = useLaunchWallet();
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(creator ? { creator } : token ? { token } : {});
    fetch(`/api/launchpad/launches?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const value = await response.json() as Directory;
        if (!Array.isArray(value.launches)) throw new Error("Launch directory unavailable");
        if (!controller.signal.aborted) setState(value);
      }).catch(() => {
        if (!controller.signal.aborted) setState({ status: "delayed", launches: [] });
      });
    return () => controller.abort();
  }, [creator, token, attempt, config?.status]);
  useEffect(() => {
    if (!token || !state?.launches.some((launch) => launch.indexing === "pending") || pendingRefreshes.current >= 4) return;
    const timer = window.setTimeout(() => {
      pendingRefreshes.current += 1;
      reload();
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [token, state, reload]);
  return { state, reload };
}

const feeEvent = parseAbiItem("event LaunchFeesCollected(address indexed creator,address indexed token,uint256 indexed positionTokenId)");
const accruedEvent = parseAbiItem("event LongevityFeesAccrued(address indexed token,uint256 nativeAmount,uint256 tokenAmount)");
const withdrawnEvent = parseAbiItem("event LongevityFeesWithdrawn(address indexed token,uint8 indexed bucket,address indexed recipient,uint256 nativeAmount,uint256 tokenAmount)");

async function publishLaunch(hash: Hex, request: LaunchRequest): Promise<NewLaunchRecord> {
  const response = await fetch("/api/launchpad/launches", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionHash: hash, creator: request.from, intentId: request.intentId }),
  });
  const data = await response.json() as { launch?: NewLaunchRecord; reason?: string };
  if (!response.ok || !data.launch) throw new Error(data.reason ?? "Receipt is confirmed. RMT launch verification is delayed.");
  return data.launch;
}

function isPendingReceipt(error: unknown) {
  return error instanceof Error && ["TransactionNotFoundError", "TransactionReceiptNotFoundError"].includes(error.name);
}

export function useLaunchTransaction(record?: NewLaunchRecord) {
  const { config, wallet, stillSelected } = useLaunchWallet();
  const deployment = config?.status === "ready" ? config.deployment : undefined;
  const client = useLaunchClient(deployment);
  const [pending, setPending] = useState<PendingRequest>();
  const [result, setResult] = useState<{ message: string; hash: Hex; launch?: Pick<NewLaunchRecord, "token" | "symbol"> }>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const checking = useRef(false);
  const inWallet = useRef(false);
  const walletAddress = wallet?.address;
  const chainId = deployment?.chainId;

  const refresh = useCallback(() => {
    if (!walletAddress || !chainId) {
      setPending(undefined);
      return;
    }
    try {
      setPending(readPendingRequest(chainId, walletAddress));
    } catch (cause) {
      setError(walletMessage(cause));
    }
  }, [walletAddress, chainId]);

  useEffect(() => {
    refresh();
    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  const verify = useCallback(async (item: PendingRequest, rpc: PublicClient) => {
    if (!item.hash || checking.current) return;
    checking.current = true;
    const hash = item.hash;
    const request = item.request;
    try {
      const receipt = await boundReceipt(rpc, hash, request);
      if (receipt.status !== "success") {
        const cleared = await replacePendingRequest(item);
        refresh();
        if (!cleared) return;
        setError("The transaction reverted onchain. Review the latest terms before retrying.");
        setMessage("");
        return;
      }
      let confirmed = "Transaction confirmed.";
      let launch: Pick<NewLaunchRecord, "token" | "symbol"> | undefined;
      if (config?.status === "ready" && config.curve && request.kind === "curve-create") {
        const created = projectCurveReceipt(config.deployment.factory, receipt, config.curve.creationFee, request);
        const indexed = await fetchCurveState(created.token);
        if (indexed.launch.transactionHash !== hash || indexed.launch.blockHash !== receipt.blockHash
          || indexed.launch.creationFee.amountWei !== created.creationFee.amountWei
          || indexed.launch.creationFee.recipient.toLowerCase() !== created.creationFee.recipient.toLowerCase()
          || indexed.launch.creationFee.refundWei !== created.creationFee.refundWei
          || indexed.launch.creationFee.logIndex !== created.creationFee.logIndex) {
          throw new Error("Curve creation is being reconciled with the index.");
        }
        launch = created;
        confirmed = "Curve token created and verified. Curve trading is open.";
      } else if (config?.status === "ready" && config.curve && request.token && isCurveAction(request)) {
        const { launch: indexed, state } = await fetchCurveState(request.token, request.from);
        confirmed = await verifyCurveAction(rpc, receipt, request, config, indexed, state);
      } else if (isCurveAction(request)) {
        throw new Error("Reconnect to the reviewed curve deployment to verify this request.");
      } else if (request.kind === "launch") {
        setMessage("Transaction confirmed onchain. Verifying the funded pool and position custody…");
        const published = await publishLaunch(hash, request);
        launch = published;
        confirmed = published.indexing === "indexed" ? "Funded launch verified and indexed." : "Funded launch verified. Directory indexing is pending.";
      } else if (request.kind === "buy" || request.kind === "sell") {
        setMessage("Transaction confirmed onchain. Verifying swap settlement…");
        const exactRecord = record?.token.toLowerCase() === request.token?.toLowerCase() ? record : undefined;
        if (!deployment || !exactRecord) throw new Error("Open the token page to verify this swap.");
        const amount = await verifySwap(rpc, receipt, deployment, exactRecord, request);
        confirmed = `Settlement verified. Received ${displayAmount(amount)} ${request.kind === "buy" ? exactRecord.symbol : "ETH"}.`;
      } else if (request.kind === "fees") {
        const events = parseEventLogs({ abi: [feeEvent], logs: receipt.logs });
        if (!events.some(({ address, args }) => address.toLowerCase() === request.to.toLowerCase()
          && args.creator.toLowerCase() === request.from.toLowerCase() && args.token.toLowerCase() === request.token?.toLowerCase())) {
          throw new Error("The receipt does not verify the creator fee collection.");
        }
        confirmed = "Creator fee collection confirmed.";
      } else if (request.kind === "fees-harvest" || request.kind === "fees-withdrawal") {
        const factoryLogs = receipt.logs.filter(({ address }) => address.toLowerCase() === request.to.toLowerCase());
        const tokenMatches = (token: Address) => token.toLowerCase() === request.token?.toLowerCase();
        if (request.kind === "fees-harvest") {
          const accrual = parseEventLogs({ abi: [accruedEvent], logs: factoryLogs }).find(({ args }) => tokenMatches(args.token));
          if (!accrual) throw new Error("The receipt does not verify the LP fee collection.");
          confirmed = accrual.args.nativeAmount || accrual.args.tokenAmount
            ? "LP fees collected into the committed shares." : "Fee collection confirmed. No fees accrued in this collection.";
        } else {
          const withdrawal = parseEventLogs({ abi: [withdrawnEvent], logs: factoryLogs }).find(({ args }) => tokenMatches(args.token)
            && args.bucket === request.feeBucket && args.recipient.toLowerCase() === request.from.toLowerCase());
          if (!withdrawal) throw new Error("The receipt does not verify the committed fee payout.");
          confirmed = "Fee payout to your committed wallet verified.";
        }
      } else {
        confirmed = "Approval confirmed. Review the next step to continue the sale.";
      }
      const cleared = await replacePendingRequest(item);
      refresh();
      if (!cleared) return;
      setResult({ message: confirmed, hash, launch });
      setError("");
      setMessage("");
    } catch (cause) {
      if (cause instanceof NativeSettlementPending) {
        setError("");
        setMessage(cause.message);
      } else if (isPendingReceipt(cause)) setMessage("Transaction pending. Waiting for a receipt…");
      else setError(walletMessage(cause));
    } finally {
      checking.current = false;
    }
  }, [config, deployment, record, refresh]);

  const hash = pending?.hash;
  useEffect(() => {
    if (!hash || !client || !chainId || !walletAddress) return;
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;
    const check = async () => {
      let saved: PendingRequest | undefined;
      try { saved = readPendingRequest(chainId, walletAddress); }
      catch (cause) { setError(walletMessage(cause)); }
      if (cancelled || !saved || saved.hash !== hash) return;
      await verify(saved, client);
      attempts += 1;
      if (!cancelled && attempts < 10) timer = window.setTimeout(() => void check(), Math.min(2_000 * attempts, 10_000));
    };
    void check();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [hash, client, chainId, walletAddress, verify]);

  async function send(request: LaunchRequest) {
    if (!wallet || !deployment || !client || inWallet.current) return;
    inWallet.current = true;
    setBusy(true);
    setResult(undefined);
    setError("");
    setMessage("Confirm the reviewed transaction in your wallet.");
    try {
      await submitReviewedRequest(wallet, request, () => stillSelected(wallet));
      setMessage("Transaction pending. Waiting for a receipt…");
    } catch (cause) {
      setError(walletMessage(cause));
      setMessage("");
    } finally {
      refresh();
      setBusy(false);
      inWallet.current = false;
    }
  }

  async function recover(raw: string) {
    if (!pending || !client) return;
    const hash = raw.trim();
    if (!isHash(hash)) {
      setError("Enter the transaction hash from your wallet activity.");
      return;
    }
    try {
      const saved = readPendingRequest(pending.request.chainId, pending.request.from);
      if (!saved || saved.hash) return;
      // Only attach hashes that already prove the exact reviewed request.
      await boundReceipt(client, hash, saved.request);
      await replacePendingRequest(saved, hash);
      refresh();
      setError("");
    } catch (cause) {
      setError(isPendingReceipt(cause) ? "Waiting for the transaction receipt. Try its hash again after confirmation." : walletMessage(cause));
    }
  }

  return {
    pending, result, message, error, busy, send, recover,
    retry: () => { if (pending && client) void verify(pending, client); },
  };
}

export function TransactionFeedback({ transaction }: { transaction: ReturnType<typeof useLaunchTransaction> }) {
  const [hash, setHash] = useState("");
  const { pending, result, error, message } = transaction;
  return <>
    {message && <p className="lpNotice" role="status">{message}</p>}
    {error && <p className="lpNotice lpError" role="alert">{error}</p>}
    {pending?.hash && <div className="lpRecovery"><code>{pending.hash}</code>
      <button type="button" className="lpButton lpSecondary" onClick={transaction.retry}>Check receipt</button>
      {pending.request.token && (pending.request.kind === "buy" || pending.request.kind === "sell" || isCurveAction(pending.request)) &&
        <Link href={`/launches/${pending.request.token}`}>Open token to verify settlement</Link>}
    </div>}
    {pending && !pending.hash && <div className="lpRecovery">
      <label>Recover wallet request<input value={hash} onChange={(event) => setHash(event.target.value)} placeholder="Transaction hash from wallet activity" /></label>
      <button type="button" className="lpButton lpSecondary" onClick={() => void transaction.recover(hash)}>Check transaction</button>
    </div>}
    {result && <div className="lpNotice" role="status">
      <strong>{result.message}</strong>
      <code>{result.hash}</code>
      {result.launch && <Link className="lpButton" href={`/launches/${result.launch.token}`}>Open {result.launch.symbol}</Link>}
    </div>}
  </>;
}
