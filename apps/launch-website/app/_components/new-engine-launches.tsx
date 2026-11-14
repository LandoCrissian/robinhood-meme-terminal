import Link from "next/link";
import { describeCurveLifecycle, hasCurveRegistration, type CurveLaunch, type NewEngineDirectory } from "../../lib/curve-lifecycle";
import { robinhoodExplorer } from "./launch-evidence";
import { ChainTime } from "./launch-freshness";

function units(wei: string) {
  const padded = wei.padStart(19, "0");
  const whole = BigInt(padded.slice(0, -18)).toLocaleString("en-US");
  const fraction = padded.slice(-18).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function LifecycleEvidence({ launch }: { launch: CurveLaunch }) {
  const lifecycle = describeCurveLifecycle(launch);
  if (lifecycle.stage === "active" || lifecycle.stage === "graduating") {
    const observed = lifecycle.observation;
    return <>
      <dt>Current curve</dt><dd><code className="lpAddress">{observed.engine}</code> · V{observed.version}</dd>
      <dt>Sold</dt><dd>{units(observed.soldWei)} / {units(observed.targetSoldWei)} tokens</dd>
      <dt>ETH backing</dt><dd>{units(observed.backingWei)} / {units(observed.targetBackingWei)} ETH</dd>
      <dt>Curve observation</dt><dd>Block {observed.at.blockNumber} · <ChainTime value={observed.at.timestamp} /></dd>
    </>;
  }
  if (lifecycle.stage === "graduated") {
    const { market, receipt, version } = lifecycle.observation;
    return <>
      <dt>Graduation receipt</dt><dd><a href={`${robinhoodExplorer}/tx/${receipt.transactionHash}`}>Block {receipt.blockNumber} · log {receipt.logIndex}</a> · V{version}</dd>
      <dt>PoolManager</dt><dd><code className="lpAddress">{market.poolManager}</code></dd>
      <dt>Pool ID</dt><dd><code className="lpAddress">{market.poolId}</code></dd>
      <dt>Pool key</dt><dd>ETH / token · {market.poolKey.fee / 10_000}% fee · tick spacing {market.poolKey.tickSpacing} · hook <code className="lpAddress">{market.poolKey.hooks}</code></dd>
      <dt>Starting deposits</dt><dd>{units(market.nativeDepositedWei)} ETH · {units(market.tokenDepositedWei)} tokens</dd>
      <dt>Initial position</dt><dd>#{market.positionId} · <code className="lpAddress">{market.positionManager}</code></dd>
      <dt>Observed owner</dt><dd><code className="lpAddress">{market.owner}</code></dd>
      <dt>Position liquidity</dt><dd>{market.liquidity}</dd>
    </>;
  }
  return <><dt>Curve and v4 state</dt><dd>Unverified</dd></>;
}

export function NewEngineLaunches({ directory }: { directory: NewEngineDirectory }) {
  const launches = directory.status === "ready"
    ? directory.launches.filter(({ registration }) => hasCurveRegistration(registration)) : [];
  return <section className="lpNotice lpProjectLink" aria-label="New RMT Launch engine">
    <span className="lpPill">{directory.status === "prelaunch" ? "Prelaunch" : "New engine"}</span>
    {directory.status === "prelaunch" && <span>The new RMT Launch engine is in prelaunch. Prepare a token draft while creation is disabled.</span>}
    {directory.status === "unavailable" && <span>New-engine evidence is unavailable.</span>}
    {directory.status === "ready" && launches.length === 0 && <span>No verified new-engine launches.</span>}
    {launches.map((launch) => {
      const { registration } = launch;
      return <section className="lpPanel lpForm" key={`${registration.chainId}:${registration.factory}:${registration.token}`}>
        <h3>{registration.name} · {registration.symbol}</h3>
        <p>{describeCurveLifecycle(launch).label}</p>
        <dl className="lpFacts lpProjectLink">
          <dt>New-engine token</dt><dd><a href={`${robinhoodExplorer}/address/${registration.token}`} className="lpAddress">{registration.token}</a></dd>
          <dt>Factory registration</dt><dd><a href={`${robinhoodExplorer}/tx/${registration.creation.transactionHash}`}>Block {registration.creation.blockNumber} · log {registration.creation.logIndex}</a></dd>
          <LifecycleEvidence launch={launch} />
          <dt>Ethereum L1 finality</dt><dd>Unverified</dd>
        </dl>
      </section>;
    })}
    {directory.status === "prelaunch" && <Link href="/create-token" prefetch={false}>Prepare a draft</Link>}
  </section>;
}
