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
const officialToken = "0xdBa33be56C89CC9fc014c4459028d7e5c7878671";
const officialMarket = "0xb26Fb775c0ac365d369BEe9ac2E044C5D90FfBee";
const legacyProvenance = "0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C";
const title = "RMT | Official Robinhood Meme Terminal Identity";
const description =
  "Official identity and provenance for Robinhood Meme Terminal (RMT), including the canonical website, Robinhood Chain network, official RMT V6 token and compatibility market.";

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

const identities = [
  {
    title: "Canonical website",
    value: "www.rmtlaunch.fun",
    href: "/",
    note: "The current Robinhood Meme Terminal product and canonical terminal entry point."
  },
  {
    title: "Official RMT V6 token",
    value: officialToken,
    href: `https://robinhoodchain.blockscout.com/address/${officialToken}`,
    note: "Canonical RMT V6 launch 0 on Robinhood Chain. Fixed supply: 1,000,000,000 RMT."
  },
  {
    title: "Official RMT V6 market",
    value: officialMarket,
    href: `https://robinhoodchain.blockscout.com/address/${officialMarket}`,
    note: "The existing official V6 market retained as RMT's live compatibility domain."
  },
  {
    title: "Legacy provenance anchor",
    value: legacyProvenance,
    href: `https://robinhoodchain.blockscout.com/address/${legacyProvenance}`,
    note: "Historical identity provenance only. Legacy balances were not copied, swapped, or migrated into V6."
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
          RMT means Robinhood Meme Terminal. This page is the canonical public identity and provenance reference for the RMT website,
          Robinhood Chain network, official V6 token, and existing V6 compatibility market. Token names and tickers can be duplicated;
          contract addresses are the authoritative way to distinguish the official RMT asset from unrelated tokens using the same symbol.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primaryAction} href="/">Open RMT Terminal</Link>
          <Link className={styles.secondaryAction} href={`/project/${officialToken}`}>View official RMT project</Link>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="official-rmt-identity">
        <div className={styles.sectionHeading}>
          <p>CANONICAL REFERENCES</p>
          <h2 id="official-rmt-identity">Official RMT identities</h2>
        </div>
        <div className={styles.grid}>
          {identities.map((identity) => (
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
            {RMT_SITE_DESCRIPTION} The current product is the terminal at the canonical root. The existing RMT V6 token and market are
            separate provenance and compatibility facts and do not redefine the terminal as a launchpad.
          </p>
          <Link href="/robinhood-chain">See the Robinhood Chain terminal surface →</Link>
        </article>
        <article>
          <p className={styles.kicker}>NETWORK IDENTITY</p>
          <h2>Robinhood Chain mainnet · chain ID 4663.</h2>
          <p>
            Before relying on an RMT contract address, confirm the network and exact address. RMT does not treat a matching name,
            ticker, pool, social profile, or third-party listing as sufficient proof of official identity.
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
          <Link href={`/project/${officialToken}`}>Official RMT project<span>Canonical V6 token identity</span></Link>
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
