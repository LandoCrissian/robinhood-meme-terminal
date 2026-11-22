import Link from "next/link";
import { headers } from "next/headers";
import { profileConfig, ProfileError, requireProfileRequest } from "../../lib/server/profiles/config";
import { profileFirebase } from "../../lib/server/profiles/firebase";
import { profileBudget, publicMemberPage, visibleDirectoryWallet } from "../../lib/server/profiles/store";
import { profileUsername } from "../../lib/profiles";
import { anonymousReadHeaders } from "../../lib/server/social-pages";
import { ProfileAvatar } from "../_components/wallet-account";

import { readPublicReview, reviewOrigin } from "../../lib/server/public-review";

async function directory(after?: string) {
  const incoming = await headers();
  const origin = reviewOrigin(incoming);
  if (origin) {
    const { profiles, capturedAt } = await readPublicReview(origin);
    const visible = profiles.filter(p => p.username && visibleDirectoryWallet(p.walletAddress) && (!after || p.username > after))
      .sort((a,b) => a.username!.localeCompare(b.username!, "en"));
    return { members: visible.slice(0,25).map(p => ({username:p.username!, displayName:p.displayName, avatarUrl:p.avatarUrl})), next: visible.length > 25 ? visible[24].username : null, capturedAt };
  }
  const config = profileConfig();
  if (!config) return null;
  requireProfileRequest(new Request(config.origin + "/people", { headers: anonymousReadHeaders(incoming) }), config, false);
  const { db } = await profileFirebase(config);
  await profileBudget(db, "public-members", config.origin, 120);
  return { ...await publicMemberPage(db, after), capturedAt:null };
}

export const dynamic = "force-dynamic";
export const metadata = { title: "People | RMT Launch", alternates:{canonical:"https://www.rmtlaunch.fun/people"} };

async function Members({ after }: { after?: string | string[] }) {
  try {
    if (after !== undefined && (typeof after !== "string" || !after || profileUsername(after) !== after)) throw new Error();
  } catch { return <p>Invalid page. <Link href="/people">View the first page</Link></p>; }
  try {
    const result = await directory(after);
    if (!result) return <p className="lpNotice">The directory is unavailable on this deployment.</p>;
    const { members, next, capturedAt } = result;
    return <>
      {members.length ? <ul className="lpDirectory">{members.map(({username,displayName,avatarUrl}) =>
        <li key={username}><Link href={"/u/"+username} prefetch={false}>
          <ProfileAvatar name={displayName || username} url={avatarUrl} size={52} />
          <span className="lpMemberName"><strong>{displayName || username}</strong><small>@{username}</small></span>
          <span aria-hidden="true" className="lpArrow">→</span></Link></li>)}</ul>
        : <p className="lpNotice">{after ? "You’ve reached the end of the directory." : "Public profiles will appear here when people choose a username."}</p>}
      {capturedAt && <small>Public profile snapshot · {capturedAt}</small>}
      <div className="lpActions">{after && <Link className="lpUtility" href="/people" prefetch={false}>First page</Link>}
        {next && <Link className="lpUtility" href={"/people?after="+next} prefetch={false}>Next page →</Link>}</div>
    </>;
  } catch (error) {
    return <div className="lpNotice" role="status">{error instanceof ProfileError && error.status===429 ? "Too many requests. Try again in a minute." : "The directory couldn’t be loaded."} <a href={after?"/people?after="+encodeURIComponent(after):"/people"}>Try again</a></div>;
  }
}
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ after?: string | string[] }> }) {
  const {after}=await searchParams;
  return <div className="lpReading"><header className="lpPageHeading"><div><h1>People</h1><p>Browse profiles by username, A–Z.</p></div>
    <Link className="lpUtility" href="/account/profile" prefetch={false}>Your profile</Link></header><Members after={after}/></div>;
}
