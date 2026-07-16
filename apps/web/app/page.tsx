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
        <div><p className="eyebrow">RMT DISCOVERY · {isMainnetRelease ? "V6 MAINNET" : "V6 TESTNET"}</p><h1>Find the next RMT runner.</h1><p>Live, verified RMT V6 launches ranked for discovery. Buy or sell from the card when you are ready.</p></div>
        <div className="terminalIntroActions"><a className="primaryAction" href="#explore">Explore RMT</a><Link className="secondaryAction" href="/launch">Launch a token</Link></div>
        <div className="trustStrip"><span>Fixed supply</span><span>No transfer tax</span><span>Permissionless graduation</span></div>
      </section>

      <FreshLaunchFeed />
      <SiteFooter />
    </main>
  );
}
