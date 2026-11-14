import type { Metadata } from "next";
import Link from "next/link";
import { readLaunchDirectory } from "../../lib/server/launch-data";
import { robinhoodExplorer } from "../_components/launch-evidence";
import { ChainTime } from "../_components/launch-freshness";

export const metadata: Metadata = { title: "Legacy RMT | RMT Launch" };
export const dynamic = "force-dynamic";

const issuances = [
  {
    title: "Official RMT V6 issuance",
    token: "0xdBa33be56C89CC9fc014c4459028d7e5c7878671",
    version: 6,
    launchId: "0",
    note: "The V6 launch 0 receipt records the original V4 token and the official V6 issuance.",
  },
  {
    title: "Original RMT V4 issuance",
    token: "0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C",
    version: 4,
    launchId: "1",
    note: "V4 launch 1 is the legacy identity recorded by the V6 factory. Each issuance has its own token supply and curve.",
  },
] as const;

export default async function LegacyRmtPage() {
  const records = await Promise.all(issuances.map(async ({ token, version, launchId, ...details }) => {
    const data = await readLaunchDirectory(token);
    const record = data.launches.find((launch) => launch.token.toLowerCase() === token.toLowerCase()
      && launch.version === version && launch.launchId === launchId);
    return { token, ...details, record };
  }));
  return <>
    <header className="lpPageHeading">
      <div><h1>Legacy RMT</h1><p>Recorded issuances on Robinhood Chain · Chain ID 4663</p></div>
      <Link className="lpButton lpSecondary" href="/" prefetch={false}>Browse launches</Link>
    </header>
    <p className="lpNotice">Historical provenance on Robinhood Chain. Verify each issuance by network and contract address.</p>
    <div className="lpColumns">
      {records.map(({ title, token, note, record }) => (
        <section className="lpPanel lpForm" key={token}>
          <h2>{title}</h2>
          {record ? <>
            <p>{note}</p>
            <dl className="lpFacts lpProjectLink">
              <dt>Token</dt><dd><a href={`${robinhoodExplorer}/address/${record.token}`}><code className="lpAddress">{record.token}</code></a></dd>
              <dt>Curve</dt><dd><a href={`${robinhoodExplorer}/address/${record.market}`}><code className="lpAddress">{record.market}</code></a></dd>
              <dt>Creation receipt</dt><dd><a href={`${robinhoodExplorer}/tx/${record.receipt.transactionHash}`}>Open on Blockscout</a></dd>
              <dt>Block</dt><dd><a href={`${robinhoodExplorer}/block/${record.receipt.blockNumber}`}>{record.receipt.blockNumber}</a> · <ChainTime value={record.receipt.timestamp} /></dd>
            </dl>
            <Link className="lpBack" href={`/launches/${record.token}`} prefetch={false}>View launch evidence</Link>
          </> : <p>Verified receipt unavailable for <code className="lpAddress">{token}</code>.</p>}
        </section>
      ))}
    </div>
  </>;
}
