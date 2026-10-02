import { readLaunchIntelligence } from "../../lib/server/launch-intelligence-reader";
import { TerminalIcon } from "../vnext/terminal-icon";
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
        <div><h1>Launches</h1><p>Robinhood Chain · Onchain origins</p></div>
        <a href="/">Markets <TerminalIcon name="chevron" /></a>
      </header>
      <form className="rmtMarketSearch rmtLaunchSearch" action="/launches" role="search">
        <TerminalIcon name="search" />
        <label className="vnSrOnly" htmlFor="launch-search">Find a launch</label>
        <input id="launch-search" name="q" defaultValue={q} placeholder="Token, symbol or exact contract"
          maxLength={160} autoComplete="off" spellCheck={false} />
        <button className="rmtSearchSubmit" type="submit">Find</button>
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
        Launch origin is not an endorsement. Explore a token for market data and trading availability.
      </p>
    </main>
  );
}