import type { Metadata } from "next";
import Link from "next/link";
import { RMT_SITE_NAME, RMT_SITE_URL } from "../../lib/site-identity";
import { SiteFooter } from "../site-footer";
import styles from "../robinhood-chain/page.module.css";

const pagePath = "/rmt";
const pageUrl = `${RMT_SITE_URL}${pagePath}`;
const title = "RMT | Official Robinhood Meme Terminal Identity";
const description =
  "Official product identity and evidence boundaries for Robinhood Meme Terminal (RMT) on Robinhood Chain.";
const explorer = "https://robinhoodchain.blockscout.com";

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
    note: "The canonical RMT Launch application."
  },
  {
    title: "Robinhood Chain mainnet",
    value: "Chain ID 4663",
    href: `${explorer}/`,
    note: "The network for RMT’s existing token and curve records."
  }
] as const;

const legacyIssuances = [
  {
    id: "v6-official-provenance",
    title: "Official RMT V6 issuance",
    token: "0xdBa33be56C89CC9fc014c4459028d7e5c7878671",
    curve: "0xb26Fb775c0ac365d369BEe9ac2E044C5D90FfBee",
    block: "10387857",
    transaction: "0x4eb7b596ccdf5d0aa5e4c8d0d50311df5108b44f47d9d39d09b1916524d825d5",
    note: "V6 launch 0 used the factory’s one-time official identity authorization. The receipt records the original V4 token and the new V6 issuance."
  },
  {
    id: "v4-original-provenance",
    title: "Original RMT V4 issuance",
    token: "0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C",
    curve: "0xfeee90288a7037fbdb4ec5b05dc7cc5e762d5fb7",
    block: "9156510",
    transaction: "0xe5cd6ed09a3cccae743b7c29c0ee0971f3797986bce171eadc3642de60b3410b",
    note: "V4 launch 1 is the legacy identity recorded by the V6 factory. Each issuance has its own token supply and curve."
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
        <h1>Verify RMT by network and contract address.</h1>
        <p className={styles.lead}>
          RMT means Robinhood Meme Terminal. This page is the canonical public identity reference for the RMT website,
          Robinhood Chain network, and public repository. Token names and tickers can be duplicated, so exact contract and
          network identity remain essential.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primaryAction} href="/">Open RMT Launch</Link>
          <a className={styles.secondaryAction} href="#v6-official-provenance">Verify the V6 issuance</a>
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

      <section id="legacy-token" className={styles.section} aria-labelledby="legacy-rmt">
        <div className={styles.sectionHeading}>
          <h2 id="legacy-rmt">Legacy RMT</h2>
        </div>
        <div className={styles.splitSection}>
          {legacyIssuances.map((issuance) => (
            <article id={issuance.id} key={issuance.id}>
              <h3>{issuance.title}</h3>
              <p>{issuance.note}</p>
              <p>Token <a href={`${explorer}/address/${issuance.token}`} target="_blank" rel="noreferrer"><code style={{ overflowWrap: "anywhere" }}>{issuance.token}</code></a></p>
              <p>Curve <a href={`${explorer}/address/${issuance.curve}`} target="_blank" rel="noreferrer"><code style={{ overflowWrap: "anywhere" }}>{issuance.curve}</code></a></p>
              <p>
                <a href={`${explorer}/tx/${issuance.transaction}`} target="_blank" rel="noreferrer">Creation receipt</a>
                {" · "}
                <a href={`${explorer}/block/${issuance.block}`} target="_blank" rel="noreferrer">Block {issuance.block}</a>
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.splitSection}>
        <article>
          <p className={styles.kicker}>PRODUCT IDENTITY</p>
          <h2>RMT Launch</h2>
          <p>Explore token launches and verify each token’s contract and onchain launch terms.</p>
          <Link href="/">Browse launches →</Link>
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
          <Link href="/">RMT Launch<span>Canonical RMT application</span></Link>
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
