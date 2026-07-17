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
          <p>Keep interesting RMT launches close. Saved items stay private to this browser while cloud profile sync remains off.</p>
        </div>
        <Link className="secondaryAction" href="/">Find tokens to watch</Link>
      </header>
      <div className="personalPageHint panel">
        <strong>Build your list from any token page.</strong>
        <span>Tap Watchlist on a verified RMT token. Your saved tokens stay private to this browser.</span>
      </div>
      <WatchlistPanel />
      <SiteFooter />
    </main>
  );
}
