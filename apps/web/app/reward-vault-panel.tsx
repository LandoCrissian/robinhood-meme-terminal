"use client";

import { useEffect, useState } from "react";
import { formatUnits, keccak256, toHex, type Address, type Hash } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import {
  bondingCurveMarketV6FeeAbi,
  directLaunchFeeSplitterV6Abi,
  rmtLaunchFactoryV6Abi,
  v4GraduationFeeCollectorAbi
} from "../lib/contracts";
import { activeChain, activeNetworkLabel } from "../lib/network";
import { useFactoryAddress } from "../lib/use-factory-address";
import { useLaunchRecord } from "../lib/use-launch-record";

const fallbackAddress = "0x0000000000000000000000000000000000000000" as const;
const canonicalCurveFeeBps = 100;
const canonicalCreatorShareBps = 7_000;
const canonicalProtocolShareBps = 3_000;
const canonicalPostGraduationFeeBps = 50;
const canonicalGraduationTarget = 2n * 10n ** 18n;
const canonicalV4PoolFee = 5_000;
const fairPolicyId = keccak256(toHex("RMT_SIMPLE_FAIR_V1"));
const openPolicyId = keccak256(toHex("RMT_SIMPLE_OPEN_V1"));
const bondingCurveMigrationAbi = [
  {
    type: "function",
    name: "migrateLiquidity",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [
      { name: "pool", type: "address" },
      { name: "liquidity", type: "uint256" }
    ]
  }
] as const;
type FeeAction = "native" | "token" | "migrate" | "collect";

function shortAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function sameAddress(left: Address | undefined, right: Address | undefined) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function amount(value: bigint, unit: string, maximumFractionDigits = 6) {
  const formatted = Number(formatUnits(value, 18));
  if (formatted === 0) return `0 ${unit}`;
  if (formatted < 0.000001) return `<0.000001 ${unit}`;
  return `${formatted.toLocaleString(undefined, { maximumFractionDigits })} ${unit}`;
}

function panelMessage(title: string, message: string) {
  return <section className="panel rewardDashboard"><p className="eyebrow">FEE SPLITTER</p><h2>{title}</h2><p>{message}</p></section>;
}

