import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Market Sources and Evidence | RMT Terminal",
  description: "How Robinhood Meme Terminal separates canonical market evidence, provider observations, project metadata, and execution verification.",
  alternates: { canonical: "/sources" }
};

const boundaries = [
  ["Canonical inventory", "Positively indexed Robinhood Chain pools establish canonical market evidence. Partial global coverage never erases markets already known."],
  ["Provider observations", "Public market providers can add prices, activity, liquidity, images, and links. Their observations do not fabricate canonical status."],
  ["Project metadata", "Websites and social links are attributed to their source. Market metadata is not represented as proof that a project controls an account."],
  ["Execution evidence", "Quotes and market visibility are separate from wallet authorization. RMT exposes an executable route only when its transaction can be independently verified."]
] as const;

export default function SourcesPage() {
  return (
    <main className="directoryPage focusedDirectory">
      <section className="directoryHero">
        <p className="eyebrow">RMT TERMINAL · EVIDENCE BOUNDARIES</p>
        <h1>Sources inform the trader. They do not decide for the trader.</h1>
        <p>RMT keeps market existence, enrichment, risk context, and transaction verification distinct so missing optional data remains unknown rather than becoming a hidden market ban.</p>
        <Link href="/">Open the Terminal →</Link>
      </section>
      <section className="directoryGrid" aria-label="RMT evidence boundaries">
        {boundaries.map(([title, description]) => <article key={title}><h2>{title}</h2><p>{description}</p></article>)}
      </section>
      <SiteFooter />
    </main>
  );
}
