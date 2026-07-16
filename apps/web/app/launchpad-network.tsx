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
    capability: "Launch · Discover · Trade",
    disclosure: "Official V6 factory, Fair Start, rewards, and graduation rules verified by RMT."
  },
  {
    name: "hood.fun",
    url: "https://hood.fun",
    status: "review",
    statusLabel: "ADAPTER REVIEW",
    capability: "External discovery next",
    disclosure: "External contracts and economics. Factory and event verification must finish before token attribution."
  },
  {
    name: "Robinfun",
    url: "https://robinfun.live",
    status: "review",
    statusLabel: "ADAPTER REVIEW",
    capability: "External discovery next",
    disclosure: "External contracts and economics. Factory and event verification must finish before token attribution."
  },
  {
    name: "real.fun",
    url: "https://real.fun",
    status: "queued",
    statusLabel: "SOURCE CHECK",
    capability: "Verification queued",
    disclosure: "Robinhood Chain launch source and contract history still need independent confirmation."
  },
  {
    name: "Leavehood",
    url: "https://leavehood.com",
    status: "queued",
    statusLabel: "SOURCE CHECK",
    capability: "Verification queued",
    disclosure: "External launch flow reviewed; factory, events, and live market history still need confirmation."
  },
  {
    name: "Pons",
    url: "https://pons.family",
    status: "queued",
    statusLabel: "SECURITY CHECK",
    capability: "Approval flow review",
    disclosure: "External approval, creator-wallet, factory, and market behavior require verification before indexing."
  },
  {
    name: "Bow.fun",
    url: "https://bow.fun",
    status: "review",
    statusLabel: "ADAPTER REVIEW",
    capability: "External discovery next",
    disclosure: "External contracts and economics. Factory and event verification must finish before token attribution."
  }
];

export function LaunchpadNetwork() {
  return (
    <section className="panel launchpadNetwork" aria-labelledby="launchpad-network-title">
      <div className="feedHeading launchpadNetworkHeading">
        <div>
          <p className="eyebrow">MULTI-LAUNCHPAD ROADMAP</p>
          <h2 id="launchpad-network-title">One terminal. Every origin labeled.</h2>
          <p>RMT is live now. External sources are being connected in read-only mode first, then trading only after their contracts and execution paths are verified.</p>
        </div>
        <span className="networkPhase">PHASE 1 · DISCOVERY</span>
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
        External tokens keep their original platform economics and security assumptions. An RMT listing never converts an external token into an RMT-verified launch.
      </p>
    </section>
  );
}
