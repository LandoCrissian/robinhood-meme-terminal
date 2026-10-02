import { readLaunchIntelligence } from "../../lib/server/launch-intelligence-reader";
import { LaunchDiscovery } from "./launch-discovery";
export const dynamic = "force-dynamic";
export default async function LaunchesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; source?: string }>;
}) {
  const params = await searchParams,
    q = typeof params.q === "string" ? params.q.trim().slice(0, 160) : "",
    source = ["PONS", "STONKBROKERS"].includes(params.source ?? "")
      ? params.source
      : undefined;
  const directory = await readLaunchIntelligence({
    q: q || undefined,
    source,
    limit: 50,
  });
  return (
    <main className="rmtLaunchPage">
      <header className="rmtLaunchHero">
        <LinkToMarkets />
        <p>Robinhood Chain · Discover</p>
        <h1>
          Launches<span>.</span>
        </h1>
        <div>New tokens. Their origins. The journey to a market.</div>
      </header>
      <form className="rmtLaunchSearch" action="/launches">
        <label htmlFor="launch-search">Find a launch</label>
        <div>
          <input
            id="launch-search"
            name="q"
            defaultValue={q}
            placeholder="Token, symbol or exact contract"
            maxLength={160}
          />
          <button type="submit">Search</button>
        </div>
        {source ? <input type="hidden" name="source" value={source} /> : null}
      </form>
      <LaunchDiscovery
        key={`${source ?? "ALL"}:${q}`}
        initial={directory}
        query={q}
        source={source}
        observedNow={Date.now()}
      />
      <p className="rmtLaunchFootnote">
        Onchain launch provenance. No quality scores or endorsements. Trading
        uses RMT’s existing 0x integration.
      </p>
    </main>
  );
}
function LinkToMarkets() {
  return <a href="/">Markets / Launches</a>;
}
