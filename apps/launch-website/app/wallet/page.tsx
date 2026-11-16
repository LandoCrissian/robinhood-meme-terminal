import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { mobileReviewPage } from "../../lib/mobile-wallet-review";
import { configuredMobileReview } from "../../lib/server/mobile-wallet-review";
import { ShowcaseAccount } from "../_components/launch-showcase";

export const metadata: Metadata = { title: "Wallet | RMT Launch" };

export default async function WalletPage() {
  const fixture = configuredMobileReview(await headers());
  return <>
    <ShowcaseAccount page="Wallet" />
    {fixture && <p><Link className="lpButton lpSecondary" href={mobileReviewPage} prefetch={false}>Open mobile wallet rehearsal</Link></p>}
  </>;
}
