import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { MobileWalletReview } from "../../_components/mobile-wallet-review";
import { proposedProductionSender } from "../../../lib/mobile-wallet-review";
import { configuredMobileReview, readMobilePlan } from "../../../lib/server/mobile-wallet-review";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mobile wallet review | RMT Launch", robots: { index: false, follow: false } };

export default async function MobileReviewPage() {
  const configured = configuredMobileReview(await headers());
  if (!configured) notFound();
  return <>
    <header className="lpPageHeading">
      <div><h1>Mobile wallet review</h1><p>Review unsigned launch transactions and rehearse one synthetic creation.</p></div>
      <Link className="lpButton lpSecondary" href="/wallet" prefetch={false}>Wallet</Link>
    </header>
    <MobileWalletReview account={configured.account} factory={configured.fixture.factory} plan={readMobilePlan()}
      proposedSender={proposedProductionSender} />
  </>;
}
