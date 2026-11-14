import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "My Launches | RMT Launch" };

export default function MyLaunchesPage() {
  return <>
    <header className="lpPageHeading"><div><h1>My Launches</h1><p>New-engine creator activity</p></div></header>
    <section className="lpPanel lpForm">
      <h2>No verified creator launches</h2>
      <p>Read-only. The new engine is in prelaunch. Wallet access and fee claims are disabled.</p>
      <Link className="lpButton lpSecondary" href="/create-token" prefetch={false}>Prepare a draft</Link>
    </section>
  </>;
}
