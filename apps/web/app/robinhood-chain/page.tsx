import type { Metadata } from "next";
import Link from "next/link";
import { RMT_SITE_NAME, RMT_SITE_URL } from "../../lib/site-identity";
import { SiteFooter } from "../site-footer";
import styles from "./page.module.css";

const pagePath = "/robinhood-chain";
const pageUrl = `${RMT_SITE_URL}${pagePath}`;
const title = "Robinhood Chain Trading Terminal & Market Intelligence | RMT";
const description =
  "Scan Robinhood Chain markets, compare origin, venue, liquidity, activity and RWA context, and prepare self-custodial trades from Robinhood Meme Terminal.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: pagePath },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: RMT_SITE_NAME,
    title,
    description,
    url: pagePath,
    images: ["/brand/rmt-master-logo.png"]
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/brand/rmt-master-logo.png"]
  }
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      "@id": `${pageUrl}#webpage`,
      url: pageUrl,
      name: "Robinhood Chain market intelligence and trading",
      description,
      inLanguage: "en-US",
      isPartOf: { "@id": `${RMT_SITE_URL}/#website` },
      about: [
        { "@type": "Thing", name: "Robinhood Chain markets" },
        { "@type": "Thing", name: "Cryptocurrency market intelligence" },
        { "@type": "Thing", name: "Self-custodial trading" }
      ]
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${pageUrl}#breadcrumbs`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: RMT_SITE_NAME,
          item: `${RMT_SITE_URL}/`
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Robinhood Chain",
          item: pageUrl
        }
      ]
    }
  ]
} as const;

const capabilities = [
  {
    title: "Market discovery",
    body: "Scan Robinhood Chain markets with live market context instead of relying on a token name or ticker alone.",
    href: "/",
    action: "Open Terminal"
  },
  {
    title: "Origin and venue evidence",
    body: "Review where project identity came from separately from the DEX or pool where a market currently trades.",
    href: "/sources",
    action: "Review sources"
  },
  {
    title: "RWA context",
    body: "Distinguish canonical Robinhood stock-token relationships from unrelated assets that are merely paired with an RWA.",
    href: "/",
    action: "Scan RWA markets"
  },
  {
    title: "Self-custodial execution",
    body: "Compare available execution evidence while keeping transaction review and authorization in the connected wallet.",
    href: "/risks",
    action: "Read execution risks"
  }
] as const;

export default function RobinhoodChainPage() {
  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />

      <section className={styles.hero}>
        <p className={styles.eyebrow}>ROBINHOOD CHAIN · MARKET INTELLIGENCE · SELF-CUSTODY</p>
        <h1>Robinhood Chain markets, trading evidence, and execution in one terminal.</h1>
        <p className={styles.lead}>
          RMT is an independent Robinhood Chain terminal for discovering markets, checking project origin and venue evidence,
          comparing live activity, reviewing RWA relationships, and preparing trades without handing custody of the wallet to RMT.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primaryAction} href="/">Open RMT Terminal</Link>
          <Link className={styles.secondaryAction} href="/explore">Explore verified RMT history</Link>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="rmt-covers">
        <div className={styles.sectionHeading}>
          <p>DISCOVERY → VERIFY → ANALYZE → EXECUTE</p>
          <h2 id="rmt-covers">What RMT covers on Robinhood Chain</h2>
        </div>
        <div className={styles.grid}>
          {capabilities.map((capability) => (
            <article className={styles.card} key={capability.title}>
              <h3>{capability.title}</h3>
              <p>{capability.body}</p>
              <Link href={capability.href}>{capability.action} →</Link>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.splitSection}>
        <article>
          <p className={styles.kicker}>EVIDENCE BOUNDARIES</p>
          <h2>A market existing onchain is not the same as project verification.</h2>
          <p>
            RMT keeps project origin, trading venue, RWA identity, and RMT-originated execution as separate facts. A pool can exist
            without proving who created the project, and a token paired with a stock token is not automatically a canonical RWA.
          </p>
          <Link href="/sources">See how RMT attributes sources and venues →</Link>
        </article>
        <article>
          <p className={styles.kicker}>TRADER CONTROL</p>
          <h2>Search by the contract, then verify before signing.</h2>
          <p>
            Names and tickers can be duplicated. Use the exact contract when checking a Robinhood Chain market, review the current
            evidence and route, and keep the final transaction decision in your wallet.
          </p>
          <Link href="/risks">Review RMT trading and market risks →</Link>
        </article>
      </section>

      <section className={styles.linkSection} aria-labelledby="research-links">
        <div>
          <p className={styles.kicker}>PUBLIC RMT SURFACES</p>
          <h2 id="research-links">Research before the wallet prompt.</h2>
        </div>
        <nav className={styles.linkGrid} aria-label="Robinhood Chain research links">
          <Link href="/">Live terminal<span>Scan markets and exact contracts</span></Link>
          <Link href="/sources">Sources<span>Origin and venue boundaries</span></Link>
          <Link href="/sushi">Sushi integration<span>Verified routing boundary</span></Link>
          <Link href="/status">System status<span>Network and protocol checks</span></Link>
          <Link href="/risks">Risks<span>Read before signing</span></Link>
          <Link href="/support">Support<span>Transaction and incident help</span></Link>
        </nav>
      </section>

      <aside className={styles.independence}>
        Robinhood Meme Terminal is independent software. It is not Robinhood Markets, Inc., and references to Robinhood Chain do not
        imply endorsement by Robinhood.
      </aside>

      <SiteFooter />
    </main>
  );
}
