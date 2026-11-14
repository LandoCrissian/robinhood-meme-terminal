import Link from "next/link";
import type { HistoricalLaunch, LaunchDirectoryData } from "../../lib/launch-data";
import { launchClassificationLabel, launchLifecycleLabel, robinhoodExplorer } from "./launch-evidence";
import { ChainTime, LaunchFreshness } from "./launch-freshness";
import { TokenArtwork } from "./token-artwork";

function Address({ value }: { value: string }) {
  return <a href={`${robinhoodExplorer}/address/${value}`}><code className="lpAddress">{value}</code></a>;
}

export function HistoricalLaunchDetails({ launch, data }: { launch: HistoricalLaunch; data: LaunchDirectoryData }) {
  const { receipt, lifecycleAt } = launch;
  const migrationReceipt = launch.lifecycle === "graduated" && lifecycleAt && "transactionHash" in lifecycleAt ? lifecycleAt : null;
  return <>
    <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
    <header className="lpPageHeading">
      <div className="lpTokenHeading">
        <TokenArtwork symbol={launch.symbol} />
        <div><h1>{launch.name}</h1><p>{launch.symbol} · Robinhood Chain 4663</p></div>
      </div>
      <span className="lpPill">{launchClassificationLabel[launch.classification]} V{launch.version}</span>
    </header>
    <LaunchFreshness data={data} />
    {launch.classification === "deployment-test" && <p className="lpNotice">This onchain registration was a deployment test.</p>}
    <div className="lpColumns">
      <section className="lpPanel lpForm">
        <h2>Launch provenance</h2>
        <dl className="lpFacts lpProjectLink">
          <dt>Token contract</dt><dd><Address value={launch.token} /></dd>
          <dt>RMT factory</dt><dd><Address value={launch.factory} /></dd>
          <dt>Factory launch ID</dt><dd>{launch.launchId}</dd>
          <dt>Project creator</dt><dd>{launch.creator ? <Address value={launch.creator} /> : "Unavailable"}</dd>
          <dt>Recorded curve or market</dt><dd><Address value={launch.market} /></dd>
          <dt>Observed lifecycle</dt><dd>{launchLifecycleLabel[launch.lifecycle]}</dd>
          {lifecycleAt && <>
            <dt>Lifecycle observation</dt><dd>Block <a href={`${robinhoodExplorer}/block/${lifecycleAt.blockNumber}`}>{lifecycleAt.blockNumber}</a> · <ChainTime value={lifecycleAt.timestamp} /></dd>
          </>}
          {launch.reservedPoolId && <>
            <dt>Reserved pool ID</dt><dd><code className="lpAddress">{launch.reservedPoolId}</code></dd>
          </>}
        </dl>
        {launch.reservedPoolId && <p>The reserved ID identifies a proposed pool. Active liquidity is unverified.</p>}
        <p>Current liquidity, price, volume and holder balances are unavailable in this view.</p>
      </section>
      <section className="lpPanel lpForm">
        <h2>Confirmed activity</h2>
        <dl className="lpFacts lpProjectLink">
          <dt>Factory registration</dt><dd><ChainTime value={receipt.timestamp} /></dd>
          <dt>Transaction receipt</dt><dd><a href={`${robinhoodExplorer}/tx/${receipt.transactionHash}`}><code className="lpAddress">{receipt.transactionHash}</code></a></dd>
          <dt>Block</dt><dd><a href={`${robinhoodExplorer}/block/${receipt.blockNumber}`}>{receipt.blockNumber}</a></dd>
          <dt>Block hash</dt><dd><code className="lpAddress">{receipt.blockHash}</code></dd>
          <dt>Log index</dt><dd>{receipt.logIndex}</dd>
          {migrationReceipt && <>
            <dt>Graduation receipt</dt><dd><a href={`${robinhoodExplorer}/tx/${migrationReceipt.transactionHash}`}><code className="lpAddress">{migrationReceipt.transactionHash}</code></a></dd>
            <dt>Graduation block and log</dt><dd>
              <a href={`${robinhoodExplorer}/block/${migrationReceipt.blockNumber}`}>{migrationReceipt.blockNumber}</a> · Log {migrationReceipt.logIndex} · <ChainTime value={migrationReceipt.timestamp} />
            </dd>
          </>}
          <dt>Ethereum L1 finality</dt><dd>Unverified</dd>
        </dl>
        <p>Trading and new token creation remain disabled.</p>
      </section>
    </div>
  </>;
}
