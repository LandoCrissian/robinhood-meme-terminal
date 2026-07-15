"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { formatEther, parseEventLogs } from "viem";
import { useAccount, useChainId, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { activeChain, activeNetworkLabel, isMainnetRelease } from "../lib/network";
import { rmtLaunchFactoryV6Abi } from "../lib/contracts";
import { useFactoryAddress } from "../lib/use-factory-address";
import { launchSchema } from "../lib/launch-schema";
import { fairStartDisclosure, formatBasisPoints } from "../lib/launch-capabilities";
import {
  SIMPLE_FAIR_V1_POLICY_ID,
  SIMPLE_OPEN_V1_POLICY_ID,
  useLaunchCapabilities
} from "../lib/use-launch-capabilities";

const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const maxImageBytes = 5_000_000;

export function LaunchForm() {
  const { isConnected, address: account } = useAccount();
  const chainId = useChainId();
  const factoryAddress = useFactoryAddress();
  const capabilityRead = useLaunchCapabilities(factoryAddress);
  const capabilities = capabilityRead.capabilities;
  const { writeContract, isPending, data: transactionHash, error: writeError } = useWriteContract();
  const { data: receipt, isLoading: isConfirming, error: receiptError } = useWaitForTransactionReceipt({ hash: transactionHash, chainId: activeChain.id });
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const supply = "1000000000";
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [telegram, setTelegram] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [fairStart, setFairStart] = useState(true);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [mediaStatus, setMediaStatus] = useState<"idle" | "uploading" | "saved">("idle");
  const [mediaError, setMediaError] = useState("");
  const [officialIntent, setOfficialIntent] = useState(false);
  const normalizedName = name.trim();
  const normalizedSymbol = symbol.trim();
  const selectedPolicyId = fairStart ? SIMPLE_FAIR_V1_POLICY_ID : SIMPLE_OPEN_V1_POLICY_ID;
  const selectedPolicy = capabilities?.policies.find(
    (policy) => policy.policyId.toLowerCase() === selectedPolicyId.toLowerCase()
  );
  const nameUsedRead = useReadContract({ address: factoryAddress ?? undefined, abi: rmtLaunchFactoryV6Abi, functionName: "isNameUsed", args: [normalizedName], chainId: activeChain.id, query: { enabled: Boolean(factoryAddress && capabilities && normalizedName), retry: false } });
  const symbolUsedRead = useReadContract({ address: factoryAddress ?? undefined, abi: rmtLaunchFactoryV6Abi, functionName: "isSymbolUsed", args: [normalizedSymbol], chainId: activeChain.id, query: { enabled: Boolean(factoryAddress && capabilities && normalizedSymbol), retry: false } });
  const isOfficialIdentity = normalizedName === "Robinhood Meme Terminal" && normalizedSymbol === "RMT";
  const officialMigrationRead = useReadContract({
    address: factoryAddress ?? undefined,
    abi: rmtLaunchFactoryV6Abi,
    functionName: "canMigrateOfficialIdentity",
    args: account ? [account, selectedPolicyId, normalizedName, normalizedSymbol] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(capabilities && account && isOfficialIdentity), retry: false }
  });
  const officialMigrationAvailable = officialMigrationRead.data === true;
  const launchesPaused = !capabilities || capabilities.launchesPaused;
  const officialPausedLaunch = launchesPaused && officialMigrationAvailable;
  const selectedPolicyReady = Boolean(selectedPolicy?.enabled && selectedPolicy.publiclySelectable);
  const nameUnavailable = nameUsedRead.data === true && !officialMigrationAvailable;
  const symbolUnavailable = symbolUsedRead.data === true && !officialMigrationAvailable;
  const identityUnavailable = nameUnavailable || symbolUnavailable;
  const lockOfficialFields = officialIntent && launchesPaused;

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("official") !== "v6") return;
    setOfficialIntent(true);
    setName("Robinhood Meme Terminal");
    setSymbol("RMT");
    setFairStart(true);
  }, []);

  useEffect(() => {
    if (!image) { setImagePreview(""); return; }
    const url = URL.createObjectURL(image);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    // Switching into or out of the official path changes the acknowledgement text materially.
    setAccepted(false);
  }, [officialPausedLaunch]);

  const formattedSupply = useMemo(() => {
    try { return BigInt(supply || "0").toLocaleString(); } catch { return "Invalid"; }
  }, [supply]);

  const deployed = useMemo(() => {
    if (!receipt || receipt.status !== "success") return null;
    const events = parseEventLogs({ abi: rmtLaunchFactoryV6Abi, eventName: "TokenLaunchedV6", logs: receipt.logs, strict: true });
    const event = events[0];
    return event ? { token: event.args.token, feeSplitter: event.args.feeSplitter, launchId: event.args.launchId } : null;
  }, [receipt]);

  const readiness = capabilityRead.loading ? "Verifying V6 launch configuration…" : officialPausedLaunch ? "Review and launch official RMT" : launchesPaused ? "New launches temporarily paused" : !selectedPolicyReady ? "Selected policy unavailable" : nameUnavailable ? "Token name already protected" : symbolUnavailable ? "Ticker already protected" : !isConnected ? "Connect wallet" : chainId !== activeChain.id ? `Switch to ${activeNetworkLabel}` : "Review and launch";

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
    if ((launchesPaused && !officialPausedLaunch) || !selectedPolicyReady) return;
    const values = { name, symbol, supply, description, website, x: xUrl, telegram, accepted };
    const parsed = launchSchema.safeParse(values);
    if (!parsed.success) {
      setValidationErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }
    if (!factoryAddress || !capabilities || !selectedPolicy || !isConnected || chainId !== activeChain.id) return;
    setValidationErrors([]);
    setMediaError("");
    const launchName = officialPausedLaunch ? "Robinhood Meme Terminal" : parsed.data.name;
    const launchSymbol = officialPausedLaunch ? "RMT" : parsed.data.symbol;
    let metadata: string;
    if (image) {
      try { metadata = await uploadMetadata(launchName, launchSymbol, parsed.data.description); }
      catch (error) { setMediaStatus("idle"); setMediaError(error instanceof Error ? error.message : "Token media upload failed."); return; }
    } else {
      metadata = `data:application/json,${encodeURIComponent(JSON.stringify({ name: launchName, symbol: launchSymbol, description: parsed.data.description, website: parsed.data.website || undefined, x: parsed.data.x || undefined, telegram: parsed.data.telegram || undefined }))}`;
    }
    if (new TextEncoder().encode(metadata).length > 512) {
      setMediaError("Metadata is too large for an onchain launch link. Add an image to save metadata to IPFS, or shorten the description and links.");
      return;
    }
    if (officialPausedLaunch) {
      writeContract({
        address: factoryAddress,
        abi: rmtLaunchFactoryV6Abi,
        functionName: "launchOfficialWhilePaused",
        args: [metadata],
        chainId: activeChain.id
      });
    } else {
      writeContract({
        address: factoryAddress,
        abi: rmtLaunchFactoryV6Abi,
        functionName: "launch",
        args: [selectedPolicy.policyId, parsed.data.name, parsed.data.symbol, metadata],
        chainId: activeChain.id
      });
    }
  }

  return (
    <section className="panel">
      <div className="sectionTitle"><div><p className="eyebrow">TOKEN LAUNCH</p><h2>Configure your token</h2></div><span className="badge">{isMainnetRelease ? "MAINNET · REAL ETH" : "TESTNET ALPHA"}</span></div>
      {launchesPaused && <div className="callout mainnetWarning"><strong>{officialPausedLaunch ? "Public launches remain paused" : "New launches are temporarily paused"}</strong><span>{officialPausedLaunch ? "The verified RMT wallet may complete the one-time official V6 launch without opening creation to anyone else." : "V6 is being verified before public creation reopens. Trading and read-only terminal features remain available."}</span></div>}
      {lockOfficialFields && !officialPausedLaunch && <div className="callout mainnetWarning"><strong>Official RMT launch is prefilled</strong><span>Connect the RMTMain wallet on the active V6 network. The site will verify the one-time migration permission before enabling the launch.</span></div>}
      {officialPausedLaunch && <div className="callout mainnetWarning"><strong>New token contract—no old-holder migration</strong><span>This action creates a new RMT contract with a new address and new fixed supply of 1,000,000,000 tokens. It does not copy, swap, credit, or migrate any old V5 holder balance. The old RMT contract is used only as the exact identity/provenance anchor. RMTMain receives the ordinary 70% creator fee share; the separate V6 governance treasury receives 30%.</span></div>}
      {capabilityRead.error && <div className="errors"><span>{capabilityRead.error} Launching is disabled safely.</span></div>}
      <label>Token name<input value={name} maxLength={32} placeholder="Name your token" readOnly={lockOfficialFields} aria-readonly={lockOfficialFields} aria-invalid={nameUnavailable} onChange={(e) => setName(e.target.value)} />{normalizedName && <span className={nameUnavailable ? "identityStatus unavailable" : nameUsedRead.data === false ? "identityStatus available" : "identityStatus"} aria-live="polite">{nameUnavailable ? "Already protected — choose a unique name" : nameUsedRead.data === false ? "Name available" : "Checking name…"}</span>}</label>
      <div className="two"><label>Ticker<input value={symbol} maxLength={10} placeholder="TICKER" readOnly={lockOfficialFields} aria-readonly={lockOfficialFields} aria-invalid={symbolUnavailable} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />{normalizedSymbol && <span className={symbolUnavailable ? "identityStatus unavailable" : symbolUsedRead.data === false ? "identityStatus available" : "identityStatus"} aria-live="polite">{symbolUnavailable ? "Already protected — choose a unique ticker" : symbolUsedRead.data === false ? "Ticker available" : "Checking ticker…"}</span>}</label><label>Platform supply<input inputMode="numeric" value={supply} readOnly aria-readonly="true" /></label></div>
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
      <div className="presetSection">
        <p className="eyebrow">LAUNCH PROTECTION</p>
        <button type="button" className={fairStart ? "preset active" : "preset"} disabled={lockOfficialFields} onClick={() => setFairStart((value) => !value)} aria-pressed={fairStart}>
          <strong>Fair Start Protection · {fairStart ? "On" : "Off"}</strong>
          <span>{selectedPolicy ? fairStartDisclosure(selectedPolicy) : "Temporary opening protection can be selected after V6 verification."}</span>
          <small>{fairStart ? "Recommended for a more balanced opening" : "Trading opens without temporary wallet limits"}</small>
        </button>
        {selectedPolicy && <div className="graduationNote">
          <strong>Fixed fee percentages</strong>
          <span>{formatBasisPoints(selectedPolicy.curveFeeBps)} curve fee · {formatBasisPoints(selectedPolicy.creatorFeeShareBps)} creator-share bucket · {formatBasisPoints(selectedPolicy.protocolFeeShareBps)} to RMT · {formatEther(selectedPolicy.graduationTarget)} ETH graduation target.</span>
          <span>After graduation, the locked V4 position charges {formatBasisPoints(selectedPolicy.postGraduationFeeBps)} and can earn fees in ETH and ${normalizedSymbol || "TOKEN"}. Collected fees use the same split; liquidity principal is not distributed.</span>
          <span>The token creator cannot authorize, propose, choose, or directly change the payout recipient. The RMT signer may propose only an evidence-linked move between the original creator and immutable V6 governance treasury. After 24 hours, any account may relay the exact approved call but cannot alter it or receive funds. Previously paid or deferred fees stay with the wallet that earned them. For uncollected pool fees, the active recipient at collection time receives the creator share.</span>
        </div>}
      </div>
      <div className="summary"><div><small>Token</small><strong>{name || "Unnamed"}</strong></div><div><small>Symbol</small><strong>${symbol || "—"}</strong></div><div><small>Supply</small><strong>{formattedSupply}</strong></div></div>
      <label className="confirm"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /><span>{officialPausedLaunch ? "I understand this official V6 launch creates a new token address and new one-billion-token supply; no old V5 balance is copied, swapped, credited, or migrated. RMTMain receives 70% of fees and the separate V6 governance treasury receives 30%." : "I understand the supply and fee percentages are permanent. The creator cannot authorize or choose a payout change; the RMT signer can propose only the two fixed destinations with public evidence and replay protection, and any account may relay the exact approved call after 24 hours. Earlier payments or deferred balances cannot be moved."}</span></label>
      {isMainnetRelease && <div className="callout mainnetWarning"><strong>Mainnet uses real ETH</strong><span>Review the token details and wallet gas estimate before signing. Launch settings are permanent.</span></div>}
      {validationErrors.length > 0 && <div className="errors">{validationErrors.map((error) => <span key={error}>{error}</span>)}</div>}
      {(writeError || receiptError) && <div className="errors"><span>{writeError?.message || receiptError?.message}</span></div>}
      {transactionHash && !deployed && <div className="callout"><strong>{isConfirming ? "Waiting for confirmation…" : "Transaction submitted"}</strong><a href={`${activeChain.blockExplorers.default.url}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction ↗</a></div>}
      {deployed && <div className="launchSuccess"><strong>Launch #{deployed.launchId.toString()} confirmed</strong><span>Token, market, and fee splitter were created in one transaction.</span><Link href={`/token/${deployed.token}`}>Open token page →</Link></div>}
      <button className="launch" type="button" disabled={(launchesPaused && !officialPausedLaunch) || !selectedPolicyReady || identityUnavailable || !factoryAddress || !isConnected || chainId !== activeChain.id || isPending || isConfirming || mediaStatus === "uploading"} onClick={submit}>{mediaStatus === "uploading" ? "Saving token media…" : isPending ? "Confirm in wallet…" : isConfirming ? "Confirming onchain…" : readiness}</button>
      <p className="fineprint">No mint authority • No blacklist • No hidden transfer tax • Wallet-signed transactions only</p>
    </section>
  );
}
