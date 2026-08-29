"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { erc20Abi, formatUnits, getAddress, isAddress, zeroAddress, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import type { ExternalMarketResponse } from "../../lib/external-market";
import { spendableAtomic } from "../../lib/vnext/execution-domain";
import { spendableNativeAtomic } from "../../lib/vnext/intent-draft";
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
import { walletPortfolioSummary } from "../../lib/vnext/wallet-portfolio";
import { useVNextWalletAssets } from "./use-vnext-wallet-assets";
import { FundWalletButton } from "../fund-wallet-button";
import { WalletTransferDialog } from "../wallet-transfer-dialog";
import { TokenArtwork } from "./token-artwork";
import { VNEXT_CLIENT_REFRESH_POLICY } from "../../lib/vnext/client-refresh-policy";
import { useVisibilityRefresh } from "./use-visibility-refresh";

const SETTLEMENT_BALANCE_REFRESH_DELAYS_MS = [0, 900, 2_500] as const;

function amount(value: bigint | undefined, decimals: number | null, maximumFractionDigits: number) {
  if (value === undefined || decimals === null) return "—";
  const formatted = Number(formatUnits(value, decimals));
  if (!Number.isFinite(formatted)) return "—";
  if (formatted > 0 && formatted < 10 ** -maximumFractionDigits) return `<${10 ** -maximumFractionDigits}`;
  return formatted.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits });
}

function assetAmount(asset: VNextDetectedWalletAsset) {
  return amount(BigInt(asset.balanceAtomic), asset.decimals, asset.address.toLowerCase() === ROBINHOOD_USDG_ADDRESS.toLowerCase() ? 2 : 5);
}

