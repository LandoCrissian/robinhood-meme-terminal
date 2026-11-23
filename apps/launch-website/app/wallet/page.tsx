import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { mobileReviewPage } from "../../lib/mobile-wallet-review";
import { configuredMobileReview } from "../../lib/server/mobile-wallet-review";
import { WalletAccount } from "../_components/wallet-account";

export const metadata: Metadata = { title: "Wallet | RMT Launch" };

export default async function WalletPage() {
  const fixture = configuredMobileReview(await headers());
  return <>
    <header className="lpPageHeading"><div><h1>Wallet</h1><p>Connect, sign in and manage your profile.</p></div></header>
    <div className="lpColumns"><WalletAccount /><section className="lpPanel lpForm">
      <h2>What you approve</h2><ol className="lpWalletSteps"><li><strong>Connect</strong><span>Share your public address with this site.</span></li>
        <li><strong>Review</strong><span>Check this website, account and sign-in expiry.</span></li><li><strong>Sign in</strong><span>Approve a gas-free identity message in your wallet.</span></li></ol>
      <p>Launchpad transactions have a separate review and release boundary. Creation, trading and claims remain disabled.</p>
    </section></div>
    {fixture && <p><Link className="lpButton lpSecondary" href={mobileReviewPage} prefetch={false}>Open mobile wallet rehearsal</Link></p>}
  </>;
}
