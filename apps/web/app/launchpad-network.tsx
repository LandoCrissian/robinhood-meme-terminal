"use client";

type SourceStatus = "live" | "review" | "queued";

type LaunchpadSource = {
  name: string;
  url: string;
  status: SourceStatus;
  statusLabel: string;
  capability: string;
  disclosure: string;
};

const SOURCES: LaunchpadSource[] = [
  {
    name: "RMT",
    url: "https://www.rmtlaunch.fun",
    status: "live",
    statusLabel: "LIVE + VERIFIED",
    capability: "Discover · Passport · Trade",
    disclosure: "RMT-native origin and external-market evidence remain visibly separate. New public creation stays paused until V7."
  },
  {
    name: "DEX Screener",
    url: "https://docs.dexscreener.com/api/reference",
    status: "live",
    statusLabel: "LIVE · MARKET DATA",
    capability: "Activity · Liquidity · Public discovery",
    disclosure: "RMT ranks eligible markets from documented public fields. Artwork is a fallback only and must come from Dexscreener’s HTTPS CDN."
  },
  {
    name: "Uniswap Launches",
    url: "https://blog.uniswap.org/launch-aggregator-explore-top-uniswap-launchpads-in-one-place",
    status: "live",
    statusLabel: "BETA · OFFICIAL",
    capability: "External launch distribution",
    disclosure: "RMT verifies recognized launch source and Uniswap market separately. Individual beta-feed inclusion is never assumed."
  },
  {
    name: "Uniswap liquidity",
    url: "https://blog.uniswap.org/robinhood-chain-is-live",
    status: "live",
    statusLabel: "LIVE · ROUTED",
    capability: "Markets · Quotes · Execution",
    disclosure: "RMT independently verifies the exact Robinhood Chain pool and route before preparing a non-custodial order."
  },
  {
    name: "Sushi liquidity",
    url: "https://www.sushi.com/robinhood/swap",
    status: "live",
    statusLabel: "LIVE · ROUTED",
    capability: "Markets · Quotes · Execution",
    disclosure: "A verified Sushi market is tradeable inside RMT without implying that Sushi created or endorsed the token."
  },
  {
    name: "Sushi Launch",
    url: "https://www.sushi.com/robinhood",
    status: "review",
    statusLabel: "CONTRACT WATCH",
    capability: "Origin adapter prepared",
    disclosure: "Announced by a Sushi contributor. Attribution remains disabled until production contracts, events, and deployment blocks are published and replay-tested."
  }
];

export function LaunchpadNetwork() {
  return (
    <section className="panel launchpadNetwork" aria-labelledby="launchpad-network-title">
      <div className="feedHeading launchpadNetworkHeading">
        <div>
          <p className="eyebrow">LAUNCH DISTRIBUTION NETWORK</p>
          <h2 id="launchpad-network-title">Origin, liquidity and reach—verified separately.</h2>
          <p>RMT connects launch sources to live markets and external distribution without pretending that one piece of evidence proves the others.</p>
        </div>
        <span className="networkPhase">LIVE · EVIDENCE FIRST</span>
      </div>

      <div className="launchpadSourceGrid">
        {SOURCES.map((source) => (
          <a className={`launchpadSourceCard ${source.status}`} href={source.url} target="_blank" rel="noreferrer" key={source.name}>
            <span className="launchpadSourceTop">
              <strong>{source.name}</strong>
              <em>{source.statusLabel}</em>
            </span>
            <span className="launchpadCapability">{source.capability}</span>
            <small>{source.disclosure}</small>
            <b>Visit source ↗</b>
          </a>
        ))}
      </div>

      <p className="launchpadNetworkDisclosure">
        External tokens keep their original economics and security assumptions. An RMT market passport is evidence, not endorsement, partnership, or a guarantee of external listing.
      </p>
    </section>
  );
}
