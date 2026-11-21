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

export function CreatorProfile({ username, walletAddress }: { username?: string; walletAddress?: string }) {
  const { session } = useAccount();
  const [profile, setProfile] = useState<PublicCreatorProfile>(), [status, setStatus] = useState<"loading" | "ready" | "missing" | "unavailable">("loading");
  const [directory, setDirectory] = useState<NewEngineDirectory>({ status: "unavailable" });
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setStatus("loading"); setProfile(undefined); setDirectory({ status: "unavailable" });
    accountApi<{ profile: PublicCreatorProfile }>(walletAddress ? `/api/account/creator/${walletAddress}` : `/api/account/public/${encodeURIComponent(username ?? "")}`, { signal: controller.signal })
      .then(({ profile: found }) => {
        if (!active) return;
        if (!found || found.chainId !== 4663 || !/^0x[0-9a-f]{40}$/i.test(found.walletAddress)
            || (walletAddress && !sameAccount(found.walletAddress, walletAddress)) || (username && found.username !== username)) throw new Error("Unverified profile identity");
        setProfile(found); setStatus("ready");
      }).catch((error) => { if (active) setStatus(error instanceof AccountApiError && error.status === 404 && error.availability === "available" ? "missing" : "unavailable"); });
    return () => { active = false; controller.abort(); };
  }, [username, walletAddress]);
  const creator = profile?.walletAddress ?? walletAddress;
  useEffect(() => {
    if (!creator) return;
    const controller = new AbortController(); let active = true;
    fetch("/api/launchpad/new-engine", { cache: "no-store", redirect: "error", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unavailable launch evidence");
        const data = await response.json() as { status: string; launches?: Array<CurveLaunch | { creator: string }> };
        if (!active || data.status !== "ready" || !Array.isArray(data.launches) || data.launches.length > 25) return;
        // Public profile content never establishes project ownership. Only this
        // canonical new-engine read supplies the creator-to-launch relationship.
        const launches: CurveLaunch[] = data.launches.flatMap((row) => {
          if ("registration" in row) return sameAccount(row.registration.creator, creator) ? [row] : [];
          return sameAccount(row.creator, creator) ? [{ registration: row as unknown as CurveLaunch["registration"], state: "created" as const }] : [];
        });
        setDirectory({ status: "ready", launches });
      }).catch(() => { if (active) setDirectory({ status: "unavailable" }); });
    return () => { active = false; controller.abort(); };
  }, [creator]);
  const own = creator && session.authenticated && sameAccount(session.account.walletAddress, creator);
  return <>
    <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
    <header className="lpPageHeading"><div><h1>Creator profile</h1><p>Public creator identity and canonical launch records.</p></div>{own && <Link className="lpButton lpSecondary" href="/account/profile" prefetch={false}>Edit your profile</Link>}</header>
    {status === "loading" ? <div className="lpSkeleton" role="status">Loading creator profile…</div> : <section className="lpProfileBanner">
      <div className="lpProfileIdentity"><ProfileAvatar name={profile?.displayName || profile?.username || "R"} url={profile?.avatarUrl} size={64} />
        <div><h2>{profile?.displayName || (profile?.username ? "@" + profile.username : creator ? shortWallet(creator) : username)}</h2>
          {profile?.username && <p>@{profile.username}</p>}</div><span className="lpPill">Creator-provided profile</span></div>
      {creator && <p><a className="lpAddress lpCreatorLink" href={`${robinhoodExplorer}/address/${creator}`} target="_blank" rel="noopener noreferrer">{creator}</a></p>}
      {profile?.bio && <p className="lpProfileBio">{profile.bio}</p>}
      {profile && <div className="lpActions">
        {profile.xHandle && <a className="lpButton lpSecondary" href={"https://x.com/" + profile.xHandle} target="_blank" rel="noopener noreferrer ugc">@{profile.xHandle} on X</a>}
        <a className="lpButton lpSecondary" href={profileShareIntent(profile)} target="_blank" rel="noopener noreferrer">Share profile on X</a>
      </div>}
      {profile?.links.length ? <ul className="lpProfileLinks">{profile.links.map((link, index) => {
        const href = httpsLink(link.url); return href ? <li key={index}><a href={href} target="_blank" rel="noopener noreferrer ugc">{link.label || new URL(href).hostname} ↗</a></li> : null;
      })}</ul> : null}
      {status === "missing" && <p className="lpInlineNotice">No public profile has been created for this identity. Wallet addresses still identify on-chain creators.</p>}
      {status === "unavailable" && <p className="lpInlineNotice" role="status">Creator profile data is unavailable in this preview. An unavailable profile does not change the on-chain creator record.</p>}
      <p className="lpInlineNotice">Profile names, avatars and links are self-provided. Wallet sign-in confirms account control, not token safety or endorsement.</p>
    </section>}
    {creator && <><div className="lpSectionHeading"><div><h2>Projects created by this wallet</h2><p>New-engine registrations only. Historical V4/V6 records are separate.</p></div></div><NewEngineLaunches directory={directory} /></>}
  </>;
}
