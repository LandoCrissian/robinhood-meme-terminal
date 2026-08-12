import Link from "next/link";
import { SiteFooter } from "../site-footer";
import { WatchlistPanel } from "../watchlist-panel";

export default function WatchlistPage() {
  return (
    <main className="directoryPage personalPage">
      <header className="directoryHero">
        <div>
          <p className="eyebrow">YOUR RMT DESK</p>
          <h1>Your watchlist</h1>
          <p>Keep interesting Robinhood Chain markets close. During terminal completion, the saved-token list stays on this device.</p>
        </div>
        <Link className="secondaryAction" href="/">Find tokens to watch</Link>
      </header>
      <div className="personalPageHint panel">
        <strong>Build your list from any supported market page.</strong>
        <span>Tap Watchlist on a token RMT can identify. Your saved list is never made public.</span>
      </div>
      <WatchlistPanel />
      <SiteFooter />
    </main>
  );
}
