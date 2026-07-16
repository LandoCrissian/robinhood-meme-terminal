import Link from "next/link";
import { SiteFooter } from "../site-footer";
import { WatchlistPanel } from "../watchlist-panel";

export default function WatchlistPage() {
  return (
    <main className="directoryPage personalPage">
      <header className="directoryHero">
        <div>
          <p className="eyebrow">PRIVATE TO THIS DEVICE</p>
          <h1>Your watchlist</h1>
          <p>Keep interesting RMT launches close without creating an account or signing a message.</p>
        </div>
        <Link className="secondaryAction" href="/">Find tokens to watch</Link>
      </header>
      <div className="personalPageHint panel">
        <strong>Build your list from any token page.</strong>
        <span>Tap Watchlist on a verified RMT token. Saved tokens stay in this browser and can be removed anytime.</span>
      </div>
      <WatchlistPanel />
      <SiteFooter />
    </main>
  );
}
