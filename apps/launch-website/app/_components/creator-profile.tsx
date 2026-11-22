"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountApiError, accountApi } from "../../lib/account-api";
import { profileShareIntent, type PublicCreatorProfile } from "../../lib/profiles";
import { sameAccount } from "../../lib/profile-wallet";
import { NewEngineLaunches } from "./new-engine-launches";
import { ProfileAvatar, shortWallet } from "./wallet-account";
import { useAccount } from "./account-provider";
import { type CurveLaunch, type NewEngineDirectory } from "../../lib/curve-lifecycle";
import { robinhoodExplorer } from "./launch-evidence";

function httpsLink(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && value.length <= 512 ? url.href : null; }
  catch { return null; }
}

export function CreatorProfile({ username, walletAddress, initialProfile, reviewFeed }: { username?: string; walletAddress?: string; initialProfile?: PublicCreatorProfile; reviewFeed?: NewEngineDirectory }) {
  const { session, checking, refresh } = useAccount();
  const [copied,setCopied] = useState("");
  const [feedAttempt,setFeedAttempt] = useState(0);
  const [profile, setProfile] = useState<PublicCreatorProfile | undefined>(initialProfile), [status, setStatus] = useState<"loading" | "ready" | "missing" | "unavailable">(initialProfile ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);
  const [directory, setDirectory] = useState<NewEngineDirectory | null>(reviewFeed ?? null);
  useEffect(() => {
    if (initialProfile) { setProfile(initialProfile); setStatus("ready"); return; }
    const controller = new AbortController(); let active = true;
    setStatus("loading"); setProfile(undefined); setDirectory(null);
    accountApi<{ profile: PublicCreatorProfile }>(walletAddress ? `/api/account/creator/${walletAddress}` : `/api/account/public/${encodeURIComponent(username ?? "")}`, { signal: controller.signal })
      .then(({ profile: found }) => {
        if (!active) return;
        if (!found || found.chainId !== 4663 || !/^0x[0-9a-f]{40}$/i.test(found.walletAddress)
            || (walletAddress && !sameAccount(found.walletAddress, walletAddress)) || (username && found.username !== username)) throw new Error("Unverified profile identity");
        setProfile(found); setStatus("ready");
      }).catch((error) => { if (active) setStatus(error instanceof AccountApiError && error.status === 404 && error.availability === "available" ? "missing" : "unavailable"); });
    return () => { active = false; controller.abort(); };
  }, [username, walletAddress, initialProfile, attempt]);
  const creator = profile?.walletAddress ?? walletAddress;
  useEffect(() => {
    if (reviewFeed) { setDirectory(reviewFeed); return; }
    if (!creator) return;
    const controller = new AbortController(); let active = true;
    fetch("/api/launchpad/new-engine", { cache: "no-store", redirect: "error", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok && response.status !== 503) throw new Error("Unavailable launch evidence");
        const data = await response.json() as { status: string; checkpoint?:{timestamp:string}; launches?: Array<CurveLaunch | { creator: string }> };
        if (!active) return;
        if (data.status === "stale") { setDirectory({status:"stale",history:[]}); return; }
        if (!response.ok || data.status !== "ready" || !Array.isArray(data.launches) || data.launches.length > 25) throw new Error("Unavailable launch evidence");
        // Public profile content never establishes project ownership. Only this
        // canonical new-engine read supplies the creator-to-launch relationship.
        const launches: CurveLaunch[] = data.launches.flatMap((row) => {
          if ("registration" in row) return sameAccount(row.registration.creator, creator) ? [row] : [];
          return sameAccount(row.creator, creator) ? [{ registration: row as unknown as CurveLaunch["registration"], state: "created" as const }] : [];
        });
        setDirectory({ status: "ready", launches, freshUntil:data.checkpoint ? Date.parse(data.checkpoint.timestamp)+120000 : undefined });
      }).catch(() => { if (active) setDirectory({ status: "unavailable" }); });
    return () => { active = false; controller.abort(); };
  }, [creator,feedAttempt,reviewFeed]);
  const own = creator && session.authenticated && sameAccount(session.account.walletAddress, creator);
  const label = profile?.displayName || profile?.username || (creator ? shortWallet(creator) : username);
  const destinations = [...(profile?.xHandle ? [{label:"@"+profile.xHandle+" on X",url:"https://x.com/"+profile.xHandle}] : []), ...(profile?.links || [])];
  return <div className="lpReading lpCreatorIdentity">
    <Link className="lpUtility lpBreadcrumb" href="/people" prefetch={false}>← People</Link>
    {status === "loading" ? <p className="lpSkeleton" role="status">Loading creator profile…</p> :
      status !== "ready" ? <section className="lpNotice"><h1>{status === "missing" ? "Profile unavailable" : "Couldn’t load profile"}</h1>
        <p>{status === "missing" ? "This creator hasn’t published a profile at this address." : "Check your connection and try again."}</p>
        {status === "unavailable" && <button className="lpUtility" onClick={()=>setAttempt(n=>n+1)}>Try again</button>}</section> :
      profile && <article className="lpIdentityCard">
        <header className="lpIdentityHead"><ProfileAvatar name={label || "R"} url={profile.avatarUrl} size={76} />
          <div><h1>{label}</h1>{profile.username && <p>@{profile.username}</p>}</div></header>
        {profile.bio && <p className="lpProfileBio">{profile.bio}</p>}
        {destinations.length > 0 && <ul className="lpDestinations">{destinations.map(({label,url},index)=>{
          const safe = httpsLink(url); if (!safe) return null;
          const parsed = new URL(safe), internal = parsed.origin === "https://www.rmtlaunch.fun";
          if (internal && (parsed.pathname.startsWith("//") || parsed.pathname === "/" || parsed.pathname === "/u/"+profile.username)) return null;
          return <li key={index}>{internal ? <Link href={parsed.pathname+parsed.search+parsed.hash} prefetch={false}>{label} →</Link> :
            <a href={safe} target="_blank" rel="noopener noreferrer ugc">{label || parsed.hostname}<span aria-hidden="true">↗</span></a>}</li>;
        })}</ul>}
        <div className="lpIdentityActions">
          {checking ? <button className="lpButton lpSecondary" disabled>Checking account…</button> :
            session.availability === "unavailable" ? <button className="lpUtility" onClick={()=>void refresh()}>Check account to share</button> :
            <a className="lpButton lpSecondary" href={profileShareIntent(profile,Boolean(own))} target="_blank" rel="noopener noreferrer">{own ? "Share my profile" : "Share this profile"}<span aria-hidden="true">↗</span></a>}
          {own && <Link className="lpUtility" href="/account/profile" prefetch={false}>Edit profile</Link>}
        </div>
        <div className="lpWalletLine"><span>Wallet</span><a href={robinhoodExplorer+"/address/"+profile.walletAddress} aria-label={"View wallet "+profile.walletAddress+" on the explorer"} target="_blank" rel="noopener noreferrer">{shortWallet(profile.walletAddress)} ↗</a>
          <button className="lpUtility" type="button" onClick={async()=>{try {await navigator.clipboard.writeText(profile.walletAddress);setCopied("Copied");}catch{setCopied(profile.walletAddress);}}}>Copy address</button>
          <span role="status">{copied}</span></div>
        <details className="lpDisclosure"><summary>About this identity</summary><p>Wallet sign-in confirms control of the address. Creators supply their names, images and links. Check the contract and destination before using a project.</p></details>
      </article>}
    {creator && <section className="lpProfileProjects"><h2>Launches</h2>
      {!directory ? <p className="lpSkeleton" role="status">Loading launches…</p> : <NewEngineLaunches directory={directory} creatorView onRetry={reviewFeed ? ()=>location.reload() : ()=>setFeedAttempt(n=>n+1)} />}</section>}
  </div>;
}
