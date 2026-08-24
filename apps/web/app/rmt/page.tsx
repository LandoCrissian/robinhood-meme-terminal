import type { Metadata } from "next";
import Link from "next/link";
import {
  RMT_SITE_DESCRIPTION,
  RMT_SITE_NAME,
  RMT_SITE_URL
} from "../../lib/site-identity";
import { SiteFooter } from "../site-footer";
import styles from "../robinhood-chain/page.module.css";

const pagePath = "/rmt";
const pageUrl = `${RMT_SITE_URL}${pagePath}`;
const title = "RMT | Official Robinhood Meme Terminal Identity";
const description =
  "Official product identity and evidence boundaries for Robinhood Meme Terminal (RMT) on Robinhood Chain.";

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
      "@type": "AboutPage",
      "@id": `${pageUrl}#webpage`,
      url: pageUrl,
      name: "RMT official identity and provenance",
      description,
      inLanguage: "en-US",
      isPartOf: { "@id": `${RMT_SITE_URL}/#website` },
      about: { "@id": `${RMT_SITE_URL}/#organization` },
      mainEntity: { "@id": `${RMT_SITE_URL}/#organization` }
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
          name: "RMT identity",
          item: pageUrl
        }
      ]
    }
  ]
} as const;

const currentIdentities = [
  {
    title: "Canonical website",
    value: "www.rmtlaunch.fun",
    href: "/",
    note: "The current Robinhood Meme Terminal product and canonical terminal entry point."
  },
  {
    title: "Robinhood Chain mainnet",
    value: "Chain ID 4663",
    href: "https://robinhoodchain.blockscout.com/",
    note: "The network used by the current Terminal market and execution surfaces."
  }
] as const;

export default function RmtIdentityPage() {
  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />

      <section className={styles.hero}>
        <p className={styles.eyebrow}>RMT · ROBINHOOD MEME TERMINAL · OFFICIAL IDENTITY</p>
        <h1>Verify RMT by the exact identity, not the ticker alone.</h1>
        <p className={styles.lead}>
          RMT means Robinhood Meme Terminal. This page is the canonical public identity reference for the RMT website,
          Robinhood Chain network, and public repository. Token names and tickers can be duplicated, so exact contract and
          network identity remain essential.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primaryAction} href="/">Open RMT Terminal</Link>
          <Link className={styles.secondaryAction} href="/status">View system status</Link>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="official-rmt-identity">
        <div className={styles.sectionHeading}>
          <p>CANONICAL REFERENCES</p>
          <h2 id="official-rmt-identity">Current RMT product identities</h2>
        </div>
        <div className={styles.grid}>
          {currentIdentities.map((identity) => (
            <article className={styles.card} key={identity.title}>
              <h3>{identity.title}</h3>
              <p><code>{identity.value}</code></p>
              <p>{identity.note}</p>
              {identity.href.startsWith("http") ? (
                <a href={identity.href} target="_blank" rel="noreferrer">Verify on Blockscout →</a>
              ) : (
                <Link href={identity.href}>Open canonical RMT →</Link>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className={styles.splitSection}>
        <article>
          <p className={styles.kicker}>PRODUCT IDENTITY</p>
          <h2>RMT is a trading terminal, not a token ticker page.</h2>
          <p>
            {RMT_SITE_DESCRIPTION} The current product is the Terminal at the canonical root. Market discovery, asset intelligence,
            portfolio context, and reviewed execution evidence belong to this one application.
          </p>
          <Link href="/robinhood-chain">See the Robinhood Chain terminal surface →</Link>
        </article>
        <article>
          <p className={styles.kicker}>NETWORK IDENTITY</p>
          <h2>Robinhood Chain mainnet · chain ID 4663.</h2>
          <p>
            Before relying on an RMT contract address, confirm the network and exact address. RMT does not treat a matching name,
            ticker, pool, social profile, or third-party listing as sufficient proof of product identity or provenance.
          </p>
          <Link href="/sources">Review RMT source and attribution boundaries →</Link>
        </article>
      </section>

      <section className={styles.linkSection} aria-labelledby="rmt-verification-links">
        <div>
          <p className={styles.kicker}>VERIFY BEFORE SIGNING</p>
          <h2 id="rmt-verification-links">Public RMT verification surfaces</h2>
        </div>
        <nav className={styles.linkGrid} aria-label="RMT verification links">
          <Link href="/">Live terminal<span>Canonical RMT application</span></Link>
          <Link href="/status">System status<span>Current network and protocol checks</span></Link>
          <Link href="/sources">Sources<span>Origin and venue evidence</span></Link>
          <Link href="/risks">Risks<span>Trading and market limitations</span></Link>
          <a href="https://github.com/LandoCrissian/robinhood-meme-terminal" target="_blank" rel="noreferrer">
            GitHub<span>Public RMT repository</span>
          </a>
        </nav>
      </section>

      <aside className={styles.independence}>
        Robinhood Meme Terminal is independent software. It is not Robinhood Markets, Inc., and references to Robinhood or Robinhood Chain do not imply endorsement by Robinhood.
      </aside>

      <SiteFooter />
    </main>
  );
}
