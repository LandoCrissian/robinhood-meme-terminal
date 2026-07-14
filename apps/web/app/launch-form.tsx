"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { parseEventLogs, type Address } from "viem";
import { useAccount, useChainId, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { activeChain, activeNetworkLabel, isMainnetRelease, settlementBlockedFactoryAddress } from "../lib/network";
import { memeLaunchFactoryAbi } from "../lib/contracts";
import { useFactoryAddress } from "../lib/use-factory-address";
import { launchSchema } from "../lib/launch-schema";

const emptyAddress = "";
const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;
const rewardBps: readonly [number, number, number, number, number] = [3000, 2500, 1500, 1500, 1500];
type LaunchPreset = "simple" | "community";
const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const maxImageBytes = 5_000_000;
const officialMigrationAuthority = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA";

export function LaunchForm() {
  const { isConnected, address: account } = useAccount();
  const chainId = useChainId();
  const factoryAddress = useFactoryAddress();
  const { writeContract, isPending, data: transactionHash, error: writeError } = useWriteContract();
  const { data: receipt, isLoading: isConfirming, error: receiptError } = useWaitForTransactionReceipt({ hash: transactionHash, chainId: activeChain.id });
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const supply = "1000000000";
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [telegram, setTelegram] = useState("");
  const [communityTreasury, setCommunityTreasury] = useState(emptyAddress);
  const [traderRewards, setTraderRewards] = useState(emptyAddress);
  const [liquidityVault, setLiquidityVault] = useState(emptyAddress);
  const [platformTreasury, setPlatformTreasury] = useState(emptyAddress);
  const [accepted, setAccepted] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [preset, setPreset] = useState<LaunchPreset>("simple");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [mediaStatus, setMediaStatus] = useState<"idle" | "uploading" | "saved">("idle");
  const [mediaError, setMediaError] = useState("");
  const v2Read = useReadContract({ address: factoryAddress ?? undefined, abi: memeLaunchFactoryAbi, functionName: "purposeVaultImplementation", chainId: activeChain.id, query: { enabled: Boolean(factoryAddress), retry: false } });
  const v3Read = useReadContract({ address: factoryAddress ?? undefined, abi: memeLaunchFactoryAbi, functionName: "communityDestinationsForToken", args: [zeroAddress], chainId: activeChain.id, query: { enabled: Boolean(factoryAddress), retry: false } });
  const v3Available = v3Read.status === "success";
  const officialMigrationRead = useReadContract({ address: factoryAddress ?? undefined, abi: memeLaunchFactoryAbi, functionName: "officialMigrationAuthority", chainId: activeChain.id, query: { enabled: Boolean(factoryAddress) && isMainnetRelease, retry: false } });
  const officialMigrationCompleteRead = useReadContract({ address: factoryAddress ?? undefined, abi: memeLaunchFactoryAbi, functionName: "officialMigrationComplete", chainId: activeChain.id, query: { enabled: officialMigrationRead.status === "success", retry: false } });
  const normalizedName = name.trim();
  const normalizedSymbol = symbol.trim();
  const nameUsedRead = useReadContract({ address: factoryAddress ?? undefined, abi: memeLaunchFactoryAbi, functionName: "isNameUsed", args: [normalizedName], chainId: activeChain.id, query: { enabled: Boolean(factoryAddress && normalizedName), retry: false } });
  const symbolUsedRead = useReadContract({ address: factoryAddress ?? undefined, abi: memeLaunchFactoryAbi, functionName: "isSymbolUsed", args: [normalizedSymbol], chainId: activeChain.id, query: { enabled: Boolean(factoryAddress && normalizedSymbol), retry: false } });
  const simpleAvailable = Boolean(v2Read.data);
  const launchesPaused = isMainnetRelease && factoryAddress?.toLowerCase() === settlementBlockedFactoryAddress.toLowerCase();
  const isOfficialIdentity = normalizedName === "Robinhood Meme Terminal" && normalizedSymbol === "RMT";
  const officialMigrationAvailable =
    isOfficialIdentity
    && account?.toLowerCase() === officialMigrationAuthority.toLowerCase()
    && String(officialMigrationRead.data).toLowerCase() === officialMigrationAuthority.toLowerCase()
    && officialMigrationCompleteRead.data === false;
  const nameUnavailable = nameUsedRead.data === true && !officialMigrationAvailable;
  const symbolUnavailable = symbolUsedRead.data === true && !officialMigrationAvailable;
  const identityUnavailable = nameUnavailable || symbolUnavailable;

  useEffect(() => {
    if (!image) { setImagePreview(""); return; }
    const url = URL.createObjectURL(image);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const formattedSupply = useMemo(() => {
    try { return BigInt(supply || "0").toLocaleString(); } catch { return "Invalid"; }
  }, [supply]);

  const deployed = useMemo(() => {
    if (!receipt || receipt.status !== "success") return null;
    const events = parseEventLogs({ abi: memeLaunchFactoryAbi, eventName: "TokenLaunched", logs: receipt.logs, strict: true });
    const event = events[0];
    return event ? { token: event.args.token, rewardVault: event.args.rewardVault, launchId: event.args.launchId } : null;
  }, [receipt]);

  const readiness = launchesPaused ? "New launches temporarily paused" : nameUnavailable ? "Token name already protected" : symbolUnavailable ? "Ticker already protected" : !factoryAddress ? "Reading launch factory…" : !isConnected ? "Connect wallet" : chainId !== activeChain.id ? `Switch to ${activeNetworkLabel}` : "Review and launch";

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setMediaError("");
    setMediaStatus("idle");
    if (!file) { setImage(null); return; }
    if (!imageTypes.includes(file.type)) { setImage(null); setMediaError("Use a PNG, JPG, or WebP image."); return; }
    if (file.size > maxImageBytes) { setImage(null); setMediaError("Image must be 5 MB or smaller."); return; }
    setImage(file);
  }

  async function uploadMetadata(tokenName: string, tokenSymbol: string, tokenDescription: string) {
    if (!image) throw new Error("Choose a token image before launching.");
    setMediaStatus("uploading");
    const signResponse = await fetch("/api/media/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: image.name }) });
    const signResult = (await signResponse.json()) as { url?: string; error?: string };
    if (!signResponse.ok || !signResult.url) throw new Error(signResult.error || "Could not prepare image upload.");
    const imageForm = new FormData();
    imageForm.append("file", image);
    imageForm.append("network", "public");
    const imageResponse = await fetch(signResult.url, { method: "POST", body: imageForm });
    const imageResult = (await imageResponse.json()) as { data?: { cid?: string }; error?: string };
    const imageCid = imageResult.data?.cid;
    if (!imageResponse.ok || !imageCid) throw new Error(imageResult.error || "Image upload failed.");
    const metadataResponse = await fetch("/api/media/metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: tokenName, symbol: tokenSymbol, description: tokenDescription, image: `ipfs://${imageCid}`, website, x: xUrl, telegram }) });
    const metadataResult = (await metadataResponse.json()) as { uri?: string; error?: string };
    if (!metadataResponse.ok || !metadataResult.uri) throw new Error(metadataResult.error || "Metadata upload failed.");
    setMediaStatus("saved");
    return metadataResult.uri;
  }

  async function submit() {
    if (launchesPaused) return;
    const automaticAddress = account ?? emptyAddress;
    const useSimple = simpleAvailable && !advanced;
    const values = { name, symbol, supply, description, website, x: xUrl, telegram, communityTreasury: useSimple ? automaticAddress : communityTreasury, traderRewards: useSimple ? automaticAddress : traderRewards, liquidityVault: useSimple ? automaticAddress : liquidityVault, platformTreasury: useSimple ? automaticAddress : platformTreasury, accepted };
    const parsed = launchSchema.safeParse(values);
    if (!parsed.success) {
      setValidationErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }
    if (!factoryAddress || !isConnected || chainId !== activeChain.id) return;
    setValidationErrors([]);
    setMediaError("");
    let metadata: string;
    if (image) {
      try { metadata = await uploadMetadata(parsed.data.name, parsed.data.symbol, parsed.data.description); }
      catch (error) { setMediaStatus("idle"); setMediaError(error instanceof Error ? error.message : "Token media upload failed."); return; }
    } else {
      metadata = `data:application/json,${encodeURIComponent(JSON.stringify({ name: parsed.data.name, symbol: parsed.data.symbol, description: parsed.data.description, website: parsed.data.website || undefined, x: parsed.data.x || undefined, telegram: parsed.data.telegram || undefined }))}`;
    }
    if (officialMigrationAvailable && preset === "community") writeContract({ address: factoryAddress, abi: memeLaunchFactoryAbi, functionName: "launchOfficialCommunity", args: [metadata], chainId: activeChain.id });
    else if (officialMigrationAvailable) writeContract({ address: factoryAddress, abi: memeLaunchFactoryAbi, functionName: "launchOfficialSimple", args: [metadata], chainId: activeChain.id });
    else if (v3Available && preset === "community") writeContract({ address: factoryAddress, abi: memeLaunchFactoryAbi, functionName: "launchCommunity", args: [parsed.data.name, parsed.data.symbol, metadata], chainId: activeChain.id });
    else if (useSimple) writeContract({ address: factoryAddress, abi: memeLaunchFactoryAbi, functionName: "launchSimple", args: [parsed.data.name, parsed.data.symbol, metadata], chainId: activeChain.id });
    else writeContract({ address: factoryAddress, abi: memeLaunchFactoryAbi, functionName: "launch", args: [parsed.data.name, parsed.data.symbol, metadata, [parsed.data.communityTreasury, parsed.data.traderRewards, parsed.data.liquidityVault, parsed.data.platformTreasury] as [Address, Address, Address, Address], rewardBps], chainId: activeChain.id });
  }

  return (
    <section className="panel">
      <div className="sectionTitle"><div><p className="eyebrow">TOKEN LAUNCH</p><h2>Configure your token</h2></div><span className="badge">{isMainnetRelease ? "MAINNET · REAL ETH" : "TESTNET ALPHA"}</span></div>
      {launchesPaused && <div className="callout mainnetWarning"><strong>New launches are temporarily paused</strong><span>We are activating a reward-settlement upgrade. Existing tokens can still trade and eligible creator rewards remain claimable.</span></div>}
      <label>Token name<input value={name} maxLength={40} placeholder="Name your token" aria-invalid={nameUnavailable} onChange={(e) => setName(e.target.value)} />{normalizedName && <span className={nameUnavailable ? "identityStatus unavailable" : nameUsedRead.data === false ? "identityStatus available" : "identityStatus"} aria-live="polite">{nameUnavailable ? "Already protected — choose a unique name" : nameUsedRead.data === false ? "Name available" : "Checking name…"}</span>}</label>
      <div className="two"><label>Ticker<input value={symbol} maxLength={10} placeholder="TICKER" aria-invalid={symbolUnavailable} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />{normalizedSymbol && <span className={symbolUnavailable ? "identityStatus unavailable" : symbolUsedRead.data === false ? "identityStatus available" : "identityStatus"} aria-live="polite">{symbolUnavailable ? "Already protected — choose a unique ticker" : symbolUsedRead.data === false ? "Ticker available" : "Checking ticker…"}</span>}</label><label>Platform supply<input inputMode="numeric" value={supply} readOnly aria-readonly="true" /></label></div>
      <label>Description<textarea value={description} maxLength={500} placeholder="Tell traders what this token is about" onChange={(e) => setDescription(e.target.value)} /></label>
      <details className="socialFields"><summary>Add social links <span>Optional</span></summary><div>
        <label>Website<input type="url" inputMode="url" placeholder="https://yourproject.com" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
        <label>X profile<input type="url" inputMode="url" placeholder="https://x.com/yourproject" value={xUrl} onChange={(e) => setXUrl(e.target.value)} /></label>
        <label>Telegram<input type="url" inputMode="url" placeholder="https://t.me/yourproject" value={telegram} onChange={(e) => setTelegram(e.target.value)} /></label>
      </div></details>
      <div className="mediaField">
        <div className="mediaCopy"><span>Token image · Optional</span><small>PNG, JPG, or WebP · 5 MB maximum</small></div>
        <label className={imagePreview ? "imagePicker selected" : "imagePicker"}>
          <input type="file" accept={imageTypes.join(",")} onChange={selectImage} />
          {imagePreview ? <img src={imagePreview} alt="Token artwork preview" /> : <span className="imagePlaceholder"><strong>+</strong>Add artwork</span>}
          {imagePreview && <span className="imageReplace">Replace</span>}
        </label>
        {mediaStatus !== "idle" && <span className="mediaProgress">{mediaStatus === "uploading" ? "Saving artwork to IPFS…" : "Artwork and metadata saved"}</span>}
        {mediaError && <span className="mediaError">{mediaError}</span>}
      </div>
      {v3Available && <div className="presetSection"><p className="eyebrow">LAUNCH STYLE</p><div className="presetGrid">
        <button type="button" className={preset === "simple" ? "preset active" : "preset"} onClick={() => setPreset("simple")}><strong>Simple</strong><span>Launch instantly. No optional programs.</span><small>70% creator · 30% protocol</small></button>
        <button type="button" className={preset === "community" ? "preset active" : "preset"} onClick={() => setPreset("community")}><strong>Community</strong><span>Add community funding and trader rewards.</span><small>40% creator · 20% community · 10% traders · 30% protocol</small></button>
      </div><div className="graduationNote"><strong>{isMainnetRelease ? "Automatic Uniswap V4 graduation" : "Graduation-ready architecture"}</strong><span>{isMainnetRelease ? "Curve reserves stay inside the market and migrate automatically at the disclosed target." : "Curve reserves stay inside the market. DEX migration is intentionally disabled in this testnet alpha."}</span></div></div>}
      {!v3Available && simpleAvailable && <div className="callout"><strong>{advanced ? "Advanced rewards" : "Automatic rewards"}</strong><span>{advanced ? "You are manually choosing reward destinations." : "Creator, community, trader, liquidity, and platform destinations are assigned automatically."}</span><button type="button" onClick={() => setAdvanced((value) => !value)}>{advanced ? "Use simple launch" : "Open advanced settings"}</button></div>}
      {!v3Available && (!simpleAvailable || advanced) && <><p className="eyebrow addressHeading">REWARD DESTINATIONS</p>
      <label>Community treasury<input placeholder="0x…" value={communityTreasury} onChange={(e) => setCommunityTreasury(e.target.value)} /></label>
      <label>Trader rewards vault<input placeholder="0x…" value={traderRewards} onChange={(e) => setTraderRewards(e.target.value)} /></label>
      <label>Graduation liquidity vault<input placeholder="0x…" value={liquidityVault} onChange={(e) => setLiquidityVault(e.target.value)} /></label>
      <label>Platform treasury<input placeholder="0x…" value={platformTreasury} onChange={(e) => setPlatformTreasury(e.target.value)} /></label></>}
      <div className="summary"><div><small>Token</small><strong>{name || "Unnamed"}</strong></div><div><small>Symbol</small><strong>${symbol || "—"}</strong></div><div><small>Supply</small><strong>{formattedSupply}</strong></div></div>
      <label className="confirm"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /><span>I understand the supply, token rules, and selected fee split are permanent after launch.</span></label>
      {isMainnetRelease && <div className="callout mainnetWarning"><strong>Mainnet uses real ETH</strong><span>Review the token details and wallet gas estimate before signing. Launch settings are permanent.</span></div>}
      {validationErrors.length > 0 && <div className="errors">{validationErrors.map((error) => <span key={error}>{error}</span>)}</div>}
      {(writeError || receiptError) && <div className="errors"><span>{writeError?.message || receiptError?.message}</span></div>}
      {transactionHash && !deployed && <div className="callout"><strong>{isConfirming ? "Waiting for confirmation…" : "Transaction submitted"}</strong><a href={`${activeChain.blockExplorers.default.url}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction ↗</a></div>}
      {deployed && <div className="launchSuccess"><strong>Launch #{deployed.launchId.toString()} confirmed</strong><span>Token and reward vault were created in one transaction.</span><Link href={`/token/${deployed.token}`}>Open token page →</Link></div>}
      <button className="launch" type="button" disabled={launchesPaused || identityUnavailable || !factoryAddress || !isConnected || chainId !== activeChain.id || isPending || isConfirming || mediaStatus === "uploading"} onClick={submit}>{mediaStatus === "uploading" ? "Saving token media…" : isPending ? "Confirm in wallet…" : isConfirming ? "Confirming onchain…" : readiness}</button>
      <p className="fineprint">No mint authority • No blacklist • No hidden transfer tax • Wallet-signed transactions only</p>
    </section>
  );
}
