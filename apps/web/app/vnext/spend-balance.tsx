"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { erc20Abi, formatUnits, getAddress, isAddress, zeroAddress } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import type { ExternalMarketResponse } from "../../lib/external-market";
import { spendableAtomic } from "../../lib/vnext/execution-domain";
import type { VNextExecutionRecord } from "../../lib/vnext/execution-recovery";
import type { VNextDirectoryMarket } from "../../lib/vnext/market-directory";
import {
  ROBINHOOD_ETH,
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_USDG,
  ROBINHOOD_USDG_ADDRESS,
  confirmedBalanceSnapshot,
  robinhoodWalletAccount
} from "../../lib/vnext/robinhood-assets";
import {
  importedWalletCandidate,
  type VNextDetectedWalletAsset,
  type VNextWalletAssetCandidate
} from "../../lib/vnext/wallet-assets";
import { useVNextWalletAssets } from "./use-vnext-wallet-assets";
import { FundWalletButton } from "../fund-wallet-button";

const SETTLEMENT_BALANCE_REFRESH_DELAYS_MS = [0, 900, 2_500] as const;

function amount(value: bigint | undefined, decimals: number | null, maximumFractionDigits: number) {
  if (value === undefined || decimals === null) return "—";
  const formatted = Number(formatUnits(value, decimals));
  if (!Number.isFinite(formatted)) return "—";
  if (formatted > 0 && formatted < 10 ** -maximumFractionDigits) return `<${10 ** -maximumFractionDigits}`;
  return formatted.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits });
}

function assetAmount(asset: VNextDetectedWalletAsset) {
  return amount(BigInt(asset.balanceAtomic), asset.decimals, asset.symbol === "USDG" ? 2 : 5);
}

