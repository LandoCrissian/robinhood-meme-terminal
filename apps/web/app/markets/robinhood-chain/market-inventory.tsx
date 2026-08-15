import Link from "next/link";
import { RMT_SITE_NAME, RMT_SITE_URL } from "../../../lib/site-identity";
import { SiteFooter } from "../../site-footer";
import {
  PUBLIC_VNEXT_MARKET_INVENTORY_VIEWS,
  fetchPublicVNextDirectorySnapshot,
  selectPublicVNextMarketInventory,
  type PublicVNextMarketInventoryView
} from "../../../lib/server/public-vnext-market-inventory";
import styles from "./market-inventory.module.css";

type MarketInventoryProps = {
  view: PublicVNextMarketInventoryView;
  title: string;
  description: string;
};

function compactUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return "$" + value.toLocaleString("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1 ? 2 : 6
  });
}

function priceUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 0.000001) return "<$0.000001";
  return "$" + value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 1 ? 2 : value >= 0.01 ? 4 : 8
  });
}

function percent(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0.00%";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function marketAge(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return "Unknown";
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (24 * 60))}d`;
}

function updatedLabel(updatedAt: string | undefined) {
  if (!updatedAt) return "Latest available directory snapshot";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(new Date(updatedAt)) + " UTC";
}

function cleanSymbol(symbol: string) {
  return symbol.replaceAll("$", "").trim();
}

export async function MarketInventory({ view, title, description }: MarketInventoryProps) {
  const snapshot = await fetchPublicVNextDirectorySnapshot();
  const markets = selectPublicVNextMarketInventory(snapshot.markets, view);
  const activeView = PUBLIC_VNEXT_MARKET_INVENTORY_VIEWS.find((candidate) => candidate.id === view)!;
  const pageUrl = `${RMT_SITE_URL}${activeView.path}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${pageUrl}#webpage`,
        url: pageUrl,
        name: title,
        description,
        isPartOf: { "@id": `${RMT_SITE_URL}/#website` },
        mainEntity: { "@id": `${pageUrl}#markets` },
        inLanguage: "en-US",
        ...(snapshot.updatedAt ? { dateModified: snapshot.updatedAt } : {}),
        about: { "@type": "Thing", name: "Robinhood Chain markets" }
      },
      {
        "@type": "ItemList",
        "@id": `${pageUrl}#markets`,
        name: `${activeView.label} on Robinhood Chain`,
        numberOfItems: markets.length,
        itemListElement: markets.map((market, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "Thing",
            name: `${market.name} (${cleanSymbol(market.symbol)})`,
            identifier: market.address
          }
        }))
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: RMT_SITE_NAME, item: `${RMT_SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Robinhood Chain", item: `${RMT_SITE_URL}/robinhood-chain` },
          { "@type": "ListItem", position: 3, name: activeView.label, item: pageUrl }
        ]
      }
    ]
  } as const;

  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />

      <header className={styles.hero}>
        <p className={styles.eyebrow}>ROBINHOOD CHAIN · PUBLIC MARKET DIRECTORY</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className={styles.actions}>
          <Link className={styles.primaryAction} href="/">Open RMT Terminal</Link>
          <Link className={styles.secondaryAction} href="/robinhood-chain">Robinhood Chain overview</Link>
        </div>
      </header>

      <nav className={styles.views} aria-label="Robinhood Chain market directory views">
        {PUBLIC_VNEXT_MARKET_INVENTORY_VIEWS.map((candidate) => (
          <Link
            key={candidate.id}
            href={candidate.path}
            aria-current={candidate.id === view ? "page" : undefined}
          >
            <strong>{candidate.label}</strong>
            <span>{candidate.summary}</span>
          </Link>
        ))}
      </nav>

      <section className={styles.snapshot} aria-labelledby="market-inventory-heading">
        <div className={styles.snapshotHeader}>
          <div>
            <p className={styles.kicker}>CANONICAL VNEXT DIRECTORY</p>
            <h2 id="market-inventory-heading">{activeView.label}</h2>
          </div>
          <div className={styles.snapshotMeta}>
            <strong>{markets.length} markets</strong>
            {snapshot.updatedAt ? (
              <time dateTime={snapshot.updatedAt}>{updatedLabel(snapshot.updatedAt)}</time>
            ) : (
              <span>{updatedLabel(undefined)}</span>
            )}
            {snapshot.stale ? <span className={styles.stale}>Snapshot delayed</span> : null}
          </div>
        </div>

        {markets.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.srOnly}>{description}</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Market</th>
                  <th scope="col">Contracts</th>
                  <th scope="col">Venue</th>
                  <th scope="col">Liquidity</th>
                  <th scope="col">24h volume</th>
                  <th scope="col">Price</th>
                  <th scope="col">24h</th>
                  <th scope="col">Age</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((market, index) => (
                  <tr key={market.address}>
                    <td>{index + 1}</td>
                    <td>
                      <strong>{market.name}</strong>
                      <span>${cleanSymbol(market.symbol)}</span>
                      <span className={styles.signal}>{market.signal}</span>
                    </td>
                    <td>
                      <span className={styles.contractLabel}>Token</span>
                      <code>{market.address}</code>
                      <span className={styles.contractLabel}>Pair</span>
                      <code>{market.pairAddress}</code>
                    </td>
                    <td>{market.dexId ?? "DEX"}</td>
                    <td>{compactUsd(market.liquidityUsd)}</td>
                    <td>{compactUsd(market.volume24h)}</td>
                    <td>{priceUsd(market.priceUsd)}</td>
                    <td>{percent(market.priceChange24h)}</td>
                    <td>{marketAge(market.ageMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <h3>Market inventory is temporarily unavailable.</h3>
            <p>{snapshot.error ?? "RMT could not load a qualified public directory snapshot."}</p>
            <Link href="/">Open the live terminal instead →</Link>
          </div>
        )}
      </section>

      <section className={styles.methodology}>
        <article>
          <p className={styles.kicker}>PUBLIC SEARCH POLICY</p>
          <h2>Activity is not verification.</h2>
          <p>
            This inventory publishes markets with an exact token and pair address, at least $5,000 of observed liquidity,
            and at least $100 of 24-hour volume. Inclusion does not prove project ownership, safety, authenticity, or future liquidity.
          </p>
        </article>
        <article>
          <p className={styles.kicker}>TRADER CONTROL</p>
          <h2>Use the contract, then verify in the terminal.</h2>
          <p>
            Token names and symbols can be duplicated. Copy the exact contract into RMT, review current origin, venue and execution
            evidence, and authorize any transaction only from your connected wallet.
          </p>
        </article>
      </section>

      <aside className={styles.disclaimer}>
        Robinhood Meme Terminal is independent software and is not Robinhood Markets, Inc. Market data can change rapidly and is not financial advice.
      </aside>

      <SiteFooter />
    </main>
  );
}
