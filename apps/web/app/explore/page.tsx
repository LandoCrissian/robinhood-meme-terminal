import type { Metadata } from "next";
import { ApprovedProjectDirectory } from "../approved-project-directory";
import { FreshLaunchFeed } from "../fresh-launch-feed";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Explore RMT Projects | RMT",
  description: "Discover approved RMT project pages and trade factory-verified RMT-native tokens.",
  alternates: { canonical: "/explore" },
  openGraph: {
    title: "Explore RMT Projects | RMT",
    description: "The home for approved RMT ecosystem pages and factory-verified RMT-native projects.",
    url: "/explore",
    images: ["/brand/rmt-master-logo.png"]
  }
};

export default function ExplorePage() {
  return (
    <main className="directoryPage focusedDirectory">
      <section className="terminalIntro">
        <div><p className="eyebrow">EXPLORE · RMT PROJECT ECOSYSTEM</p><h1>Projects first. Markets verified.</h1><p>Discover approved ecosystem pages, then trade only where RMT can verify the active factory and market origin.</p></div>
      </section>
      <ApprovedProjectDirectory />
      <FreshLaunchFeed />
      <SiteFooter />
    </main>
  );
}
