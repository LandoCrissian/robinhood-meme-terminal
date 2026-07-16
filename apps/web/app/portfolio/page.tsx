import Link from "next/link";
import { PortfolioPanel } from "../portfolio-panel";
import { SiteFooter } from "../site-footer";

export default function PortfolioPage() {
  return (
    <main className="directoryPage personalPage">
      <header className="directoryHero">
        <div>
          <p className="eyebrow">CONNECTED WALLET</p>
          <h1>Your portfolio</h1>
          <p>Connect your wallet to see balances across the active RMT Discovery candidate set. RMT reads public onchain holdings only.</p>
        </div>
        <Link className="secondaryAction" href="/">Discover RMT tokens</Link>
      </header>
      <PortfolioPanel />
      <SiteFooter />
    </main>
  );
}
