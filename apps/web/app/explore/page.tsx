import type { Metadata } from "next";
import { ApprovedProjectDirectory } from "../approved-project-directory";
import { FreshLaunchFeed } from "../fresh-launch-feed";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Explore RMT Projects | RMT",
  description: "Discover approved RMT projects, creator-built games and factory-verified RMT-native tokens.",
  alternates: { canonical: "/explore" },
  openGraph: {
    title: "Explore RMT Projects | RMT",
    description: "The home for approved RMT projects, creator-built games and factory-verified RMT-native markets.",
    url: "/explore",
    images: ["/brand/rmt-master-logo.png"]
  }
};

export default function ExplorePage() {
  return (
    <main className="directoryPage focusedDirectory">
      <section className="terminalIntro">
        <div><p className="eyebrow">EXPLORE · RMT CREATOR ECOSYSTEM</p><h1>Projects, games and verified markets.</h1><p>Discover approved creator worlds—including projects without tokens—then trade only where RMT can verify the active factory and market origin.</p></div>
      </section>
      <ApprovedProjectDirectory />
      <FreshLaunchFeed />
      <SiteFooter />
    </main>
  );
}
