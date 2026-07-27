import type { Metadata } from "next";
import { FreshLaunchFeed } from "../fresh-launch-feed";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Explore RMT Launches | RMT",
  description: "Discover, verify, and trade tokens launched through Robinhood Meme Terminal.",
  alternates: { canonical: "/explore" },
  openGraph: {
    title: "Explore RMT Launches | RMT",
    description: "The verified home for projects launched through Robinhood Meme Terminal.",
    url: "/explore",
    images: ["/brand/rmt-master-logo.png"]
  }
};

export default function ExplorePage() {
  return (
    <main className="directoryPage focusedDirectory">
      <section className="terminalIntro">
        <div><p className="eyebrow">EXPLORE · VERIFIED RMT-NATIVE PROJECTS</p><h1>Born on RMT. Traded on RMT.</h1><p>Every project below is matched to its active factory record before discovery or trading controls appear.</p></div>
      </section>
      <FreshLaunchFeed />
      <SiteFooter />
    </main>
  );
}
