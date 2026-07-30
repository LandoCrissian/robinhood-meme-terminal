import type { Metadata } from "next";
import { ExperienceSettings } from "./experience-settings";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Experience & Privacy | RMT",
  description: "Control first-visit guidance and optional anonymous product diagnostics for this RMT browser.",
  alternates: { canonical: "/experience" },
  robots: { index: true, follow: true }
};

export default function ExperiencePage() {
  return (
    <main className="experiencePage">
      <header className="experienceHero">
        <p className="eyebrow">CLEAR CONTROLS · NO SURVEILLANCE SDK</p>
        <h1>Make RMT easier without following users.</h1>
        <p>RMT can learn where its interface creates friction using optional, aggregate milestones. You decide whether this browser contributes.</p>
      </header>
      <ExperienceSettings />
      <section className="experiencePrinciples" aria-labelledby="experience-principles-title">
        <header><p className="eyebrow">MEASUREMENT BOUNDARY</p><h2 id="experience-principles-title">What the system is allowed to learn</h2></header>
        <div>
          <article><span>01</span><strong>Milestones, not behavior trails</strong><p>Each allowed milestone is counted at most once per browser session.</p></article>
          <article><span>02</span><strong>Aggregates, not identities</strong><p>RMT stores daily mobile and desktop totals—not visitor histories.</p></article>
          <article><span>03</span><strong>Product improvement only</strong><p>No advertising profiles, sale of data, token ranking, wallet scoring, or transaction decisions.</p></article>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
