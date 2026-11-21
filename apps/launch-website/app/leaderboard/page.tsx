import Link from "next/link";
import { headers } from "next/headers";
import { profileConfig, ProfileError, requireProfileRequest } from "../../lib/server/profiles/config";
import { profileFirebase } from "../../lib/server/profiles/firebase";
import { profileBudget, publicMemberPage } from "../../lib/server/profiles/store";
import { profileUsername } from "../../lib/profiles";

export const dynamic = "force-dynamic";
export const metadata = { title: "People | RMT Launch" };

async function Members({ after }: { after?: string | string[] }) {
  try {
    if (after !== undefined && (typeof after !== "string" || !after || profileUsername(after) !== after)) {
      return <p>Invalid page. <Link href="/leaderboard">View the first page</Link></p>;
    }
  } catch {
    return <p>Invalid page. <Link href="/leaderboard">View the first page</Link></p>;
  }
  try {
    const config = profileConfig();
    if (!config) return <p>Public profiles are currently disabled.</p>;
    requireProfileRequest(new Request(config.origin + "/leaderboard", { headers: await headers() }), config, false);
    const { db } = await profileFirebase(config);
    await profileBudget(db, "public-members", config.origin, 120);
    const { names, next } = await publicMemberPage(db, after);
    return <>
      {names.length > 0 ? <ul className="lpProfileLinks">{names.map(name =>
        <li key={name}><Link href={"/u/" + name} prefetch={false}>@{name}</Link></li>
      )}</ul> : <p>{after ? "No more public usernames." : "No public usernames yet."}</p>}
      {after && <Link className="lpButton lpSecondary" href="/leaderboard" prefetch={false}>First page</Link>}
      {next && <Link className="lpButton lpSecondary" href={"/leaderboard?after=" + next} prefetch={false}>Next page</Link>}
    </>;
  } catch (error) {
    return <p role="status">{error instanceof ProfileError && error.status === 429
      ? "Too many requests. Try again in a minute." : "Public profiles are temporarily unavailable."}</p>;
  }
}

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ after?: string | string[] }> }) {
  const { after } = await searchParams;
  return <>
    <header className="lpPageHeading"><div><h1>People</h1><p>Public usernames in alphabetical order.</p></div>
      <Link className="lpButton lpSecondary" href="/account/profile" prefetch={false}>Your profile</Link>
    </header>
    <Members after={after} />
  </>;
}