export function RewardVaultPanel({ tokenAddress, symbol }: { tokenAddress: Address; symbol: string }) {
  const factoryAddress = useFactoryAddress();
  const launchRecord = useLaunchRecord(tokenAddress);
  const feeSplitter = launchRecord.data?.rewardVault ?? null;
  const market = launchRecord.data?.market ?? fallbackAddress;
  const { address: account } = useAccount();
  const { writeContract, data: actionHash, isPending, error: actionError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: actionConfirmed } = useWaitForTransactionReceipt({ hash: actionHash, chainId: activeChain.id });
  const [lastAction, setLastAction] = useState<FeeAction | null>(null);

  const splitterAddress = feeSplitter ?? fallbackAddress;
  const splitterEnabled = Boolean(feeSplitter);
  const splitterCommon = {
    address: splitterAddress,
    abi: directLaunchFeeSplitterV6Abi,
    chainId: activeChain.id,
    query: { enabled: splitterEnabled, retry: false, refetchInterval: 10_000 }
  } as const;

  const originalCreatorRead = useReadContract({ ...splitterCommon, functionName: "originalCreator" });
  const creatorRecipientRead = useReadContract({ ...splitterCommon, functionName: "creator" });
  const payoutAuthorityRead = useReadContract({ ...splitterCommon, functionName: "creatorPayoutAuthority" });
  const payoutNonceRead = useReadContract({ ...splitterCommon, functionName: "creatorPayoutNonce" });
  const protocolTreasuryRead = useReadContract({ ...splitterCommon, functionName: "protocolTreasury" });
  const launchTokenRead = useReadContract({ ...splitterCommon, functionName: "launchToken" });
  const authorizedMarketRead = useReadContract({ ...splitterCommon, functionName: "authorizedMarket" });
  const splitterAdapterRead = useReadContract({ ...splitterCommon, functionName: "graduationAdapter" });
  const creatorShareRead = useReadContract({ ...splitterCommon, functionName: "creatorShareBps" });
  const factoryPayoutAuthorityRead = useReadContract({
    address: factoryAddress ?? fallbackAddress,
    abi: rmtLaunchFactoryV6Abi,
    functionName: "creatorPayoutAuthority",
    chainId: activeChain.id,
    query: { enabled: Boolean(factoryAddress) && splitterEnabled, retry: false, refetchInterval: 30_000 }
  });
  const nativeReceivedRead = useReadContract({ ...splitterCommon, functionName: "totalReceived" });
  const nativePaidRead = useReadContract({ ...splitterCommon, functionName: "totalPaid" });
  const tokenReceivedRead = useReadContract({ ...splitterCommon, functionName: "totalTokenReceived", args: [tokenAddress] });
  const tokenPaidRead = useReadContract({ ...splitterCommon, functionName: "totalTokenPaid", args: [tokenAddress] });
  const pendingNativeRead = useReadContract({
    ...splitterCommon,
    functionName: "pending",
    args: [account ?? fallbackAddress],
    query: { enabled: splitterEnabled && Boolean(account), retry: false, refetchInterval: 10_000 }
  });
  const pendingTokenRead = useReadContract({
    ...splitterCommon,
    functionName: "pendingToken",
    args: [tokenAddress, account ?? fallbackAddress],
    query: { enabled: splitterEnabled && Boolean(account), retry: false, refetchInterval: 10_000 }
  });

  const marketEnabled = Boolean(launchRecord.data);
  const marketGraduatedRead = useReadContract({
    address: market,
    abi: bondingCurveMarketV6FeeAbi,
    functionName: "graduated",
    chainId: activeChain.id,
    query: { enabled: marketEnabled, retry: false, refetchInterval: 10_000 }
  });
  const adapterRead = useReadContract({
    address: market,
    abi: bondingCurveMarketV6FeeAbi,
    functionName: "graduationAdapter",
    chainId: activeChain.id,
    query: { enabled: marketEnabled, retry: false, refetchInterval: 30_000 }
  });
  const adapter = adapterRead.data ?? fallbackAddress;
  const adapterEnabled = Boolean(adapterRead.data && adapterRead.data !== fallbackAddress);
  const adapterGraduatedRead = useReadContract({
    address: adapter,
    abi: v4GraduationFeeCollectorAbi,
    functionName: "isGraduated",
    args: [tokenAddress],
    chainId: activeChain.id,
    query: { enabled: adapterEnabled, retry: false, refetchInterval: 10_000 }
  });
  const adapterSplitterRead = useReadContract({
    address: adapter,
    abi: v4GraduationFeeCollectorAbi,
    functionName: "feeSplitters",
    args: [tokenAddress],
    chainId: activeChain.id,
    query: { enabled: adapterEnabled, retry: false, refetchInterval: 30_000 }
  });
  const adapterMarketRead = useReadContract({
    address: adapter,
    abi: v4GraduationFeeCollectorAbi,
    functionName: "markets",
    args: [tokenAddress],
    chainId: activeChain.id,
    query: { enabled: adapterEnabled, retry: false, refetchInterval: 30_000 }
  });
  const adapterFactoryRead = useReadContract({
    address: adapter,
    abi: v4GraduationFeeCollectorAbi,
    functionName: "factory",
    chainId: activeChain.id,
    query: { enabled: adapterEnabled, retry: false, refetchInterval: 30_000 }
  });
  const adapterPoolFeeRead = useReadContract({
    address: adapter,
    abi: v4GraduationFeeCollectorAbi,
    functionName: "poolFee",
    chainId: activeChain.id,
    query: { enabled: adapterEnabled, retry: false, refetchInterval: 30_000 }
  });
  const adapterLaunchFeeRead = useReadContract({
    address: adapter,
    abi: v4GraduationFeeCollectorAbi,
    functionName: "postGraduationFeeBps",
    args: [tokenAddress],
    chainId: activeChain.id,
    query: { enabled: adapterEnabled, retry: false, refetchInterval: 30_000 }
  });
  const lockedLiquidityRead = useReadContract({
    address: adapter,
    abi: v4GraduationFeeCollectorAbi,
    functionName: "lockedLiquidity",
    args: [tokenAddress],
    chainId: activeChain.id,
    query: { enabled: adapterEnabled, retry: false, refetchInterval: 30_000 }
  });

  const coreReads = [
    originalCreatorRead,
    creatorRecipientRead,
    payoutAuthorityRead,
    payoutNonceRead,
    protocolTreasuryRead,
    launchTokenRead,
    authorizedMarketRead,
    splitterAdapterRead,
    creatorShareRead,
    factoryPayoutAuthorityRead,
    nativeReceivedRead,
    nativePaidRead,
    tokenReceivedRead,
    tokenPaidRead,
    marketGraduatedRead,
    adapterRead,
    adapterGraduatedRead,
    adapterSplitterRead,
    adapterMarketRead,
    adapterFactoryRead,
    adapterPoolFeeRead,
    adapterLaunchFeeRead,
    lockedLiquidityRead
  ];
  const accountReads = account ? [pendingNativeRead, pendingTokenRead] : [];
  const loading = launchRecord.isLoading || coreReads.some((read) => read.isLoading) || accountReads.some((read) => read.isLoading);
  const readFailed = coreReads.some((read) => read.isError) || accountReads.some((read) => read.isError);
  const missingRequiredData = !loading && coreReads.some((read) => read.data === undefined);

  const bindingValid = Boolean(
    launchRecord.data
    && sameAddress(originalCreatorRead.data, launchRecord.data.creator)
    && sameAddress(launchTokenRead.data, tokenAddress)
    && sameAddress(authorizedMarketRead.data, launchRecord.data.market)
    && sameAddress(splitterAdapterRead.data, adapterRead.data)
    && sameAddress(adapterSplitterRead.data, feeSplitter ?? undefined)
    && sameAddress(adapterMarketRead.data, launchRecord.data.market)
    && sameAddress(adapterFactoryRead.data, factoryAddress ?? undefined)
    && adapterPoolFeeRead.data === canonicalV4PoolFee
    && adapterLaunchFeeRead.data === canonicalPostGraduationFeeBps
    && launchRecord.data.curveFeeBps === canonicalCurveFeeBps
    && launchRecord.data.rewardBps[0] === canonicalCreatorShareBps
    && launchRecord.data.rewardBps[4] === canonicalProtocolShareBps
    && launchRecord.data.postGraduationFeeBps === canonicalPostGraduationFeeBps
    && launchRecord.data.graduationTarget === canonicalGraduationTarget
    && launchRecord.data.policyVersion === 1
    && (
      (
        launchRecord.data.policyId === fairPolicyId
        && launchRecord.data.fairStartEnabled
        && launchRecord.data.fairStartDelayBlocks === 1n
        && launchRecord.data.fairStartDurationBlocks === 10n
        && launchRecord.data.fairStartMaxTxBps === 100
        && launchRecord.data.fairStartMaxWalletBps === 300
      )
      || (
        launchRecord.data.policyId === openPolicyId
        && !launchRecord.data.fairStartEnabled
        && launchRecord.data.fairStartDelayBlocks === 0n
        && launchRecord.data.fairStartDurationBlocks === 0n
        && launchRecord.data.fairStartMaxTxBps === 0
        && launchRecord.data.fairStartMaxWalletBps === 0
      )
    )
    && creatorShareRead.data === canonicalCreatorShareBps
    && sameAddress(payoutAuthorityRead.data, factoryPayoutAuthorityRead.data)
    && sameAddress(protocolTreasuryRead.data, factoryPayoutAuthorityRead.data)
    && (sameAddress(creatorRecipientRead.data, originalCreatorRead.data) || sameAddress(creatorRecipientRead.data, protocolTreasuryRead.data))
  );

  const nativeReceived = nativeReceivedRead.data ?? 0n;
  const nativePaid = nativePaidRead.data ?? 0n;
  const tokenReceived = tokenReceivedRead.data ?? 0n;
  const tokenPaid = tokenPaidRead.data ?? 0n;
  const nativeDeferred = nativeReceived >= nativePaid ? nativeReceived - nativePaid : 0n;
  const tokenDeferred = tokenReceived >= tokenPaid ? tokenReceived - tokenPaid : 0n;
  const pendingNative = pendingNativeRead.data ?? 0n;
  const pendingToken = pendingTokenRead.data ?? 0n;
  const creatorShareBps = Number(creatorShareRead.data ?? 0);
  const protocolShareBps = 10_000 - creatorShareBps;
  const recipientRedirected = !sameAddress(originalCreatorRead.data, creatorRecipientRead.data);
  const migratedToV4 = adapterGraduatedRead.data === true;
  const busy = isPending || isConfirming;

  useEffect(() => {
    if (!actionConfirmed) return;
    void Promise.all([
      marketGraduatedRead.refetch(),
      adapterGraduatedRead.refetch(),
      lockedLiquidityRead.refetch()
    ]);
  }, [actionConfirmed]);

  function claimNative() {
    if (!feeSplitter || pendingNative === 0n) return;
    setLastAction("native");
    writeContract({ address: feeSplitter, abi: directLaunchFeeSplitterV6Abi, functionName: "claimDeferred", chainId: activeChain.id });
  }

  function claimToken() {
    if (!feeSplitter || pendingToken === 0n) return;
    setLastAction("token");
    writeContract({ address: feeSplitter, abi: directLaunchFeeSplitterV6Abi, functionName: "claimDeferredToken", args: [tokenAddress], chainId: activeChain.id });
  }

  function collectPostGraduationFees() {
    if (!adapterEnabled || !migratedToV4 || !bindingValid) return;
    setLastAction("collect");
    writeContract({ address: adapter, abi: v4GraduationFeeCollectorAbi, functionName: "collectFees", args: [tokenAddress], chainId: activeChain.id });
  }

  function finalizeGraduation() {
    if (!account || marketGraduatedRead.data !== true || migratedToV4 || !bindingValid) return;
    setLastAction("migrate");
    writeContract({ address: market, abi: bondingCurveMigrationAbi, functionName: "migrateLiquidity", chainId: activeChain.id });
  }

  if (!factoryAddress) return panelMessage("Awaiting factory registry", `Fee accounting activates after the verified factory is available on ${activeNetworkLabel}.`);
  if (launchRecord.error) return panelMessage("Fee splitter unavailable", launchRecord.error instanceof Error ? launchRecord.error.message : "The V6 launch record could not be read.");
  if (launchRecord.isSuccess && !launchRecord.data) return panelMessage("No active V6 launch record", "This fee dashboard is available only for tokens emitted by the active V6 factory. No fee balances are being assumed.");
  if (!feeSplitter || loading) return panelMessage("Reading V6 fee accounting…", "Verifying the splitter, payout recipients, graduation adapter, and both fee assets onchain.");
  if (readFailed || missingRequiredData || !bindingValid) return panelMessage("Fee configuration could not be verified", "One or more required V6 bindings or accounting reads failed. The dashboard is hidden rather than displaying unverified zero balances.");

  const splitterExplorer = `${activeChain.blockExplorers.default.url}/address/${feeSplitter}`;
  const addressExplorer = (address: Address) => `${activeChain.blockExplorers.default.url}/address/${address}`;
  const txExplorer = (hash: Hash) => `${activeChain.blockExplorers.default.url}/tx/${hash}`;
  const actionName = lastAction === "migrate" ? "V4 graduation" : lastAction === "collect" ? "Fee collection" : lastAction === "token" ? `${symbol} claim` : "ETH claim";
  const originalCreator = originalCreatorRead.data as Address;
  const creatorRecipient = creatorRecipientRead.data as Address;
  const protocolTreasury = protocolTreasuryRead.data as Address;
  const payoutAuthority = payoutAuthorityRead.data as Address;

  return (
    <section className="panel rewardDashboard">
      <div className="sectionTitle"><div><p className="eyebrow">V6 FEE SPLITTER</p><h2>Transparent fee distribution</h2></div><span className={`badge ${recipientRedirected ? "warning" : "liveBadge"}`}>{recipientRedirected ? "RMT DIRECTED" : "ONCHAIN"}</span></div>

      <div className="feeRecipientGrid">
        <a href={addressExplorer(originalCreator)} target="_blank" rel="noreferrer"><small>Original launch creator</small><strong>{shortAddress(originalCreator)}</strong><span>Permanent token record ↗</span></a>
        <a href={addressExplorer(creatorRecipient)} target="_blank" rel="noreferrer"><small>Current creator-share recipient</small><strong>{shortAddress(creatorRecipient)}</strong><span>{creatorShareBps / 100}% of collected fees ↗</span></a>
        <a href={addressExplorer(protocolTreasury)} target="_blank" rel="noreferrer"><small>RMT treasury</small><strong>{shortAddress(protocolTreasury)}</strong><span>{protocolShareBps / 100}% of collected fees ↗</span></a>
        <a href={addressExplorer(payoutAuthority)} target="_blank" rel="noreferrer"><small>Future-payout authority</small><strong>{shortAddress(payoutAuthority)}</strong><span>Delayed governance ↗</span></a>
      </div>

      <div className="feeAssetGrid">
        <article><header><span>Native fees</span><strong>ETH</strong></header><dl><dt>Received</dt><dd>{amount(nativeReceived, "ETH")}</dd><dt>Distributed</dt><dd>{amount(nativePaid, "ETH")}</dd><dt>Deferred</dt><dd>{amount(nativeDeferred, "ETH")}</dd></dl></article>
        <article><header><span>Token fees</span><strong>{symbol}</strong></header><dl><dt>Received</dt><dd>{amount(tokenReceived, symbol)}</dd><dt>Distributed</dt><dd>{amount(tokenPaid, symbol)}</dd><dt>Deferred</dt><dd>{amount(tokenDeferred, symbol)}</dd></dl></article>
      </div>

      <div className="callout feeAuthorityNote"><strong>{recipientRedirected ? "Future collected creator-share fees currently route to RMT" : "Creator payout control is narrowly governed"}</strong><span>The token creator cannot authorize, propose, choose, or directly change a payout recipient. The RMT signer may propose only an evidence-linked move between the immutable original creator and V6 governance treasury. After 24 hours, any account may relay the exact approved call but cannot alter it or receive funds. Because the treasury is the governance contract, stale-nonce invalidation also requires an approved delayed governance call. Previously paid or deferred ETH and token fees remain with the wallet that earned them. Uncollected pool fees use the recipient active when collection occurs, even if some accrued earlier.</span></div>

      <div className="callout postGraduationFees">
        <strong>{migratedToV4 ? "Post-graduation fees are ready for permissionless collection" : marketGraduatedRead.data ? "Curve complete; V4 migration is still pending" : "Post-graduation fee collection begins after migration"}</strong>
        <span>{migratedToV4 ? `The locked V4 position may earn ETH and/or ${symbol} fees depending on swap direction. These are swap fees, not a token allocation. Collection realizes the LP fees actually earned by the canonical pool through this same ${creatorShareBps / 100}/${protocolShareBps / 100} splitter; it does not remove liquidity principal. A separate PoolManager protocol fee, if enabled, is removed upstream. Fees do not reach recipients until someone collects them.` : marketGraduatedRead.data ? `The curve is permanently closed. Any connected wallet may now submit the one-time transaction that moves only the market's tracked ETH reserve and ${symbol} inventory into the canonical locked V4 position. The caller receives no tokens, ETH, liquidity, or reward.` : "No post-graduation fees are being represented as distributed before the adapter confirms migration."}</span>
        {marketGraduatedRead.data && !migratedToV4 && <button type="button" disabled={!account || busy} onClick={finalizeGraduation}>{!account ? "Connect wallet to finalize V4 graduation" : busy && lastAction === "migrate" ? isPending ? "Confirm graduation…" : "Finalizing graduation…" : "Finalize V4 graduation"}</button>}
        {marketGraduatedRead.data && !migratedToV4 && <small>Permissionless one-time action · caller receives no funds or ownership · network gas applies · liquidity principal becomes permanently locked</small>}
        {migratedToV4 && <button type="button" disabled={!account || busy} onClick={collectPostGraduationFees}>{!account ? "Connect wallet to collect" : busy && lastAction === "collect" ? isPending ? "Confirm collection…" : "Collecting fees…" : "Collect post-graduation fees"}</button>}
        {migratedToV4 && <small>Permissionless action · the caller cannot choose recipients · network gas applies · locked liquidity: {lockedLiquidityRead.data?.toString()}</small>}
      </div>

      <div className="claimGrid">
        <div className="claimBox"><div><small>Your deferred ETH</small><strong>{account ? amount(pendingNative, "ETH", 8) : "Connect wallet"}</strong><span>Most wallets receive fees directly; claims are the transfer-failure fallback.</span></div><button disabled={!account || pendingNative === 0n || busy} onClick={claimNative}>{busy && lastAction === "native" ? isPending ? "Confirm claim…" : "Claiming…" : "Claim ETH"}</button></div>
        <div className="claimBox"><div><small>Your deferred {symbol}</small><strong>{account ? amount(pendingToken, symbol, 8) : "Connect wallet"}</strong><span>Token fees remain owned by the recipient that originally earned them.</span></div><button disabled={!account || pendingToken === 0n || busy} onClick={claimToken}>{busy && lastAction === "token" ? isPending ? "Confirm claim…" : "Claiming…" : `Claim ${symbol}`}</button></div>
      </div>

      {actionError && <div className="errors"><span>{actionError.message}</span></div>}
      {actionHash && <div className="callout"><strong>{actionConfirmed ? `${actionName} confirmed` : `${actionName} submitted`}</strong><a href={txExplorer(actionHash)} target="_blank" rel="noreferrer">View transaction ↗</a></div>}
      <a className="explorerLink" href={splitterExplorer} target="_blank" rel="noreferrer">Open fee splitter in explorer ↗</a>
    </section>
  );
}
