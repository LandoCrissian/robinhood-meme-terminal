import Link from "next/link";
import { isMainnetRelease } from "../lib/network";

export function SiteFooter() {
  return (
    <footer className="siteFooter">
      <Link href="/terms">Terms</Link>
      <Link href="/privacy">Privacy</Link>
      <Link href="/risks">Risks</Link>
      <Link href="/support">Support</Link>
      <Link href="/status">Status</Link>
      {isMainnetRelease && <span className="betaDisclosure">Mainnet beta · Contracts are not independently audited</span>}
      <span>Robinhood Meme Terminal is independent software and is not Robinhood Markets, Inc. or an endorsement by Robinhood.</span>
    </footer>
  );
}
