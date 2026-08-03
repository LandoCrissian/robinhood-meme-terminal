import Link from "next/link";
import { isMainnetRelease } from "../lib/network";

export function SiteFooter() {
  return (
    <footer className="siteFooter">
      <Link href="/terms">Terms</Link>
      <Link href="/privacy">Privacy</Link>
      <Link href="/experience">Experience controls</Link>
      <Link href="/risks">Risks</Link>
      <Link href="/support">Support</Link>
      <Link href="/status">Status</Link>
      <a href="https://github.com/LandoCrissian/rmt-transparency" target="_blank" rel="noreferrer">Public evidence ↗</a>
      <a href="https://github.com/sponsors/LandoCrissian" target="_blank" rel="noreferrer">Support RMT ↗</a>
      {isMainnetRelease && <span className="betaDisclosure">Mainnet beta · Contracts are not independently audited</span>}
      <span>Robinhood Meme Terminal is independent software and is not Robinhood Markets, Inc. or an endorsement by Robinhood.</span>
    </footer>
  );
}
