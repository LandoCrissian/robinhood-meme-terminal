import Link from "next/link";
import { FreshLaunchFeed } from "./fresh-launch-feed";
import { isMainnetRelease } from "../lib/network";
import { SiteFooter } from "./site-footer";
import { LegacyHomeRedirect } from "./legacy-home-redirect";

export default function Home() {
  return (
    <main>
      <LegacyHomeRedirect />
      <section className="terminalIntro">
        <div><p className="eyebrow">RUNNER TERMINAL · RMT V6 · LIVE MARKET SCANNER</p><h1>Robinhood Meme Terminal</h1><p>Origin-verified Robinhood Chain launches ranked by momentum, liquidity, activity, and creator behavior.</p></div>
        <div className="terminalIntroActions"><a className="primaryAction" href="#explore">Open scanner</a><Link className="secondaryAction" href="/launch">Create</Link></div>
        <div className="trustStrip"><span><b>NETWORK</b>{isMainnetRelease ? "RHC MAINNET · 4663" : "RHC TESTNET · 46630"}</span><span><b>REFRESH</b>30S ONCHAIN</span><span><b>EXECUTION</b>NON-CUSTODIAL</span><span><b>MARKETS</b>V6 → UNISWAP V4</span></div>
      </section>

      <FreshLaunchFeed />
      <SiteFooter />
    </main>
  );
}
