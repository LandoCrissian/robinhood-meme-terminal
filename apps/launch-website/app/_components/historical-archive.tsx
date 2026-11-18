import { readLaunchDirectory } from "../../lib/server/launch-data";
import { robinhoodExplorer } from "./launch-evidence";
import { ChainTime } from "./launch-freshness";

export async function HistoricalArchive() {
  const history = await readLaunchDirectory();
  return <details className="lpArchive"><summary>Historical registrations{history.status !== "unavailable" ? ` · ${history.launches.length} records` : " · evidence unavailable"}</summary>
    <p>Archived V4/V6 registrations and deployment tests. These are not projects created through the new RMT Launch engine.</p>
    {history.checkpoint && <p>{history.status === "stale" ? "Stale historical snapshot" : "Historical index checkpoint"} · block {history.checkpoint.blockNumber} · <ChainTime value={history.checkpoint.timestamp} />. Ethereum L1 finality is unverified.</p>}
    {history.status === "unavailable" ? <p role="status">Historical evidence is unavailable. No balances or activity are inferred.</p> : <div className="lpArchiveGrid">{history.launches.map((launch) => <article className="lpArchiveRecord" key={`${launch.factory}:${launch.launchId}`}>
      <h3>{launch.name} · {launch.symbol}</h3><span className="lpPill">Historical V{launch.version} · {launch.classification === "deployment-test" ? "Deployment test" : launch.classification === "retired" ? "Retired record" : "Registration"}</span>
      <p><a className="lpAddress" href={`${robinhoodExplorer}/address/${launch.token}`}>{launch.token}</a></p>
      <p><a href={`${robinhoodExplorer}/tx/${launch.receipt.transactionHash}`}>Registration receipt ↗</a> · <ChainTime value={launch.receipt.timestamp} /></p>
    </article>)}</div>}
  </details>;
}
