"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { parseEventLogs, type Address } from "viem";
import { useAccount, useChainId, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { robinhoodChainTestnet } from "@rmt/shared/chains";
import { memeLaunchFactoryAbi } from "../lib/contracts";
import { useFactoryAddress } from "../lib/use-factory-address";
import { launchSchema } from "../lib/launch-schema";

const emptyAddress = "";
const rewardBps: readonly [number, number, number, number, number] = [3000, 2500, 1500, 1500, 1500];

export function LaunchForm() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const factoryAddress = useFactoryAddress();
  const { writeContract, isPending, data: transactionHash, error: writeError } = useWriteContract();
  const { data: receipt, isLoading: isConfirming, error: receiptError } = useWaitForTransactionReceipt({ hash: transactionHash, chainId: robinhoodChainTestnet.id });
  const [name, setName] = useState("Robinhood Meme Terminal");
  const [symbol, setSymbol] = useState("RMT");
  const supply = "1000000000";
  const [description, setDescription] = useState("The genesis token launched through Robinhood Meme Terminal.");
  const [communityTreasury, setCommunityTreasury] = useState(emptyAddress);
  const [traderRewards, setTraderRewards] = useState(emptyAddress);
  const [liquidityVault, setLiquidityVault] = useState(emptyAddress);
  const [platformTreasury, setPlatformTreasury] = useState(emptyAddress);
  const [accepted, setAccepted] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const formattedSupply = useMemo(() => {
    try { return BigInt(supply || "0").toLocaleString(); } catch { return "Invalid"; }
  }, [supply]);

  const deployed = useMemo(() => {
    if (!receipt || receipt.status !== "success") return null;
    const events = parseEventLogs({ abi: memeLaunchFactoryAbi, eventName: "TokenLaunched", logs: receipt.logs, strict: true });
    const event = events[0];
    return event ? { token: event.args.token, rewardVault: event.args.rewardVault, launchId: event.args.launchId } : null;
  }, [receipt]);

  const readiness = !factoryAddress ? "Factory not deployed" : !isConnected ? "Connect wallet" : chainId !== robinhoodChainTestnet.id ? "Switch to Robinhood Testnet" : "Review and launch";

  function submit() {
    const values = { name, symbol, supply, description, communityTreasury, traderRewards, liquidityVault, platformTreasury, accepted };
    const parsed = launchSchema.safeParse(values);
    if (!parsed.success) {
      setValidationErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }
    if (!factoryAddress || !isConnected || chainId !== robinhoodChainTestnet.id) return;
    setValidationErrors([]);
    writeContract({
      address: factoryAddress,
      abi: memeLaunchFactoryAbi,
      functionName: "launch",
      args: [parsed.data.name, parsed.data.symbol, `data:application/json,${encodeURIComponent(JSON.stringify({ name: parsed.data.name, symbol: parsed.data.symbol, description: parsed.data.description }))}`, [parsed.data.communityTreasury, parsed.data.traderRewards, parsed.data.liquidityVault, parsed.data.platformTreasury] as [Address, Address, Address, Address], rewardBps]
    });
  }

  return (
    <section className="panel">
      <div className="sectionTitle"><div><p className="eyebrow">GENESIS LAUNCH</p><h2>Configure your token</h2></div><span className="badge">TESTNET GUARDED</span></div>
      <label>Token name<input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
      <div className="two"><label>Ticker<input value={symbol} maxLength={10} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /></label><label>Platform supply<input inputMode="numeric" value={supply} readOnly aria-readonly="true" /></label></div>
      <label>Description<textarea value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></label>
      <p className="eyebrow addressHeading">REWARD DESTINATIONS</p>
      <label>Community treasury<input placeholder="0x…" value={communityTreasury} onChange={(e) => setCommunityTreasury(e.target.value)} /></label>
      <label>Trader rewards vault<input placeholder="0x…" value={traderRewards} onChange={(e) => setTraderRewards(e.target.value)} /></label>
      <label>Graduation liquidity vault<input placeholder="0x…" value={liquidityVault} onChange={(e) => setLiquidityVault(e.target.value)} /></label>
      <label>Platform treasury<input placeholder="0x…" value={platformTreasury} onChange={(e) => setPlatformTreasury(e.target.value)} /></label>
      <div className="summary"><div><small>Token</small><strong>{name || "Unnamed"}</strong></div><div><small>Symbol</small><strong>${symbol || "—"}</strong></div><div><small>Supply</small><strong>{formattedSupply}</strong></div></div>
      <label className="confirm"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /><span>I understand supply, token rules, and reward destinations are permanent after deployment.</span></label>
      {validationErrors.length > 0 && <div className="errors">{validationErrors.map((error) => <span key={error}>{error}</span>)}</div>}
      {(writeError || receiptError) && <div className="errors"><span>{writeError?.message || receiptError?.message}</span></div>}
      {transactionHash && !deployed && <div className="callout"><strong>{isConfirming ? "Waiting for confirmation…" : "Transaction submitted"}</strong><a href={`${robinhoodChainTestnet.blockExplorers.default.url}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction ↗</a></div>}
      {deployed && <div className="launchSuccess"><strong>Launch #{deployed.launchId.toString()} confirmed</strong><span>Token and reward vault were created in one transaction.</span><Link href={`/token/${deployed.token}`}>Open token page →</Link></div>}
      <button className="launch" disabled={!factoryAddress || !isConnected || chainId !== robinhoodChainTestnet.id || isPending || isConfirming} onClick={submit}>{isPending ? "Confirm in wallet…" : isConfirming ? "Confirming onchain…" : readiness}</button>
      <p className="fineprint">No mint authority • No blacklist • No hidden transfer tax • Wallet-signed transactions only</p>
    </section>
  );
}
