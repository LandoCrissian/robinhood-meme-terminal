import Link from "next/link";
import { SiteFooter } from "../site-footer";
import { publicLaunchRelease } from "../../lib/public-launch-release";
import "../launch-presets.css";

export default function LaunchPage() {
  return (
    <main className="launchPage">
      <header className="launchPageHeader">
        <div><p className="eyebrow">RMT PRODUCT DIRECTION</p><h1>RMT is a trading terminal, not a launchpad.</h1><p>{publicLaunchRelease.reason} RMT is focused on Robinhood Chain discovery, market intelligence, wallet holdings, funding, and verified execution.</p></div>
        <div className="launchAssurances"><span>Existing RMT market remains live</span><span>External markets remain discoverable</span><span>No new token launches through RMT</span></div>
      </header>

      <section className="panel launchPausePanel" aria-labelledby="launch-pause-title">
        <p className="eyebrow">TERMINAL COMPLETION PROGRAM</p>
        <h2 id="launch-pause-title">The product is moving forward as one terminal.</h2>
        <p>The deployed V6 protocol and existing official RMT market remain represented truthfully. V7 creator, NFT, marketplace, and launch work is preserved but paused and is not the next product phase.</p>
        <div className="terminalIntroActions">
          <Link className="primaryAction" href="/">Open Terminal</Link>
          <Link className="secondaryAction" href="/explore">Explore markets</Link>
        </div>
        <div className="callout"><strong>No launch reopening is implied</strong><span>Any future return to launching requires a separate, explicit architecture decision after the terminal completion gate has passed.</span></div>
      </section>

      <SiteFooter />
    </main>
  );
}
