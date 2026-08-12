import type { Metadata } from "next";
import { FreshLaunchFeed } from "../fresh-launch-feed";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Explore RMT Markets | RMT",
  description: "Inspect the deployed RMT market and verified Robinhood Chain market evidence.",
  alternates: { canonical: "/explore" },
  openGraph: {
    title: "Explore RMT Markets | RMT",
    description: "Inspect the deployed RMT market and verified Robinhood Chain market evidence.",
    url: "/explore",
    images: ["/brand/rmt-master-logo.png"]
  }
};

export default function ExplorePage() {
  return (
    <main className="directoryPage focusedDirectory">
      <section className="terminalIntro">
        <div><p className="eyebrow">EXPLORE · VERIFIED MARKET HISTORY</p><h1>RMT markets and onchain evidence.</h1><p>Inspect the existing official RMT market and its verified activity. Broader Robinhood Chain discovery remains available in Terminal.</p></div>
      </section>
      <FreshLaunchFeed />
      <SiteFooter />
    </main>
  );
}