function dollars(value: bigint | undefined) {
  if (value === undefined) return "—";
  const formatted = Number(formatUnits(value, ROBINHOOD_USDG.decimals ?? 6));
  if (!Number.isFinite(formatted)) return "—";
  return formatted.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function stateLabel(asset: VNextDetectedWalletAsset) {
  return asset.identityState === "verified" ? "Detected" : "Detected · identity reported";
}

export function SpendBalance({ markets, onAssetsChange, onNativeBalanceChange, executionRecord, portfolioRevealRequest = 0 }: {
  markets: VNextDirectoryMarket[];
  onAssetsChange?: (assets: VNextDetectedWalletAsset[]) => void;
  onNativeBalanceChange?: (balance: bigint | undefined) => void;
  executionRecord?: VNextExecutionRecord | null;
  portfolioRevealRequest?: number;
}) {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: ROBINHOOD_MAINNET_CHAIN_ID });
  const [importAddress, setImportAddress] = useState("");
  const [imported, setImported] = useState<VNextWalletAssetCandidate[]>([]);
  const [importState, setImportState] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [importMessage, setImportMessage] = useState("Paste a Robinhood token contract that is missing from the directory.");
  const [holdingsExpanded, setHoldingsExpanded] = useState(false);
  const wallet = address;
  const onRobinhood = chainId === ROBINHOOD_MAINNET_CHAIN_ID;
  const { assets, nativeBalance, status, enabled, refresh } = useVNextWalletAssets(markets, imported);
  const usdg = assets.find((asset) => asset.address.toLowerCase() === ROBINHOOD_USDG_ADDRESS.toLowerCase());
  const confirmedUsdg = usdg ? BigInt(usdg.balanceAtomic) : status === "ready" ? 0n : undefined;
  const assetCountReady = status === "ready" || status === "stale";
  const spendable = wallet && confirmedUsdg !== undefined
    ? BigInt(spendableAtomic(confirmedBalanceSnapshot({
        account: robinhoodWalletAccount(wallet),
        asset: ROBINHOOD_USDG,
        settledAtomic: confirmedUsdg,
        observedAtMs: Date.now()
      })))
    : undefined;
  const delayed = enabled && (status === "stale" || status === "error");
  const refreshedResolution = useRef<string | undefined>(undefined);
  const refreshBalances = useRef(refresh);

  useEffect(() => onAssetsChange?.(assets), [assets, onAssetsChange]);
  useEffect(() => onNativeBalanceChange?.(nativeBalance), [nativeBalance, onNativeBalanceChange]);
  useEffect(() => {
    if (portfolioRevealRequest > 0) setHoldingsExpanded(true);
  }, [portfolioRevealRequest]);
  useEffect(() => {
    refreshBalances.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (
      !executionRecord
      || executionRecord.kind !== "swap"
      || executionRecord.state !== "confirmed"
      || refreshedResolution.current === executionRecord.txHash
    ) return;
    refreshedResolution.current = executionRecord.txHash;
    const timers = SETTLEMENT_BALANCE_REFRESH_DELAYS_MS.flatMap((delayMs) => {
      if (delayMs === 0) {
        void refreshBalances.current();
        return [];
      }
      return [window.setTimeout(() => void refreshBalances.current(), delayMs)];
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [executionRecord]);

  async function importAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rawAddress = importAddress.trim();
    if (!wallet || !publicClient || !enabled) {
      setImportState("error");
      setImportMessage("Connect a Robinhood Chain wallet before checking a token balance.");
      return;
    }
    if (!isAddress(rawAddress, { strict: false }) || rawAddress.toLowerCase() === zeroAddress) {
      setImportState("error");
      setImportMessage("Enter a complete nonzero Robinhood token contract.");
      return;
    }
    const address = getAddress(rawAddress);
    setImportState("checking");
    setImportMessage("Verifying the contract and connected-wallet balance…");
    try {
      const query = new URLSearchParams({ address });
      const response = await fetch(`/api/vnext/asset-identity?${query}`, { cache: "no-store" });
      const payload = await response.json() as ExternalMarketResponse;
      const candidate = importedWalletCandidate(payload, address);
      if (!response.ok || !candidate) throw new Error("Token identity could not be verified on Robinhood Chain.");
      const balance = await publicClient.readContract({
        address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet]
      });
      if (balance <= 0n) {
        setImportState("error");
        setImportMessage(`${candidate.symbol} is verified, but this wallet has no positive balance.`);
        return;
      }
      setImported((current) => current.some((asset) => asset.address.toLowerCase() === address.toLowerCase())
        ? current
        : [...current, candidate]);
      setImportAddress("");
      setImportState("success");
      setImportMessage(`${candidate.symbol} detected. Its execution route has not been checked.`);
    } catch (error) {
      setImportState("error");
      setImportMessage(error instanceof Error ? error.message : "The token could not be verified.");
    }
  }

  return (
    <section id="vnext-portfolio" className="vnBalanceBar" aria-labelledby="vn-balance-heading" aria-busy={status === "loading"}>
      <div className="vnBalancePrimary">
        <span id="vn-balance-heading">Available to trade</span>
        <strong>{enabled ? dollars(spendable) : "—"}</strong>
        <small><i aria-hidden="true" />{!isConnected ? "Connect a wallet" : !onRobinhood ? "Switch to Robinhood Chain" : delayed ? "Balance read delayed" : status === "loading" ? "Reading confirmed USDG" : "Confirmed wallet-held USDG"}</small>
      </div>
      <div className="vnBalanceMetric">
        <span>Wallet assets</span>
        <strong>{enabled && assetCountReady ? `${assets.length + (nativeBalance && nativeBalance > 0n ? 1 : 0)} detected` : "—"}</strong>
        <small>{enabled ? `${amount(nativeBalance, ROBINHOOD_ETH.decimals, 5)} ETH` : "Chain-specific balances"}</small>
      </div>
      <div className="vnBalanceMetric">
        <span>Pending</span>
        <strong>{executionRecord?.state === "submitted" ? "1 transaction" : "None tracked"}</strong>
        <small>{executionRecord?.state === "submitted" ? `${executionRecord.kind === "erc20_approval" ? "Approval" : "Swap"} awaiting confirmation` : "Unconfirmed proceeds are never spendable"}</small>
      </div>
      <div className="vnBalanceActions">
        <FundWalletButton variant="inline" label="Add funds" target="mainnet" />
      </div>

      {enabled && <div className={`vnDetectedAssets${holdingsExpanded ? " isExpanded" : ""}`} aria-live="polite">
        <div className="vnDetectedAssetsHead">
          <span><strong>Onchain holdings</strong><small>Canonical assets + current live directory</small></span>
          <div className="vnDetectedAssetsControls">
            <button
              className="vnDetectedAssetsToggle"
              type="button"
              aria-expanded={holdingsExpanded}
              aria-controls="vn-detected-assets-body"
              onClick={() => setHoldingsExpanded((expanded) => !expanded)}
            >{holdingsExpanded ? "Hide assets" : "View assets"}</button>
            <button className="vnDetectedAssetsRefresh" type="button" onClick={() => void refresh()} disabled={status === "loading"}>{status === "loading" ? "Scanning…" : "Refresh"}</button>
          </div>
        </div>
        <div className="vnDetectedAssetsBody" id="vn-detected-assets-body">
          <form className="vnAssetImport" onSubmit={(event) => void importAsset(event)}>
            <label htmlFor="vn-import-token">Import held token</label>
            <div>
              <input
                id="vn-import-token"
                value={importAddress}
                onChange={(event) => {
                  setImportAddress(event.target.value);
                  if (importState !== "idle") {
                    setImportState("idle");
                    setImportMessage("Paste a Robinhood token contract that is missing from the directory.");
                  }
                }}
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="0x… token contract"
                aria-describedby="vn-import-token-status"
              />
              <button type="submit" disabled={importState === "checking" || importAddress.trim().length === 0}>{importState === "checking" ? "Checking…" : "Check balance"}</button>
            </div>
            <small id="vn-import-token-status" className={importState === "error" ? "isError" : importState === "success" ? "isSuccess" : ""} role="status">{importMessage}</small>
          </form>
          {status === "error" && assets.length === 0 ? <p className="vnDetectedAssetsEmpty">Wallet reads are temporarily unavailable. No asset was marked unavailable.</p> : null}
          {status === "ready" && assets.length === 0 && (!nativeBalance || nativeBalance === 0n) ? <p className="vnDetectedAssetsEmpty">No positive balance was found in the current scan set.</p> : null}
          {(assets.length > 0 || (nativeBalance && nativeBalance > 0n)) ? <div className="vnDetectedAssetList">
            {nativeBalance && nativeBalance > 0n ? <div className="vnDetectedAsset">
              <span className="vnDetectedMark" aria-hidden="true">E</span>
              <span><strong>ETH</strong><small>Ether</small></span>
              <span><strong>{amount(nativeBalance, ROBINHOOD_ETH.decimals, 5)}</strong><small>Detected · native</small></span>
            </div> : null}
            {assets.slice(0, 8).map((asset) => <div className="vnDetectedAsset" key={asset.address}>
              <span className="vnDetectedMark" aria-hidden="true">{asset.symbol.slice(0, 1)}</span>
              <span><strong>{asset.symbol}</strong><small>{asset.name}</small></span>
              <span><strong>{assetAmount(asset)}</strong><small>{stateLabel(asset)} · route not checked</small></span>
            </div>)}
          </div> : null}
          {assets.length > 8 ? <p className="vnDetectedAssetsMore">+{assets.length - 8} more detected assets</p> : null}
        </div>
      </div>}
    </section>
  );
}