function portfolioDollars(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function stateLabel(asset: VNextDetectedWalletAsset, marketFound: boolean) {
  if (asset.reputation === "suspicious") return "Detected · review token identity";
  if (asset.address.toLowerCase() === ROBINHOOD_USDG_ADDRESS.toLowerCase()) return "Confirmed spend balance";
  if (asset.symbol.toUpperCase() === "USDG") return "Detected · not canonical USDG";
  if (marketFound) return "Market found · quote on demand";
  return asset.identityState === "verified" ? "Detected · route not checked" : "Detected · identity reported";
}

export function SpendBalance({ visible = true, markets, onAssetsChange, onNativeBalanceChange, onWalletReadStatusChange, onSelectAsset, executionRecord, portfolioRevealRequest = 0 }: {
  visible?: boolean;
  markets: VNextDirectoryMarket[];
  onAssetsChange?: (assets: VNextDetectedWalletAsset[]) => void;
  onNativeBalanceChange?: (balance: bigint | undefined) => void;
  onWalletReadStatusChange?: (status: "idle" | "loading" | "ready" | "stale" | "error") => void;
  onSelectAsset?: (address: string) => void;
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
  const [showAllAssets, setShowAllAssets] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [ethUsd, setEthUsd] = useState<number>();
  const wallet = address;
  const onRobinhood = chainId === ROBINHOOD_MAINNET_CHAIN_ID;
  const { assets, nativeBalance, status, discoveryStatus, observedAtMs, enabled, refresh } = useVNextWalletAssets(markets, imported);
  const usdg = assets.find((asset) => asset.address.toLowerCase() === ROBINHOOD_USDG_ADDRESS.toLowerCase());
  const confirmedUsdg = usdg ? BigInt(usdg.balanceAtomic) : status === "ready" ? 0n : undefined;
  const assetCountReady = status === "ready" || status === "stale";
  const usdgSpendable = wallet && confirmedUsdg !== undefined
    ? BigInt(spendableAtomic(confirmedBalanceSnapshot({
        account: robinhoodWalletAccount(wallet),
        asset: ROBINHOOD_USDG,
        settledAtomic: confirmedUsdg,
        observedAtMs: Date.now()
      })))
    : undefined;
  const nativeSpendable = spendableNativeAtomic(nativeBalance);
  const delayed = enabled && (status === "stale" || status === "error");
  const refreshedResolution = useRef<string | undefined>(undefined);
  const refreshBalances = useRef(refresh);
  const marketAddresses = useMemo(() => new Set(markets.map((market) => market.address.toLowerCase())), [markets]);
  const portfolio = useMemo(() => walletPortfolioSummary({ assets, markets, nativeBalance, ethUsd }), [assets, ethUsd, markets, nativeBalance]);
  const tradeBalanceUsd = usdgSpendable === undefined || nativeSpendable === undefined
    ? undefined
    : Number(formatUnits(usdgSpendable, ROBINHOOD_USDG.decimals ?? 6))
      + (ethUsd ? Number(formatUnits(nativeSpendable, ROBINHOOD_ETH.decimals ?? 18)) * ethUsd : 0);
  const tradeBalanceFullyPriced = nativeSpendable === 0n || ethUsd !== undefined;
  const visibleAssets = showAllAssets ? assets : assets.slice(0, 12);

  useEffect(() => onAssetsChange?.(assets), [assets, onAssetsChange]);
  useEffect(() => onNativeBalanceChange?.(nativeBalance), [nativeBalance, onNativeBalanceChange]);
  useEffect(() => onWalletReadStatusChange?.(status), [onWalletReadStatusChange, status]);
  useEffect(() => {
    if (portfolioRevealRequest > 0) setHoldingsExpanded(true);
  }, [portfolioRevealRequest]);
  useEffect(() => {
    refreshBalances.current = refresh;
  }, [refresh]);
  const refreshEthPrice = () => {
    const controller = new AbortController();
    return fetch("/api/prices/eth", { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ usd?: unknown }> : null)
      .then((payload) => {
        if (typeof payload?.usd === "number" && Number.isFinite(payload.usd) && payload.usd > 0) setEthUsd(payload.usd);
      })
      .catch(() => undefined);
  };
  useVisibilityRefresh(refreshEthPrice, VNEXT_CLIENT_REFRESH_POLICY.ethPriceMs, { enabled });
  useEffect(() => {
    if (!enabled) setEthUsd(undefined);
  }, [enabled]);
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
        void refreshBalances.current(false);
        return [];
      }
      return [window.setTimeout(() => void refreshBalances.current(false), delayMs)];
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
      const response = await fetch(`/api/vnext/asset-identity?${query}`);
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

  if (!visible) return null;

  return (
    <section id="vnext-portfolio" className="vnBalanceBar" aria-labelledby="vn-balance-heading" aria-busy={status === "loading"}>
      <div className="vnBalancePrimary">
        <span id="vn-balance-heading">Portfolio</span>
        <strong>{enabled && assetCountReady && portfolio.hasKnownValue ? portfolioDollars(portfolio.knownPortfolioUsd) : "—"}</strong>
        <small><i aria-hidden="true" />{!isConnected ? "Connect a wallet" : !onRobinhood ? "Switch to Robinhood Chain" : delayed ? "Wallet read delayed" : status === "loading" ? "Reading wallet" : `${shortAddress(wallet!)} · Robinhood Chain`}</small>
      </div>
      <div className="vnBalanceMetric">
        <span>Trade balance</span>
        <strong>{enabled && tradeBalanceFullyPriced ? portfolioDollars(tradeBalanceUsd) : enabled && nativeSpendable && nativeSpendable > 0n ? "Value pending" : "—"}</strong>
        <small>{enabled ? `${amount(nativeSpendable, ROBINHOOD_ETH.decimals, 6)} ETH · ${amount(usdgSpendable, ROBINHOOD_USDG.decimals, 2)} USDG` : "Confirmed funding assets"}</small>
      </div>
      <div className="vnBalanceMetric">
        <span>Pending</span>
        <strong>{executionRecord?.state === "submitted" ? "1 transaction" : "None tracked"}</strong>
        <small>{executionRecord?.state === "submitted" ? `${executionRecord.kind === "erc20_approval" ? "Approval" : "Swap"} awaiting confirmation` : "Unconfirmed proceeds are never spendable"}</small>
      </div>
      <div className="vnBalanceActions">
        <FundWalletButton variant="inline" label="Add funds" target="mainnet" />
        {wallet ? <FundWalletButton variant="inline" label="Receive" target="mainnet" directReceive /> : null}
        {wallet ? <button className="vnBalanceSend" type="button" onClick={() => setTransferOpen(true)} disabled={!onRobinhood || nativeBalance === undefined || nativeBalance <= 0n}>Send ETH</button> : null}
      </div>

      {enabled && <div className={`vnDetectedAssets isExpanded${holdingsExpanded ? " hasDetails" : ""}`} aria-live="polite">
        <div className="vnTradeBalance" aria-label="Spendable trade balance">
          <div><span>ETH</span><strong>{amount(nativeSpendable, ROBINHOOD_ETH.decimals, 6)}</strong><small>Trade funding + network gas · reserve excluded</small></div>
          <div><span>USDG</span><strong>{amount(usdgSpendable, ROBINHOOD_USDG.decimals, 2)}</strong><small>Canonical trade balance · settlement asset</small></div>
        </div>
        <div className="vnDetectedAssetsHead">
          <span><strong>Holdings</strong><small>{assets.length + (nativeBalance && nativeBalance > 0n ? 1 : 0)} onchain assets</small></span>
          <div className="vnDetectedAssetsControls">
            <button
              className="vnDetectedAssetsToggle"
              type="button"
              aria-expanded={holdingsExpanded}
              aria-controls="vn-wallet-details"
              onClick={() => setHoldingsExpanded((expanded) => !expanded)}
            >{holdingsExpanded ? "Hide details" : "Wallet details"}</button>
            <button className="vnDetectedAssetsRefresh" type="button" onClick={() => void refresh()} disabled={status === "loading"}>{status === "loading" ? "Scanning…" : "Refresh"}</button>
          </div>
        </div>
        <div className="vnDetectedAssetsBody" id="vn-detected-assets-body">
          {holdingsExpanded ? <div className="vnWalletDetails" id="vn-wallet-details"><div className="vnPortfolioTruth">
            <div><span>Native balance</span><strong>{amount(nativeBalance, ROBINHOOD_ETH.decimals, 6)} ETH</strong><small>Trade funding plus protected network-gas reserve</small></div>
            <div><span>Wallet discovery</span><strong>{discoveryStatus === "ready" ? "Complete" : discoveryStatus === "partial" ? "Partial" : discoveryStatus === "stale" ? "Last known" : discoveryStatus === "unavailable" ? "Delayed" : "Checking"}</strong><small>Indexer finds assets; onchain reads confirm balances</small></div>
            <div><span>Last balance check</span><strong>{observedAtMs ? new Date(observedAtMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—"}</strong><small>Refresh runs quietly in the background</small></div>
          </div>
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
          </form></div> : null}
          {status === "error" && assets.length === 0 ? <p className="vnDetectedAssetsEmpty">Wallet reads are temporarily unavailable. No asset was marked unavailable.</p> : null}
          {status === "ready" && assets.length === 0 && (!nativeBalance || nativeBalance === 0n) ? <p className="vnDetectedAssetsEmpty">No positive Robinhood Chain balance was found for this wallet.</p> : null}
          {(assets.length > 0 || (nativeBalance && nativeBalance > 0n)) ? <div className="vnDetectedAssetList">
            {nativeBalance && nativeBalance > 0n ? <div className="vnDetectedAsset">
              <TokenArtwork className="vnDetectedMark" symbol="ETH" imageUrl={null} />
              <span><strong>ETH</strong><small>Ether · trade funding</small></span>
              <span><strong>{amount(nativeBalance, ROBINHOOD_ETH.decimals, 5)}</strong><small>{portfolio.nativeValueUsd === null ? "Trade funding + network gas" : `${portfolioDollars(portfolio.nativeValueUsd)} · funding + gas`}</small></span>
            </div> : null}
            {visibleAssets.map((asset) => {
              const marketFound = marketAddresses.has(asset.address.toLowerCase());
              const valuation = portfolio.valuations.find((item) => item.address.toLowerCase() === asset.address.toLowerCase());
              return <div className={`vnDetectedAsset${asset.reputation === "suspicious" ? " isReview" : ""}`} key={asset.address}>
              <TokenArtwork className="vnDetectedMark" symbol={asset.symbol} imageUrl={asset.imageUrl} />
              <span><strong>{asset.symbol}</strong><small>{asset.name} · {shortAddress(asset.address)}</small></span>
              <span><strong>{assetAmount(asset)}</strong><small>{valuation?.valueUsd === null || valuation?.valueUsd === undefined ? stateLabel(asset, marketFound) : `${portfolioDollars(valuation.valueUsd)} · ${stateLabel(asset, marketFound)}`}</small></span>
              {marketFound && onSelectAsset ? <button className="vnDetectedAssetOpen" type="button" onClick={() => onSelectAsset(asset.address)}>Open</button> : <span className="vnDetectedAssetNoRoute">View only</span>}
            </div>})}
          </div> : null}
          {assets.length > 12 ? <button className="vnDetectedAssetsMore" type="button" onClick={() => setShowAllAssets((shown) => !shown)}>{showAllAssets ? "Show fewer assets" : `Show all ${assets.length} assets`}</button> : null}
        </div>
      </div>}
      {wallet ? <WalletTransferDialog address={wallet as Address} open={transferOpen} target="mainnet" onClose={() => setTransferOpen(false)} /> : null}
    </section>
  );
}
