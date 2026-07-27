import Link from "next/link";
import { SiteFooter } from "../site-footer";
import { publicLaunchRelease } from "../../lib/public-launch-release";
import "../launch-presets.css";

export default function LaunchPage() {
  return (
    <main className="launchPage">
      <header className="launchPageHeader">
        <div><p className="eyebrow">RMT V{publicLaunchRelease.requiredProtocolVersion} PREPARATION</p><h1>New token launches are paused.</h1><p>RMT V6 creation is closed while the V7 factory, market path, indexing, and release controls are configured and reviewed together.</p></div>
        <div className="launchAssurances"><span>Existing trading remains live</span><span>RMT projects remain visible</span><span>No V6 launches through the site</span></div>
      </header>

      <section className="panel launchPausePanel" aria-labelledby="launch-pause-title">
        <p className="eyebrow">FAIL-CLOSED RELEASE GATE</p>
        <h2 id="launch-pause-title">Launching reopens with V7—not before.</h2>
        <p>The pause affects new token creation only. Existing RMT launches remain discoverable and tradable, and external Robinhood Chain markets remain available in Terminal.</p>
        <div className="terminalIntroActions">
          <Link className="primaryAction" href="/explore">Explore RMT launches</Link>
          <Link className="secondaryAction" href="/">Open Terminal</Link>
        </div>
        <div className="callout"><strong>Onchain status is independently verifiable</strong><span>The website release gate cannot be reopened by an environment-variable change. V7 requires a dedicated reviewed release.</span></div>
      </section>

      <SiteFooter />
    </main>
  );
}
